// src/components/GraphDiff.jsx
import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";

export default function GraphDiff({ proposalResult }) {
    const svgRef = useRef(null);
    const containerRef = useRef(null);
    const zoomRef = useRef(null);
    const simulationRef = useRef(null);
    const [tooltip, setTooltip] = useState(null);
    const [selectedNodeId, setSelectedNodeId] = useState(null);
    const [scale, setScale] = useState(100);
    const [detailLevel, setDetailLevel] = useState(3);

    const nodesData = proposalResult?.react_flow?.nodes || [];
    const edgesData = proposalResult?.react_flow?.edges || [];
    const diff = proposalResult?.diff_summary || {};

    const addedNodes = nodesData.filter(n => n.data?.status === "added");
    const modifiedNodes = nodesData.filter(n => n.data?.status === "modified");
    const addedEdges = edgesData.filter(e => e.animated || e.data?.status === "added");

    useEffect(() => {
        if (!proposalResult || !svgRef.current || !containerRef.current) return;

        const width = containerRef.current.clientWidth || 800;
        const height = containerRef.current.clientHeight || 500;

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();
        svg.attr("width", width).attr("height", height);

        // Compute degrees for sizing
        const degree = {};
        nodesData.forEach(n => { degree[n.id] = 0; });
        edgesData.forEach(e => {
            degree[e.source] = (degree[e.source] || 0) + 1;
            degree[e.target] = (degree[e.target] || 0) + 1;
        });
        const maxDegree = Math.max(...Object.values(degree), 1);
        const nodeRadius = id => 10 + (degree[id] / maxDegree) * 18;

        const g = svg.append("g");

        // Deselect node on background click
        svg.on("click", function(e) {
            if (e.target === svgRef.current) {
                setSelectedNodeId(null);
                link.attr("stroke-opacity", 0.3).attr("stroke-width", 1);
                node.selectAll("circle").attr("opacity", 1);
            }
        });

        const zoom = d3.zoom()
            .scaleExtent([0.2, 4])
            .on("zoom", e => {
                g.attr("transform", e.transform);
                setScale(Math.round(e.transform.k * 100));
            });
        zoomRef.current = zoom;
        svg.call(zoom);

        // Markers for arrows
        const defs = svg.append("defs");
        ["edited", "unedited", "removed"].forEach(type => {
            const color = type === "edited" ? "#F59E0B" : type === "unedited" ? "#FFFFFF" : "#EF4444";
            defs.append("marker")
                .attr("id", `arrow-diff-${type}`)
                .attr("viewBox", "0 -5 10 10")
                .attr("refX", 22).attr("refY", 0)
                .attr("markerWidth", 5).attr("markerHeight", 5)
                .attr("orient", "auto")
                .append("path").attr("d", "M0,-5L10,0L0,5")
                .attr("fill", color).attr("opacity", 0.7);
        });

        const glowFilter = defs.append("filter").attr("id", "diff-glow");
        glowFilter.append("feGaussianBlur").attr("stdDeviation", "2").attr("result", "coloredBlur");
        const feMerge = glowFilter.append("feMerge");
        feMerge.append("feMergeNode").attr("in", "coloredBlur");
        feMerge.append("feMergeNode").attr("in", "SourceGraphic");

        const nodes = nodesData.map(d => ({ ...d }));
        const edges = edgesData.map(d => ({ ...d }));

        // Stationary Force Simulation: Closer spacing ("Space them not too far away")
        const simulation = d3.forceSimulation(nodes)
            .force("link", d3.forceLink(edges).id(d => d.id).distance(80))
            .force("charge", d3.forceManyBody().strength(-150))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collision", d3.forceCollide(d => nodeRadius(d.id) + 8));

        // Tick synchronously to lay out nodes, then STOP the simulation immediately to freeze them
        for (let i = 0; i < 200; i++) {
            simulation.tick();
        }
        simulation.stop();

        // Pin final positions to coordinate keys
        nodes.forEach(d => { d.fx = d.x; d.fy = d.y; });

        const getLinkType = l => {
            const tgtNode = nodes.find(n => n.id === (l.target.id || l.target));
            if (!tgtNode) return "unedited";
            const status = tgtNode.data?.status;
            if (status === "added" || status === "modified") return "edited";
            if (status === "removed") return "removed";
            return "unedited";
        };

        const link = g.append("g").selectAll("line")
            .data(edges).enter().append("line")
            .attr("class", "link-line")
            .attr("stroke", d => {
                const type = getLinkType(d);
                return type === "edited" ? "#F59E0B" : type === "removed" ? "#EF4444" : "#D1D5DB";
            })
            .attr("stroke-width", d => d.animated ? 2 : 1)
            .attr("stroke-opacity", 0.25)
            .attr("stroke-dasharray", d => d.animated ? "4,4" : null)
            .attr("marker-end", d => `url(#arrow-diff-${getLinkType(d)})`);

        // Edge text labels
        const linkLabel = g.append("g").selectAll("text")
            .data(edges).enter().append("text")
            .attr("class", "link-label")
            .text(d => d.relationship || d.label || "imports")
            .attr("font-size", "7px")
            .attr("font-family", "JetBrains Mono, monospace")
            .attr("fill", "#9CA3AF")
            .attr("text-anchor", "middle")
            .attr("dy", -3)
            .style("pointer-events", "none");

        // Helper to determine node type
        const isFile = id => id.startsWith("file::");
        const isFunction = id => id.startsWith("fn::");
        const isServiceOrClass = id => !isFile(id) && !isFunction(id);

        const getFill = d => {
            const status = d.data?.status;
            if (status === "added" || status === "modified") return "#2A200F";
            if (status === "removed") return "#2D1416";
            return "#111827"; // Slate gray/dark fill for unedited base nodes
        };

        const getStroke = d => {
            const status = d.data?.status;
            if (status === "added" || status === "modified") return "#F59E0B";
            if (status === "removed") return "#EF4444";
            return "#FFFFFF"; // Pure white for unedited base nodes
        };

        function handleMouseOver(e, d) {
            if (selectedNodeId !== null) return;
            d3.select(this).attr("stroke-width", 3).attr("filter", "url(#diff-glow)");
            link
                .attr("stroke-opacity", l => {
                    const sId = l.source.id || l.source;
                    const tId = l.target.id || l.target;
                    return (sId === d.id || tId === d.id) ? 0.95 : 0.05;
                })
                .attr("stroke-width", l => {
                    const sId = l.source.id || l.source;
                    const tId = l.target.id || l.target;
                    return (sId === d.id || tId === d.id) ? 2 : 1;
                });
            
            const deps = edges.filter(l => (l.source.id || l.source) === d.id).map(l => l.target.id || l.target);
            const used_by = edges.filter(l => (l.target.id || l.target) === d.id).map(l => l.source.id || l.source);
            
            setTooltip({
                x: e.offsetX,
                y: e.offsetY,
                id: d.id,
                status: d.data?.status || "unchanged",
                type: d.data?.nodeType || "file",
                depCount: degree[d.id] || 0,
                deps,
                used_by,
                description: d.data?.description
            });
        }

        function handleMouseOut() {
            if (selectedNodeId !== null) return;
            d3.select(this).attr("stroke-width", d => (d.data?.status === "added" || d.data?.status === "modified") ? 2.5 : 1.5).attr("filter", null);
            link.attr("stroke-opacity", 0.25).attr("stroke-width", 1);
            setTooltip(null);
        }

        function handleNodeClick(e, d) {
            e.stopPropagation();
            const newSelected = selectedNodeId === d.id ? null : d.id;
            setSelectedNodeId(newSelected);

            if (newSelected === null) {
                link.attr("stroke-opacity", 0.25).attr("stroke-width", 1);
                node.selectAll(".node-shape").attr("opacity", 1);
                return;
            }

            const connected = new Set();
            edges.forEach(l => {
                const sId = l.source.id || l.source;
                const tId = l.target.id || l.target;
                if (sId === d.id || tId === d.id) {
                    connected.add(sId);
                    connected.add(tId);
                }
            });
            link
                .attr("stroke-opacity", l => {
                    const sId = l.source.id || l.source;
                    const tId = l.target.id || l.target;
                    return (sId === d.id || tId === d.id) ? 1 : 0.04;
                })
                .attr("stroke-width", l => {
                    const sId = l.source.id || l.source;
                    const tId = l.target.id || l.target;
                    return (sId === d.id || tId === d.id) ? 2.5 : 0.5;
                });
            node.selectAll(".node-shape")
                .attr("opacity", nd => connected.has(nd.id) || nd.id === d.id ? 1 : 0.2);
        }

        // Stationary drag handler: Moves elements directly without restarting the force simulation
        const drag = d3.drag()
            .on("drag", (e, d) => {
                d.x = e.x;
                d.y = e.y;
                d.fx = e.x;
                d.fy = e.y;
                
                // Move node element translation immediately
                d3.select(e.sourceEvent.currentTarget.parentElement).attr("transform", `translate(${d.x},${d.y})`);
                
                // Move connected links manually
                link
                    .filter(l => (l.source.id || l.source) === d.id || (l.target.id || l.target) === d.id)
                    .attr("x1", l => (l.source.x ?? 0)).attr("y1", l => (l.source.y ?? 0))
                    .attr("x2", l => (l.target.x ?? 0)).attr("y2", l => (l.target.y ?? 0));
                
                // Move connected labels manually
                linkLabel
                    .filter(l => (l.source.id || l.source) === d.id || (l.target.id || l.target) === d.id)
                    .attr("x", l => ((l.source.x ?? 0) + (l.target.x ?? 0)) / 2)
                    .attr("y", l => ((l.source.y ?? 0) + (l.target.y ?? 0)) / 2);
            });

        const node = g.append("g").selectAll("g")
            .data(nodes).enter().append("g")
            .attr("class", "node-group")
            .style("cursor", "pointer")
            .call(drag);

        // 1. File Level -> Rectangles
        node.filter(d => isFile(d.id))
            .append("rect")
            .attr("class", "node-shape")
            .attr("width", d => nodeRadius(d.id) * 2)
            .attr("height", d => nodeRadius(d.id) * 1.4)
            .attr("x", d => -nodeRadius(d.id))
            .attr("y", d => -nodeRadius(d.id) * 0.7)
            .attr("rx", 3).attr("ry", 3)
            .attr("fill", getFill)
            .attr("stroke", getStroke)
            .attr("stroke-width", d => (d.data?.status === "added" || d.data?.status === "modified") ? 2.5 : 1.5)
            .attr("class", d => (d.data?.status === "added" || d.data?.status === "modified") ? "node-pulse node-shape" : "node-shape")
            .on("mouseover", handleMouseOver)
            .on("mouseout", handleMouseOut)
            .on("click", handleNodeClick);

        // 2. Service/Class Level -> Triangles
        node.filter(d => isServiceOrClass(d.id))
            .append("polygon")
            .attr("class", "node-shape")
            .attr("points", d => {
                const r = nodeRadius(d.id) * 1.1;
                return `0,${-r} ${-r},${r} ${r},${r}`;
            })
            .attr("fill", getFill)
            .attr("stroke", getStroke)
            .attr("stroke-width", d => (d.data?.status === "added" || d.data?.status === "modified") ? 2.5 : 1.5)
            .attr("class", d => (d.data?.status === "added" || d.data?.status === "modified") ? "node-pulse node-shape" : "node-shape")
            .on("mouseover", handleMouseOver)
            .on("mouseout", handleMouseOut)
            .on("click", handleNodeClick);

        // 3. Function Level -> Circles
        node.filter(d => isFunction(d.id))
            .append("circle")
            .attr("class", "node-shape")
            .attr("r", d => nodeRadius(d.id))
            .attr("fill", getFill)
            .attr("stroke", getStroke)
            .attr("stroke-width", d => (d.data?.status === "added" || d.data?.status === "modified") ? 2.5 : 1.5)
            .attr("class", d => (d.data?.status === "added" || d.data?.status === "modified") ? "node-pulse node-shape" : "node-shape")
            .on("mouseover", handleMouseOver)
            .on("mouseout", handleMouseOut)
            .on("click", handleNodeClick);

        node.append("text")
            .text(d => d.data?.label || d.id.replace(/^(file|fn|cls)::/, ""))
            .attr("text-anchor", "middle")
            .attr("dy", d => nodeRadius(d.id) + 16)
            .attr("fill", d => {
                const status = d.data?.status;
                if (status === "added" || status === "modified") return "#F59E0B";
                if (status === "removed") return "#EF4444";
                return "#FFFFFF"; // Text label pure white for unedited nodes
            })
            .attr("font-size", "10px")
            .attr("font-family", "JetBrains Mono, monospace")
            .attr("pointer-events", "none");

        // Manually place coordinates immediately after synchronous layout ticks
        link
            .attr("x1", d => d.source.x ?? 0).attr("y1", d => d.source.y ?? 0)
            .attr("x2", d => d.target.x ?? 0).attr("y2", d => d.target.y ?? 0);
        linkLabel
            .attr("x", d => ((d.source.x ?? 0) + (d.target.x ?? 0)) / 2)
            .attr("y", d => ((d.source.y ?? 0) + (d.target.y ?? 0)) / 2);
        node.attr("transform", d => `translate(${d.x ?? 0},${d.y ?? 0})`);

        function autoFit() {
            const bounds = g.node().getBBox();
            if (!bounds.width || !bounds.height) return;
            const pad = 60;
            const sc = Math.min((width - pad * 2) / bounds.width, (height - pad * 2) / bounds.height, 1);
            const tx = (width - bounds.width * sc) / 2 - bounds.x * sc;
            const ty = (height - bounds.height * sc) / 2 - bounds.y * sc;
            svg.transition().duration(400)
                .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(sc));
        }

        autoFit();
    }, [proposalResult]);

    useEffect(() => {
        if (!svgRef.current) return;
        const svg = d3.select(svgRef.current);
        const node = svg.selectAll("g.node-group");
        const link = svg.selectAll("line.link-line");
        const linkLabel = svg.selectAll("text.link-label");

        const isFileNode = d => (d.data?.nodeType === "file" || d.type === "file" || d.id.startsWith("file::"));
        const isFunctionNode = d => (d.data?.nodeType === "function" || d.type === "function" || d.id.startsWith("fn::"));

        // Selective drill-down filter: Shows selected file's detail levels, while other files remain at top levels
        const isVisible = d => {
            if (isFileNode(d)) return true;

            // If a file is selected, show details belonging to it
            if (selectedNodeId && isFileNode({ id: selectedNodeId })) {
                const selectedFile = selectedNodeId.replace("file::", "");
                const filePath = d.data?.filePath || d.file_path || "";
                if (filePath.includes(selectedFile) || d.id.includes(selectedFile)) return true;
            }

            // General hierarchy level check
            if (detailLevel === 1) return false;
            if (detailLevel === 2) return !isFunctionNode(d);
            return true;
        };

        // Smooth transition zoom/scale of node shapes
        node.transition().duration(400)
            .style("opacity", d => isVisible(d) ? 1 : 0)
            .style("pointer-events", d => isVisible(d) ? "auto" : "none")
            .selectAll(".node-shape")
            .attr("transform", d => isVisible(d) ? "scale(1)" : "scale(0.01)");

        node.transition().duration(400)
            .selectAll("text")
            .style("opacity", d => isVisible(d) ? 1 : 0);

        // Transition links only when both endpoints are visible
        link.transition().duration(400)
            .style("opacity", d => {
                const srcNode = node.filter(n => n.id === (d.source.id || d.source)).datum();
                const tgtNode = node.filter(n => n.id === (d.target.id || d.target)).datum();
                return (srcNode && isVisible(srcNode) && tgtNode && isVisible(tgtNode)) ? 0.3 : 0;
            });

        linkLabel.transition().duration(400)
            .style("opacity", d => {
                const srcNode = node.filter(n => n.id === (d.source.id || d.source)).datum();
                const tgtNode = node.filter(n => n.id === (d.target.id || d.target)).datum();
                return (srcNode && isVisible(srcNode) && tgtNode && isVisible(tgtNode)) ? 0.6 : 0;
            });
    }, [detailLevel, selectedNodeId]);

    function zoomBy(factor) {
        if (!zoomRef.current || !svgRef.current) return;
        d3.select(svgRef.current).transition().duration(200)
            .call(zoomRef.current.scaleBy, factor);
    }

    function resetZoom() {
        if (!zoomRef.current || !svgRef.current) return;
        d3.select(svgRef.current).transition().duration(300)
            .call(zoomRef.current.transform, d3.zoomIdentity);
    }

    if (!proposalResult) {
        return (
            <div className="empty-state">
                <div className="empty-state-icon">⚡</div>
                <div className="empty-state-title">No Diff Available</div>
                <div className="empty-state-desc">
                    Propose a feature using the sidebar to see how the architecture graph changes.
                </div>
            </div>
        );
    }

    return (
        <div className="diff-panel fade-in" style={{ display: "flex", flexDirection: "column", height: "100%", padding: 0 }}>
            {/* Header bar */}
            <div style={{
                display: "flex",
                alignItems: "center",
                padding: "8px 16px",
                borderBottom: "1px solid var(--border-color)",
                flexShrink: 0,
                background: "var(--bg-tertiary)",
                minHeight: 40
            }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>⚡ Graph Diff</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
                        — {addedNodes.length} added · {modifiedNodes.length} edited · {addedEdges.length} connections
                    </span>
                </div>

                {/* Hierarchy Scroller */}
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)", marginLeft: "20px" }}>
                    level
                    <input
                        type="range"
                        min={1} max={3} step={1}
                        value={detailLevel}
                        onChange={e => setDetailLevel(Number(e.target.value))}
                        style={{ width: 60, accentColor: "var(--accent-blue)", cursor: "pointer", height: "4px" }}
                    />
                    <span style={{ color: "var(--accent-blue)", fontWeight: 600, fontSize: 10 }}>
                        {detailLevel === 1 ? "Files" : detailLevel === 2 ? "Services" : "Functions"}
                    </span>
                </label>

                {/* Legend */}
                <div style={{ display: "flex", gap: 12, marginLeft: "auto", fontSize: "10px", fontFamily: "var(--font-mono)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#F59E0B" }} />
                        <span style={{ color: "var(--text-secondary)" }}>Edited (Yellow)</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#FFFFFF" }} />
                        <span style={{ color: "var(--text-secondary)" }}>Unedited (White)</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#EF4444" }} />
                        <span style={{ color: "var(--text-secondary)" }}>Removed (Red)</span>
                    </div>
                </div>
            </div>

            {/* Main Interactive Graph Area */}
            <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden", background: "var(--bg-secondary)" }}>
                <svg ref={svgRef} style={{ width: "100%", height: "100%", display: "block" }} />

                {/* Zoom controls */}
                <div style={{
                    position: "absolute",
                    bottom: 12,
                    right: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                }}>
                    {[
                        ["+", () => zoomBy(1.3)],
                        [`${scale}%`, resetZoom],
                        ["−", () => zoomBy(0.77)],
                    ].map(([label, fn]) => (
                        <button key={label} onClick={fn} style={{
                            background: "var(--bg-card)",
                            border: "1px solid var(--border-color)",
                            borderRadius: "var(--radius)",
                            width: 28, height: 28,
                            display: "grid", placeItems: "center",
                            color: "var(--text-muted)",
                            fontSize: label.includes("%") ? "8px" : "14px",
                            cursor: "pointer",
                            fontFamily: "var(--font-mono)",
                            transition: "var(--transition)",
                        }}>
                            {label}
                        </button>
                    ))}
                </div>

                {/* Tooltip */}
                {tooltip && (
                    <div style={{
                        position: "absolute",
                        left: Math.min(tooltip.x + 14, window.innerWidth - 240),
                        top: Math.min(tooltip.y + 14, window.innerHeight - 220),
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius)",
                        padding: "10px 14px",
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        pointerEvents: "none",
                        zIndex: 100,
                        minWidth: 180,
                        boxShadow: "var(--shadow-lg)",
                    }}>
                        <div style={{
                            color: tooltip.status === "added" || tooltip.status === "modified" ? "#F59E0B" : tooltip.status === "removed" ? "#EF4444" : "#FFFFFF",
                            fontWeight: 700,
                            marginBottom: 6,
                            fontSize: 11
                        }}>
                            {tooltip.id}
                        </div>
                        <div style={{ display: "flex", gap: 6, marginBottom: 4, alignItems: "center" }}>
                            <span style={{ color: "var(--text-muted)", fontSize: 9 }}>status</span>
                            <span style={{
                                background: tooltip.status === "added" || tooltip.status === "modified" ? "rgba(245,158,11,0.1)" : tooltip.status === "removed" ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)",
                                color: tooltip.status === "added" || tooltip.status === "modified" ? "#F59E0B" : tooltip.status === "removed" ? "#EF4444" : "#22C55E",
                                padding: "1px 6px",
                                borderRadius: 4,
                                fontSize: 9,
                                fontWeight: 600,
                            }}>{tooltip.status}</span>
                        </div>
                        <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                            <span style={{ color: "var(--text-muted)", fontSize: 9 }}>type</span>
                            <span style={{ color: "var(--text-secondary)" }}>{tooltip.type}</span>
                        </div>
                        {tooltip.description && (
                            <div style={{ marginBottom: 6, fontSize: 9, color: "var(--text-secondary)", lineHeight: 1.5, fontFamily: "var(--font-sans)" }}>
                                {tooltip.description}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
