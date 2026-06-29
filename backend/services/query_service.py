import os
import re
from dotenv import load_dotenv

load_dotenv()

from sqlalchemy.orm import Session
from sqlalchemy import text

from clients import groq_client
from services import flow_service


def _keyword_search(repo_id: str, query: str, db: Session, limit: int = 10) -> list:
    """
    SQLite-compatible keyword search using LIKE.
    Searches for individual words from the query across code chunks.
    Falls back to a simple LIMIT query if no words match.
    """
    words = [w.strip() for w in re.split(r"\W+", query) if len(w.strip()) > 2]

    if words:
        # Build a LIKE clause for each word (OR across words)
        conditions = " OR ".join([f"content LIKE :w{i}" for i in range(len(words))])
        params = {"repo_id": repo_id}
        params.update({f"w{i}": f"%{w}%" for i, w in enumerate(words)})
        rows = db.execute(
            text(f"""
                SELECT file_path, content, start_line, end_line
                FROM code_chunks
                WHERE repo_id = :repo_id AND ({conditions})
                LIMIT {limit}
            """),
            params,
        ).fetchall()
    else:
        rows = db.execute(
            text("""
                SELECT file_path, content, start_line, end_line
                FROM code_chunks
                WHERE repo_id = :repo_id
                LIMIT :limit
            """),
            {"repo_id": repo_id, "limit": limit},
        ).fetchall()

    return rows


def get_symbol_context(repo_id: str, file_paths: list[str], db: Session) -> str:
    if not file_paths:
        return ""

    # SQLite-compatible IN clause (no ANY() support)
    placeholders = ", ".join([f":p{i}" for i in range(len(file_paths))])
    params = {"repo_id": repo_id}
    params.update({f"p{i}": fp for i, fp in enumerate(file_paths)})

    rows = db.execute(text(f"""
        SELECT file_path, functions, classes, imports, top_level_docstring
        FROM file_symbols
        WHERE repo_id = :repo_id AND file_path IN ({placeholders})
    """), params).fetchall()

    if not rows:
        return ""

    import json as _json

    def _parse_json(val):
        if not val:
            return []
        if isinstance(val, str):
            try:
                return _json.loads(val)
            except Exception:
                return []
        return val

    parts = ["## File Structure (AST Analysis)\n"]
    for row in rows:
        short_path = row.file_path.split("/")[-1]
        parts.append(f"### {short_path}")
        if row.top_level_docstring:
            parts.append(f"_{row.top_level_docstring}_\n")
        
        imports = _parse_json(row.imports)
        if imports:
            parts.append(f"**Imports:** {', '.join(imports[:10])}")
        
        classes = _parse_json(row.classes)
        if classes:
            for cls in classes:
                if not isinstance(cls, dict):
                    continue
                method_names = [m["name"] for m in cls.get("methods", []) if isinstance(m, dict) and "name" in m]
                parts.append(f"**Class `{cls.get('name')}`** (line {cls.get('line')})")
                if cls.get("docstring"):
                    parts.append(f"  - {cls['docstring']}")
                if method_names:
                    parts.append(f"  - Methods: {', '.join(method_names)}")
        
        functions = _parse_json(row.functions)
        if functions:
            for fn in functions:
                if not isinstance(fn, dict):
                    continue
                args = ", ".join(fn.get("args", []))
                parts.append(f"**Function `{fn.get('name')}({args})`** (line {fn.get('line')})")
                if fn.get("docstring"):
                    parts.append(f"  - {fn['docstring']}")
        parts.append("")
    return "\n".join(parts)


_SMALLTALK_PATTERNS = [
    r"^(hi+|hey+|hello+|hola|sup|what'?s up|yo+|howdy|greetings|good\s*(morning|afternoon|evening|day))\W*$",
    r"^(thanks?|thank\s*you|ty|thx|thank\s*u|cheers|much\s*appreciated)\W*$",
    r"^(bye+|goodbye+|see\s*ya|see\s*you|cya|later|take\s*care|farewell)\W*$",
    r"^(ok+|okay+|got\s*it|alright|sure|cool|nice|great|awesome|perfect|sounds?\s*good)\W*$",
    r"who\s+are\s+you|what\s+are\s+you|what\s+(can|do)\s+you\s+do|your\s+purpose",
]

