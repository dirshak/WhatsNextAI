"""
routers/propose.py

POST /api/propose-feature — GraphForgeAI feature proposal endpoint.

Pipeline:
    Current Graph (from DB)
        ↓
    FeatureProposer (Groq reasoning)
        ↓
    Mutation JSON
        ↓
    GraphMutator (pure graph manipulation)
        ↓
    Updated Graph
        ↓
    React Flow + Mermaid Architecture + Mermaid ER + Implementation Plan
"""
import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text

from database import SessionLocal
from feature_proposer import FeatureProposer
from mutator import GraphMutator
from rate_limit import limiter

logger = logging.getLogger(__name__)
router = APIRouter()


class ProposeRequest(BaseModel):
    repo_id: str
    feature: str


def _build_graph_from_db(repo_id: str, db) -> dict:
    """
    Reconstruct the knowledge graph from the database in the same format
    that FeatureProposer and GraphMutator expect:
    { "nodes": [...], "edges": [...] }

    Reuses the same DB tables populated by ingestion_service.
    """
    import json as _json

    def _parse_json_col(val):
        """Raw text() queries on SQLite return JSON columns as strings — parse them."""
        if val is None:
            return []
        if isinstance(val, str):
            try:
                return _json.loads(val)
            except Exception:
                return []
        return val  # already a list/dict (ORM model path)

    # ── Nodes: files, classes, functions from file_symbols ──
    symbol_rows = db.execute(text("""
        SELECT file_path, functions, classes FROM file_symbols
        WHERE repo_id = :repo_id
    """), {"repo_id": repo_id}).fetchall()

    nodes: list[dict] = []
    edges: list[dict] = []
    seen_nodes: set[str] = set()

    def add_node(node_id, name, node_type, file_path="", description=""):
        if node_id not in seen_nodes:
            seen_nodes.add(node_id)
            nodes.append({
                "id": node_id,
                "type": node_type,
                "name": name,
                "file_path": file_path,
                "description": description,
            })

    for row in symbol_rows:
        file_name = row.file_path.split("/")[-1]
        file_id = f"file::{file_name}"
        add_node(file_id, file_name, "file", file_path=row.file_path)

        for fn in _parse_json_col(row.functions):
            if not isinstance(fn, dict):
                continue
            fn_id = f"fn::{file_name}::{fn.get('name', '')}"
            add_node(fn_id, fn.get("name", ""), "function",
                     file_path=row.file_path,
                     description=fn.get("docstring") or "")
            edges.append({"source": file_id, "target": fn_id, "relationship": "defines"})

        for cls in _parse_json_col(row.classes):
            cls_id = f"cls::{file_name}::{cls['name']}"
            add_node(cls_id, cls["name"], "class",
                     file_path=row.file_path,
                     description=cls.get("docstring") or "")
            edges.append({"source": file_id, "target": cls_id, "relationship": "defines"})

    # ── Edges: file-level dependency graph ──
    dep_rows = db.execute(text("""
        SELECT source, target FROM file_dependencies
        WHERE repo_id = :repo_id
    """), {"repo_id": repo_id}).fetchall()

    for row in dep_rows:
        src_name = row.source.split("/")[-1]
        tgt_name = row.target.split("/")[-1]
        src_id = f"file::{src_name}"
        tgt_id = f"file::{tgt_name}"
        if src_id in seen_nodes and tgt_id in seen_nodes:
            edges.append({"source": src_id, "target": tgt_id, "relationship": "imports"})

    # ── Call edges ──
    call_rows = db.execute(text("""
        SELECT caller_id, callee_id FROM call_edges
        WHERE repo_id = :repo_id
    """), {"repo_id": repo_id}).fetchall()

    for row in call_rows:
        edges.append({
            "source": row.caller_id,
            "target": row.callee_id,
            "relationship": "calls",
        })

    # Deduplicate edges
    seen_edge_keys: set[str] = set()
    deduped_edges: list[dict] = []
    for e in edges:
        key = f"{e['source']}→{e['target']}"
        if key not in seen_edge_keys:
            seen_edge_keys.add(key)
            deduped_edges.append(e)

    return {"nodes": nodes, "edges": deduped_edges}


@router.post("/propose-feature")
@limiter.limit("10/hour")
async def propose_feature(request: Request, body: ProposeRequest):
    """
    Propose a new feature for the ingested repository.

    Pipeline:
        1. Load current graph from DB
        2. Call FeatureProposer to get mutation JSON
        3. Apply via GraphMutator
        4. Return updated React Flow graph, Mermaid diagrams, and implementation plan
    """
    if not body.feature.strip():
        raise HTTPException(status_code=400, detail="Feature description cannot be empty")

    db = SessionLocal()
    try:
        # 1. Load current graph
        current_graph = _build_graph_from_db(body.repo_id, db)

        if not current_graph["nodes"]:
            raise HTTPException(
                status_code=404,
                detail="No graph data found for this repo. Please ingest it first.",
            )

        logger.info(
            "propose-feature: repo_id=%s, nodes=%d, edges=%d, feature='%s'",
            body.repo_id,
            len(current_graph["nodes"]),
            len(current_graph["edges"]),
            body.feature,
        )

        # 2. Propose architectural mutation
        proposer = FeatureProposer(use_fast_model=True)
        proposal = await proposer.propose(body.feature, current_graph)

        # 3. Apply mutation
        mutator = GraphMutator()
        result = mutator.apply(current_graph, proposal)

        # 4. Serialize outputs
        react_flow = result.to_react_flow()
        architecture_mermaid = result.to_mermaid_arch()
        er_mermaid = result.to_mermaid_er()

        return {
            "graph": result.updated_graph,
            "react_flow": react_flow,
            "architecture_mermaid": architecture_mermaid,
            "er_mermaid": er_mermaid,
            "implementation_plan": result.diff.impl_plan,
            "rationale": result.diff.rationale,
            "diff_summary": result.diff.summary(),
            "warnings": result.diff.warnings,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("propose-feature failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()
