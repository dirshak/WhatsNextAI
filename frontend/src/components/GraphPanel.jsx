// src/components/GraphPanel.jsx - Simplified workspace version
import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";

const API = process.env.REACT_APP_API_URL || "http://localhost:8000/api";

const STDLIB = new Set([
    "os", "sys", "re", "json", "time", "csv", "math", "io", "abc", "copy",
    "datetime", "collections", "itertools", "functools", "pathlib", "typing",
    "uuid", "tempfile", "ast", "hashlib", "base64", "threading", "subprocess",
    "logging", "unittest", "enum", "dataclasses", "contextlib", "socket",
    "http", "urllib", "xml", "html",
    "fs", "path", "url", "util", "events", "stream", "buffer", "crypto",
    "child_process", "net", "dns", "process", "console",
]);

function getNodeColors(theme) {
    const dark = theme !== "light";
    return {
        local: { fill: dark ? "#1E293B" : "#FFFFFF", stroke: dark ? "#10B981" : "#059669", label: dark ? "#10B981" : "#059669" },
        stdlib: { fill: dark ? "#1E293B" : "#FFFFFF", stroke: dark ? "#60A5FA" : "#2563EB", label: dark ? "#60A5FA" : "#2563EB" },
        external: { fill: dark ? "#1E293B" : "#F8FAFC", stroke: dark ? "#64748B" : "#94A3B8", label: dark ? "#64748B" : "#64748B" },
    };
}

function filterGraphData(data, localOnly, minDegree) {
    if (!data) return null;
    const degree = {};
    data.nodes.forEach(n => { degree[n.id] = 0; });
    data.edges.forEach(e => {
        degree[e.source] = (degree[e.source] || 0) + 1;
        degree[e.target] = (degree[e.target] || 0) + 1;
    });
    const isLocal = id =>
        id.endsWith(".py") || id.endsWith(".js") || id.endsWith(".ts") ||
        id.endsWith(".tsx") || id.endsWith(".jsx");
    const filteredNodes = data.nodes.filter(n => {
        if (minDegree > 1 && (degree[n.id] || 0) < minDegree) return false;
        if (localOnly && !isLocal(n.id)) return false;
        return true;
    });
    const nodeSet = new Set(filteredNodes.map(n => n.id));
    const filteredEdges = data.edges.filter(e => nodeSet.has(e.source) && nodeSet.has(e.target));
    return { nodes: filteredNodes, edges: filteredEdges };
}

