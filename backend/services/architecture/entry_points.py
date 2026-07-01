"""
Entry-point detection.

Scores every file in the RepoGraph on how likely it is to be where the
application starts, so the layout algorithm has a root to layer from.
Combines filename conventions, cheap content signals already available from
extracted symbols, and structural position in the import graph (root of the
dependency tree: little/nothing imports it, it imports a lot).
"""
from __future__ import annotations

from .graph_model import FileNode, RepoGraph

_ENTRY_FILENAMES: dict[str, float] = {
    "main.py": 10, "__main__.py": 10, "manage.py": 9,
    "app.py": 8, "server.py": 8, "wsgi.py": 6, "asgi.py": 6,
    "index.js": 8, "index.ts": 8, "index.jsx": 8, "index.tsx": 8,
    "main.js": 8, "main.ts": 8,
    "app.js": 7, "app.jsx": 7, "app.ts": 7, "app.tsx": 7,
    "server.js": 8, "server.ts": 8,
}
_ENTRY_FUNCTION_NAMES = {"main", "run", "run_server", "create_app", "bootstrap", "start"}

STRUCTURAL_ROOT_BONUS = 4.0
OUT_DEGREE_WEIGHT = 3.0
CONTENT_SCORE = 3.0
CANDIDATE_SCORE_RATIO = 0.6
CANDIDATE_SCORE_FLOOR = 5.0


def _filename_score(filename: str) -> float:
    return _ENTRY_FILENAMES.get(filename.lower(), 0.0)


def _content_score(node: FileNode) -> float:
    names = {f.lower() for f in node.functions}
    return CONTENT_SCORE if names & _ENTRY_FUNCTION_NAMES else 0.0


def _score_all(graph: RepoGraph) -> dict[str, float]:
    in_deg = graph.in_degree()
    out_deg = graph.out_degree()
    max_out = max(out_deg.values(), default=0)

    scores: dict[str, float] = {}
    for node_id, node in graph.nodes.items():
        score = _filename_score(node.filename) + _content_score(node)
        if in_deg.get(node_id, 0) == 0 and out_deg.get(node_id, 0) > 0:
            score += STRUCTURAL_ROOT_BONUS
        if max_out > 0:
            score += OUT_DEGREE_WEIGHT * (out_deg.get(node_id, 0) / max_out)
        scores[node_id] = score
    return scores


def detect_entry_points(graph: RepoGraph, limit: int = 3) -> list[FileNode]:
    """Return the 1-3 files most likely to be application entry points.

    Always returns at least one node (falls back to the highest-scoring file
    overall, even if nothing matches a known convention) as long as the graph
    has any nodes at all.
    """
    if not graph.nodes:
        return []

    scores = _score_all(graph)
    ranked = sorted(graph.nodes.values(), key=lambda n: -scores[n.id])

    top_score = scores[ranked[0].id]
    threshold = max(top_score * CANDIDATE_SCORE_RATIO, CANDIDATE_SCORE_FLOOR)

    entries = [ranked[0]]
    for node in ranked[1:limit]:
        if scores[node.id] >= threshold:
            entries.append(node)
    return entries
