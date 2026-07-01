"""
Mermaid exporter.

Pure rendering: takes an already-computed LayoutResult (layers, in-layer
order, clusters, entry flags, back-edge flags) and emits Mermaid
`flowchart TD` text. No layout decisions are made here — this module only
decides how to *say* a layout, not what the layout *is*.

Emission order matters even though Mermaid/dagre re-lays-out the graph
client-side: nodes are emitted in our computed layer/order sequence and
grouped into subgraphs by cluster, which seeds dagre's own crossing-reduction
pass with an already-good starting order instead of raw DB row order.

Each cluster gets its own low-contrast tone (dark, desaturated fill so it
reads clearly against the app's dark theme without fighting it), applied to
both the file nodes AND their enclosing subgraph box (the box gets a darker
shade of the same tone so nodes still stand out from their container). Node
and subgraph boxes are rounded, and titles are rendered bold/larger via
inline HTML (the frontend already runs Mermaid with `htmlLabels: true`, see
DiagramPanel.jsx). The entry point additionally gets a glow plus an explicit
"START" marker in its label, so where execution begins is unambiguous at a
glance.

Note on the glow: Mermaid's `classDef`/`style` value grammar does not accept
parentheses at all (verified against the actual parser bundled in
frontend/node_modules/mermaid — `filter:drop-shadow(...)` fails with a hard
parse error, "Expecting ... got 'PS'"), so a real CSS drop-shadow filter is
not an option here. The glow is instead a concentric "halo" ring: the entry
node is wrapped in its own untitled subgraph styled with a bright,
transparent-fill border, which reads as a soft outline around the node
without relying on any unsupported CSS function syntax.
"""
from __future__ import annotations

from .layout import OTHER_CLUSTER_KEY, LayoutResult

# Muted, dark-theme-friendly tones: fill stays dark/desaturated so contrast
# against the panel background stays low, while the stroke hue is distinct
# enough to tell clusters apart at a glance.
_TONE_PALETTE = [
    ("tone1", "#16223a", "#5b8def"),  # slate blue
    ("tone2", "#2a2416", "#c99a4a"),  # muted amber
    ("tone3", "#17281e", "#4fae82"),  # sage green
    ("tone4", "#2a1c22", "#c96a86"),  # dusty rose
    ("tone5", "#211f36", "#8b85d6"),  # muted indigo
    ("tone6", "#152625", "#4aa9a3"),  # muted teal
    ("tone7", "#241d33", "#a480c9"),  # muted purple
]
_OTHER_TONE = ("toneOther", "#1c1c1c", "#7a7a7a")  # neutral gray for unreached/backfilled files
_ENTRY_TONE = ("entry", "#16321c", "#7fff6e")       # kept close to the app's existing accent green

_NODE_CORNER_RADIUS = 10
_CLUSTER_CORNER_RADIUS = 14
_HALO_CORNER_RADIUS = 22
_CLASSDEF_TEMPLATE = (
    "classDef {name} fill:{fill},stroke:{stroke},stroke-width:{width}px,"
    "color:#e8e8f0,font-family:monospace,rx:{radius}px,ry:{radius}px"
)


def _escape(text: str) -> str:
    return text.replace('"', "'")


def _darken(hex_color: str, factor: float) -> str:
    """Shade a hex color toward black by `factor` (0-1) — used so a cluster's
    enclosing box reads as a darker container behind its lighter node tone."""
    hex_color = hex_color.lstrip("#")
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
    r, g, b = (max(0, int(c * factor)) for c in (r, g, b))
    return f"#{r:02x}{g:02x}{b:02x}"


def _cluster_label(cluster_key: str) -> str:
    if cluster_key == OTHER_CLUSTER_KEY:
        return "Other modules"
    return cluster_key


def _mermaid_subgraph_id(cluster_key: str) -> str:
    safe = "".join(c if c.isalnum() else "_" for c in cluster_key) or "root"
    return f"cluster_{safe}"


def _assign_cluster_tones(cluster_keys) -> dict[str, str]:
    """Cycle each non-'other' cluster through the muted palette, in the
    order clusters first appear, so tones are stable across a given render."""
    tone_of: dict[str, str] = {}
    palette_index = 0
    for key in cluster_keys:
        if key == OTHER_CLUSTER_KEY:
            tone_of[key] = _OTHER_TONE[0]
            continue
        tone_of[key] = _TONE_PALETTE[palette_index % len(_TONE_PALETTE)][0]
        palette_index += 1
    return tone_of