export default function GraphPanel({ repoId, repoUrl, theme, proposalResult }) {
    const svgRef = useRef(null);
    const containerRef = useRef(null);
    const zoomRef = useRef(null);
    const simulationRef = useRef(null);
    const graphDataRef = useRef(null);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [stats, setStats] = useState(null);
    const [tooltip, setTooltip] = useState(null);
    const [copied, setCopied] = useState(false);
    const [localOnly, setLocalOnly] = useState(false);
    const [minDegree, setMinDegree] = useState(1);

    const addedNodeIds = proposalResult ? new Set((proposalResult.react_flow?.nodes || []).filter(n => n.data?.status === "added").map(n => n.id)) : new Set();
    const modifiedNodeIds = proposalResult ? new Set((proposalResult.react_flow?.nodes || []).filter(n => n.data?.status === "modified").map(n => n.id)) : new Set();

    function renderGraph(data) {
        if (!data || !svgRef.current || !containerRef.current) return;

        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();
        svg.attr("width", width).attr("height", height);

        const nodeColors = getNodeColors(theme);
        const isLocal = id =>
            id.endsWith(".py") || id.endsWith(".js") || id.endsWith(".ts") ||
            id.endsWith(".tsx") || id.endsWith(".jsx");
        const getNodeType = id => {
            if (isLocal(id)) return "local";
            if (STDLIB.has(id.replace(/\.[^.]+$/, ""))) return "stdlib";
            return "external";
        };

        const degree = {};
        data.nodes.forEach(n => { degree[n.id] = 0; });
        data.edges.forEach(e => {
            degree[e.source] = (degree[e.source] || 0) + 1;
            degree[e.target] = (degree[e.target] || 0) + 1;
        });
        const maxDegree = Math.max(...Object.values(degree), 1);
        const nodeRadius = id => 14 + (degree[id] / maxDegree) * 14;

        const g = svg.append("g");

        const zoom = d3.zoom()
            .scaleExtent([0.2, 4])
            .on("zoom", e => g.attr("transform", e.transform));
        zoomRef.current = zoom;
        svg.call(zoom);

        const defs = svg.append("defs");
        ["local", "stdlib", "external"].forEach(type => {
            defs.append("marker")
                .attr("id", `arrow-${type}`)
                .attr("viewBox", "0 -5 10 10")
                .attr("refX", 28).attr("refY", 0)
                .attr("markerWidth", 5).attr("markerHeight", 5)
                .attr("orient", "auto")
                .append("path").attr("d", "M0,-5L10,0L0,5")
                .attr("fill", nodeColors[type].stroke).attr("opacity", 0.5);
        });
        const glowFilter = defs.append("filter").attr("id", "graph-glow");
        glowFilter.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "coloredBlur");
        const feMerge = glowFilter.append("feMerge");
        feMerge.append("feMergeNode").attr("in", "coloredBlur");
        feMerge.append("feMergeNode").attr("in", "SourceGraphic");

        const nodes = data.nodes.map(d => ({ ...d }));
        const edges = data.edges.map(d => ({ ...d }));

        const simulation = d3.forceSimulation(nodes)
            .force("link", d3.forceLink(edges).id(d => d.id).distance(d =>
                getNodeType(d.source.id || d.source) === "local" ? 150 : 200
            ))
            .force("charge", d3.forceManyBody().strength(-600))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("x", d3.forceX(width / 2).strength(0.06))
            .force("y", d3.forceY(height / 2).strength(0.06))
            .force("collision", d3.forceCollide(d => nodeRadius(d.id) + 10));
        simulationRef.current = simulation;

        const link = g.append("g").selectAll("line")
            .data(edges).enter().append("line")
            .attr("stroke", d => nodeColors[getNodeType(d.target.id || d.target)].stroke)
            .attr("stroke-width", 1)
            .attr("stroke-opacity", 0.3)
            .attr("marker-end", d => `url(#arrow-${getNodeType(d.target.id || d.target)})`);

        const node = g.append("g").selectAll("g")
            .data(nodes).enter().append("g")
            .style("cursor", "pointer")
            .call(d3.drag()
                .on("start", (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
                .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
                .on("end", (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
            );

        node.filter(d => getNodeType(d.id) === "local")
            .append("circle")
            .attr("r", d => nodeRadius(d.id) + 4)
            .attr("fill", "none")
            .attr("stroke", nodeColors.local.stroke)
            .attr("stroke-width", 0.5).attr("stroke-opacity", 0.2)
            .attr("filter", "url(#graph-glow)");

        node.append("circle")
            .attr("r", d => nodeRadius(d.id))
            .attr("fill", d => {
                if (addedNodeIds.has(d.id)) return theme === "light" ? "#D1FAE5" : "#064E3B";
                if (modifiedNodeIds.has(d.id)) return theme === "light" ? "#FEF3C7" : "#78350F";
                return nodeColors[getNodeType(d.id)].fill;
            })
            .attr("stroke", d => {
                if (addedNodeIds.has(d.id)) return "#10B981";
                if (modifiedNodeIds.has(d.id)) return "#F59E0B";
                return nodeColors[getNodeType(d.id)].stroke;
            })
            .attr("stroke-width", 1.5)
            .attr("class", d => addedNodeIds.has(d.id) ? "node-added" : "")
            .on("mouseover", function (e, d) {
                d3.select(this).attr("stroke-width", 2.5).attr("filter", "url(#graph-glow)");
                link
                    .attr("stroke-opacity", l => (l.source.id === d.id || l.target.id === d.id) ? 0.9 : 0.05)
                    .attr("stroke-width", l => (l.source.id === d.id || l.target.id === d.id) ? 2 : 1);
                const deps = edges.filter(l => l.source.id === d.id).map(l => l.target.id);
                const used_by = edges.filter(l => l.target.id === d.id).map(l => l.source.id);
                setTooltip({ x: e.offsetX, y: e.offsetY, id: d.id, deps, used_by });
            })
            .on("mouseout", function () {
                d3.select(this).attr("stroke-width", 1.5).attr("filter", null);
                link.attr("stroke-opacity", 0.3).attr("stroke-width", 1);
                setTooltip(null);
            });

        node.append("text")
            .text(d => d.id.replace(/\.[^.]+$/, ""))
            .attr("text-anchor", "middle")
            .attr("dy", d => nodeRadius(d.id) + 14)
            .attr("fill", d => nodeColors[getNodeType(d.id)].label)
            .attr("font-size", d => getNodeType(d.id) === "local" ? 11 : 10)
            .attr("font-family", "JetBrains Mono, monospace")
            .attr("font-weight", d => getNodeType(d.id) === "local" ? "500" : "400")
            .attr("pointer-events", "none");

        simulation.on("tick", () => {
            link
                .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
            node.attr("transform", d => `translate(${d.x},${d.y})`);
        });

        simulation.on("end", () => autoFit());
    }

    function autoFit() {
        if (!zoomRef.current || !svgRef.current) return;
        const svgEl = svgRef.current;
        const g = svgEl.querySelector("g");
        if (!g) return;
        const bounds = g.getBBox();
        if (!bounds.width || !bounds.height) return;
        const w = parseInt(svgEl.getAttribute("width")) || svgEl.clientWidth || 800;
        const h = parseInt(svgEl.getAttribute("height")) || svgEl.clientHeight || 600;
        const pad = 80;
        const sc = Math.min((w - pad * 2) / bounds.width, (h - pad * 2) / bounds.height, 0.9);
        const tx = (w - bounds.width * sc) / 2 - bounds.x * sc;
        const ty = (h - bounds.height * sc) / 2 - bounds.y * sc;
        d3.select(svgEl).transition().duration(400)
            .call(zoomRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(sc));
    }

    function zoomBy(factor) {
        if (!zoomRef.current || !svgRef.current) return;
        d3.select(svgRef.current).transition().duration(200)
            .call(zoomRef.current.scaleBy, factor);
    }

    useEffect(() => {
        async function fetchData() {
            try {
                const res = await fetch(`${API}/graph/${repoId}`);
                const data = await res.json();
                graphDataRef.current = data;
                setLoading(false);
            } catch {
                setError("Failed to load graph. Try re-ingesting the repo.");
                setLoading(false);
            }
        }
        fetchData();
        return () => { if (simulationRef.current) simulationRef.current.stop(); };
    }, [repoId]);

    useEffect(() => {
        if (loading || !graphDataRef.current) return;
        const filtered = filterGraphData(graphDataRef.current, localOnly, minDegree);
        if (filtered) setStats({ nodes: filtered.nodes.length, edges: filtered.edges.length });
        renderGraph(filtered);
    }, [loading, localOnly, minDegree, theme]);

    function downloadSVG() {
        const svg = svgRef.current;
        const serializer = new XMLSerializer();
        let source = serializer.serializeToString(svg);
        source = source.replace("<svg", `<svg xmlns:xlink="http://www.w3.org/1999/xlink"`);
        const style = `<style>@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap'); text { font-family: 'JetBrains Mono', monospace; }</style>`;
        source = source.replace("</svg>", `${style}</svg>`);
        const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `dependency-graph-${repoUrl.split("/").pop()}.svg`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function downloadPNG() {
        const svg = svgRef.current;
        const cloned = svg.cloneNode(true);
        const g = svg.querySelector("g");
        const bbox = g ? g.getBBox() : { x: 0, y: 0, width: 800, height: 600 };
        const pad = 40;
        const w = bbox.width + pad * 2;
        const h = bbox.height + pad * 2;
        cloned.setAttribute("width", w);
        cloned.setAttribute("height", h);
        cloned.setAttribute("viewBox", `${bbox.x - pad} ${bbox.y - pad} ${w} ${h}`);
        const clonedG = cloned.querySelector("g");
        if (clonedG) clonedG.removeAttribute("transform");
        cloned.querySelectorAll("style").forEach(s => {
            s.textContent = s.textContent.replace(/@import[^;]+;/g, "");
        });
        const svgStr = new XMLSerializer().serializeToString(cloned);
        const encoded = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = w * 2;
            canvas.height = h * 2;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = theme === "light" ? "#F8FAFC" : "#0F172A";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.scale(2, 2);
            ctx.drawImage(img, 0, 0);
            const a = document.createElement("a");
            a.download = `dependency-graph-${repoUrl.split("/").pop()}.png`;
            a.href = canvas.toDataURL("image/png");
            a.click();
        };
        img.src = encoded;
    }

    async function copyAsDot() {
        if (!graphDataRef.current) return;
        const { edges } = graphDataRef.current;
        const lines = [
            "digraph dependencies {",
            "  rankdir=LR;",
            '  node [shape=box, fontname="monospace"];',
            ...edges.map(e => `  "${e.source}" -> "${e.target}";`),
            "}",
        ];
        await navigator.clipboard.writeText(lines.join("\n"));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    if (loading) {
        return (
            <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                background: "var(--bg-secondary)",
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                fontSize: 13,
            }}>
                <div style={{ textAlign: "center" }}>
                    <div style={{
                        width: 24,
                        height: 24,
                        border: "2px solid var(--border-color)",
                        borderTopColor: "var(--accent-blue)",
                        borderRadius: "50%",
                        animation: "spin 0.8s linear infinite",
                        margin: "0 auto 12px"
                    }} />
                    Building graph…
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                background: "var(--bg-secondary)",
                color: "#EF4444",
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                padding: 40,
                textAlign: "center",
            }}>
                {error}
            </div>
        );
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-secondary)" }}>
            {/* Filter bar */}
            <div style={{
                display: "flex",
                alignItems: "center",
                padding: "4px 16px",
                borderBottom: "1px solid var(--border-color)",
                flexShrink: 0,
                flexWrap: "wrap",
                gap: 8,
                background: "var(--bg-tertiary)",
                minHeight: 36,
            }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontWeight: 600, fontSize: 12, color: "var(--text-primary)" }}>Dependency Graph</span>
                    {stats && (
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)" }}>
                            {stats.nodes} files · {stats.edges} connections
                        </span>
                    )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
                    <button
                        style={{
                            background: "transparent",
                            border: "1px solid var(--border-color)",
                            borderRadius: "var(--radius)",
                            padding: "2px 8px",
                            color: "var(--text-muted)",
                            fontFamily: "var(--font-mono)",
                            fontSize: 8,
                            cursor: "pointer",
                        }}
                        onClick={downloadSVG}
                    >
                        ↓ SVG
                    </button>
                    <button
                        style={{
                            background: "transparent",
                            border: "1px solid var(--border-color)",
                            borderRadius: "var(--radius)",
                            padding: "2px 8px",
                            color: "var(--text-muted)",
                            fontFamily: "var(--font-mono)",
                            fontSize: 8,
                            cursor: "pointer",
                        }}
                        onClick={downloadPNG}
                    >
                        ↓ PNG
                    </button>
                    <button
                        style={{
                            background: "transparent",
                            border: "1px solid var(--border-color)",
                            borderRadius: "var(--radius)",
                            padding: "2px 8px",
                            color: "var(--text-muted)",
                            fontFamily: "var(--font-mono)",
                            fontSize: 8,
                            cursor: "pointer",
                        }}
                        onClick={copyAsDot}
                    >
                        {copied ? "✓" : "DOT"}
                    </button>

                    <div style={{ width: 1, height: 16, background: "var(--border-color)", margin: "0 4px" }} />

                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-muted)", cursor: "pointer" }}>
                        <input
                            type="checkbox"
                            checked={localOnly}
                            onChange={e => setLocalOnly(e.target.checked)}
                            style={{ accentColor: "var(--accent-blue)", width: 12, height: 12 }}
                        />
                        local
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-muted)" }}>
                        min
                        <input
                            type="range"
                            min={1} max={10} step={1}
                            value={minDegree}
                            onChange={e => setMinDegree(Number(e.target.value))}
                            style={{ width: 40, accentColor: "var(--accent-blue)" }}
                        />
                        <span style={{ color: "var(--accent-blue)", minWidth: 10, fontWeight: 600, fontSize: 9 }}>{minDegree}</span>
                    </label>
                </div>
            </div>

            {/* Graph Area */}
            <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
                <svg ref={svgRef} style={{ width: "100%", height: "100%", display: "block" }} />

                {/* Zoom controls */}
                <div style={{
                    position: "absolute",
                    bottom: 12,
                    right: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                }}>
                    {[
                        ["+", () => zoomBy(1.3)],
                        ["⊙", autoFit],
                        ["−", () => zoomBy(0.77)],
                    ].map(([label, fn]) => (
                        <button key={label} onClick={fn} style={{
                            background: "var(--bg-card)",
                            border: "1px solid var(--border-color)",
                            borderRadius: "var(--radius)",
                            width: 24, height: 24,
                            display: "grid", placeItems: "center",
                            color: "var(--text-muted)",
                            fontSize: label === "⊙" ? 10 : 14,
                            cursor: "pointer",
                            fontFamily: "monospace",
                            transition: "var(--transition)",
                        }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent-blue)"; e.currentTarget.style.color = "var(--accent-blue)"; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border-color)"; e.currentTarget.style.color = "var(--text-muted)"; }}>
                            {label}
                        </button>
                    ))}
                </div>

                {/* Tooltip */}
                {tooltip && (
                    <div style={{
                        position: "absolute",
                        left: Math.min(tooltip.x + 12, window.innerWidth - 220),
                        top: Math.min(tooltip.y + 12, window.innerHeight - 200),
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius)",
                        padding: "8px 12px",
                        fontFamily: "var(--font-mono)",
                        fontSize: 9,
                        pointerEvents: "none",
                        zIndex: 10,
                        minWidth: 140,
                        boxShadow: "var(--shadow)",
                    }}>
                        <div style={{ color: "var(--accent-green)", fontWeight: 600, marginBottom: 3, fontSize: 10 }}>
                            {tooltip.id}
                        </div>
                        {tooltip.deps.length > 0 && (
                            <div style={{ marginBottom: 2 }}>
                                <span style={{ color: "var(--text-muted)" }}>imports: </span>
                                <span style={{ color: "var(--text-primary)" }}>{tooltip.deps.slice(0, 5).join(", ")}{tooltip.deps.length > 5 ? ` +${tooltip.deps.length - 5}` : ""}</span>
                            </div>
                        )}
                        {tooltip.used_by.length > 0 && (
                            <div>
                                <span style={{ color: "var(--text-muted)" }}>used by: </span>
                                <span style={{ color: "var(--accent-blue)" }}>{tooltip.used_by.slice(0, 5).join(", ")}{tooltip.used_by.length > 5 ? ` +${tooltip.used_by.length - 5}` : ""}</span>
                            </div>
                        )}
                        {tooltip.deps.length === 0 && tooltip.used_by.length === 0 && (
                            <div style={{ color: "var(--text-muted)" }}>no connections</div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}