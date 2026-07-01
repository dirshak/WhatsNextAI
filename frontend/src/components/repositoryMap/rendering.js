// D3 render helpers for the Repository Map. These take an existing D3
// selection + already-computed data (positions from layoutEngine.js, paths
// from edgeRouting.js) and do the actual DOM join/attr work — no layout
// decisions happen here.
//
// Deliberately no `.transition()` anywhere: a prior version stored a
// selection's `.transition()` return value (a Transition, not a Selection)
// and reused it later from hover handlers, which threw "transition not
// found" once the transition had long since ended. Keeping this module
// transition-free avoids that whole bug class by construction — smooth
// animation instead comes from a static CSS `transition` style set once per
// element, so ordinary `.attr()` changes (opacity, stroke-width, ...)
// animate automatically without ever touching a d3 Transition object.
import * as d3 from "d3";
import { EXTERNAL_COLOR, NODE_H, NODE_W, TEST_STROKE, colorForGroup } from "./constants.js";

export function renderGroupBoxes(layer, groupBoxes, groupOrder) {
    const data = Array.from(groupBoxes.entries()).map(([groupId, box]) => ({ groupId, ...box }));

    const sel = layer.selectAll("g.group-box")
        .data(data, d => d.groupId)
        .join(enter => {
            const ent = enter.append("g").attr("class", "group-box");
            ent.append("rect").attr("class", "group-box-rect").attr("rx", 16).attr("ry", 16)
                .style("transition", "opacity 200ms ease, stroke-width 200ms ease, fill 200ms ease, x 300ms ease, y 300ms ease, width 300ms ease, height 300ms ease");
            ent.append("text").attr("class", "group-box-label")
                .attr("font-family", "JetBrains Mono, monospace")
                .attr("font-weight", 800)
                .attr("text-anchor", "middle")
                .attr("pointer-events", "none")
                .style("transition", "x 300ms ease, y 300ms ease");
            return ent;
        });

    const color = d => colorForGroup(d.groupId, groupOrder);
    sel.select("rect.group-box-rect")
        .attr("x", d => d.x).attr("y", d => d.y)
        .attr("width", d => d.width).attr("height", d => d.height)
        .attr("fill", d => color(d) + "0d")
        .attr("stroke", color).attr("stroke-width", 1.5)
        .attr("stroke-dasharray", "4,3");
    sel.select("text.group-box-label")
        // Centered title, sized to the box width so short group names read
        // as a real header rather than a small corner tag.
        .attr("x", d => d.x + d.width / 2)
        .attr("y", d => d.y + 22)
        .attr("font-size", d => Math.min(16, Math.max(12, d.width / 12)))
        .attr("fill", color)
        .text(d => d.groupId);

    return sel;
}

// Named-connection visibility state for one edge: "selected" (user clicked
// this exact edge), "emphasized" (touches the currently selected/hovered
// node), "dimmed" (some other edge is selected/emphasized right now), or
// "normal" (default clean view). Only "selected"/"emphasized" edges ever
// show a label — named connections are revealed on demand, not by default.
function edgeState(key, focus) {
    if (focus?.selectedEdgeKey) return key === focus.selectedEdgeKey ? "selected" : "dimmed";
    if (focus?.emphasizedEdgeKeys?.size) return focus.emphasizedEdgeKeys.has(key) ? "emphasized" : "dimmed";
    return "normal";
}

export function edgeLabelText(d, labelMode, state) {
    if (state === "selected" || state === "emphasized") {
        return d.label || (d.kind === "semantic" ? d.kind : "imports");
    }
    if (labelMode === "none") return "";
    if (d.kind !== "semantic" || !d.label) return "";
    if (labelMode === "all" || d.label !== "invokes") return d.label;
    return "";
}

function edgeOpacity(state, kind) {
    if (state === "selected" || state === "emphasized") return 1;
    if (state === "dimmed") return 0.04;
    return kind === "semantic" ? 0.7 : 0.45;
}

function edgeWidth(state, kind) {
    if (state === "selected") return 3;
    if (state === "emphasized") return kind === "semantic" ? 2.2 : 1.8;
    return kind === "semantic" ? 1.6 : 1.1;
}

