// src/components/GraphPanel.jsx — stable D3 graph with inlined draw effect
import { useEffect, useRef, useState, useMemo } from "react";
import * as d3 from "d3";
import { API } from '../config';

const STDLIB = new Set([
    "os", "sys", "re", "json", "time", "csv", "math", "io", "abc", "copy",
    "datetime", "collections", "itertools", "functools", "pathlib", "typing",
    "uuid", "tempfile", "ast", "hashlib", "base64", "threading", "subprocess",
    "logging", "unittest", "enum", "dataclasses", "contextlib", "socket",
    "http", "urllib", "xml", "html",
    "fs", "path", "url", "util", "events", "stream", "buffer", "crypto",
    "child_process", "net", "dns", "process", "console",
]);

const NODE_COLORS = {
    local:    { fill: "#ffffff", stroke: "#A855F7", label: "#ffffff" },
    stdlib:   { fill: "#ffffff", stroke: "#60A5FA", label: "#ffffff" },
    external: { fill: "#ffffff", stroke: "#A78BFA", label: "#ffffff" },
};

function getNodeType(id) {
    const ext = [".py", ".js", ".ts", ".tsx", ".jsx"];
    if (ext.some(e => id.endsWith(e))) return "local";
    if (STDLIB.has(id.replace(/\.[^.]+$/, ""))) return "stdlib";
    return "external";
}

function isFileId(id)     { return id.startsWith("file::"); }
function isFunctionId(id) { return id.startsWith("fn::"); }

function filterGraphData(data, localOnly, minDegree) {
    if (!data) return null;
    const degree = {};
    data.nodes.forEach(n => { degree[n.id] = 0; });
    data.edges.forEach(e => {
        degree[e.source] = (degree[e.source] || 0) + 1;
        degree[e.target] = (degree[e.target] || 0) + 1;
    });
    const isLocal = id =>
        [".py", ".js", ".ts", ".tsx", ".jsx"].some(ext => id.endsWith(ext));
    const filteredNodes = data.nodes.filter(n => {
        if (minDegree > 0 && (degree[n.id] || 0) < minDegree) return false;
        if (localOnly && !isLocal(n.id)) return false;
        return true;
    });
    const nodeSet = new Set(filteredNodes.map(n => n.id));
    const filteredEdges = data.edges.filter(e => nodeSet.has(e.source) && nodeSet.has(e.target));
    return { nodes: filteredNodes, edges: filteredEdges };
}

