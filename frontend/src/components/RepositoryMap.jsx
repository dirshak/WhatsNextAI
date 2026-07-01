// src/components/RepositoryMap.jsx
//
// Merges the old Architecture Diagram (Mermaid, grouped/organized) and
// Dependency Graph (d3 force-directed, complete file-level detail) into one
// view. Real files + real dependency edges (from /repo-map/{repoId}, which
// reuses the same graph_model/build_repo_graph the Mermaid pipeline uses)
// laid out with a hierarchical (group-then-file) force layout — see
// repositoryMap/layoutEngine.js for why: a single flat simulation over
// every file produced one hairball with overlapping, escaping groups.
//
// This component is the orchestrator only — fetch, React state/refs, and
// the effect that re-renders on layout/filter/label changes. The actual
// logic lives in repositoryMap/: layoutEngine.js (positions), grouping.js
// (filter/collapse), edgeRouting.js (intra vs. inter-group edges — every
// single dependency edge is kept and rendered, never merged/aggregated),
// rendering.js (D3 DOM joins).
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import * as d3 from "d3";
import { API } from '../config';
import { computeHierarchicalLayout } from "./repositoryMap/layoutEngine.js";
import { buildVisibleGraph } from "./repositoryMap/grouping.js";
import { classifyEdges, buildInterGroupPaths, pathForEdge } from "./repositoryMap/edgeRouting.js";
import { renderGroupBoxes, renderIntraEdges, renderInterGroupEdges, renderNodes } from "./repositoryMap/rendering.js";
import { colorForGroup } from "./repositoryMap/constants.js";

const DEFAULT_FILTERS = { structural: true, semantic: true, external: true, tests: true, generated: true };