function positionEdgeLabels(labelSel, pathSel) {
    labelSel.each(function (d) {
        const pathNode = pathSel.filter(p => p.key === d.key).node();
        if (!pathNode) return;
        let mid;
        if (typeof pathNode.getPointAtLength === "function") {
            mid = pathNode.getPointAtLength(pathNode.getTotalLength() / 2);
        } else {
            // straight <line> fallback (intra-group edges)
            mid = {
                x: (+pathNode.getAttribute("x1") + +pathNode.getAttribute("x2")) / 2,
                y: (+pathNode.getAttribute("y1") + +pathNode.getAttribute("y2")) / 2,
            };
        }
        d3.select(this).attr("x", mid.x).attr("y", mid.y - 5);
    });
}

const EDGE_TRANSITION = "stroke-opacity 180ms ease, stroke-width 180ms ease, opacity 180ms ease";

// `focus` (optional): { selectedEdgeKey, emphasizedEdgeKeys: Set<string> }
export function renderIntraEdges(layer, intraEdges, nodePositions, labelMode, focus, onEdgeClick) {
    const keyOf = d => `${d.source}->${d.target}`;

    const lineSel = layer.selectAll("line.intra-edge")
        .data(intraEdges, keyOf)
        .join(enter => enter.append("line").attr("class", "intra-edge").style("transition", EDGE_TRANSITION))
        .attr("x1", d => nodePositions.get(d.source)?.x ?? 0)
        .attr("y1", d => nodePositions.get(d.source)?.y ?? 0)
        .attr("x2", d => nodePositions.get(d.target)?.x ?? 0)
        .attr("y2", d => nodePositions.get(d.target)?.y ?? 0)
        .attr("stroke", d => d.kind === "semantic" ? "#7fb8ff" : "rgba(210,220,240,0.55)")
        .attr("stroke-width", d => edgeWidth(edgeState(keyOf(d), focus), d.kind))
        .attr("stroke-opacity", d => edgeOpacity(edgeState(keyOf(d), focus), d.kind))
        .style("cursor", "pointer")
        .on("click", function (e, d) { e.stopPropagation(); onEdgeClick?.(e, d, keyOf(d)); });

    const labelData = intraEdges.filter(d => {
        const state = edgeState(keyOf(d), focus);
        return d.kind === "semantic" || state === "selected" || state === "emphasized";
    });
    const labelSel = layer.selectAll("text.intra-edge-label")
        .data(labelData, keyOf)
        .join("text")
        .attr("class", "intra-edge-label")
        .attr("font-size", "11px")
        .attr("font-weight", 700)
        .attr("font-family", "JetBrains Mono, monospace")
        .attr("fill", d => edgeState(keyOf(d), focus) === "selected" ? "#ffe08a" : "#a9d3ff")
        .attr("text-anchor", "middle")
        .style("pointer-events", "none")
        .text(d => edgeLabelText(d, labelMode, edgeState(keyOf(d), focus)));

    // Straight lines — midpoint is just the average of the two endpoints,
    // no need for the path-based getPointAtLength helper used for curves.
    labelSel.each(function (d) {
        const x = ((nodePositions.get(d.source)?.x ?? 0) + (nodePositions.get(d.target)?.x ?? 0)) / 2;
        const y = ((nodePositions.get(d.source)?.y ?? 0) + (nodePositions.get(d.target)?.y ?? 0)) / 2;
        d3.select(this).attr("x", x).attr("y", y - 5);
    });

    return lineSel;
}

export function renderInterGroupEdges(layer, interPaths, labelMode, focus, onEdgeClick) {
    const pathSel = layer.selectAll("path.inter-edge")
        .data(interPaths, d => d.key)
        .join(enter => enter.append("path").attr("class", "inter-edge").attr("fill", "none").style("transition", EDGE_TRANSITION))
        .attr("d", d => d.path)
        .attr("stroke", d => d.kind === "semantic" ? "#7fb8ff" : "rgba(210,220,240,0.4)")
        .attr("stroke-width", d => edgeWidth(edgeState(d.key, focus), d.kind))
        .attr("stroke-opacity", d => edgeOpacity(edgeState(d.key, focus), d.kind))
        .style("cursor", "pointer")
        .on("click", function (e, d) { e.stopPropagation(); onEdgeClick?.(e, d, d.key); });

    const labelData = interPaths.filter(d => {
        const state = edgeState(d.key, focus);
        return d.kind === "semantic" || state === "selected" || state === "emphasized";
    });
    const labelSel = layer.selectAll("text.inter-edge-label")
        .data(labelData, d => d.key)
        .join("text")
        .attr("class", "inter-edge-label")
        .attr("font-size", "11px")
        .attr("font-weight", 700)
        .attr("font-family", "JetBrains Mono, monospace")
        .attr("fill", d => edgeState(d.key, focus) === "selected" ? "#ffe08a" : "#a9d3ff")
        .attr("text-anchor", "middle")
        .style("pointer-events", "none")
        .text(d => edgeLabelText(d, labelMode, edgeState(d.key, focus)));

    positionEdgeLabels(labelSel, pathSel);

    return { pathSel, labelSel };
}

