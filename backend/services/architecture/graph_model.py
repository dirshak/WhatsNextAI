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


def safe_id(filename: str) -> str:
    no_ext = re.sub(r"\.[^.]+$", "", filename)
    return re.sub(r"[^a-zA-Z0-9]", "_", no_ext) or "file"


def display_name(filename: str) -> str:
    return re.sub(r"\.[^.]+$", "", filename)


def _dir_segments(file_path: str) -> list[str]:
    normalized = file_path.replace("\\", "/")
    parts = [p for p in normalized.split("/") if p]
    return parts[:-1] if parts else []


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


def build_repo_graph(symbols_rows, dependency_rows) -> RepoGraph:
    """Build a RepoGraph from file_symbols + file_dependencies DB rows.

    One node per file present in file_symbols. Edges are file_dependencies
    rows restricted to files that have a node (so we never point at an
    external/unresolved import as if it were a repo file).
    """
    nodes: dict[str, FileNode] = {}
    path_to_id: dict[str, str] = {}
    used_ids: set[str] = set()

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

        node = FileNode(
            id=node_id,
            filename=filename,
            file_path=row.file_path,
            directory=cluster_key(row.file_path),
            functions=fns,
            classes=cls,
        )
        nodes[node_id] = node
        # Last writer wins on filename collisions across directories; the
        # dependency edges below only need a reasonable, existing target.
        path_to_id[row.file_path] = node_id
        path_to_id.setdefault(filename, node_id)

    edges: list[FileEdge] = []
    seen_edges: set[tuple[str, str]] = set()
    for row in dependency_rows:
        src_id = path_to_id.get(row.source) or path_to_id.get(row.source.split("/")[-1])
        tgt_id = path_to_id.get(row.target) or path_to_id.get(row.target.split("/")[-1])
        if not src_id or not tgt_id or src_id == tgt_id:
            continue
        key = (src_id, tgt_id)
        if key in seen_edges:
            continue
        seen_edges.add(key)
        edges.append(FileEdge(source=src_id, target=tgt_id))

    return RepoGraph(nodes=nodes, edges=edges)