export default function GraphPanel({ repoId, repoUrl }) {
    const svgRef       = useRef(null);
    const containerRef = useRef(null);
    const zoomRef      = useRef(null);
    const autoFitRef   = useRef(null);

    const [graphData, setGraphData] = useState(null);
    const [loading,   setLoading]   = useState(true);
    const [error,     setError]     = useState(null);
    const [stats,     setStats]     = useState(null);
    const [tooltip,   setTooltip]   = useState(null);
    const [copied,    setCopied]    = useState(false);
    const [localOnly, setLocalOnly] = useState(false);
    const [minDegree, setMinDegree] = useState(0);
    const [selectedNodeId, setSelectedNodeId] = useState(null);
    const [detailLevel,    setDetailLevel]    = useState(2); // Fixed at Services level

    // No diff colouring — base graph is always the original repo state

    // Fetch graph data once per repoId
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setGraphData(null);

        fetch(`${API}/graph/${repoId}`)
            .then(r => r.json())
            .then(data => { if (!cancelled) { setGraphData(data); setLoading(false); } })
            .catch(() => { if (!cancelled) { setError("Failed to load graph. Try re-ingesting the repo."); setLoading(false); } });

        return () => { cancelled = true; };
    }, [repoId]);

    // Filtered view — recomputed only when source data / filters change
    const filteredData = useMemo(
        () => filterGraphData(graphData, localOnly, minDegree),
        [graphData, localOnly, minDegree]
    );

    // ── Main D3 draw effect ─────────────────────────────────────────────────
    useEffect(() => {
        if (!filteredData || !svgRef.current || !containerRef.current) return;

        const data   = filteredData;
        const width  = containerRef.current.clientWidth  || 800;
        const height = containerRef.current.clientHeight || 600;

        setStats({ nodes: data.nodes.length, edges: data.edges.length });

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();
        svg.attr("width", width).attr("height", height);

        // ── Degree map & radius ──────────────────────────────────────────────
        const degree = {};
        data.nodes.forEach(n => { degree[n.id] = 0; });
        data.edges.forEach(e => {
            degree[e.source] = (degree[e.source] || 0) + 1;
            degree[e.target] = (degree[e.target] || 0) + 1;
        });
        const maxDeg    = Math.max(...Object.values(degree), 1);
        const nodeRadius = id => 10 + (degree[id] / maxDeg) * 18;

        // ── Zoom ─────────────────────────────────────────────────────────────
        const g    = svg.append("g");
        const zoom = d3.zoom()
            .scaleExtent([0.15, 5])
            .on("zoom", e => g.attr("transform", e.transform));
        zoomRef.current = zoom;
        svg.call(zoom);

        // Click background to deselect
        svg.on("click", function (e) {
            if (e.target === svgRef.current) {
                setSelectedNodeId(null);
                linkSel.attr("stroke-opacity", 0.3).attr("stroke-width", 1);
                nodeSel.selectAll(".node-shape").attr("opacity", 1);
            }
        });

        // ── Defs (markers, glow) ─────────────────────────────────────────────
        const defs = svg.append("defs");
        ["local", "stdlib", "external"].forEach(type => {
            defs.append("marker")
                .attr("id", `gp-arrow-${type}`)
                .attr("viewBox", "0 -5 10 10")
                .attr("refX", 28).attr("refY", 0)
                .attr("markerWidth", 5).attr("markerHeight", 5)
                .attr("orient", "auto")
                .append("path").attr("d", "M0,-5L10,0L0,5")
                .attr("fill", NODE_COLORS[type].stroke)
                .attr("opacity", 0.5);
        });
        const glow = defs.append("filter").attr("id", "gp-glow");
        glow.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "coloredBlur");
        const feMerge = glow.append("feMerge");
        feMerge.append("feMergeNode").attr("in", "coloredBlur");
        feMerge.append("feMergeNode").attr("in", "SourceGraphic");

        // ── Static layout via synchronous simulation ticks ───────────────────
        const nodes = data.nodes.map(d => ({ ...d }));
        const edges = data.edges.map(d => ({ ...d }));

        d3.forceSimulation(nodes)
            .force("link", d3.forceLink(edges).id(d => d.id).distance(140))
            .force("charge", d3.forceManyBody().strength(-400))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collision", d3.forceCollide(d => nodeRadius(d.id) + 55))
            .tick(400)
            .stop();

        // Pin positions so nothing ever moves again
        nodes.forEach(d => { d.fx = d.x; d.fy = d.y; });

        // ── Fill / stroke from node type only (no proposal diff) ────────────
        const getFill   = d => NODE_COLORS[getNodeType(d.id)].fill;
        const getStroke = d => NODE_COLORS[getNodeType(d.id)].stroke;

        // ── Links ────────────────────────────────────────────────────────────
        const linkSel = g.append("g").selectAll("line")
            .data(edges).enter().append("line")
            .attr("class", "link-line")
            .attr("stroke", d => NODE_COLORS[getNodeType(d.target.id || d.target)].stroke)
            .attr("stroke-width", 1)
            .attr("stroke-opacity", 0.3)
            .attr("marker-end", d => `url(#gp-arrow-${getNodeType(d.target.id || d.target)})`);

        const linkLabelSel = g.append("g").selectAll("text")
            .data(edges).enter().append("text")
            .attr("class", "link-label")
            .text(d => d.relationship || "imports")
            .attr("font-size", "7px")
            .attr("font-family", "JetBrains Mono, monospace")
            .attr("fill", "rgba(255,255,255,0.5)")
            .attr("text-anchor", "middle")
            .attr("dy", -3)
            .style("pointer-events", "none");

        // ── Nodes ────────────────────────────────────────────────────────────
        const nodeSel = g.append("g").selectAll("g")
            .data(nodes).enter().append("g")
            .attr("class", "node-group")
            .style("cursor", "pointer")
            .call(
                d3.drag()
                    .on("drag", function(e, d) {
                        d.x = e.x; d.y = e.y; d.fx = e.x; d.fy = e.y;
                        d3.select(this)
                            .attr("transform", `translate(${d.x},${d.y})`);
                        linkSel
                            .filter(l => (l.source.id || l.source) === d.id || (l.target.id || l.target) === d.id)
                            .attr("x1", l => l.source.x ?? 0).attr("y1", l => l.source.y ?? 0)
                            .attr("x2", l => l.target.x ?? 0).attr("y2", l => l.target.y ?? 0);
                        linkLabelSel
                            .filter(l => (l.source.id || l.source) === d.id || (l.target.id || l.target) === d.id)
                            .attr("x", l => ((l.source.x ?? 0) + (l.target.x ?? 0)) / 2)
                            .attr("y", l => ((l.source.y ?? 0) + (l.target.y ?? 0)) / 2);
                    })
            );

        // File → rectangle
        nodeSel.filter(d => isFileId(d.id))
            .append("rect")
            .attr("class", "node-shape")
            .attr("width",  d => nodeRadius(d.id) * 2)
            .attr("height", d => nodeRadius(d.id) * 1.4)
            .attr("x", d => -nodeRadius(d.id))
            .attr("y", d => -nodeRadius(d.id) * 0.7)
            .attr("rx", 3).attr("ry", 3)
            .attr("fill", getFill).attr("stroke", getStroke).attr("stroke-width", 1.5)
            .on("mouseover", handleOver).on("mouseout", handleOut).on("click", handleClick);

        // Service/Class → triangle
        nodeSel.filter(d => !isFileId(d.id) && !isFunctionId(d.id))
            .append("polygon")
            .attr("class", "node-shape")
            .attr("points", d => { const r = nodeRadius(d.id) * 1.1; return `0,${-r} ${-r},${r} ${r},${r}`; })
            .attr("fill", getFill).attr("stroke", getStroke).attr("stroke-width", 1.5)
            .on("mouseover", handleOver).on("mouseout", handleOut).on("click", handleClick);

        // Function → circle
        nodeSel.filter(d => isFunctionId(d.id))
            .append("circle")
            .attr("class", "node-shape")
            .attr("r", d => nodeRadius(d.id))
            .attr("fill", getFill).attr("stroke", getStroke).attr("stroke-width", 1.5)
            .on("mouseover", handleOver).on("mouseout", handleOut).on("click", handleClick);

        // Labels — show only filename, truncated to avoid overlap
        nodeSel.append("text")
            .text(d => {
                const s = d.id.replace(/^(file|fn|cls)::/, "");
                const name = s.split(/[/\\]/).pop();
                return name.length > 20 ? name.slice(0, 18) + "…" : name;
            })
            .attr("text-anchor", "middle")
            .attr("dy",  d => nodeRadius(d.id) + 16)
            .attr("fill", d => NODE_COLORS[getNodeType(d.id)].label)
            .attr("font-size",   d => getNodeType(d.id) === "local" ? 11 : 10)
            .attr("font-family", "JetBrains Mono, monospace")
            .attr("font-weight", d => getNodeType(d.id) === "local" ? "500" : "400")
            .attr("pointer-events", "none");

        // ── Position all elements from static layout ──────────────────────────
        linkSel
            .attr("x1", d => d.source.x ?? 0).attr("y1", d => d.source.y ?? 0)
            .attr("x2", d => d.target.x ?? 0).attr("y2", d => d.target.y ?? 0);
        linkLabelSel
            .attr("x", d => ((d.source.x ?? 0) + (d.target.x ?? 0)) / 2)
            .attr("y", d => ((d.source.y ?? 0) + (d.target.y ?? 0)) / 2);
        nodeSel.attr("transform", d => `translate(${d.x ?? 0},${d.y ?? 0})`);

        // ── Auto-fit ──────────────────────────────────────────────────────────
        function autoFit() {
            if (!zoomRef.current || !svgRef.current) return;
            const el = svgRef.current;
            const g  = el.querySelector("g");
            if (!g) return;
            const b  = g.getBBox();
            if (!b.width || !b.height) return;
            const w  = parseInt(el.getAttribute("width"))  || el.clientWidth  || 800;
            const h  = parseInt(el.getAttribute("height")) || el.clientHeight || 600;
            const pad = 80;
            const sc  = Math.min((w - pad * 2) / b.width, (h - pad * 2) / b.height, 0.9);
            const tx  = (w - b.width * sc) / 2 - b.x * sc;
            const ty  = (h - b.height * sc) / 2 - b.y * sc;
            d3.select(el).transition().duration(400)
                .call(zoomRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(sc));
        }
        autoFitRef.current = autoFit;
        autoFit();

        // ── Interaction handlers ──────────────────────────────────────────────
        function handleOver(e, d) {
            d3.select(this).attr("stroke-width", 2.5).attr("filter", "url(#gp-glow)");
            linkSel
                .attr("stroke-opacity", l => {
                    const s = l.source.id || l.source, t = l.target.id || l.target;
                    return (s === d.id || t === d.id) ? 0.9 : 0.06;
                })
                .attr("stroke-width", l => {
                    const s = l.source.id || l.source, t = l.target.id || l.target;
                    return (s === d.id || t === d.id) ? 2 : 1;
                });
            const deps    = edges.filter(l => (l.source.id || l.source) === d.id).map(l => l.target.id || l.target);
            const used_by = edges.filter(l => (l.target.id || l.target) === d.id).map(l => l.source.id || l.source);
            setTooltip({ x: e.offsetX, y: e.offsetY, id: d.id, type: getNodeType(d.id), depCount: degree[d.id] || 0, deps, used_by, description: d.description || null });
        }

        function handleOut() {
            d3.select(this).attr("stroke-width", 1.5).attr("filter", null);
            linkSel.attr("stroke-opacity", 0.3).attr("stroke-width", 1);
            setTooltip(null);
        }

        function handleClick(e, d) {
            e.stopPropagation();
            const newSel = d.id;
            setSelectedNodeId(prev => {
                const sel = prev === newSel ? null : newSel;
                if (!sel) {
                    linkSel.attr("stroke-opacity", 0.3).attr("stroke-width", 1);
                    nodeSel.selectAll(".node-shape").attr("opacity", 1);
                } else {
                    const connected = new Set();
                    edges.forEach(l => {
                        const s = l.source.id || l.source, t = l.target.id || l.target;
                        if (s === sel || t === sel) { connected.add(s); connected.add(t); }
                    });
                    linkSel
                        .attr("stroke-opacity", l => {
                            const s = l.source.id || l.source, t = l.target.id || l.target;
                            return (s === sel || t === sel) ? 1 : 0.04;
                        })
                        .attr("stroke-width", l => {
                            const s = l.source.id || l.source, t = l.target.id || l.target;
                            return (s === sel || t === sel) ? 2.5 : 0.5;
                        });
                    nodeSel.selectAll(".node-shape")
                        .attr("opacity", nd => connected.has(nd.id) || nd.id === sel ? 1 : 0.2);
                }
                return sel;
            });
        }

    }, [filteredData]); // stable deps — filteredData changes only on fetch/filter change

    // ── Detail-level / selected node filter (separate light effect) ──────────
    useEffect(() => {
        if (!svgRef.current) return;
        const svg         = d3.select(svgRef.current);
        const nodeEls     = svg.selectAll("g.node-group");
        const linkEls     = svg.selectAll("line.link-line");
        const linkLblEls  = svg.selectAll("text.link-label");

        const isVisible = d => {
            if (isFileId(d.id)) return true;
            if (selectedNodeId && isFileId(selectedNodeId)) {
                const sel = selectedNodeId.replace("file::", "");
                if ((d.data?.filePath || d.file_path || "").includes(sel) || d.id.includes(sel)) return true;
            }
            if (detailLevel === 1) return false;
            if (detailLevel === 2) return !isFunctionId(d.id);
            return true;
        };

        nodeEls.transition().duration(350)
            .style("opacity", d => isVisible(d) ? 1 : 0)
            .style("pointer-events", d => isVisible(d) ? "auto" : "none");

        linkEls.transition().duration(350)
            .style("opacity", d => {
                const s = d.source?.id || d.source, t = d.target?.id || d.target;
                const sNode = nodeEls.filter(n => n.id === s).datum();
                const tNode = nodeEls.filter(n => n.id === t).datum();
                return (sNode && isVisible(sNode) && tNode && isVisible(tNode)) ? 0.3 : 0;
            });

        linkLblEls.transition().duration(350)
            .style("opacity", d => {
                const s = d.source?.id || d.source, t = d.target?.id || d.target;
                const sNode = nodeEls.filter(n => n.id === s).datum();
                const tNode = nodeEls.filter(n => n.id === t).datum();
                return (sNode && isVisible(sNode) && tNode && isVisible(tNode)) ? 0.6 : 0;
            });

    }, [detailLevel, selectedNodeId]);

    // ── Download / copy helpers ───────────────────────────────────────────────
    function zoomBy(factor) {
        if (!zoomRef.current || !svgRef.current) return;
        d3.select(svgRef.current).transition().duration(200).call(zoomRef.current.scaleBy, factor);
    }

    function downloadSVG() {
        if (!svgRef.current) return;
        const serializer = new XMLSerializer();
        let src = serializer.serializeToString(svgRef.current);
        src = src.replace("<svg", `<svg xmlns:xlink="http://www.w3.org/1999/xlink"`);
        src = src.replace("</svg>", `<style>@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap'); text { font-family: 'JetBrains Mono', monospace; }</style></svg>`);
        const blob = new Blob([src], { type: "image/svg+xml;charset=utf-8" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href = url; a.download = `dep-graph-${(repoUrl || "repo").split("/").pop()}.svg`; a.click();
        URL.revokeObjectURL(url);
    }

    function downloadPNG() {
        if (!svgRef.current) return;
        const svg    = svgRef.current;
        const cloned = svg.cloneNode(true);
        const gEl    = svg.querySelector("g");
        const bbox   = gEl ? gEl.getBBox() : { x: 0, y: 0, width: 800, height: 600 };
        const pad = 40, w = bbox.width + pad * 2, h = bbox.height + pad * 2;
        cloned.setAttribute("width", w); cloned.setAttribute("height", h);
        cloned.setAttribute("viewBox", `${bbox.x - pad} ${bbox.y - pad} ${w} ${h}`);
        const svgStr  = new XMLSerializer().serializeToString(cloned);
        const img     = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = w * 2; canvas.height = h * 2;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#0B1220"; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.scale(2, 2); ctx.drawImage(img, 0, 0);
            const a = document.createElement("a");
            a.download = `dep-graph-${(repoUrl || "repo").split("/").pop()}.png`;
            a.href = canvas.toDataURL("image/png"); a.click();
        };
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
    }

    async function copyAsDot() {
        if (!filteredData) return;
        const lines = [
            "digraph dependencies {",
            "  rankdir=LR;",
            '  node [shape=box, fontname="monospace"];',
            ...filteredData.edges.map(e => `  "${e.source}" -> "${e.target}";`),
            "}",
        ];
        await navigator.clipboard.writeText(lines.join("\n"));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    // ── Loading / error states ────────────────────────────────────────────────
    if (loading) {
        return (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", background: "var(--bg-secondary)", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                <div style={{ textAlign: "center" }}>
                    <div style={{ width: 24, height: 24, border: "2px solid var(--border-color)", borderTopColor: "var(--accent-blue)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
                    Building graph…
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

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-secondary)" }}>
            {/* Filter bar */}
            <div style={{ display: "flex", alignItems: "center", padding: "4px 16px", borderBottom: "1px solid var(--border-color)", flexShrink: 0, flexWrap: "wrap", gap: 8, background: "var(--bg-tertiary)", minHeight: 36 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontWeight: 600, fontSize: 12, color: "var(--text-primary)" }}>Dependency Graph</span>
                    {stats && (
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)" }}>
                            {stats.nodes} nodes · {stats.edges} edges
                        </span>
                    )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
                    {/* Download buttons */}
                    {[["↓ SVG", downloadSVG], ["↓ PNG", downloadPNG]].map(([lbl, fn]) => (
                        <button key={lbl} onClick={fn} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "var(--radius)", padding: "2px 8px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 8, cursor: "pointer" }}>
                            {lbl}
                        </button>
                    ))}
                    <button onClick={copyAsDot} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "var(--radius)", padding: "2px 8px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 8, cursor: "pointer" }}>
                        {copied ? "✓" : "DOT"}
                    </button>

                    <div style={{ width: 1, height: 16, background: "var(--border-color)", margin: "0 4px" }} />

                    {/* Local only */}
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-muted)", cursor: "pointer" }}>
                        <input type="checkbox" checked={localOnly} onChange={e => setLocalOnly(e.target.checked)}
                            style={{ accentColor: "var(--accent-blue)", width: 12, height: 12 }} />
                        local
                    </label>

                    {/* Min degree */}
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-muted)" }}>
                        min deps
                        <input
                            type="number"
                            min={0}
                            max={50}
                            step={1}
                            value={minDegree}
                            onChange={e => setMinDegree(Math.max(0, Number(e.target.value)))}
                            style={{
                                width: 40,
                                background: "var(--bg-tertiary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: 4,
                                color: "var(--accent-blue)",
                                fontFamily: "var(--font-mono)",
                                fontSize: 9,
                                fontWeight: 600,
                                textAlign: "center",
                                padding: "1px 4px",
                                outline: "none",
                            }}
                        />
                    </label>
                </div>
            </div>

            {/* Graph canvas — app blue background */}
            <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden", background: "#0B1220" }}>
                <svg ref={svgRef} style={{ width: "100%", height: "100%", display: "block", background: "#0B1220" }} />

                {/* Zoom controls */}
                <div style={{ position: "absolute", bottom: 12, right: 12, display: "flex", flexDirection: "column", gap: 3 }}>
                    {[
                        ["+", () => zoomBy(1.3)],
                        ["⊙", () => autoFitRef.current && autoFitRef.current()],
                        ["−", () => zoomBy(0.77)],
                    ].map(([label, fn]) => (
                        <button key={label} onClick={fn} style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: "var(--radius)", width: 24, height: 24, display: "grid", placeItems: "center", color: "var(--text-muted)", fontSize: label === "⊙" ? 10 : 14, cursor: "pointer", fontFamily: "monospace", transition: "var(--transition)" }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent-blue)"; e.currentTarget.style.color = "var(--accent-blue)"; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border-color)"; e.currentTarget.style.color = "var(--text-muted)"; }}>
                            {label}
                        </button>
                    ))}
                </div>

                {/* Tooltip */}
                {tooltip && (
                    <div style={{ position: "absolute", left: Math.min(tooltip.x + 14, window.innerWidth - 240), top: Math.min(tooltip.y + 14, window.innerHeight - 220), background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: "var(--radius)", padding: "10px 14px", fontFamily: "var(--font-mono)", fontSize: 10, pointerEvents: "none", zIndex: 10, minWidth: 180, boxShadow: "var(--shadow-lg)" }}>
                        <div style={{ color: "var(--accent-green)", fontWeight: 700, marginBottom: 6, fontSize: 11 }}>{tooltip.id}</div>
                        <div style={{ display: "flex", gap: 6, marginBottom: 4, alignItems: "center" }}>
                            <span style={{ color: "var(--text-muted)", fontSize: 9 }}>type</span>
                            <span style={{ background: tooltip.type === "local" ? "rgba(34,197,94,0.1)" : tooltip.type === "stdlib" ? "rgba(96,165,250,0.1)" : "rgba(75,85,99,0.15)", color: tooltip.type === "local" ? "#22C55E" : tooltip.type === "stdlib" ? "#60A5FA" : "#6B7280", padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 600 }}>{tooltip.type}</span>
                        </div>
                        <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                            <span style={{ color: "var(--text-muted)", fontSize: 9 }}>connections</span>
                            <span style={{ color: "var(--accent-blue)", fontWeight: 600 }}>{tooltip.depCount}</span>
                        </div>
                        {tooltip.description && (
                            <div style={{ marginBottom: 6, fontSize: 9, color: "var(--text-secondary)", lineHeight: 1.5, fontFamily: "var(--font-sans)" }}>{tooltip.description}</div>
                        )}
                        {tooltip.deps.length > 0 && (
                            <div style={{ marginBottom: 3 }}>
                                <span style={{ color: "var(--text-muted)", fontSize: 9 }}>imports: </span>
                                <span style={{ color: "var(--text-secondary)" }}>{tooltip.deps.slice(0, 4).join(", ")}{tooltip.deps.length > 4 ? ` +${tooltip.deps.length - 4}` : ""}</span>
                            </div>
                        )}
                        {tooltip.used_by.length > 0 && (
                            <div>
                                <span style={{ color: "var(--text-muted)", fontSize: 9 }}>used by: </span>
                                <span style={{ color: "var(--accent-blue)" }}>{tooltip.used_by.slice(0, 4).join(", ")}{tooltip.used_by.length > 4 ? ` +${tooltip.used_by.length - 4}` : ""}</span>
                            </div>
                        )}
                        {tooltip.deps.length === 0 && tooltip.used_by.length === 0 && (
                            <div style={{ color: "var(--text-muted)", fontSize: 9 }}>no connections</div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}