def _render_node_line(node, indent: str, class_name: str) -> str:
    title = _escape(node.file_node.label)
    heading = f"<b style='font-size:15px'>{title}</b>"
    if node.is_entry:
        heading = (
            "<div style='font-size:10px;letter-spacing:2px;opacity:0.85'>START</div>"
            + heading
        )

    body = heading
    items = node.file_node.functions + node.file_node.classes
    if items:
        detail = _escape("<br/>".join(items))
        body += f"<br/><span style='font-size:10px;opacity:0.75'>{detail}</span>"

    # Round-edge shape id("...") instead of the square-cornered id["..."].
    return f'{indent}{node.id}("{body}"):::{class_name}'


def _halo_subgraph_id(node_id: str) -> str:
    return f"halo_{node_id}"


def _emit_node(lines: list[str], halo_styles: list[str], node, indent: str, class_name: str) -> None:
    """Emit a node line, wrapping entry nodes in an untitled "halo" subgraph
    ring for a glow-like effect (see module docstring for why this replaces
    a literal CSS drop-shadow filter)."""
    if not node.is_entry:
        lines.append(_render_node_line(node, indent, class_name))
        return

    halo_id = _halo_subgraph_id(node.id)
    lines.append(f'{indent}subgraph {halo_id}[" "]')
    lines.append(_render_node_line(node, indent + "    ", class_name))
    lines.append(f"{indent}end")
    halo_styles.append(
        f"    style {halo_id} fill:none,stroke:{_ENTRY_TONE[2]},stroke-width:2px,"
        f"rx:{_HALO_CORNER_RADIUS}px,ry:{_HALO_CORNER_RADIUS}px"
    )


def layout_to_mermaid(layout: LayoutResult) -> str:
    if not layout.nodes:
        return 'flowchart TD\n    empty("No files found")'

    node_by_id = {n.id: n for n in layout.nodes}
    cluster_tone = _assign_cluster_tones(layout.clusters.keys())
    used_tones: set[str] = set()
    subgraph_styles: list[str] = []
    halo_styles: list[str] = []

    def class_for(node) -> str:
        name = _ENTRY_TONE[0] if node.is_entry else cluster_tone[node.cluster]
        used_tones.add(name)
        return name

    all_tones = {name: (fill, stroke) for name, fill, stroke in _TONE_PALETTE}
    all_tones[_OTHER_TONE[0]] = (_OTHER_TONE[1], _OTHER_TONE[2])
    all_tones[_ENTRY_TONE[0]] = (_ENTRY_TONE[1], _ENTRY_TONE[2])

    lines = ["flowchart TD"]

    for cluster_key, node_ids in layout.clusters.items():
        if len(node_ids) > 1:
            subgraph_id = _mermaid_subgraph_id(cluster_key)
            title = _escape(_cluster_label(cluster_key))
            lines.append(f'    subgraph {subgraph_id}["<b style=\'font-size:14px\'>{title}</b>"]')
            for nid in node_ids:
                node = node_by_id[nid]
                _emit_node(lines, halo_styles, node, "        ", class_for(node))
            lines.append("    end")

            tone_fill, tone_stroke = all_tones[cluster_tone[cluster_key]]
            subgraph_styles.append(
                f"    style {subgraph_id} fill:{_darken(tone_fill, 0.75)},"
                f"stroke:{tone_stroke},stroke-width:1px,"
                f"rx:{_CLUSTER_CORNER_RADIUS}px,ry:{_CLUSTER_CORNER_RADIUS}px"
            )
        else:
            node = node_by_id[node_ids[0]]
            _emit_node(lines, halo_styles, node, "    ", class_for(node))

    for edge in layout.edges:
        connector = "-.->" if edge.is_back_edge else "-->"
        lines.append(f"    {edge.source} {connector} {edge.target}")

    lines.extend(subgraph_styles)
    lines.extend(halo_styles)

    for name in sorted(used_tones):
        fill, stroke = all_tones[name]
        width = 3 if name == _ENTRY_TONE[0] else 1.5
        lines.append("    " + _CLASSDEF_TEMPLATE.format(
            name=name, fill=fill, stroke=stroke, width=width,
            radius=_NODE_CORNER_RADIUS,
        ))

    return "\n".join(lines)
