// src/components/DiagramPanel.jsx
import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import * as d3 from "d3";
import { API } from '../config';

const BASE_THEME_VARS = {
    background:          "#0B1220",
    primaryColor:        "#161D2E",
    primaryTextColor:    "#F8FAFC",
    primaryBorderColor:  "#22C55E",
    lineColor:           "#3B82F6",
    secondaryColor:      "#1F2937",
    tertiaryColor:       "#0D1526",
    edgeLabelBackground: "#111827",
    fontFamily:          "JetBrains Mono, monospace",
    fontSize:            "13px",
};

// Architecture diagram config — clear hierarchy, tight layout
const ARCH_CONFIG = {
    startOnLoad: false,
    theme: "dark",
    themeVariables: {
        ...BASE_THEME_VARS,
        primaryBorderColor: "#22C55E",
        lineColor:          "#3B82F6",
        fontSize:           "13px",
        clusterBkg:         "#111827",
        clusterBorder:      "#2D3748",
    },
    flowchart: {
        htmlLabels: true,
        curve: "basis",
        diagramPadding: 16,
        nodeSpacing: 50,
        rankSpacing: 60,
        useMaxWidth: false,
    },
};

// ER diagram config — LR layout, clear relationship arrows, high contrast
const ER_CONFIG = {
    startOnLoad: false,
    theme: "dark",
    themeVariables: {
        ...BASE_THEME_VARS,
        primaryBorderColor:  "#60A5FA",
        lineColor:           "#60A5FA",
        primaryColor:        "#0F1F3D",
        primaryTextColor:    "#E2E8F0",
        // ER attribute rows
        attributeBackgroundColorEven: "#111827",
        attributeBackgroundColorOdd:  "#1A2540",
        fontSize: "14px",
    },
    er: {
        diagramPadding:  40,
        layoutDirection: "LR",
        minEntityWidth:  120,
        minEntityHeight: 80,
        entityPadding:   20,
        useMaxWidth:     false,
    },
};

