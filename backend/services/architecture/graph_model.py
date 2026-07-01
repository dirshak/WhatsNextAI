"""
Internal graph model for the architecture-diagram pipeline.

Turns raw DB rows (file_symbols, file_dependencies) into a RepoGraph of real
repository files and real file->file import edges. No layout or rendering
decisions happen here.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field


def _parse_json_field(val):
    if not val:
        return []
    if isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            return []
    return val


# Mermaid flowchart keywords that break parsing if used verbatim as a node
# id (confirmed against the real parser: a file called end.py produces the
# id "end", which collides with the keyword that closes a subgraph/flowchart
# block and throws "Syntax error in text"). Guarded case-insensitively since
# a file called End.py or STYLE.py would collide just as badly.
_RESERVED_IDS = {
    "end", "subgraph", "style", "linkstyle", "classdef", "class", "click",
    "direction", "default", "graph", "flowchart", "acc_title", "acc_descr",
}


def safe_id(filename: str) -> str:
    no_ext = re.sub(r"\.[^.]+$", "", filename)
    candidate = re.sub(r"[^a-zA-Z0-9]", "_", no_ext) or "file"
    if candidate.lower() in _RESERVED_IDS:
        candidate = f"{candidate}_file"
    return candidate


def display_name(filename: str) -> str:
    return re.sub(r"\.[^.]+$", "", filename)


def _dir_segments(file_path: str) -> list[str]:
    normalized = file_path.replace("\\", "/")
    parts = [p for p in normalized.split("/") if p]
    return parts[:-1] if parts else []


def strip_clone_prefix(paths: list[str]) -> dict[str, str]:
    """Map each raw stored path to a repo-relative one by stripping the
    longest common leading-directory prefix across the whole batch.

    Ingestion clones every repo into a fresh, randomly-named temp directory
    and stores that absolute path verbatim (e.g.
    "C:\\Users\\...\\Temp\\tmphmfqk4qi\\cli\\main.py"), so every file for a
    given repo necessarily shares that same prefix. Stripping it (rather than
    pattern-matching temp-dir naming conventions) is robust to any OS/temp
    layout and fixes directory-based grouping, which otherwise leaks the
    random temp directory name in as a fake extra path segment.
    """
    if not paths:
        return {}
    split_paths = [p.replace("\\", "/").split("/") for p in paths]
    min_len = min(len(p) for p in split_paths)
    common = 0
    for i in range(min_len):
        segment = split_paths[0][i]
        if all(p[i] == segment for p in split_paths):
            common += 1
        else:
            break
    common = min(common, min_len - 1)  # never strip the filename itself

    return {
        original: "/".join(segments[common:])
        for original, segments in zip(paths, split_paths)
    }


def cluster_key(file_path: str) -> str:
    """Directory-based grouping key so related files land in the same cluster."""
    segments = _dir_segments(file_path)
    if not segments:
        return "root"
    # Last one or two directory segments: enough to distinguish siblings
    # (e.g. "backend/services") without dragging in the whole absolute
    # clone-temp-dir prefix that ingestion stores file paths with.
    return "/".join(segments[-2:])


@dataclass
class FileNode:
    id: str                              # mermaid-safe node id, unique per repo
    filename: str                        # e.g. "flow_service.py"
    file_path: str                       # full path as stored in DB
    directory: str                       # cluster key derived from file_path
    functions: list[str] = field(default_factory=list)
    classes: list[str] = field(default_factory=list)
    is_external: bool = False            # True for unresolved-import pseudo-nodes

    @property
    def label(self) -> str:
        return display_name(self.filename)


@dataclass
class FileEdge:
    source: str  # FileNode.id
    target: str  # FileNode.id


@dataclass
class RepoGraph:
    nodes: dict[str, FileNode]
    edges: list[FileEdge]

    def out_degree(self) -> dict[str, int]:
        degree: dict[str, int] = {nid: 0 for nid in self.nodes}
        for edge in self.edges:
            degree[edge.source] = degree.get(edge.source, 0) + 1
        return degree

    def in_degree(self) -> dict[str, int]:
        degree: dict[str, int] = {nid: 0 for nid in self.nodes}
        for edge in self.edges:
            degree[edge.target] = degree.get(edge.target, 0) + 1
        return degree

    def adjacency(self) -> dict[str, set[str]]:
        adj: dict[str, set[str]] = {nid: set() for nid in self.nodes}
        for edge in self.edges:
            adj.setdefault(edge.source, set()).add(edge.target)
        return adj


def build_repo_graph(symbols_rows, dependency_rows, include_external: bool = False) -> RepoGraph:
    """Build a RepoGraph from file_symbols + file_dependencies DB rows.

    One node per file present in file_symbols. Edges are file_dependencies
    rows restricted to files that have a node — i.e. an unresolved/external
    import target is dropped by default (correct for the Mermaid architecture
    view, which only wants real repo files).

    When include_external=True (used by the Repository Map, which wants to
    be "complete like the Dependency Graph"), an unresolved dependency target
    instead gets a lightweight external pseudo-node (is_external=True) rather
    than being dropped, so those edges/files are still visible and filterable
    as "External APIs".
    """
    nodes: dict[str, FileNode] = {}
    path_to_id: dict[str, str] = {}
    used_ids: set[str] = set()
    clean_path = strip_clone_prefix([row.file_path for row in symbols_rows])

    for row in symbols_rows:
        filename = row.file_path.split("/")[-1].split("\\")[-1]
        base = safe_id(filename)
        node_id = base
        counter = 1
        while node_id in used_ids:
            node_id = f"{base}_{counter}"
            counter += 1
        used_ids.add(node_id)

        fns = [
            f["name"] for f in _parse_json_field(row.functions)[:3]
            if isinstance(f, dict) and "name" in f
        ]
        cls = [
            c["name"] for c in _parse_json_field(row.classes)[:2]
            if isinstance(c, dict) and "name" in c
        ]

        display_path = clean_path.get(row.file_path, row.file_path)
        node = FileNode(
            id=node_id,
            filename=filename,
            file_path=display_path,
            directory=cluster_key(display_path),
            functions=fns,
            classes=cls,
        )
        nodes[node_id] = node
        # Last writer wins on filename collisions across directories; the
        # dependency edges below only need a reasonable, existing target.
        path_to_id[row.file_path] = node_id
        path_to_id.setdefault(filename, node_id)

    def _external_node_id(target: str) -> str:
        existing = path_to_id.get(target)
        if existing:
            return existing

        display = target.split("/")[-1].split("\\")[-1] or target
        base = safe_id(display)
        node_id = base
        counter = 1
        while node_id in used_ids:
            node_id = f"{base}_{counter}"
            counter += 1
        used_ids.add(node_id)

        nodes[node_id] = FileNode(
            id=node_id,
            filename=display,
            file_path=target,
            directory="external",
            is_external=True,
        )
        path_to_id[target] = node_id
        return node_id

    edges: list[FileEdge] = []
    seen_edges: set[tuple[str, str]] = set()
    for row in dependency_rows:
        src_id = path_to_id.get(row.source) or path_to_id.get(row.source.split("/")[-1])
        if not src_id:
            continue

        tgt_id = path_to_id.get(row.target) or path_to_id.get(row.target.split("/")[-1])
        if not tgt_id:
            if not include_external:
                continue
            tgt_id = _external_node_id(row.target)

        if src_id == tgt_id:
            continue
        key = (src_id, tgt_id)
        if key in seen_edges:
            continue
        seen_edges.add(key)
        edges.append(FileEdge(source=src_id, target=tgt_id))

    return RepoGraph(nodes=nodes, edges=edges)