_CONVERSATIONAL_SYSTEM = (
    "You are Codebase Assistant, an AI that helps developers understand GitHub repositories. "
    "You can explain architecture, trace function flows, find where logic lives, and answer "
    "questions about any ingested codebase. "
    "When the user sends a greeting, thanks, farewell, or any non-code question, "
    "respond naturally and briefly in a friendly tone. "
    "Do not produce code snippets or file references unless the user asks a code question. "
    "Keep replies concise — 1-3 sentences max."
)


def is_smalltalk(question: str) -> bool:
    q = question.strip().lower()
    return any(re.search(p, q) for p in _SMALLTALK_PATTERNS)


def detect_intent(question: str) -> tuple[str, str | None]:
    q = question.lower()

    arch_patterns = [
        "architecture", "overview diagram", "system diagram",
        "how does the system", "high level", "overall structure", "architecture diagram",
    ]
    if any(p in q for p in arch_patterns):
        return "architecture", None

    flow_patterns = [
        "trace", "flow", "execution", "how does .* work",
        "walk me through", "step by step", "call chain", "how is .* called",
    ]
    for pattern in flow_patterns:
        if re.search(pattern, q):
            fn_match = re.search(r'`([^`]+)`|"([^"]+)"|(\b\w+(?:_\w+)*)\(\)', question)
            if fn_match:
                fn_name = fn_match.group(1) or fn_match.group(2) or fn_match.group(3)
                return "flow", fn_name
            return "flow", None

    return "normal", None


async def answer(repo_id: str, question: str, db: Session) -> dict:
    if is_smalltalk(question):
        llm_response = await groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": _CONVERSATIONAL_SYSTEM},
                {"role": "user", "content": question},
            ],
        )
        return {"answer": llm_response.choices[0].message.content, "sources": [], "mermaid": None}

    intent, fn_name = detect_intent(question)

    if intent == "architecture":
        result = await flow_service.get_architecture(repo_id, db)
        if "error" in result:
            return {"answer": result["error"], "sources": [], "mermaid": None}
        answer_text = result["explanation"] + "\n\n*Architecture diagram rendered below.*"
        return {"answer": answer_text, "sources": [], "mermaid": result["mermaid"], "diagram_type": "architecture"}

    if intent == "flow" and fn_name:
        result = await flow_service.get_flow(repo_id, fn_name, db)
        if "error" not in result:
            answer_text = result["explanation"] + "\n\n*Flow diagram rendered below.*"
            return {"answer": answer_text, "sources": [], "mermaid": result["mermaid"], "diagram_type": "flow"}

    # ── keyword search (SQLite-compatible LIKE) ───────────────
    all_chunks = _keyword_search(repo_id, question, db)

    if not all_chunks:
        llm_response = await groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": _CONVERSATIONAL_SYSTEM},
                {"role": "user", "content": question},
            ],
        )
        return {"answer": llm_response.choices[0].message.content, "sources": [], "mermaid": None}

    matched_files = list(set(c.file_path for c in all_chunks))
    symbol_context = get_symbol_context(repo_id, matched_files, db)
    code_context = "\n\n".join([
        f"# {c.file_path} (lines {c.start_line}–{c.end_line})\n{c.content}"
        for c in all_chunks
    ])
    full_context = (
        (symbol_context + "\n---\n\n## Relevant Code Snippets\n\n" + code_context)
        if symbol_context else code_context
    )

    llm_response = await groq_client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a helpful code assistant with deep understanding of code structure. "
                    "You are given both a structural summary of files (classes, functions, imports) "
                    "and the actual relevant code snippets. "
                    "Use both to give precise, accurate answers. "
                    "Always mention which file(s) and function/class names are relevant. "
                    "Format your answer clearly using markdown."
                ),
            },
            {"role": "user", "content": f"Here is the codebase context:\n\n{full_context}\n\nQuestion: {question}"},
        ],
    )

    final_answer = llm_response.choices[0].message.content
    sources = list(set(c.file_path for c in all_chunks))
    return {"answer": final_answer, "sources": sources, "mermaid": None}
