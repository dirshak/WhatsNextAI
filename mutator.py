"""
mutator.py

Applies a feature proposal (from feature_proposer.py) to an existing graph.

Responsibilities:
  1. Validate the proposal against the current graph (no duplicate IDs, valid edge refs)
  2. Apply add_nodes, add_edges, modify_nodes to produce an updated graph
  3. Produce a GraphDiff object describing exactly what changed
  4. Serialize both the updated graph and the diff to React Flow format
     (so the frontend can highlight new/modified nodes in green/amber)

The mutator is PURE — it never calls Groq. It only does graph manipulation.
This makes it fast, testable, and safe to call multiple times.

Usage:
    mutator = GraphMutator()
    result = mutator.apply(current_graph, proposal)
    # result.updated_graph  → full graph with changes applied
    # result.diff           → only what changed (for frontend highlight)
    # result.to_react_flow()→ React Flow nodes + edges format
"""

import copy
import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class NodeDiff:
    node_id: str
    change_type: str        # "added" | "modified" | "unchanged"
    node_data: dict


@dataclass
class EdgeDiff:
    edge_id: str
    change_type: str        # "added" | "unchanged"
    edge_data: dict


@dataclass
class GraphDiff:
    """
    Everything that changed in one mutation pass.
    The frontend uses this to colour new nodes green, modified nodes amber.
    """
    added_nodes: list[NodeDiff] = field(default_factory=list)
    modified_nodes: list[NodeDiff] = field(default_factory=list)
    added_edges: list[EdgeDiff] = field(default_factory=list)
    rationale: str = ""
    impl_plan: list[str] = field(default_factory=list)
    complexity: str = "medium"
    estimated_hours: int = 0
    warnings: list[str] = field(default_factory=list)

    def summary(self) -> dict:
        return {
            "added_nodes": len(self.added_nodes),
            "modified_nodes": len(self.modified_nodes),
            "added_edges": len(self.added_edges),
            "complexity": self.complexity,
            "estimated_hours": self.estimated_hours,
            "warnings": self.warnings,
        }


