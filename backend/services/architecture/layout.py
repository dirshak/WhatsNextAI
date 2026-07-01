"""
Layout algorithm: turns a RepoGraph + entry points into a LayoutResult.

This is the actual "graph/layout algorithm" part of the pipeline (as opposed
to rendering, which lives in mermaid_export.py). It is a simplified
Sugiyama-style layered graph layout:

  1. select the subset of files relevant to the entry-point flow
  2. break cycles (DFS back-edge classification) so layering is well-defined
  3. assign layers via longest-path rank from the entry point(s)
  4. reduce crossings by reordering nodes within each layer (barycenter
     heuristic, alternating down/up sweeps), tie-broken by directory so
     related files stay adjacent
  5. assign simple (x, y) coordinates from (order, layer)

No Mermaid/rendering concerns here — this module only produces a layout that
mermaid_export.py (or, in the future, any other renderer) can consume.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

from .graph_model import FileNode, RepoGraph

DEFAULT_MAX_NODES = 40
CROSSING_REDUCTION_SWEEPS = 4
COLUMN_WIDTH = 220
ROW_HEIGHT = 140
OTHER_CLUSTER_KEY = "__other__"


@dataclass
class LayoutNode:
    id: str
    file_node: FileNode
    layer: int
    order: int = 0
    x: float = 0.0
    y: float = 0.0
    cluster: str = ""
    is_entry: bool = False


@dataclass
class LayoutEdge:
    source: str
    target: str
    is_back_edge: bool = False


@dataclass
class LayoutResult:
    nodes: list[LayoutNode]
    edges: list[LayoutEdge]
    clusters: dict[str, list[str]] = field(default_factory=dict)


# ── 1. Node selection ──────────────────────────────────────────

def _select_nodes(graph: RepoGraph, entry_ids: list[str], max_nodes: int) -> tuple[list[str], set[str]]:
    """BFS outward from the entry point(s); closer-to-entry files win the
    node budget over merely high-degree ones. Any leftover budget is
    backfilled with the highest-degree unreached files so real structure
    outside the entry-reachable flow isn't silently hidden."""
    adj = graph.adjacency()
    order: list[str] = []
    seen: set[str] = set()
    queue: deque[str] = deque()
    for eid in entry_ids:
        if eid in graph.nodes and eid not in seen:
            seen.add(eid)
            queue.append(eid)

    while queue:
        node_id = queue.popleft()
        order.append(node_id)
        for neighbor in sorted(adj.get(node_id, ())):
            if neighbor not in seen:
                seen.add(neighbor)
                queue.append(neighbor)

    reached = order[:max_nodes]
    remaining_budget = max_nodes - len(reached)

    backfilled: list[str] = []
    if remaining_budget > 0:
        out_deg = graph.out_degree()
        in_deg = graph.in_degree()
        unreached = [nid for nid in graph.nodes if nid not in seen]
        unreached.sort(key=lambda nid: -(out_deg.get(nid, 0) + in_deg.get(nid, 0)))
        backfilled = unreached[:remaining_budget]

    return reached + backfilled, set(backfilled)


# ── 2. Cycle breaking (DFS edge classification) ───────────────

def _classify_back_edges(
    selected_ids: list[str],
    induced_edges: list[tuple[str, str]],
    entry_ids: list[str],
) -> set[tuple[str, str]]:
    """Standard DFS white/gray/black classification. Edges pointing back to
    a node currently on the recursion stack (gray) are back edges; removing
    them always leaves a DAG, which is what layering needs."""
    adj: dict[str, list[str]] = {nid: [] for nid in selected_ids}
    for src, tgt in induced_edges:
        adj[src].append(tgt)
    for nid in adj:
        adj[nid].sort()

    WHITE, GRAY, BLACK = 0, 1, 2
    color = {nid: WHITE for nid in selected_ids}
    back_edges: set[tuple[str, str]] = set()

    def dfs(root: str) -> None:
        stack: list[list] = [[root, 0]]
        color[root] = GRAY
        while stack:
            node, idx = stack[-1]
            neighbors = adj[node]
            if idx >= len(neighbors):
                color[node] = BLACK
                stack.pop()
                continue
            stack[-1][1] += 1
            neighbor = neighbors[idx]
            if color[neighbor] == WHITE:
                color[neighbor] = GRAY
                stack.append([neighbor, 0])
            elif color[neighbor] == GRAY:
                back_edges.add((node, neighbor))
            # BLACK neighbor: forward/cross edge, not a cycle, ignore.

    roots = [nid for nid in entry_ids if nid in color]
    roots += [nid for nid in selected_ids if nid not in roots]
    for root in roots:
        if color[root] == WHITE:
            dfs(root)

    return back_edges