export default function RepositoryMap({ repoId, repoUrl }) {
    const svgRef = useRef(null);
    const containerRef = useRef(null);
    const zoomRef = useRef(null);
    const autoFitRef = useRef(null);
    // Mutable layout state the draw effect and drag handler both read/write
    // without forcing a React re-render on every drag tick.
    const layoutDataRef = useRef(null); // { nodePositions, groupBoxes, nodeById, interPairs, intra }
    // Double-click-to-pin: positions here survive layout recomputes (filter/
    // collapse changes), applied as an override right after
    // computeHierarchicalLayout runs. Doesn't need to be React state — it's
    // read/written imperatively alongside nodePositions.
    const pinnedPositionsRef = useRef(new Map());

    const [rawGraph, setRawGraph] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [stats, setStats] = useState(null);
    const [tooltip, setTooltip] = useState(null);
    const [copied, setCopied] = useState(null); // "dot" | "mermaid" | null
    const [selectedNodeId, setSelectedNodeId] = useState(null);
    const [selectedEdge, setSelectedEdge] = useState(null); // { key, source, target, kind, label }
    const [focusedGroup, setFocusedGroup] = useState(null);
    const [collapsedGroupIds, setCollapsedGroupIds] = useState(() => new Set());
    const [filters, setFilters] = useState(DEFAULT_FILTERS);
    const [labelMode, setLabelMode] = useState("important"); // "none" | "important" | "all"
    const [search, setSearch] = useState("");
    const [layoutTick, setLayoutTick] = useState(0);
    const [pinVersion, setPinVersion] = useState(0); // bumped on pin/unpin so renderNodes re-reflects it

    // ── Fetch once per repoId ────────────────────────────────────────────
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setRawGraph(null);
        setCollapsedGroupIds(new Set()); // fully expanded on every fresh load

        fetch(`${API}/repo-map/${repoId}`)
            .then(r => r.json())
            .then(data => {
                if (cancelled) return;
                if (data.error) { setError(data.error); setLoading(false); return; }
                setRawGraph(data);
                setLoading(false);
            })
            .catch(() => { if (!cancelled) { setError("Failed to load repository map. Try re-ingesting the repo."); setLoading(false); } });

        return () => { cancelled = true; };
    }, [repoId]);

    // Node payloads carry `group` as the human-readable label (from
    // role_groups.assign_group), not the backend's slugged `groups[].id` —
    // use the label as the canonical group identifier throughout so
    // collapse/color/layout lookups against `node.group` actually match.
    const groupOrder = useMemo(() => rawGraph?.groups.map(g => g.label) || [], [rawGraph]);

    // Which nodes/edges are actually shown (filters + collapse) — pure,
    // id-based, no positions yet.
    const visibleGraph = useMemo(() => {
        if (!rawGraph) return null;
        return buildVisibleGraph(rawGraph.nodes, rawGraph.edges, collapsedGroupIds, filters);
    }, [rawGraph, collapsedGroupIds, filters]);

    const toggleGroup = useCallback((groupId) => {
        setCollapsedGroupIds(prev => {
            const next = new Set(prev);
            if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
            return next;
        });
    }, []);

    // ── Compute the hierarchical layout whenever the visible node/edge set
    // changes (fresh fetch, filter toggle, or collapse/expand) — each of
    // these is a deliberate user action, not a per-frame recompute, so
    // re-running the (bounded, two-phase) layout each time stays cheap and
    // simple rather than trying to incrementally patch a persistent sim.
    useEffect(() => {
        if (!visibleGraph || !containerRef.current) return;
        const width = containerRef.current.clientWidth || 900;
        const height = containerRef.current.clientHeight || 600;

        const { nodePositions, groupBoxes } = computeHierarchicalLayout(
            visibleGraph.nodes, visibleGraph.edges, groupOrder, { width, height }
        );
        // Pinned files stay put across a layout recompute — the group
        // rigid-body offset moves under them like everything else, but a
        // pin overrides the file's own position within its group.
        for (const [id, pos] of pinnedPositionsRef.current) {
            if (nodePositions.has(id)) nodePositions.set(id, pos);
        }
        const nodeById = new Map(visibleGraph.nodes.map(n => [n.id, n]));
        // No aggregation: every edge the parser found is classified as
        // intra- or inter-group, but every single one is kept and rendered.
        const { intra, inter } = classifyEdges(visibleGraph.edges, nodeById);

        layoutDataRef.current = { nodePositions, groupBoxes, nodeById, intra, inter };
        setStats({ nodes: visibleGraph.nodes.length, edges: visibleGraph.edges.length });
        setLayoutTick(t => t + 1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visibleGraph, groupOrder]);

    // ── Draw effect — D3 general update pattern via rendering.js helpers.
    useEffect(() => {
        if (!layoutDataRef.current || !svgRef.current || !containerRef.current) return;
        const width = containerRef.current.clientWidth || 900;
        const height = containerRef.current.clientHeight || 600;
        const { nodePositions, groupBoxes, inter, intra, nodeById } = layoutDataRef.current;

        const svg = d3.select(svgRef.current);
        svg.attr("width", width).attr("height", height);

        let g = svg.select("g.viewport");
        if (g.empty()) {
            g = svg.append("g").attr("class", "viewport");
            const defs = svg.append("defs");
            const glow = defs.append("filter").attr("id", "rm-glow");
            glow.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "blur");
            const merge = glow.append("feMerge");
            merge.append("feMergeNode").attr("in", "blur");
            merge.append("feMergeNode").attr("in", "SourceGraphic");

            const zoom = d3.zoom().scaleExtent([0.1, 5]).on("zoom", e => g.attr("transform", e.transform));
            zoomRef.current = zoom;
            svg.call(zoom);
            svg.on("click", function (e) {
                if (e.target === svgRef.current) { setSelectedNodeId(null); setSelectedEdge(null); }
            });
            // z-order: group boxes -> inter-group edges -> intra-group edges -> nodes
            g.append("g").attr("class", "group-boxes");
            g.append("g").attr("class", "inter-edges");
            g.append("g").attr("class", "intra-edges");
            g.append("g").attr("class", "nodes");
        }

        const nameOf = (id) => nodeById.get(id)?.filename || nodeById.get(id)?.label || (id || "").replace(/^group:/, "");
        function onEdgeClick(e, d, key) {
            setSelectedNodeId(null);
            setSelectedEdge(prev => {
                if (prev?.key === key) return null; // click again to deselect
                return {
                    key, source: d.source, target: d.target, kind: d.kind, label: d.label,
                    sourceLabel: nameOf(d.source), targetLabel: nameOf(d.target),
                    sourceGroup: nodeById.get(d.source)?.group, targetGroup: nodeById.get(d.target)?.group,
                };
            });
        }

        // Unify click-driven ("selected an edge" / "selected a node, so its
        // neighborhood is emphasized") edge visibility into one focus object
        // that rendering.js's edge helpers use for both opacity and the
        // "only show labels for the relevant edges" rule.
        const emphasizedEdgeKeys = new Set();
        const connectedNodeIds = new Set();
        if (selectedNodeId) {
            connectedNodeIds.add(selectedNodeId);
            visibleGraph.edges.forEach(l => {
                if (l.source === selectedNodeId || l.target === selectedNodeId) {
                    emphasizedEdgeKeys.add(`${l.source}->${l.target}`);
                    connectedNodeIds.add(l.source);
                    connectedNodeIds.add(l.target);
                }
            });
        }
        const focus = selectedEdge
            ? { selectedEdgeKey: selectedEdge.key }
            : (emphasizedEdgeKeys.size ? { emphasizedEdgeKeys } : null);

        renderGroupBoxes(g.select("g.group-boxes"), groupBoxes, groupOrder);
        const intraSel = renderIntraEdges(g.select("g.intra-edges"), intra, nodePositions, labelMode, focus, onEdgeClick);
        const interPaths = buildInterGroupPaths(inter, nodePositions, groupBoxes, nodeById);
        const { pathSel: interSel } = renderInterGroupEdges(g.select("g.inter-edges"), interPaths, labelMode, focus, onEdgeClick);

        const dragBehavior = d3.drag()
            .filter(d => !d.isGroup)
            .on("start", function () {
                // The node group has a CSS transition on `transform` for
                // smooth layout-recompute animation — disable it during an
                // active drag so position tracks the mouse instantly instead
                // of animating after every tick.
                d3.select(this).style("transition", "none");
            })
            .on("drag", function (e, d) {
                nodePositions.set(d.id, { x: e.x, y: e.y });
                if (pinnedPositionsRef.current.has(d.id)) pinnedPositionsRef.current.set(d.id, { x: e.x, y: e.y });
                d3.select(this).attr("transform", `translate(${e.x},${e.y})`);
                intraSel
                    .filter(l => l.source === d.id || l.target === d.id)
                    .attr("x1", l => nodePositions.get(l.source)?.x ?? 0)
                    .attr("y1", l => nodePositions.get(l.source)?.y ?? 0)
                    .attr("x2", l => nodePositions.get(l.target)?.x ?? 0)
                    .attr("y2", l => nodePositions.get(l.target)?.y ?? 0);
                // Only recompute the (small) subset of curves actually
                // touching the dragged node — with thousands of inter-group
                // edges possible, rebuilding every path + relabeling all of
                // them on every drag tick would be wasteful.
                interSel
                    .filter(l => l.source === d.id || l.target === d.id)
                    .attr("d", l => pathForEdge(l, nodePositions, groupBoxes, nodeById));
            })
            .on("end", function () {
                // Labels lag slightly during drag (skipped above for
                // performance) — snap them back into place once released.
                renderInterGroupEdges(g.select("g.inter-edges"), buildInterGroupPaths(inter, nodePositions, groupBoxes, nodeById), labelMode, focus, onEdgeClick);
                d3.select(this).style("transition", "transform 300ms ease");
            });

        renderNodes(g.select("g.nodes"), visibleGraph.nodes, nodePositions, groupOrder, {
            onOver: handleOver,
            onOut: handleOut,
            onClick: handleClick,
            onDoubleClick: handleDoubleClick,
            dragBehavior,
        }, connectedNodeIds, pinnedPositionsRef.current);

        function autoFit() {
            if (!zoomRef.current || !svgRef.current) return;
            const el = svgRef.current;
            const gEl = el.querySelector("g.viewport");
            if (!gEl) return;
            const b = gEl.getBBox();
            if (!b.width || !b.height) return;
            const w = el.clientWidth || 900, h = el.clientHeight || 600, pad = 80;
            const sc = Math.min((w - pad * 2) / b.width, (h - pad * 2) / b.height, 1);
            const tx = (w - b.width * sc) / 2 - b.x * sc;
            const ty = (h - b.height * sc) / 2 - b.y * sc;
            d3.select(el).transition().duration(400)
                .call(zoomRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(sc));
        }
        autoFitRef.current = autoFit;
        autoFit();

        function buildTooltip(e, d) {
            const deps = visibleGraph.edges.filter(l => l.source === d.id).map(l => nameOf(l.target));
            const usedBy = visibleGraph.edges.filter(l => l.target === d.id).map(l => nameOf(l.source));
            return {
                x: e.offsetX, y: e.offsetY, id: d.id, isGroup: !!d.isGroup,
                filePath: d.file_path, group: d.group, isExternal: !!d.is_external,
                depCount: d.isGroup ? d.fileCount : (d.dependency_count || 0),
                imports: d.imports || [], functions: d.functions || [], classes: d.classes || [],
                docstring: d.docstring || null, deps, usedBy,
            };
        }
        function handleOver(e, d) {
            d3.select(this).select(".shape").selectAll("rect").attr("filter", "url(#rm-glow)");
            // A temporary hover preview on top of whatever's persistently
            // selected — restored to the declarative baseline on mouseout.
            intraSel.attr("stroke-opacity", l => (l.source === d.id || l.target === d.id) ? 0.95 : 0.05);
            interSel.attr("stroke-opacity", l => (l.source === d.id || l.target === d.id) ? 0.95 : 0.05);
            setTooltip(buildTooltip(e, d));
        }
        function handleOut() {
            d3.select(this).select(".shape").selectAll("rect").attr("filter", null);
            // Restore to whatever the current click-driven selection dictates
            // (re-running the same declarative render, not a hardcoded reset).
            renderIntraEdges(g.select("g.intra-edges"), intra, nodePositions, labelMode, focus, onEdgeClick);
            renderInterGroupEdges(g.select("g.inter-edges"), interPaths, labelMode, focus, onEdgeClick);
            if (!selectedNodeId) setTooltip(null); // keep the persistent panel if a file is selected
        }
        function handleClick(e, d) {
            e.stopPropagation();
            if (d.isGroup) { toggleGroup(d.group); return; }
            setSelectedEdge(null);
            const isDeselecting = selectedNodeId === d.id;
            setSelectedNodeId(isDeselecting ? null : d.id);
            setTooltip(isDeselecting ? null : buildTooltip(e, d));
        }
        function handleDoubleClick(e, d) {
            e.stopPropagation();
            if (d.isGroup) return;
            if (pinnedPositionsRef.current.has(d.id)) {
                pinnedPositionsRef.current.delete(d.id);
            } else {
                const pos = nodePositions.get(d.id);
                if (pos) pinnedPositionsRef.current.set(d.id, { ...pos });
            }
            // Pin state is read declaratively by renderNodes (see its
            // docstring for why) — bump a counter to trigger that reread.
            setPinVersion(v => v + 1);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [layoutTick, labelMode, toggleGroup, selectedEdge, selectedNodeId, pinVersion]);

    // ── Search: auto-expand collapsed groups, fly to match, fade rest ────
    useEffect(() => {
        if (!svgRef.current || !layoutDataRef.current) return;
        const svg = d3.select(svgRef.current);
        const term = search.toLowerCase().trim();

        if (!term) {
            svg.selectAll("g.node-group .shape rect").attr("opacity", 1);
            return;
        }

        const { nodeById, nodePositions } = layoutDataRef.current;
        const match = Array.from(nodeById.values()).find(n =>
            !n.isGroup && !n.is_external && n.filename?.toLowerCase().includes(term)
        );
        if (!match) return;

        if (collapsedGroupIds.has(match.group)) {
            setCollapsedGroupIds(prev => {
                const next = new Set(prev);
                next.delete(match.group);
                return next;
            });
            return; // layout will recompute; this effect re-runs once it settles
        }

        svg.selectAll("g.node-group").each(function (d) {
            const isMatch = !d.isGroup && d.id === match.id;
            d3.select(this).select(".shape").selectAll("rect")
                .attr("opacity", isMatch ? 1 : 0.15)
                .attr("filter", isMatch ? "url(#rm-glow)" : null);
        });

        const pos = nodePositions.get(match.id);
        if (pos && zoomRef.current) {
            const w = svgRef.current.clientWidth, h = svgRef.current.clientHeight;
            d3.select(svgRef.current).transition().duration(500)
                .call(zoomRef.current.transform,
                    d3.zoomIdentity.translate(w / 2 - pos.x, h / 2 - pos.y).scale(1.4));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search, layoutTick]);

    // ── Group focus (left nav panel): center camera, highlight that
    // group's boundary, dim unrelated groups — edges are left untouched
    // ("keep all file-to-file connections intact", don't hide the rest).
    useEffect(() => {
        if (!svgRef.current || !layoutDataRef.current) return;
        const svg = d3.select(svgRef.current);

        if (!focusedGroup) {
            svg.selectAll("g.group-box rect.group-box-rect").attr("opacity", 1).attr("stroke-width", 1.5);
            svg.selectAll("g.node-group .shape rect").attr("opacity", 1);
            return;
        }

        svg.selectAll("g.group-box").each(function (d) {
            const isFocused = d.groupId === focusedGroup;
            d3.select(this).select("rect.group-box-rect")
                .attr("opacity", isFocused ? 1 : 0.2)
                .attr("stroke-width", isFocused ? 3 : 1.5);
        });
        svg.selectAll("g.node-group").each(function (d) {
            const belongs = !d.isGroup && d.group === focusedGroup;
            d3.select(this).select(".shape rect").attr("opacity", belongs ? 1 : 0.25);
        });

        const box = layoutDataRef.current.groupBoxes.get(focusedGroup);
        if (box && zoomRef.current && svgRef.current) {
            const el = svgRef.current;
            const w = el.clientWidth || 900, h = el.clientHeight || 600, pad = 90;
            const sc = Math.min((w - pad * 2) / box.width, (h - pad * 2) / box.height, 2.2);
            const tx = w / 2 - (box.x + box.width / 2) * sc;
            const ty = h / 2 - (box.y + box.height / 2) * sc;
            d3.select(el).transition().duration(500)
                .call(zoomRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(sc));
        }
    }, [focusedGroup, layoutTick]);

    function zoomBy(factor) {
        if (!zoomRef.current || !svgRef.current) return;
        d3.select(svgRef.current).transition().duration(200).call(zoomRef.current.scaleBy, factor);
    }

    function downloadSVG() {
        if (!svgRef.current) return;
        const serializer = new XMLSerializer();
        let src = serializer.serializeToString(svgRef.current);
        src = src.replace("<svg", `<svg xmlns:xlink="http://www.w3.org/1999/xlink"`);
        const blob = new Blob([src], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `repo-map-${(repoUrl || "repo").split("/").pop()}.svg`; a.click();
        URL.revokeObjectURL(url);
    }

    function downloadPNG() {
        if (!svgRef.current) return;
        const svg = svgRef.current;
        const cloned = svg.cloneNode(true);
        const gEl = svg.querySelector("g.viewport");
        const bbox = gEl ? gEl.getBBox() : { x: 0, y: 0, width: 900, height: 600 };
        const pad = 40, w = bbox.width + pad * 2, h = bbox.height + pad * 2;
        cloned.setAttribute("width", w); cloned.setAttribute("height", h);
        cloned.setAttribute("viewBox", `${bbox.x - pad} ${bbox.y - pad} ${w} ${h}`);
        const svgStr = new XMLSerializer().serializeToString(cloned);
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = w * 2; canvas.height = h * 2;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#0B1220"; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.scale(2, 2); ctx.drawImage(img, 0, 0);
            const a = document.createElement("a");
            a.download = `repo-map-${(repoUrl || "repo").split("/").pop()}.png`;
            a.href = canvas.toDataURL("image/png"); a.click();
        };
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
    }

    async function copyAsDot() {
        if (!visibleGraph) return;
        const lines = [
            "digraph repository {", "  rankdir=LR;", '  node [shape=box, fontname="monospace"];',
            ...visibleGraph.edges.map(e => `  "${e.source}" -> "${e.target}"${e.label ? ` [label="${e.label}"]` : ""};`),
            "}",
        ];
        await navigator.clipboard.writeText(lines.join("\n"));
        setCopied("dot");
        setTimeout(() => setCopied(null), 2000);
    }

    async function copyAsMermaid() {
        try {
            const res = await fetch(`${API}/architecture/${repoId}`);
            const data = await res.json();
            if (data.mermaid) {
                await navigator.clipboard.writeText(data.mermaid);
                setCopied("mermaid");
                setTimeout(() => setCopied(null), 2000);
            }
        } catch { /* best-effort export, ignore */ }
    }

    const groups = rawGraph?.groups || [];
    const filterKey = (label, key) => (
        <label key={key} style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={filters[key]}
                onChange={e => setFilters(f => ({ ...f, [key]: e.target.checked }))}
                style={{ accentColor: "var(--accent-blue)", width: 12, height: 12 }} />
            {label}
        </label>
    );

    if (loading) {
        return (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", background: "var(--bg-secondary)", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                <div style={{ textAlign: "center" }}>
                    <div style={{ width: 24, height: 24, border: "2px solid var(--border-color)", borderTopColor: "var(--accent-blue)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
                    Building repository map…
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", background: "var(--bg-secondary)", color: "#EF4444", fontFamily: "var(--font-mono)", fontSize: 13, padding: 40, textAlign: "center" }}>
                {error}
            </div>
        );
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-secondary)" }}>
            {/* Filter bar */}
            <div style={{ display: "flex", alignItems: "center", padding: "4px 16px", borderBottom: "1px solid var(--border-color)", flexShrink: 0, flexWrap: "wrap", gap: 8, background: "var(--bg-tertiary)", minHeight: 36 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontWeight: 600, fontSize: 12, color: "var(--text-primary)" }}>Repository Map</span>
                    {stats && (
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)" }}>
                            {stats.nodes} files · {stats.edges} edges
                        </span>
                    )}
                </div>

                <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search files…"
                    style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: 4, padding: "3px 10px", color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 10, outline: "none", width: 160, marginLeft: 12 }} />

                <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
                    {filterKey("structural", "structural")}
                    {filterKey("semantic", "semantic")}
                    {filterKey("external", "external")}
                    {filterKey("tests", "tests")}
                    {filterKey("generated", "generated")}

                    <div style={{ width: 1, height: 16, background: "var(--border-color)", margin: "0 4px" }} />

                    <select value={labelMode} onChange={e => setLabelMode(e.target.value)}
                        style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: 4, color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 8, padding: "2px 4px" }}>
                        <option value="none">labels: none</option>
                        <option value="important">labels: important</option>
                        <option value="all">labels: all</option>
                    </select>

                    <div style={{ width: 1, height: 16, background: "var(--border-color)", margin: "0 4px" }} />

                    {[["↓ SVG", downloadSVG], ["↓ PNG", downloadPNG]].map(([lbl, fn]) => (
                        <button key={lbl} onClick={fn} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "var(--radius)", padding: "2px 8px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 8, cursor: "pointer" }}>
                            {lbl}
                        </button>
                    ))}
                    <button onClick={copyAsDot} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "var(--radius)", padding: "2px 8px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 8, cursor: "pointer" }}>
                        {copied === "dot" ? "✓" : "DOT"}
                    </button>
                    <button onClick={copyAsMermaid} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "var(--radius)", padding: "2px 8px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 8, cursor: "pointer" }}>
                        {copied === "mermaid" ? "✓" : "Mermaid"}
                    </button>
                </div>
            </div>

            {/* Canvas */}
            <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden", background: "#0B1220" }}>
                <svg ref={svgRef} style={{ width: "100%", height: "100%", display: "block", background: "#0B1220" }} />

                {/* Floating left navigation panel — fixed to the viewport
                    (a plain HTML overlay, not part of the zoomed/panned SVG
                    group), listing architecture groups. */}
                {groups.length > 0 && (
                    <div style={{ position: "absolute", top: 12, left: 12, width: 190, maxHeight: "calc(100% - 24px)", display: "flex", flexDirection: "column", gap: 8, zIndex: 5 }}>
                        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: "var(--radius)", boxShadow: "var(--shadow-lg)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                            <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-color)", fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                Architecture Groups
                            </div>
                            <div style={{ overflowY: "auto", maxHeight: 360 }}>
                                {groups.map(g => {
                                    const collapsed = collapsedGroupIds.has(g.label);
                                    const active = focusedGroup === g.label;
                                    const color = colorForGroup(g.label, groupOrder);
                                    return (
                                        <div key={g.id}
                                            onClick={() => setFocusedGroup(prev => prev === g.label ? null : g.label)}
                                            style={{
                                                display: "flex", alignItems: "center", gap: 6, padding: "6px 10px",
                                                cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 10,
                                                background: active ? color + "22" : "transparent",
                                                borderLeft: `3px solid ${active ? color : "transparent"}`,
                                            }}>
                                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                                            <span style={{ flex: 1, color: active ? color : "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                {g.label}
                                            </span>
                                            <span style={{ color: "var(--text-muted)", fontSize: 8 }}>{g.file_count}</span>
                                            <span
                                                onClick={(e) => { e.stopPropagation(); toggleGroup(g.label); }}
                                                title={collapsed ? "Expand" : "Collapse"}
                                                style={{ color: "var(--text-muted)", padding: "0 2px" }}>
                                                {collapsed ? "▶" : "▼"}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Instructions card */}
                        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: "var(--radius)", boxShadow: "var(--shadow-lg)", padding: "8px 10px", fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)", lineHeight: 1.7 }}>
                            <div style={{ fontWeight: 700, color: "var(--text-secondary)", marginBottom: 4 }}>Repository Map</div>
                            <div>• Click a file to inspect its dependencies.</div>
                            <div>• Click a connection to reveal its relationship.</div>
                            <div>• Drag files to reposition them.</div>
                            <div>• Click a group above to focus it.</div>
                            <div>• Use the search bar to locate files.</div>
                            <div>• Scroll to zoom, drag background to pan.</div>
                        </div>
                    </div>
                )}

                {selectedEdge && (
                    <div style={{ position: "absolute", bottom: 12, left: 12, background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: "var(--radius)", padding: "10px 14px", fontFamily: "var(--font-mono)", fontSize: 10, zIndex: 10, minWidth: 220, boxShadow: "var(--shadow-lg)" }}>
                        <div style={{ color: "#ffe08a", fontWeight: 700, marginBottom: 6, fontSize: 11 }}>
                            {selectedEdge.label || (selectedEdge.kind === "semantic" ? selectedEdge.kind : "imports")}
                        </div>
                        <div style={{ marginBottom: 3 }}><span style={{ color: "var(--text-muted)" }}>source: </span>{selectedEdge.sourceLabel}</div>
                        <div style={{ marginBottom: 3 }}><span style={{ color: "var(--text-muted)" }}>destination: </span>{selectedEdge.targetLabel}</div>
                        <div><span style={{ color: "var(--text-muted)" }}>relationship: </span>{selectedEdge.kind}</div>
                    </div>
                )}

                <div style={{ position: "absolute", bottom: 12, right: 12, display: "flex", flexDirection: "column", gap: 3 }}>
                    {[["+", () => zoomBy(1.3)], ["⊙", () => autoFitRef.current && autoFitRef.current()], ["−", () => zoomBy(0.77)]].map(([label, fn]) => (
                        <button key={label} onClick={fn} style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: "var(--radius)", width: 24, height: 24, display: "grid", placeItems: "center", color: "var(--text-muted)", fontSize: label === "⊙" ? 10 : 14, cursor: "pointer", fontFamily: "monospace" }}>
                            {label}
                        </button>
                    ))}
                </div>

                {tooltip && (
                    <div style={{ position: "absolute", left: Math.min(tooltip.x + 14, window.innerWidth - 260), top: Math.min(tooltip.y + 14, window.innerHeight - 260), background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: "var(--radius)", padding: "10px 14px", fontFamily: "var(--font-mono)", fontSize: 10, pointerEvents: "none", zIndex: 10, minWidth: 200, maxWidth: 280, boxShadow: "var(--shadow-lg)" }}>
                        <div style={{ color: "var(--accent-green)", fontWeight: 700, marginBottom: 6, fontSize: 11 }}>
                            {tooltip.isGroup ? `${tooltip.id.replace("group:", "")} (${tooltip.depCount} files)` : tooltip.filePath || tooltip.id}
                        </div>
                        {!tooltip.isGroup && (
                            <>
                                <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                                    <span style={{ color: "var(--text-muted)", fontSize: 9 }}>group</span>
                                    <span style={{ color: "var(--text-secondary)" }}>{tooltip.group}</span>
                                </div>
                                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                                    <span style={{ color: "var(--text-muted)", fontSize: 9 }}>connections</span>
                                    <span style={{ color: "var(--accent-blue)", fontWeight: 600 }}>{tooltip.depCount}</span>
                                </div>
                                {tooltip.docstring && (
                                    <div style={{ marginBottom: 6, fontSize: 9, color: "var(--text-secondary)", lineHeight: 1.5, fontFamily: "var(--font-sans)" }}>{tooltip.docstring}</div>
                                )}
                                {tooltip.functions.length > 0 && (
                                    <div style={{ marginBottom: 3 }}><span style={{ color: "var(--text-muted)", fontSize: 9 }}>functions: </span>{tooltip.functions.slice(0, 5).join(", ")}</div>
                                )}
                                {tooltip.classes.length > 0 && (
                                    <div style={{ marginBottom: 3 }}><span style={{ color: "var(--text-muted)", fontSize: 9 }}>classes: </span>{tooltip.classes.slice(0, 5).join(", ")}</div>
                                )}
                                {tooltip.deps.length > 0 && (
                                    <div style={{ marginBottom: 3 }}>
                                        <span style={{ color: "var(--text-muted)", fontSize: 9 }}>depends on: </span>
                                        <span style={{ color: "var(--text-secondary)" }}>{tooltip.deps.slice(0, 6).join(", ")}{tooltip.deps.length > 6 ? ` +${tooltip.deps.length - 6}` : ""}</span>
                                    </div>
                                )}
                                {tooltip.usedBy.length > 0 && (
                                    <div style={{ marginBottom: 3 }}>
                                        <span style={{ color: "var(--text-muted)", fontSize: 9 }}>used by: </span>
                                        <span style={{ color: "var(--accent-blue)" }}>{tooltip.usedBy.slice(0, 6).join(", ")}{tooltip.usedBy.length > 6 ? ` +${tooltip.usedBy.length - 6}` : ""}</span>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