export default function DiagramPanel({ repoId, repoUrl, mode, proposalResult }) {
    const wrapperRef = useRef(null);
    const svgContainerRef = useRef(null);
    const zoomRef = useRef(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [explanation, setExplanation] = useState("");
    const [mermaidCode, setMermaidCode] = useState("");
    const [fnInput, setFnInput] = useState("");
    const [copiedMermaid, setCopiedMermaid] = useState(false);
    const [copiedText, setCopiedText] = useState(false);
    const [copiedImg, setCopiedImg] = useState(false);
    const [activeTab, setActiveTab] = useState("diagram");
    const [scale, setScale] = useState(1);


    async function fetchDiagram(functionName) {
        setLoading(true);
        setError(null);
        setMermaidCode("");
        setExplanation("");
        try {
            if (proposalResult && mode === "architecture") {
                setMermaidCode(proposalResult.architecture_mermaid);
                setExplanation(proposalResult.rationale);
                setActiveTab("diagram");
                setLoading(false);
                return;
            }
            let data;
            if (mode === "architecture") {
                const res = await fetch(`${API}/architecture/${repoId}`);
                data = await res.json();
            } else if (mode === "er") {
                const res = await fetch(`${API}/er-diagram/${repoId}`);
                data = await res.json();
            } else {
                const res = await fetch(`${API}/flow/${repoId}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ function_name: functionName }),
                });
                data = await res.json();
            }
            if (data.error) { setError(data.error); setLoading(false); return; }
            setMermaidCode(data.mermaid);
            setExplanation(data.explanation || "");
            setActiveTab("diagram");
            setLoading(false);
        } catch {
            setError("Failed to generate diagram. Check that the backend is running.");
            setLoading(false);
        }
    }

    useEffect(() => {
        if (mode === "architecture" || mode === "er" || proposalResult) fetchDiagram(null);
    }, [mode, repoId, proposalResult]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!mermaidCode || loading || activeTab !== "diagram" || !wrapperRef.current) return;

        async function render() {
            try {
                const config = mode === "er" ? ER_CONFIG : ARCH_CONFIG;
                mermaid.initialize(config);

                const id = `mermaid-${Math.random().toString(36).slice(2)}`;
                const { svg } = await mermaid.render(id, mermaidCode);

                const container = svgContainerRef.current;
                container.innerHTML = svg;

                const svgEl = container.querySelector("svg");
                if (!svgEl) return;

                const naturalW = svgEl.viewBox?.baseVal?.width || svgEl.clientWidth || 800;
                const naturalH = svgEl.viewBox?.baseVal?.height || svgEl.clientHeight || 600;

                svgEl.setAttribute("width", naturalW);
                svgEl.setAttribute("height", naturalH);
                svgEl.style.width = naturalW + "px";
                svgEl.style.height = naturalH + "px";
                svgEl.style.display = "block";

                const wrapper = wrapperRef.current;
                const wW = wrapper.clientWidth;
                const wH = wrapper.clientHeight;

                const fitScale = Math.min((wW - 80) / naturalW, (wH - 80) / naturalH, 1);
                const tx = (wW - naturalW * fitScale) / 2;
                const ty = (wH - naturalH * fitScale) / 2;

                const zoom = d3.zoom()
                    .scaleExtent([0.1, 5])
                    .on("zoom", (e) => {
                        container.style.transform = `translate(${e.transform.x}px, ${e.transform.y}px) scale(${e.transform.k})`;
                        container.style.transformOrigin = "0 0";
                        setScale(Math.round(e.transform.k * 100));
                    });

                zoomRef.current = zoom;
                const sel = d3.select(wrapper);
                sel.call(zoom);
                sel.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(fitScale));
                setScale(Math.round(fitScale * 100));
            } catch {
                if (svgContainerRef.current) {
                    svgContainerRef.current.innerHTML = `<pre style="color:#EF4444;font-size:11px;padding:16px;overflow:auto">${mermaidCode}</pre>`;
                }
            }
        }
        render();
    }, [mermaidCode, loading, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

    function zoomBy(factor) {
        if (!zoomRef.current || !wrapperRef.current) return;
        d3.select(wrapperRef.current).transition().duration(200)
            .call(zoomRef.current.scaleBy, factor);
    }

    function fitDiagram() {
        if (!zoomRef.current || !wrapperRef.current || !svgContainerRef.current) return;
        const svgEl = svgContainerRef.current.querySelector("svg");
        if (!svgEl) return;
        const naturalW = svgEl.clientWidth || 800;
        const naturalH = svgEl.clientHeight || 600;
        const wW = wrapperRef.current.clientWidth;
        const wH = wrapperRef.current.clientHeight;
        const fitScale = Math.min((wW - 80) / naturalW, (wH - 80) / naturalH, 1);
        const tx = (wW - naturalW * fitScale) / 2;
        const ty = (wH - naturalH * fitScale) / 2;
        d3.select(wrapperRef.current).transition().duration(300)
            .call(zoomRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(fitScale));
    }

    async function getSVGBlob() {
        const svgEl = svgContainerRef.current?.querySelector("svg");
        if (!svgEl) return null;
        const cloned = svgEl.cloneNode(true);
        const vb = svgEl.getAttribute("viewBox");
        let w, h;
        if (vb) {
            const parts = vb.split(/[\s,]+/);
            w = parseFloat(parts[2]);
            h = parseFloat(parts[3]);
        } else {
            w = svgEl.scrollWidth || 1200;
            h = svgEl.scrollHeight || 800;
        }
        cloned.setAttribute("width", w);
        cloned.setAttribute("height", h);
        cloned.querySelectorAll("style").forEach(s => {
            s.textContent = s.textContent
                .replace(/@import[^;]+;/g, "")
                .replace(/url\(['"]?https?[^)]+\)/g, "");
        });
        cloned.querySelectorAll("[href]").forEach(el => {
            if (el.getAttribute("href")?.startsWith("http")) el.removeAttribute("href");
        });
        const svgStr = new XMLSerializer().serializeToString(cloned);
        const encoded = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
        return { encoded, w, h };
    }

    function downloadPNG() {
        const bgColor = "#0B1220";
        getSVGBlob().then(result => {
            if (!result) return;
            const { encoded, w, h } = result;
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = w * 2;
                canvas.height = h * 2;
                const ctx = canvas.getContext("2d");
                ctx.fillStyle = bgColor;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.scale(2, 2);
                ctx.drawImage(img, 0, 0);
                const a = document.createElement("a");
                a.download = `${mode}-diagram-${repoUrl.split("/").pop()}.png`;
                a.href = canvas.toDataURL("image/png");
                a.click();
            };
            img.src = encoded;
        });
    }

    async function copyImage() {
        const bgColor = "#0B1220";
        const result = await getSVGBlob();
        if (!result) return;
        const { encoded, w, h } = result;
        const img = new Image();
        img.onload = async () => {
            const canvas = document.createElement("canvas");
            canvas.width = w * 2;
            canvas.height = h * 2;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.scale(2, 2);
            ctx.drawImage(img, 0, 0);
            canvas.toBlob(async (pngBlob) => {
                try {
                    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
                    setCopiedImg(true);
                    setTimeout(() => setCopiedImg(false), 2000);
                } catch { }
            });
        };
        img.src = encoded;
    }

    async function copyMermaid() {
        await navigator.clipboard.writeText(mermaidCode);
        setCopiedMermaid(true);
        setTimeout(() => setCopiedMermaid(false), 2000);
    }

    async function copyExplanation() {
        await navigator.clipboard.writeText(explanation);
        setCopiedText(true);
        setTimeout(() => setCopiedText(false), 2000);
    }

    const tabStyle = (active) => ({
        background: "transparent",
        border: "none",
        borderBottom: active ? "2px solid var(--accent-blue)" : "2px solid transparent",
        padding: "6px 12px",
        color: active ? "var(--text-primary)" : "var(--text-muted)",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        cursor: "pointer",
        transition: "var(--transition)",
    });

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
                    Generating diagram…
                </div>
            </div>
        );
    }

    return (
        <div className="workspace-content" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {/* Flow: function input */}
            {mode === "flow" && !mermaidCode && !loading && (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "var(--bg-secondary)" }}>
                    <div style={{ width: "min(480px, 100%)" }}>
                        <div style={{ marginBottom: 8, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                            Enter function name to trace
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                            <input
                                value={fnInput}
                                onChange={e => setFnInput(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && fnInput.trim() && fetchDiagram(fnInput.trim())}
                                placeholder="e.g. fetch_comments, handleSubmit, processOrder"
                                autoFocus
                                style={{
                                    flex: 1,
                                    background: "var(--bg-card)",
                                    border: "1px solid var(--border-color)",
                                    borderRadius: "var(--radius)",
                                    padding: "10px 14px",
                                    color: "var(--text-primary)",
                                    fontFamily: "var(--font-mono)",
                                    fontSize: 13,
                                    outline: "none",
                                    transition: "border-color 0.2s",
                                }}
                                onFocus={e => e.target.style.borderColor = "var(--accent-blue)"}
                                onBlur={e => e.target.style.borderColor = "var(--border-color)"}
                            />
                            <button
                                onClick={() => fnInput.trim() && fetchDiagram(fnInput.trim())}
                                style={{
                                    background: "var(--accent-blue)",
                                    color: "white",
                                    border: "none",
                                    borderRadius: "var(--radius)",
                                    padding: "10px 20px",
                                    fontFamily: "var(--font-mono)",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    transition: "var(--transition)",
                                }}
                            >
                                Trace →
                            </button>
                        </div>
                        {error && (
                            <div style={{ marginTop: 12, color: "#EF4444", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                                {error}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {!loading && mermaidCode && (
                <>
                    {/* Tabs */}
                    <div style={{
                        display: "flex",
                        alignItems: "center",
                        borderBottom: "1px solid var(--border-color)",
                        flexShrink: 0,
                        overflowX: "auto",
                        background: "var(--bg-tertiary)",
                        padding: "0 12px",
                        minHeight: 32,
                    }}>
                        <button style={tabStyle(activeTab === "diagram")} onClick={() => setActiveTab("diagram")}>Diagram</button>
                        <button style={tabStyle(activeTab === "explanation")} onClick={() => setActiveTab("explanation")}>Explanation</button>
                        <button style={tabStyle(activeTab === "code")} onClick={() => setActiveTab("code")}>Source</button>

                        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                            <button
                                onClick={downloadPNG}
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
                            >↓ PNG</button>
                            <button
                                onClick={copyImage}
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
                            >{copiedImg ? "✓" : "Copy"}</button>
                            <button
                                onClick={copyMermaid}
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
                            >{copiedMermaid ? "✓" : "Mermaid"}</button>
                            {mode === "flow" && (
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
                                    onClick={() => { setMermaidCode(""); setExplanation(""); setFnInput(""); setError(null); }}
                                >
                                    ← New
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Diagram Tab */}
                    {activeTab === "diagram" && (
                        <div style={{ flex: 1, position: "relative", overflow: "hidden", background: "var(--bg-secondary)" }}>
                            {/* Zoom controls */}
                            <div style={{
                                position: "absolute",
                                bottom: 12,
                                right: 12,
                                zIndex: 10,
                                display: "flex",
                                flexDirection: "column",
                                gap: 3,
                            }}>
                                {[
                                    ["+", () => zoomBy(1.3)],
                                    [`${scale}%`, fitDiagram],
                                    ["−", () => zoomBy(0.77)],
                                ].map(([label, fn]) => (
                                    <button key={label} onClick={fn} style={{
                                        background: "var(--bg-card)",
                                        border: "1px solid var(--border-color)",
                                        borderRadius: "var(--radius)",
                                        width: 24, height: 24,
                                        display: "grid", placeItems: "center",
                                        color: "var(--text-muted)",
                                        fontSize: label === "⊙" ? 10 : label === `${scale}%` ? 8 : 14,
                                        cursor: "pointer",
                                        fontFamily: "var(--font-mono)",
                                        transition: "var(--transition)",
                                    }}>
                                        {label}
                                    </button>
                                ))}
                            </div>

                            <div
                                ref={wrapperRef}
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    cursor: "grab",
                                    userSelect: "none",
                                    touchAction: "none"
                                }}
                            >
                                <div ref={svgContainerRef} style={{ transformOrigin: "0 0", display: "inline-block" }} />
                            </div>
                        </div>
                    )}

                    {/* Explanation Tab */}
                    {activeTab === "explanation" && (
                        <div style={{ flex: 1, overflow: "auto", padding: 16, background: "var(--bg-secondary)" }}>
                            <div style={{ maxWidth: 760, margin: "0 auto" }}>
                                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                                    <button
                                        onClick={copyExplanation}
                                        style={{
                                            background: "transparent",
                                            border: "1px solid var(--border-color)",
                                            borderRadius: "var(--radius)",
                                            padding: "2px 10px",
                                            color: copiedText ? "var(--accent-green)" : "var(--text-muted)",
                                            fontFamily: "var(--font-mono)",
                                            fontSize: 9,
                                            cursor: "pointer",
                                        }}
                                    >
                                        {copiedText ? "✓ Copied!" : "Copy"}
                                    </button>
                                </div>
                                <div style={{
                                    fontFamily: "var(--font-mono)",
                                    fontSize: 12,
                                    lineHeight: 1.8,
                                    color: "var(--text-secondary)",
                                    whiteSpace: "pre-wrap",
                                    background: "var(--bg-card)",
                                    border: "1px solid var(--border-color)",
                                    borderRadius: "var(--radius)",
                                    padding: 20,
                                }}>
                                    {explanation}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Source Tab */}
                    {activeTab === "code" && (
                        <div style={{ flex: 1, overflow: "auto", padding: 16, background: "var(--bg-secondary)" }}>
                            <div style={{ maxWidth: 760, margin: "0 auto" }}>
                                <pre style={{
                                    background: "var(--bg-card)",
                                    border: "1px solid var(--border-color)",
                                    borderRadius: "var(--radius)",
                                    padding: 16,
                                    fontFamily: "var(--font-mono)",
                                    fontSize: 11,
                                    color: "var(--text-secondary)",
                                    overflow: "auto",
                                    lineHeight: 1.6
                                }}>
                                    {mermaidCode}
                                </pre>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}