# ── 3. Layering (longest-path rank from entry) ────────────────

def _assign_layers(
    selected_ids: list[str],
    induced_edges: list[tuple[str, str]],
    back_edges: set[tuple[str, str]],
    entry_ids: list[str],
) -> dict[str, int]:
    rank_edges = [e for e in induced_edges if e not in back_edges]

    preds: dict[str, list[str]] = {nid: [] for nid in selected_ids}
    succs: dict[str, list[str]] = {nid: [] for nid in selected_ids}
    for src, tgt in rank_edges:
        preds[tgt].append(src)
        succs[src].append(tgt)

    indeg = {nid: len(preds[nid]) for nid in selected_ids}
    queue: deque[str] = deque(sorted(nid for nid in selected_ids if indeg[nid] == 0))
    topo: list[str] = []
    while queue:
        nid = queue.popleft()
        topo.append(nid)
        for nxt in sorted(succs[nid]):
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                queue.append(nxt)
    # Rank edges are acyclic by construction, but guard against surprises
    # (e.g. an unresolved-import edge slipping through) instead of hanging.
    topo.extend(sorted(nid for nid in selected_ids if nid not in topo))

    entry_set = {nid for nid in entry_ids if nid in set(selected_ids)}
    if not entry_set and topo:
        entry_set = {topo[0]}

    layer: dict[str, int] = {nid: 0 for nid in entry_set}
    for nid in topo:
        if nid in layer:
            continue
        parent_layers = [layer[p] for p in preds[nid] if p in layer]
        layer[nid] = (max(parent_layers) + 1) if parent_layers else 0
    return layer


# ── 4. Crossing reduction (barycenter heuristic) ──────────────

def _count_adjacent_crossings(
    order_by_layer: dict[int, list[str]],
    adjacent_edges: dict[tuple[int, int], list[tuple[str, str]]],
) -> int:
    total = 0
    for (l1, l2), pairs in adjacent_edges.items():
        pos1 = {nid: i for i, nid in enumerate(order_by_layer.get(l1, []))}
        pos2 = {nid: i for i, nid in enumerate(order_by_layer.get(l2, []))}
        seq = sorted(
            (pos1[s], pos2[t]) for s, t in pairs if s in pos1 and t in pos2
        )
        vals = [p2 for _, p2 in seq]
        for i in range(len(vals)):
            for j in range(i + 1, len(vals)):
                if vals[i] > vals[j]:
                    total += 1
    return total


def _barycenter_sweep(
    order_by_layer: dict[int, list[str]],
    preds_map: dict[str, list[str]],
    succs_map: dict[str, list[str]],
    directory_of: dict[str, str],
    downward: bool,
) -> None:
    levels = sorted(order_by_layer)
    iterate = levels[1:] if downward else list(reversed(levels[:-1]))
    neighbors_map = preds_map if downward else succs_map

    for lvl in iterate:
        ref_lvl = lvl - 1 if downward else lvl + 1
        if ref_lvl not in order_by_layer:
            continue
        ref_pos = {nid: i for i, nid in enumerate(order_by_layer[ref_lvl])}

        def sort_key(nid: str):
            neigh_positions = [ref_pos[n] for n in neighbors_map.get(nid, []) if n in ref_pos]
            if not neigh_positions:
                return (1, directory_of.get(nid, ""), nid)
            barycenter = sum(neigh_positions) / len(neigh_positions)
            return (0, barycenter, directory_of.get(nid, ""))

        order_by_layer[lvl] = sorted(order_by_layer[lvl], key=sort_key)


