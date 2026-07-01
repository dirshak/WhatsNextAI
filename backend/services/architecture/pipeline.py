"""
End-to-end architecture diagram pipeline:

    DB rows -> RepoGraph -> entry points -> LayoutResult -> Mermaid text

    Repository
      -> AST / dependency extraction   (services.ingestion_service, at ingest time)
      -> Internal graph model          (graph_model.build_repo_graph)
      -> Entry point detection         (entry_points.detect_entry_points)
      -> Layout algorithm              (layout.compute_layout)
      -> Mermaid exporter              (mermaid_export.layout_to_mermaid)

Mermaid is purely an export format here: every layout decision (selection,
layering, ordering, clustering) happens before mermaid_export.py is ever
called.
"""
from __future__ import annotations

from .entry_points import detect_entry_points
from .graph_model import build_repo_graph
from .layout import compute_layout
from .mermaid_export import layout_to_mermaid


def build_architecture_mermaid(symbols_rows, dependency_rows, max_nodes: int = 60) -> str:
    graph = build_repo_graph(symbols_rows, dependency_rows)
    if not graph.nodes:
        return 'flowchart TD\n    empty["No files found"]'

    entry_points = detect_entry_points(graph)
    layout = compute_layout(graph, entry_points, max_nodes=max_nodes)
    return layout_to_mermaid(layout)
