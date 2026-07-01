"""
Repository Map orchestrator.

Combines everything the Mermaid architecture pipeline already computes
(RepoGraph — real files, real import edges, directory clustering) with
group assignment and semantic edge classification into one JSON payload for
the frontend's merged "Repository Map" view (file-level detail + grouped
organization + structural/semantic edges), independent of Mermaid.

    DB rows -> RepoGraph (include_external=True)
            -> groups (role_groups.assign_group)
            -> edges classified (semantic_edges.classify_edge)
            -> JSON payload
"""
from __future__ import annotations

import json
import re
from collections import defaultdict

from .graph_model import RepoGraph, build_repo_graph, strip_clone_prefix
from .role_groups import EXTERNAL_GROUP, assign_group, is_generated, is_test
from .semantic_edges import build_call_index, classify_edge


def _parse_json_field(val):
    if not val:
        return []
    if isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            return []
    return val


def _slug(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_") or "group"


def _empty_payload() -> dict:
    return {"groups": [], "nodes": [], "edges": []}


def build_repo_map(symbols_rows, dependency_rows, call_edge_rows) -> dict:
    graph: RepoGraph = build_repo_graph(symbols_rows, dependency_rows, include_external=True)
    if not graph.nodes:
        return _empty_payload()

    out_degree = graph.out_degree()
    in_degree = graph.in_degree()
    call_index = build_call_index(call_edge_rows)

    # Full (untruncated) per-file metadata for hover cards — read directly
    # from the raw rows rather than FileNode, whose functions/classes lists
    # are intentionally truncated for Mermaid label brevity. Keyed by the
    # same cleaned repo-relative path build_repo_graph puts on FileNode.file_path
    # (not the raw absolute DB path), so the lookup below actually matches.
    clean_path = strip_clone_prefix([row.file_path for row in symbols_rows])
    symbols_by_path = {clean_path.get(row.file_path, row.file_path): row for row in symbols_rows}

    node_group: dict[str, str] = {}
    group_file_counts: dict[str, int] = defaultdict(int)
    nodes_payload = []

    for node in graph.nodes.values():
        group = assign_group(node)
        node_group[node.id] = group
        group_file_counts[group] += 1

        symbol_row = symbols_by_path.get(node.file_path)
        if symbol_row is not None:
            imports = _parse_json_field(symbol_row.imports)
            functions = [f["name"] for f in _parse_json_field(symbol_row.functions) if isinstance(f, dict) and "name" in f]
            classes = [c["name"] for c in _parse_json_field(symbol_row.classes) if isinstance(c, dict) and "name" in c]
            docstring = symbol_row.top_level_docstring
        else:
            imports, functions, classes, docstring = [], [], [], None

        nodes_payload.append({
            "id": node.id,
            "file_path": node.file_path,
            "filename": node.filename,
            "group": group,
            "is_test": is_test(node),
            "is_generated": is_generated(node),
            "is_external": node.is_external,
            "dependency_count": out_degree.get(node.id, 0) + in_degree.get(node.id, 0),
            "imports": imports,
            "functions": functions,
            "classes": classes,
            "docstring": docstring,
        })

    edges_payload = []
    for edge in graph.edges:
        source_node = graph.nodes[edge.source]
        target_node = graph.nodes[edge.target]
        kind, label = classify_edge(source_node, target_node, call_index)
        edges_payload.append({
            "source": edge.source,
            "target": edge.target,
            "kind": kind,
            "label": label,
        })

    groups_payload = [
        {"id": _slug(label), "label": label, "file_count": count}
        for label, count in sorted(
            group_file_counts.items(),
            key=lambda item: (item[0] == EXTERNAL_GROUP, item[0]),
        )
    ]

    return {
        "groups": groups_payload,
        "nodes": nodes_payload,
        "edges": edges_payload,
    }