def _order_layers(
    selected_ids: list[str],
    layer: dict[str, int],
    induced_edges: list[tuple[str, str]],
    directory_of: dict[str, str],
) -> dict[int, list[str]]:
    order_by_layer: dict[int, list[str]] = {}
    for nid in selected_ids:
        order_by_layer.setdefault(layer[nid], []).append(nid)
    for lvl in order_by_layer:
        order_by_layer[lvl].sort(key=lambda nid: (directory_of.get(nid, ""), nid))

    preds_map: dict[str, list[str]] = {nid: [] for nid in selected_ids}
    succs_map: dict[str, list[str]] = {nid: [] for nid in selected_ids}
    for src, tgt in induced_edges:
        preds_map[tgt].append(src)
        succs_map[src].append(tgt)

    adjacent_edges: dict[tuple[int, int], list[tuple[str, str]]] = {}
    for src, tgt in induced_edges:
        if abs(layer[tgt] - layer[src]) == 1:
            key = (min(layer[src], layer[tgt]), max(layer[src], layer[tgt]))
            adjacent_edges.setdefault(key, []).append((src, tgt))

    best_order = {lvl: list(ids) for lvl, ids in order_by_layer.items()}
    best_crossings = _count_adjacent_crossings(best_order, adjacent_edges)

    for i in range(CROSSING_REDUCTION_SWEEPS):
        _barycenter_sweep(order_by_layer, preds_map, succs_map, directory_of, downward=(i % 2 == 0))
        crossings = _count_adjacent_crossings(order_by_layer, adjacent_edges)
        if crossings <= best_crossings:
            best_crossings = crossings
            best_order = {lvl: list(ids) for lvl, ids in order_by_layer.items()}

    return best_order


# ── Orchestration ──────────────────────────────────────────────

def compute_layout(
    graph: RepoGraph,
    entry_points: list[FileNode],
    max_nodes: int = DEFAULT_MAX_NODES,
) -> LayoutResult:
    entry_ids = [n.id for n in entry_points]
    selected_ids, backfilled_ids = _select_nodes(graph, entry_ids, max_nodes)
    selected_set = set(selected_ids)

    induced_edges = [
        (e.source, e.target) for e in graph.edges
        if e.source in selected_set and e.target in selected_set
    ]

    back_edges = _classify_back_edges(selected_ids, induced_edges, entry_ids)
    layer = _assign_layers(selected_ids, induced_edges, back_edges, entry_ids)

    directory_of = {nid: graph.nodes[nid].directory for nid in selected_ids}
    order_by_layer = _order_layers(selected_ids, layer, induced_edges, directory_of)

    entry_set = set(entry_ids)
    layout_nodes: list[LayoutNode] = []
    order_index: dict[str, int] = {}
    for lvl, ids in order_by_layer.items():
        for idx, nid in enumerate(ids):
            order_index[nid] = idx
            cluster = OTHER_CLUSTER_KEY if nid in backfilled_ids else directory_of[nid]
            layout_nodes.append(LayoutNode(
                id=nid,
                file_node=graph.nodes[nid],
                layer=lvl,
                order=idx,
                x=idx * COLUMN_WIDTH,
                y=lvl * ROW_HEIGHT,
                cluster=cluster,
                is_entry=nid in entry_set,
            ))

    layout_nodes.sort(key=lambda n: (n.layer, n.order))

    layout_edges = [
        LayoutEdge(source=src, target=tgt, is_back_edge=(src, tgt) in back_edges)
        for src, tgt in induced_edges
    ]

    clusters: dict[str, list[str]] = {}
    for node in layout_nodes:
        clusters.setdefault(node.cluster, []).append(node.id)

    return LayoutResult(nodes=layout_nodes, edges=layout_edges, clusters=clusters)