@dataclass
class MutationResult:
    updated_graph: dict[str, Any]   # full graph after mutation
    diff: GraphDiff                  # only what changed

    def to_react_flow(self) -> dict[str, Any]:
        """
        Converts updated_graph to React Flow format.
        New nodes get data.status = "added" (frontend renders green).
        Modified nodes get data.status = "modified" (frontend renders amber).
        """
        added_ids = {d.node_id for d in self.diff.added_nodes}
        modified_ids = {d.node_id for d in self.diff.modified_nodes}
        added_edge_ids = {d.edge_id for d in self.diff.added_edges}

        rf_nodes = []
        for node in self.updated_graph.get("nodes", []):
            nid = node["id"]
            status = (
                "added" if nid in added_ids
                else "modified" if nid in modified_ids
                else "unchanged"
            )
            rf_nodes.append({
                "id": nid,
                "type": "codeNode",         # matches React Flow custom node type
                "position": node.get("position", {"x": 0, "y": 0}),
                "data": {
                    "label": node.get("name", nid),
                    "nodeType": node.get("type", "file"),
                    "filePath": node.get("file_path", ""),
                    "description": node.get("description", ""),
                    "status": status,
                },
            })

        rf_edges = []
        for edge in self.updated_graph.get("edges", []):
            eid = edge.get("id", f"{edge['source']}__{edge['target']}")
            rf_edges.append({
                "id": eid,
                "source": edge["source"],
                "target": edge["target"],
                "label": edge.get("relationship", ""),
                "animated": eid in added_edge_ids,   # new edges animate in
                "style": {
                    "stroke": "#22c55e" if eid in added_edge_ids else None,
                },
            })

        return {
            "nodes": rf_nodes,
            "edges": rf_edges,
            "diff_summary": self.diff.summary(),
            "rationale": self.diff.rationale,
            "impl_plan": self.diff.impl_plan,
        }

    def to_mermaid_er(self) -> str:
        """
        Auto-generates a Mermaid erDiagram string from the updated graph.
        Only includes file-level and class-level nodes for readability.
        """
        lines = ["erDiagram"]

        nodes = self.updated_graph.get("nodes", [])
        edges = self.updated_graph.get("edges", [])

        # Index nodes by id
        node_map = {n["id"]: n for n in nodes}

        # Filter to structural nodes only
        structural_types = {"file", "class", "module", "service", "database"}
        structural_ids = {
            n["id"] for n in nodes if n.get("type") in structural_types
        }

        # Emit entity blocks
        for nid in structural_ids:
            node = node_map[nid]
            safe_name = _safe_mermaid_name(node.get("name", nid))
            desc = node.get("description", "")[:60].replace('"', "'")
            lines.append(f'  {safe_name} {{')
            lines.append(f'    string type "{node.get("type", "")}"')
            if node.get("file_path"):
                lines.append(f'    string path "{node["file_path"]}"')
            if desc:
                lines.append(f'    string desc "{desc}"')
            lines.append(f'  }}')

        # Emit relationships between structural nodes
        rel_map = {
            "imports":      "||--o{",
            "depends_on":   "||--o{",
            "calls":        "}o--||",
            "inherits":     "}|--|{",
            "instantiates": "||--o{",
            "defines":      "||--|{",
        }

        seen_pairs: set[tuple[str, str]] = set()
        for edge in edges:
            src = edge.get("source")
            tgt = edge.get("target")
            if src not in structural_ids or tgt not in structural_ids:
                continue
            pair = (src, tgt)
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)

            src_name = _safe_mermaid_name(node_map[src].get("name", src))
            tgt_name = _safe_mermaid_name(node_map[tgt].get("name", tgt))
            rel = edge.get("relationship", "depends_on")
            arrow = rel_map.get(rel, "||--o{")
            label = rel.replace("_", " ")
            lines.append(f'  {src_name} {arrow} {tgt_name} : "{label}"')

        return "\n".join(lines)

    def to_mermaid_arch(self) -> str:
        """
        Generates a Mermaid flowchart (top-down) showing the architecture.
        Groups nodes by type into subgraphs.
        """
        lines = ["flowchart TD"]

        nodes = self.updated_graph.get("nodes", [])
        edges = self.updated_graph.get("edges", [])

        added_ids = {d.node_id for d in self.diff.added_nodes}
        modified_ids = {d.node_id for d in self.diff.modified_nodes}

        # Group by type
        groups: dict[str, list[dict]] = {}
        for node in nodes:
            t = node.get("type", "file")
            groups.setdefault(t, []).append(node)

        type_order = ["service", "module", "file", "class",
                      "database", "external", "function"]

        for t in type_order:
            if t not in groups:
                continue
            safe_group = t.upper()
            lines.append(f'  subgraph {safe_group}["{t.title()} layer"]')
            for node in groups[t]:
                nid = node["id"]
                safe_id = _safe_mermaid_id(nid)
                label = node.get("name", nid)
                # Style new/modified nodes differently
                if nid in added_ids:
                    lines.append(f'    {safe_id}["{label}"]:::added')
                elif nid in modified_ids:
                    lines.append(f'    {safe_id}["{label}"]:::modified')
                else:
                    lines.append(f'    {safe_id}["{label}"]')
            lines.append("  end")

        # Edges (structural only, limit to 40 for readability)
        structural_types = {"file", "class", "module", "service", "database"}
        node_map = {n["id"]: n for n in nodes}
        count = 0
        for edge in edges:
            if count >= 40:
                break
            src = edge.get("source")
            tgt = edge.get("target")
            if (node_map.get(src, {}).get("type") not in structural_types or
                    node_map.get(tgt, {}).get("type") not in structural_types):
                continue
            src_safe = _safe_mermaid_id(src)
            tgt_safe = _safe_mermaid_id(tgt)
            rel = edge.get("relationship", "")
            eid = f"{src}__{tgt}"
            added_edge_ids = {d.edge_id for d in self.diff.added_edges}
            arrow = "==>" if eid in added_edge_ids else "-->"
            lines.append(f'  {src_safe} {arrow}|"{rel}"| {tgt_safe}')
            count += 1

        # Style classes
        lines.append("  classDef added fill:#22c55e,stroke:#16a34a,color:#fff")
        lines.append("  classDef modified fill:#f59e0b,stroke:#d97706,color:#fff")

        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main mutator class
# ---------------------------------------------------------------------------

