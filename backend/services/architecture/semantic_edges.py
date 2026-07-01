"""
Rule-based semantic edge classification for the Repository Map.

Turns a plain structural dependency edge (source imports target) into a
labeled semantic edge when there's a confident signal for *what kind* of
relationship it is (routes, invokes, queries, stores, ...). Deliberately
rule-based (name/pattern matching over already-extracted data, plus the
precomputed Python call graph), not LLM-based, so classifying 2000+ edges
stays fast and free.

If nothing fires confidently, the edge stays structural — this is the
explicit "fall back to the structural edge" requirement, not a special case.
"""
from __future__ import annotations

import re
from collections import defaultdict

from .graph_model import FileNode


def _basename(path: str) -> str:
    return path.replace("\\", "/").rsplit("/", 1)[-1]

STRUCTURAL = "structural"
SEMANTIC = "semantic"

# (name pattern, resulting label) — checked in order, first match wins.
_VERB_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"^(get_|list_|fetch_|retrieve_)"), "fetches"),
    (re.compile(r"^(query_|select_|find_|search_)"), "queries"),
    (re.compile(r"^(read_|load_)"), "reads"),
    (re.compile(r"^(create_|save_|insert_|store_)"), "stores"),
    (re.compile(r"^(write_|update_|delete_|remove_)"), "writes"),
    (re.compile(r"^(publish_|emit_|broadcast_)"), "publishes"),
    (re.compile(r"^(subscribe_|on_|listen_)"), "subscribes"),
    (re.compile(r"^(validate_|check_|verify_|assert_)"), "validates"),
    (re.compile(r"^(generate_|render_|build_)"), "generates"),
    (re.compile(r"^(orchestrate_|coordinate_|run_all|pipeline)"), "orchestrates"),
    (re.compile(r"^(route|handle_|endpoint)"), "routes"),
]

_ROUTE_FILENAME_RE = re.compile(r"(routes?|views?|controllers?)\.[a-zA-Z]+$")


def build_call_index(call_edge_rows) -> dict[tuple[str, str], list[str]]:
    """caller_id/callee_id look like 'fn::<filename>::<func_name>' (see
    ingestion_service.store_call_edges). Returns
    {(caller_filename, callee_filename): [callee_func_name, ...]}.

    The file segment is re-basenamed defensively rather than trusted as-is:
    older ingested data (pre-fix) stored a full absolute path there on
    Windows instead of a bare filename, which would otherwise silently
    make every lookup miss.
    """
    index: dict[tuple[str, str], list[str]] = defaultdict(list)
    for row in call_edge_rows:
        caller_parts = row.caller_id.split("::")
        callee_parts = row.callee_id.split("::")
        if len(caller_parts) < 3 or len(callee_parts) < 3:
            continue
        caller_file = _basename(caller_parts[1])
        callee_file = _basename(callee_parts[1])
        callee_name = callee_parts[-1]
        index[(caller_file, callee_file)].append(callee_name)
    return index


def _label_for_function_name(name: str) -> str | None:
    lowered = name.lower()
    for pattern, label in _VERB_PATTERNS:
        if pattern.search(lowered):
            return label
    return None


def classify_edge(
    source: FileNode,
    target: FileNode,
    call_index: dict[tuple[str, str], list[str]],
) -> tuple[str, str | None]:
    if source.is_external or target.is_external:
        return STRUCTURAL, None

    callee_names = call_index.get((source.filename, target.filename), [])
    for name in callee_names:
        label = _label_for_function_name(name)
        if label:
            return SEMANTIC, label

    if callee_names:
        # A real traced call exists but no specific verb matched — still a
        # meaningful relationship, just a generic one.
        return SEMANTIC, "invokes"

    # No call-graph data (non-Python source, or nothing traced) — fall back
    # to a filename-convention signal only when it's a strong one.
    if _ROUTE_FILENAME_RE.search(target.filename):
        return SEMANTIC, "routes"

    return STRUCTURAL, None
