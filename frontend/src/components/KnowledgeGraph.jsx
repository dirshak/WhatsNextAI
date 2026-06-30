// src/components/KnowledgeGraph.jsx - Full workspace version
import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { API } from '../config';

const TYPE = {
  file: { stroke: "#10B981", fill: "#064E3B", r: 28, label: "#10B981" },
  class: { stroke: "#60A5FA", fill: "#1E3A5F", r: 18, label: "#60A5FA" },
  function: { stroke: "#8B5CF6", fill: "#2D1B4E", r: 11, label: "#8B5CF6" },
};

export default function KnowledgeGraph({ repoId, repoUrl, theme }) {
  const svgRef = useRef(null);
  const gRef = useRef(null);
  const zoomRef = useRef(null);
  const simRef = useRef(null);
  const linkSel = useRef(null);
  const nodeSel = useRef(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const [graphData, setGraphData] = useState(null);

  const dark = theme !== "light";

  // ── fetch + render ────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API}/knowledge-graph/${repoId}`);
        const data = await res.json();
        if (data.error) { setError(data.error); setLoading(false); return; }
        setStats({ nodes: data.nodes.length, edges: data.edges.length });
        setGraphData(data);
        renderGraph(data);
        setLoading(false);
      } catch {
        setError("Failed to load knowledge graph. Make sure the repo is ingested.");
        setLoading(false);
      }
    }
    load();
    return () => { simRef.current?.stop(); };
  }, [repoId]);

  function renderGraph(data) {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const W = svgRef.current.clientWidth;
    const H = svgRef.current.clientHeight;

    // ── defs ──
    const defs = svg.append("defs");
    const glow = defs.append("filter").attr("id", "kg-glow");
    glow.append("feGaussianBlur").attr("stdDeviation", 4).attr("result", "blur");
    const merge = glow.append("feMerge");
    merge.append("feMergeNode").attr("in", "blur");
    merge.append("feMergeNode").attr("in", "SourceGraphic");

    // radial gradient per type
    Object.entries(TYPE).forEach(([t, c]) => {
      const grad = defs.append("radialGradient").attr("id", `grad-${t}`);
      grad.append("stop").attr("offset", "0%").attr("stop-color", c.stroke).attr("stop-opacity", 0.15);
      grad.append("stop").attr("offset", "100%").attr("stop-color", dark ? c.fill : "#FFFFFF");
    });

    const g = svg.append("g");
    gRef.current = g;

    // ── zoom ──
    const zoom = d3.zoom().scaleExtent([0.15, 5])
      .on("zoom", e => g.attr("transform", e.transform));
    zoomRef.current = zoom;
    svg.call(zoom);
    svg.on("click", () => { setSelected(null); resetHighlight(); });

    // ── data ──
    const nodes = data.nodes.map(d => ({ ...d }));
    const edges = data.edges.map(d => ({ ...d }));

    // group files at fixed positions around center
    const fileNodes = nodes.filter(n => n.type === "file");
    const angle = (2 * Math.PI) / Math.max(fileNodes.length, 1);
    const ring = Math.min(W, H) * 0.28;
    fileNodes.forEach((n, i) => {
      n.fx_init = W / 2 + ring * Math.cos(i * angle - Math.PI / 2);
      n.fy_init = H / 2 + ring * Math.sin(i * angle - Math.PI / 2);
    });

    // ── simulation ──
    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(edges).id(d => d.id)
        .distance(d => d.type === "contains" ? 70 : 120)
        .strength(d => d.type === "contains" ? 0.8 : 0.3))
      .force("charge", d3.forceManyBody()
        .strength(d => d.type === "file" ? -800 : d.type === "class" ? -200 : -80))
      .force("center", d3.forceCenter(W / 2, H / 2).strength(0.05))
      .force("collision", d3.forceCollide(d => (TYPE[d.type]?.r || 12) + 12))
      .alpha(1).alphaDecay(0.02);

    simRef.current = sim;

    // nudge file nodes toward their initial ring positions
    sim.force("ring", () => {
      fileNodes.forEach(n => {
        if (n.fx_init === undefined) return;
        n.vx += (n.fx_init - n.x) * 0.05;
        n.vy += (n.fy_init - n.y) * 0.05;
      });
    });

    // ── edges ──
    const link = g.append("g").attr("class", "links").selectAll("line")
      .data(edges).enter().append("line")
      .attr("stroke", d => dark ? (d.type === "contains" ? "#334155" : "#4F46E5") : (d.type === "contains" ? "#CBD5E1" : "#818CF8"))
      .attr("stroke-width", d => d.type === "contains" ? 1 : 1.5)
      .attr("stroke-dasharray", d => d.type === "contains" ? "5,3" : null)
      .attr("stroke-opacity", 0.5);
    linkSel.current = link;

    // ── nodes ──
    const node = g.append("g").attr("class", "nodes").selectAll("g")
      .data(nodes).enter().append("g")
      .attr("class", d => `node node-${d.type}`)
      .style("cursor", "pointer")
      .call(d3.drag()
        .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }))
      .on("click", (e, d) => { e.stopPropagation(); setSelected(d); setAnswer(""); setQuestion(""); highlight(d, link, node); });
    nodeSel.current = node;

    // outer pulse ring for files
    node.filter(d => d.type === "file")
      .append("circle")
      .attr("r", d => TYPE[d.type].r + 6)
      .attr("fill", "none")
      .attr("stroke", d => TYPE[d.type].stroke)
      .attr("stroke-width", 0.5)
      .attr("stroke-opacity", 0.25)
      .attr("filter", "url(#kg-glow)");

    // main circle with gradient fill
    node.append("circle")
      .attr("r", d => TYPE[d.type]?.r || 12)
      .attr("fill", d => `url(#grad-${d.type})`)
      .attr("stroke", d => TYPE[d.type]?.stroke || "#94A3B8")
      .attr("stroke-width", 1.5)
      .on("mouseover", function (e, d) {
        d3.select(this).attr("stroke-width", 3).attr("filter", "url(#kg-glow)");
      })
      .on("mouseout", function () {
        d3.select(this).attr("stroke-width", 1.5).attr("filter", null);
      });

    // type icon
    node.append("text")
      .text(d => d.type === "file" ? "F" : d.type === "class" ? "C" : "f")
      .attr("text-anchor", "middle").attr("dy", "0.35em")
      .attr("font-size", d => d.type === "file" ? 12 : d.type === "class" ? 10 : 8)
      .attr("font-family", "JetBrains Mono, monospace")
      .attr("font-weight", "700")
      .attr("fill", d => TYPE[d.type]?.stroke || "#94A3B8")
      .attr("pointer-events", "none");

    // label
    node.append("text")
      .text(d => d.label.length > 20 ? d.label.slice(0, 18) + "…" : d.label)
      .attr("text-anchor", "middle")
      .attr("dy", d => (TYPE[d.type]?.r || 12) + 16)
      .attr("fill", d => TYPE[d.type]?.label || "#94A3B8")
      .attr("font-size", d => d.type === "file" ? 11 : d.type === "class" ? 10 : 9)
      .attr("font-family", "JetBrains Mono, monospace")
      .attr("font-weight", d => d.type === "file" ? "500" : "400")
      .attr("pointer-events", "none");

    sim.on("tick", () => {
      link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      node.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    // auto-fit after settle
    sim.on("end", () => fitGraph(g, svg, zoom, W, H));
  }

  function highlight(d, link, node) {
    const connected = new Set();
    link.each(l => {
      if (l.source.id === d.id) connected.add(l.target.id);
      if (l.target.id === d.id) connected.add(l.source.id);
    });
    link.attr("stroke-opacity", l =>
      l.source.id === d.id || l.target.id === d.id ? 0.9 : 0.05)
      .attr("stroke-width", l =>
        l.source.id === d.id || l.target.id === d.id ? 2.5 : 1);
    node.attr("opacity", n => n.id === d.id || connected.has(n.id) ? 1 : 0.2);
  }

  function resetHighlight() {
    if (!linkSel.current || !nodeSel.current) return;
    linkSel.current.attr("stroke-opacity", 0.5).attr("stroke-width", d => d.type === "contains" ? 1 : 1.5);
    nodeSel.current.attr("opacity", 1);
  }

  function fitGraph(g, svg, zoom, W, H) {
    try {
      const bounds = g.node().getBBox();
      if (!bounds.width) return;
      const pad = 60;
      const scale = Math.min((W - pad * 2) / bounds.width, (H - pad * 2) / bounds.height, 1);
      const tx = (W - bounds.width * scale) / 2 - bounds.x * scale;
      const ty = (H - bounds.height * scale) / 2 - bounds.y * scale;
      svg.transition().duration(700)
        .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
    } catch { }
  }

  function fitCurrent() {
    if (!gRef.current || !zoomRef.current || !svgRef.current) return;
    fitGraph(
      gRef.current,
      d3.select(svgRef.current),
      zoomRef.current,
      svgRef.current.clientWidth,
      svgRef.current.clientHeight
    );
  }

  function zoomBy(factor) {
    if (!zoomRef.current || !svgRef.current) return;
    d3.select(svgRef.current).transition().duration(200)
      .call(zoomRef.current.scaleBy, factor);
  }

  // ── search ────────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current) return;
    const s = search.toLowerCase().trim();
    if (!s) { resetHighlight(); return; }
    const svg = d3.select(svgRef.current);
    svg.selectAll(".node circle").attr("filter", null).attr("stroke-width", 1.5);
    svg.selectAll(".node").attr("opacity", d => d?.label?.toLowerCase().includes(s) ? 1 : 0.15);
    svg.selectAll(".node circle")
      .filter(d => d?.label?.toLowerCase().includes(s))
      .attr("filter", "url(#kg-glow)").attr("stroke-width", 3);

    // fly to first match
    const match = d3.select(svgRef.current).selectAll(".node")
      .filter(d => d?.label?.toLowerCase().includes(s)).datum();
    if (match && zoomRef.current && svgRef.current) {
      const W = svgRef.current.clientWidth;
      const H = svgRef.current.clientHeight;
      d3.select(svgRef.current).transition().duration(500)
        .call(zoomRef.current.transform,
          d3.zoomIdentity.translate(W / 2 - match.x, H / 2 - match.y).scale(1.5));
    }
  }, [search]);

  // ── filter by type ────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    if (filterType === "all") {
      svg.selectAll(".node").attr("opacity", 1).attr("display", null);
      svg.selectAll(".links line").attr("opacity", 0.5);
    } else {
      svg.selectAll(".node").attr("opacity", d => d?.type === filterType ? 1 : 0.08);
      svg.selectAll(".links line").attr("opacity", 0.05);
    }
  }, [filterType]);

  // ── ask ───────────────────────────────────────────────────
  async function askAboutNode() {
    if (!question.trim() || !selected) return;
    setAsking(true); setAnswer("");
    try {
      const res = await fetch(`${API}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_id: repoId,
          question: `About the ${selected.type} "${selected.label}": ${question}`,
        }),
      });
      const data = await res.json();
      setAnswer(data.answer);
    } catch { setAnswer("Failed to get answer."); }
    finally { setAsking(false); }
  }

  // ── styles ────────────────────────────────────────────────
  const TLABEL = { file: "FILE", class: "CLASS", function: "FUNCTION" };

  // Show loading state
  if (loading) {
    return (
      <div className="workspace-content" style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
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
          Building knowledge graph…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="workspace-content" style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
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
    <div className="workspace-content" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* ── header ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 16px",
        borderBottom: "1px solid var(--border-color)",
        flexShrink: 0,
        background: "var(--bg-secondary)",
        minHeight: 36,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>Knowledge Graph</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
            {repoUrl.replace("https://github.com/", "")}
          </span>
          {stats && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)" }}>
              {stats.nodes} symbols · {stats.edges} connections
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search symbols…"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius)",
              padding: "2px 10px",
              color: "var(--text-primary)",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              outline: "none",
              width: 140,
              transition: "border-color 0.2s",
            }}
            onFocus={e => e.target.style.borderColor = "var(--accent-blue)"}
            onBlur={e => e.target.style.borderColor = "var(--border-color)"}
          />
        </div>
      </div>

      {/* ── toolbar ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 16px",
        borderBottom: "1px solid var(--border-color)",
        flexShrink: 0,
        background: "var(--bg-tertiary)",
        flexWrap: "wrap",
        minHeight: 32,
      }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-muted)", marginRight: 2 }}>
          FILTER:
        </span>
        {["all", "file", "class", "function"].map(t => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            style={{
              background: "transparent",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius)",
              padding: "2px 8px",
              color: filterType === t ? (TYPE[t]?.stroke || "var(--accent-green)") : "var(--text-muted)",
              borderColor: filterType === t ? (TYPE[t]?.stroke || "var(--accent-green)") : "var(--border-color)",
              fontFamily: "var(--font-mono)",
              fontSize: 8,
              cursor: "pointer",
              transition: "var(--transition)",
            }}
          >
            {t === "all" ? "All" : t.charAt(0).toUpperCase() + t.slice(1) + "s"}
          </button>
        ))}
        <div style={{ display: "flex", gap: 10, marginLeft: 8 }}>
          {[
            ["var(--accent-green)", "Files"],
            ["var(--accent-blue)", "Classes"],
            ["var(--accent-purple)", "Functions"]
          ].map(([c, l]) => (
            <div key={l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: c, opacity: 0.7 }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-muted)" }}>{l}</span>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 12, borderTop: "1px dashed var(--border-color)" }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-muted)" }}>contains</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 12, borderTop: "1.5px solid var(--accent-purple)" }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-muted)" }}>calls</span>
          </div>
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-muted)", marginLeft: "auto" }}>
          click · scroll · drag
        </span>
      </div>

      {/* ── main ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", background: "var(--bg-secondary)" }}>

        {/* graph canvas */}
        <div style={{ flex: 1, position: "relative" }}>
          <svg ref={svgRef} style={{ width: "100%", height: "100%", display: "block" }} />

          {/* zoom controls */}
          <div style={{
            position: "absolute",
            bottom: 12,
            right: 12,
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}>
            {[
              ["+", () => zoomBy(1.4)],
              ["⊙", () => {
                resetHighlight();
                setSelected(null);
                setSearch("");
                setFilterType("all");
                fitCurrent();
              }],
              ["−", () => zoomBy(0.7)],
            ].map(([label, fn]) => (
              <button key={label} onClick={fn} style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius)",
                width: 24, height: 24,
                color: "var(--text-muted)",
                fontSize: label === "⊙" ? 10 : 14,
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
                fontFamily: "monospace",
                transition: "var(--transition)",
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent-blue)"; e.currentTarget.style.color = "var(--accent-blue)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border-color)"; e.currentTarget.style.color = "var(--text-muted)"; }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── side panel ── */}
        {selected ? (
          <div style={{
            width: 320,
            borderLeft: "1px solid var(--border-color)",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            background: "var(--bg-secondary)",
            overflow: "hidden",
          }}>
            {/* node identity */}
            <div style={{
              padding: "12px 16px",
              borderBottom: "1px solid var(--border-color)",
              background: "var(--bg-tertiary)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 8,
                  letterSpacing: "0.1em",
                  color: TYPE[selected.type]?.stroke,
                  background: "var(--bg-card)",
                  border: `1px solid ${TYPE[selected.type]?.stroke}`,
                  borderRadius: 3,
                  padding: "1px 6px"
                }}>
                  {TLABEL[selected.type]}
                </span>
                <button
                  onClick={() => { setSelected(null); resetHighlight(); }}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius)",
                    padding: "1px 6px",
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    cursor: "pointer",
                    marginLeft: "auto",
                  }}
                >
                  ✕
                </button>
              </div>
              <div style={{
                fontFamily: "var(--font-mono)",
                fontSize: 14,
                color: TYPE[selected.type]?.stroke,
                fontWeight: 600,
                wordBreak: "break-all",
                marginBottom: 4,
              }}>
                {selected.label}
              </div>
              {selected.file && selected.type !== "file" && (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
                  in {selected.file} {selected.line ? `· line ${selected.line}` : ""}
                </div>
              )}
            </div>

            {/* details scroll area */}
            <div style={{ flex: 1, overflow: "auto", padding: "12px 16px" }}>
              {selected.docstring && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 8,
                    color: "var(--text-muted)",
                    letterSpacing: "0.08em",
                    marginBottom: 4,
                    textTransform: "uppercase",
                  }}>DOCSTRING</div>
                  <div style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--text-secondary)",
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius)",
                    padding: "8px 10px",
                    lineHeight: 1.7
                  }}>
                    {selected.docstring}
                  </div>
                </div>
              )}

              {selected.args?.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 8,
                    color: "var(--text-muted)",
                    letterSpacing: "0.08em",
                    marginBottom: 4,
                    textTransform: "uppercase",
                  }}>PARAMETERS</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                    {selected.args.map(a => (
                      <span key={a} style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: "var(--accent-blue)",
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-color)",
                        borderRadius: 3,
                        padding: "1px 6px"
                      }}>
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {selected.methods?.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 8,
                    color: "var(--text-muted)",
                    letterSpacing: "0.08em",
                    marginBottom: 4,
                    textTransform: "uppercase",
                  }}>METHODS ({selected.methods.length})</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    {selected.methods.map(m => (
                      <div key={m.name} style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        padding: "4px 0",
                        borderBottom: "1px solid var(--border-color)",
                        display: "flex",
                        alignItems: "baseline",
                        gap: 4
                      }}>
                        <span style={{ color: "var(--accent-green)" }}>{m.name}</span>
                        {m.args?.length > 0 && <span style={{ color: "var(--text-muted)", fontSize: 9 }}>({m.args.filter(a => a !== "self").join(", ")})</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ask section */}
              <div style={{ marginBottom: 12 }}>
                <div style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 8,
                  color: "var(--text-muted)",
                  letterSpacing: "0.08em",
                  marginBottom: 4,
                  textTransform: "uppercase",
                }}>ASK ABOUT THIS {TLABEL[selected.type]}</div>
                <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                  <input
                    value={question}
                    onChange={e => setQuestion(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && askAboutNode()}
                    placeholder="What does this do?"
                    style={{
                      flex: 1,
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius)",
                      padding: "4px 8px",
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      outline: "none",
                      transition: "border-color 0.2s",
                    }}
                    onFocus={e => e.target.style.borderColor = "var(--accent-blue)"}
                    onBlur={e => e.target.style.borderColor = "var(--border-color)"}
                  />
                  <button
                    onClick={askAboutNode}
                    disabled={asking}
                    style={{
                      background: asking ? "var(--bg-tertiary)" : "var(--accent-blue)",
                      color: asking ? "var(--text-muted)" : "white",
                      border: "none",
                      borderRadius: "var(--radius)",
                      padding: "4px 12px",
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: asking ? "not-allowed" : "pointer",
                      transition: "var(--transition)",
                    }}
                  >
                    {asking ? "…" : "Ask"}
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 8 }}>
                  {["What does this do?", "What calls this?", "What does this return?", "Any issues here?"].map(q => (
                    <button
                      key={q}
                      onClick={() => setQuestion(q)}
                      style={{
                        background: "transparent",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius)",
                        padding: "1px 6px",
                        color: "var(--text-muted)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 8,
                        cursor: "pointer",
                      }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
                {answer && (
                  <div style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--text-secondary)",
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius)",
                    padding: "8px 10px",
                    lineHeight: 1.7,
                    whiteSpace: "pre-wrap",
                    maxHeight: 200,
                    overflow: "auto"
                  }}>
                    {answer}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* empty state hint */
          <div style={{
            width: 200,
            borderLeft: "1px solid var(--border-color)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            flexShrink: 0,
            background: "var(--bg-secondary)",
          }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.3 }}>◎</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)", lineHeight: 1.6 }}>
                Click any node to inspect
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}