class GraphMutator:
    """
    Pure graph mutation engine. No external calls.

    Applies a proposal from FeatureProposer to a graph dict and returns
    a MutationResult containing the updated graph and a GraphDiff.
    """

    def apply(
        self,
        current_graph: dict[str, Any],
        proposal: dict[str, Any],
    ) -> MutationResult:
        """
        Apply a feature proposal to the current graph.

        Args:
            current_graph: Dict with "nodes" and "edges" lists
            proposal: Output from FeatureProposer.propose()

        Returns:
            MutationResult with updated_graph and diff
        """
        if "error" in proposal:
            logger.warning("Received error proposal, returning unchanged graph")
            return MutationResult(
                updated_graph=copy.deepcopy(current_graph),
                diff=GraphDiff(warnings=[proposal["error"]]),
            )

        # Deep copy so we never mutate the original
        graph = copy.deepcopy(current_graph)

        nodes: list[dict] = graph.setdefault("nodes", [])
        edges: list[dict] = graph.setdefault("edges", [])

        node_index: dict[str, dict] = {n["id"]: n for n in nodes}
        edge_index: set[str] = {
            f"{e['source']}__{e['target']}" for e in edges
        }

        diff = GraphDiff(
            rationale=proposal.get("rationale", ""),
            impl_plan=proposal.get("impl_plan", []),
            complexity=proposal.get("complexity", "medium"),
            estimated_hours=proposal.get("estimated_hours", 0),
        )

        # --- 1. Add new nodes ---
        for new_node in proposal.get("add_nodes", []):
            nid = new_node.get("id")
            if not nid:
                diff.warnings.append("Skipped node with missing id")
                continue
            if nid in node_index:
                diff.warnings.append(
                    f"Node '{nid}' already exists — skipping add, consider modify_nodes"
                )
                continue

            node_entry = {
                "id": nid,
                "type": new_node.get("type", "file"),
                "name": new_node.get("name", nid),
                "file_path": new_node.get("file_path", ""),
                "description": new_node.get("description", ""),
                "position": self._auto_position(len(nodes)),
            }
            nodes.append(node_entry)
            node_index[nid] = node_entry
            diff.added_nodes.append(NodeDiff(
                node_id=nid,
                change_type="added",
                node_data=node_entry,
            ))
            logger.debug("Added node: %s (%s)", nid, node_entry["type"])

        # --- 2. Add new edges ---
        for new_edge in proposal.get("add_edges", []):
            src = new_edge.get("source")
            tgt = new_edge.get("target")
            rel = new_edge.get("relationship", "depends_on")

            if not src or not tgt:
                diff.warnings.append(f"Skipped edge with missing source/target: {new_edge}")
                continue
            if src not in node_index:
                diff.warnings.append(f"Edge source '{src}' not found in graph")
                continue
            if tgt not in node_index:
                diff.warnings.append(f"Edge target '{tgt}' not found in graph")
                continue

            edge_key = f"{src}__{tgt}"
            if edge_key in edge_index:
                logger.debug("Edge %s already exists, skipping", edge_key)
                continue

            edge_entry = {
                "id": edge_key,
                "source": src,
                "target": tgt,
                "relationship": rel,
            }
            edges.append(edge_entry)
            edge_index.add(edge_key)
            diff.added_edges.append(EdgeDiff(
                edge_id=edge_key,
                change_type="added",
                edge_data=edge_entry,
            ))
            logger.debug("Added edge: %s -[%s]-> %s", src, rel, tgt)

        # --- 3. Modify existing nodes ---
        for mod in proposal.get("modify_nodes", []):
            nid = mod.get("id")
            changes = mod.get("changes", "")
            if not nid:
                continue
            if nid not in node_index:
                diff.warnings.append(
                    f"modify_nodes references unknown node '{nid}'"
                )
                continue

            # Append change note to description
            existing = node_index[nid]
            prev_desc = existing.get("description", "")
            existing["description"] = (
                f"{prev_desc} | MODIFIED: {changes}" if prev_desc
                else f"MODIFIED: {changes}"
            )
            existing["modified"] = True

            diff.modified_nodes.append(NodeDiff(
                node_id=nid,
                change_type="modified",
                node_data=existing,
            ))
            logger.debug("Modified node: %s", nid)

        logger.info(
            "Mutation applied: +%d nodes, +%d edges, ~%d modified | warnings: %d",
            len(diff.added_nodes),
            len(diff.added_edges),
            len(diff.modified_nodes),
            len(diff.warnings),
        )

        return MutationResult(updated_graph=graph, diff=diff)

    def _auto_position(self, node_count: int) -> dict[str, float]:
        """
        Rough auto-layout for new nodes. Places them in a spiral
        so they don't all stack at (0, 0). React Flow's auto-layout
        will clean this up on the frontend.
        """
        import math
        angle = node_count * 0.5
        radius = 200 + node_count * 15
        return {
            "x": round(300 + radius * math.cos(angle), 1),
            "y": round(300 + radius * math.sin(angle), 1),
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_mermaid_name(name: str) -> str:
    """Strip characters that break Mermaid entity names."""
    safe = "".join(c if c.isalnum() or c == "_" else "_" for c in name)
    # Mermaid entity names can't start with a digit
    if safe and safe[0].isdigit():
        safe = "N_" + safe
    return safe or "Unknown"


def _safe_mermaid_id(node_id: str) -> str:
    """Make a node id safe for Mermaid flowchart node ids."""
    return "".join(c if c.isalnum() or c == "_" else "_" for c in node_id)