function strokeColorFor(d) {
    if (d.isGroup) return colorForGroup(d.group, d.__groupOrder);
    if (d.is_test) return TEST_STROKE;
    if (d.is_external) return EXTERNAL_COLOR;
    return colorForGroup(d.group, d.__groupOrder);
}

// `connectedNodeIds` (optional Set<string>): when set, non-connected nodes
// dim — used for the "click a file -> highlight its neighborhood" feature.
// `pinnedIds` (optional Set<string>): double-click-pinned files get a
// thicker border so pin state stays visible without needing to hover/click
// again — read declaratively rather than mutated imperatively, since a
// double-click also dispatches ordinary click events first, which (via
// React state updates) can replace the very DOM node an imperative handler
// would have tried to restyle.
export function renderNodes(layer, nodes, nodePositions, groupOrder, handlers, connectedNodeIds, pinnedIds) {
    // Stash groupOrder on each datum so per-node style callbacks (invoked by
    // D3 without extra args) can still resolve a color without a closure
    // capturing a stale groupOrder from an earlier render.
    nodes.forEach(n => { n.__groupOrder = groupOrder; });

    const sel = layer.selectAll("g.node-group")
        .data(nodes, d => d.id)
        .join(enter => {
            const ent = enter.append("g").attr("class", "node-group").style("cursor", "pointer")
                .style("transition", "transform 300ms ease");
            ent.append("g").attr("class", "shape");
            ent.append("text").attr("class", "node-label")
                .attr("text-anchor", "middle")
                .attr("font-family", "JetBrains Mono, monospace")
                .attr("pointer-events", "none");
            return ent;
        });

    sel.attr("transform", d => {
        const pos = nodePositions.get(d.id) || { x: 0, y: 0 };
        return `translate(${pos.x},${pos.y})`;
    });

    sel.each(function (d) {
        const shape = d3.select(this).select("g.shape");
        shape.selectAll("*").remove();
        const stroke = strokeColorFor(d);
        shape.append("rect")
            .attr("width", NODE_W).attr("height", NODE_H)
            .attr("x", -NODE_W / 2).attr("y", -NODE_H / 2)
            .attr("rx", 5).attr("ry", 5)
            .attr("fill", d.isGroup ? stroke + "1a" : "rgba(255,255,255,0.045)")
            .attr("stroke", stroke)
            .attr("stroke-width", d.isGroup ? 1.8 : (pinnedIds?.has(d.id) ? 2.6 : (d.is_test ? 1.8 : 1.3)))
            .attr("stroke-dasharray", d.isGroup ? "4,2" : null)
            .style("transition", "opacity 180ms ease, stroke-width 180ms ease");
    });

    sel.select(".shape rect")
        .attr("opacity", d => connectedNodeIds && connectedNodeIds.size ? (connectedNodeIds.has(d.id) ? 1 : 0.15) : 1);

    const maxChars = Math.floor((NODE_W - 10) / 6.4);
    sel.select("text.node-label")
        .text(d => {
            const label = d.isGroup ? `${d.label} (${d.fileCount})` : d.filename;
            return label.length > maxChars ? label.slice(0, maxChars - 1) + "…" : label;
        })
        .attr("dy", "0.32em")
        .attr("font-size", 11)
        .attr("font-weight", d => d.isGroup ? 700 : 600)
        .attr("fill", d => d.isGroup ? colorForGroup(d.group, groupOrder) : "#eef2fb");

    if (handlers) {
        sel.on("mouseover", handlers.onOver)
            .on("mouseout", handlers.onOut)
            .on("click", handlers.onClick)
            .on("dblclick", handlers.onDoubleClick || null);
        if (handlers.dragBehavior) sel.call(handlers.dragBehavior);
    }

    return sel;
}
