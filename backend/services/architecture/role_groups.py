"""
Architecture group assignment for the Repository Map.

Directory-based grouping (reusing graph_model.cluster_key as the fallback),
refined with a small keyword->role table so common folder names map to the
human-friendly categories requested (Frontend, Backend, Services, Agents,
Models, Storage, Tests, External APIs) instead of raw directory strings.

This is deliberately simple/deterministic: no file-content inspection, no
LLM calls — grouping must stay cheap at 500+ files.
"""
from __future__ import annotations

import re

from .graph_model import FileNode, cluster_key

EXTERNAL_GROUP = "External APIs"
_UNGROUPED_FALLBACK = "Other"

# Matched against every directory segment of a file's path (case-insensitive,
# checked in this order so more specific roles win over generic ones).
_KEYWORD_GROUPS: list[tuple[str, str]] = [
    ("agents", "Agents"),
    ("agent", "Agents"),
    ("models", "Models"),
    ("model", "Models"),
    ("schemas", "Models"),
    ("storage", "Storage"),
    ("database", "Storage"),
    ("db", "Storage"),
    ("migrations", "Storage"),
    ("services", "Services"),
    ("service", "Services"),
    ("routers", "Backend"),
    ("routes", "Backend"),
    ("controllers", "Backend"),
    ("api", "Backend"),
    ("backend", "Backend"),
    ("frontend", "Frontend"),
    ("client", "Frontend"),
    ("components", "Frontend"),
    ("pages", "Frontend"),
    ("views", "Frontend"),
    ("src", "Frontend"),
    ("tests", "Tests"),
    ("test", "Tests"),
    ("__tests__", "Tests"),
    ("spec", "Tests"),
]

_TEST_FILENAME_RE = re.compile(r"(^test_.+|.+_test\.[^.]+$|.+\.test\.[^.]+$|.+\.spec\.[^.]+$)", re.IGNORECASE)
_GENERATED_FILENAME_RE = re.compile(
    r"(_pb2\.py$|\.pb\.go$|\.g\.[a-z]+$|_generated\.[^.]+$|^generated_)",
    re.IGNORECASE,
)


def _dir_segments(file_path: str) -> list[str]:
    normalized = file_path.replace("\\", "/")
    return [p for p in normalized.split("/") if p]


def assign_group(node: FileNode) -> str:
    if node.is_external:
        return EXTERNAL_GROUP

    segments = [s.lower() for s in _dir_segments(node.file_path)[:-1]]
    for segment in segments:
        for keyword, label in _KEYWORD_GROUPS:
            if segment == keyword:
                return label

    fallback = cluster_key(node.file_path)
    if fallback in ("root", ""):
        return _UNGROUPED_FALLBACK
    return "/".join(part.capitalize() for part in fallback.split("/"))


def is_test(node: FileNode) -> bool:
    if node.is_external:
        return False
    if any(seg.lower() in ("tests", "test", "__tests__", "spec") for seg in _dir_segments(node.file_path)[:-1]):
        return True
    return bool(_TEST_FILENAME_RE.match(node.filename))


def is_generated(node: FileNode) -> bool:
    if node.is_external:
        return False
    if "migrations" in (s.lower() for s in _dir_segments(node.file_path)[:-1]):
        return True
    return bool(_GENERATED_FILENAME_RE.search(node.filename))
