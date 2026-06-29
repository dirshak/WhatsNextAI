"""
feature_proposer.py (backend)

Proposes architectural mutations for a given feature request using Groq.
Uses the shared groq_client from clients.py — no separate API key management needed.

This module is responsible only for reasoning.
It does NOT modify the graph.
"""
import json
import logging
from typing import Any

from clients import groq_client

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are an expert software architect and codebase mutation engine.

Your job:
Given an existing codebase graph and a feature request, return ONLY a valid JSON
object describing exactly what architectural changes are needed. Do not add any
explanation, markdown, or text outside the JSON object.

Graph schema:
- nodes: list of {id, type, name, file_path, description}
  - type is one of: "file", "class", "function", "module", "service", "database", "external"
- edges: list of {source, target, relationship}
  - relationship is one of: "imports", "calls", "inherits", "depends_on", "instantiates", "defines"

Output schema (return exactly this, nothing else):
{
  "add_nodes": [
    {
      "id": "unique_snake_case_id",
      "type": "file|class|function|module|service|database|external",
      "name": "HumanReadableName",
      "file_path": "relative/path/to/file.py",
      "description": "one sentence: what this component does"
    }
  ],
  "add_edges": [
    {
      "source": "existing_or_new_node_id",
      "target": "existing_or_new_node_id",
      "relationship": "imports|calls|inherits|depends_on|instantiates|defines"
    }
  ],
  "modify_nodes": [
    {
      "id": "existing_node_id",
      "changes": "one sentence: what changes in this existing component"
    }
  ],
  "rationale": "2-3 sentences explaining WHY new components are placed where they are relative to the existing architecture",
  "implementation_plan": [
    "ACTION: path/to/file.py — highly descriptive step detailing exactly which functions, classes, arguments, and specific logic to create or modify."
  ],
  "complexity": "low|medium|high",
  "estimated_hours": 2
}

Rules:
- Only add nodes that are genuinely necessary for the feature
- Place new components consistently with the existing architecture patterns you observe
- implementation_plan steps must be ordered (dependencies before dependents)
- Make implementation_plan extremely descriptive, explicitly detailing what specific functions, classes, arguments, and logic to modify or add in each file.
- If a feature touches an existing node, prefer modify_nodes over adding duplicate nodes
- Never invent frameworks or libraries not already present in the graph
- Keep file_path values consistent with the existing project structure you see
"""

USER_PROMPT_TEMPLATE = """Feature request: "{feature_request}"

Current codebase graph:
{graph_json}

Return the mutation JSON for this feature request."""


# ---------------------------------------------------------------------------
# Main class
# ---------------------------------------------------------------------------

class FeatureProposer:
    """
    Proposes architectural mutations for a given feature request.

    Accepts:
        - current architecture graph (nodes + edges)
        - repository metadata (embedded in graph)
        - user feature request (natural language string)

    Returns:
        {
            "add_nodes": [],
            "add_edges": [],
            "modify_nodes": [],
            "rationale": "",
            "implementation_plan": []
        }

    This module is responsible only for reasoning. It does NOT modify the graph.
    Uses the shared groq_client (X / groq_client) from clients.py.
    """

    MODEL_FAST = "llama-3.3-70b-versatile"    # main reasoning model
    MODEL_SMALL = "llama-3.1-8b-instant"       # fallback for simple requests

    def __init__(self, use_fast_model: bool = True):
        self.model = self.MODEL_FAST if use_fast_model else self.MODEL_SMALL

    async def propose(
        self,
        feature_request: str,
        current_graph: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Main entry point.

        Args:
            feature_request: Natural language description e.g. "add rate limiting"
            current_graph: Dict with keys "nodes" and "edges" (from graph builder)

        Returns:
            Parsed mutation plan dict, or error dict if Groq call fails.
        """
        trimmed_graph = self._trim_graph_for_context(current_graph)
        graph_json = json.dumps(trimmed_graph, indent=2)

        user_message = USER_PROMPT_TEMPLATE.format(
            feature_request=feature_request,
            graph_json=graph_json,
        )

        logger.info(
            "Proposing feature '%s' against graph with %d nodes, %d edges",
            feature_request,
            len(current_graph.get("nodes", [])),
            len(current_graph.get("edges", [])),
        )

        try:
            response = await groq_client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_message},
                ],
                temperature=0.2,      # low temp: we want deterministic structure
                max_tokens=1200,
                response_format={"type": "json_object"},
            )

            raw = response.choices[0].message.content
            result = json.loads(raw)
            result = self._validate_and_fill_defaults(result)

            logger.info(
                "Proposal complete: +%d nodes, +%d edges, %d modifications",
                len(result.get("add_nodes", [])),
                len(result.get("add_edges", [])),
                len(result.get("modify_nodes", [])),
            )
            return result

        except json.JSONDecodeError as e:
            logger.error("Groq returned invalid JSON: %s", e)
            return self._error_result(f"Model returned invalid JSON: {e}")
        except Exception as e:
            logger.error("Feature proposal failed: %s", e)
            return self._error_result(str(e))

    # -----------------------------------------------------------------------
    # Helpers
    # -----------------------------------------------------------------------

    def _trim_graph_for_context(
        self,
        graph: dict[str, Any],
        max_nodes: int = 50,
        max_edges: int = 80,
    ) -> dict[str, Any]:
        """
        Large repos produce graphs with thousands of nodes. Trim to the most
        structurally important ones so we stay within Groq's context window.

        Priority: files and classes over individual functions.
        """
        nodes = graph.get("nodes", [])
        edges = graph.get("edges", [])

        # Sort: files and classes first, then functions, then rest
        priority = {"file": 0, "class": 1, "module": 2, "service": 3,
                    "database": 4, "external": 5, "function": 6}
        nodes_sorted = sorted(
            nodes,
            key=lambda n: priority.get(n.get("type", "function"), 99),
        )

        kept_nodes = nodes_sorted[:max_nodes]
        kept_ids = {n["id"] for n in kept_nodes}

        # Only keep edges where both endpoints are in kept set
        kept_edges = [
            e for e in edges
            if e.get("source") in kept_ids and e.get("target") in kept_ids
        ][:max_edges]

        return {"nodes": kept_nodes, "edges": kept_edges}

    def _validate_and_fill_defaults(self, result: dict) -> dict:
        """Ensure all expected keys exist with correct types."""
        result.setdefault("add_nodes", [])
        result.setdefault("add_edges", [])
        result.setdefault("modify_nodes", [])
        result.setdefault("rationale", "")
        result.setdefault("implementation_plan", result.pop("impl_plan", []))
        result.setdefault("complexity", "medium")
        result.setdefault("estimated_hours", 4)

        # Validate node ids are strings
        for node in result["add_nodes"]:
            node["id"] = str(node.get("id", "unknown_node"))
            node.setdefault("type", "file")
            node.setdefault("description", "")
            node.setdefault("file_path", "")

        return result

    def _error_result(self, message: str) -> dict:
        return {
            "error": message,
            "add_nodes": [],
            "add_edges": [],
            "modify_nodes": [],
            "rationale": "",
            "implementation_plan": [],
            "complexity": "unknown",
            "estimated_hours": 0,
        }
