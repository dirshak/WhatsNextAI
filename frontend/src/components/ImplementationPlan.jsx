// src/components/ImplementationPlan.jsx
import { useState } from "react";

export default function ImplementationPlan({ result, onClose }) {
    const [tab, setTab] = useState("plan");

    const tabs = [
        { id: "plan", label: "Implementation Plan" },
        { id: "rationale", label: "Rationale" },
        { id: "diff", label: "Diff" },
    ];

    return (
        <div className="plan-panel">
            <div className="plan-panel-header">
                <h4>
                    <span style={{ color: "var(--accent-green)" }}>●</span>
                    Implementation Plan
                </h4>
                <button
                    onClick={onClose}
                    style={{
                        background: "transparent",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius)",
                        padding: "4px 10px",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        fontSize: 11,
                        fontFamily: "var(--font-mono)",
                    }}
                >
                    ✕ Close
                </button>
            </div>

            <div style={{
                display: "flex",
                gap: 4,
                padding: "0 16px",
                background: "var(--bg-tertiary)",
                borderBottom: "1px solid var(--border-color)",
                flexShrink: 0,
            }}>
                {tabs.map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        style={{
                            background: "transparent",
                            border: "none",
                            borderBottom: tab === t.id ? "2px solid var(--accent-blue)" : "2px solid transparent",
                            padding: "8px 14px",
                            color: tab === t.id ? "var(--text-primary)" : "var(--text-muted)",
                            fontFamily: "var(--font-mono)",
                            fontSize: 11,
                            cursor: "pointer",
                            transition: "all 0.15s",
                        }}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <div className="plan-panel-body">
                {tab === "plan" && (
                    <>
                        <div style={{
                            fontSize: 11,
                            color: "var(--text-muted)",
                            fontFamily: "var(--font-mono)",
                            marginBottom: 12,
                        }}>
                            {result.implementation_plan?.length || 0} steps
                            {result.diff_summary && (
                                <span style={{ marginLeft: 16 }}>
                                    +{result.diff_summary.added_nodes} nodes ·
                                    +{result.diff_summary.added_edges} edges
                                    {result.diff_summary.estimated_hours > 0 &&
                                        ` · ~${result.diff_summary.estimated_hours}h`
                                    }
                                </span>
                            )}
                        </div>

                        {(result.implementation_plan || []).map((step, i) => (
                            <div key={i} className="plan-step">
                                <span className="num">{i + 1}.</span>
                                <span className="content">{step}</span>
                            </div>
                        ))}

                        <div className="plan-stats">
                            {[
                                { label: "Added Nodes", value: result.diff_summary?.added_nodes, color: "var(--accent-green)" },
                                { label: "Modified Nodes", value: result.diff_summary?.modified_nodes, color: "var(--accent-orange)" },
                                { label: "Added Edges", value: result.diff_summary?.added_edges, color: "var(--accent-blue)" },
                                { label: "Est. Hours", value: result.diff_summary?.estimated_hours, color: "var(--text-muted)" },
                            ].map(item => (
                                <div key={item.label} className="plan-stat">
                                    <div className="value" style={{ color: item.color }}>
                                        {item.value ?? "—"}
                                    </div>
                                    <div className="label">{item.label}</div>
                                </div>
                            ))}
                        </div>

                        {(result.warnings || []).length > 0 && (
                            <div style={{ marginTop: 16 }}>
                                <div style={{
                                    fontSize: 10,
                                    color: "var(--accent-orange)",
                                    fontFamily: "var(--font-mono)",
                                    letterSpacing: "0.08em",
                                    marginBottom: 6,
                                }}>
                                    ⚠ Warnings
                                </div>
                                {result.warnings.map((w, i) => (
                                    <div key={i} style={{
                                        padding: "8px 12px",
                                        marginBottom: 4,
                                        background: "rgba(245, 158, 11, 0.08)",
                                        border: "1px solid rgba(245, 158, 11, 0.2)",
                                        borderRadius: "var(--radius)",
                                        fontSize: 11,
                                        fontFamily: "var(--font-mono)",
                                        color: "var(--accent-orange)",
                                    }}>
                                        {w}
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}

                {tab === "rationale" && (
                    <div style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 13,
                        color: "var(--text-secondary)",
                        lineHeight: 1.8,
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius)",
                        padding: 20,
                        maxWidth: 720,
                    }}>
                        {result.rationale || "No rationale provided."}
                    </div>
                )}

                {tab === "diff" && result.diff_summary && (
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                        {[
                            { label: "Added Nodes", value: result.diff_summary.added_nodes, color: "var(--accent-green)" },
                            { label: "Modified Nodes", value: result.diff_summary.modified_nodes, color: "var(--accent-orange)" },
                            { label: "Added Edges", value: result.diff_summary.added_edges, color: "var(--accent-blue)" },
                            { label: "Complexity", value: result.diff_summary.complexity, color: "var(--accent-purple)" },
                            { label: "Est. Hours", value: result.diff_summary.estimated_hours, color: "var(--text-muted)" },
                        ].map(item => (
                            <div key={item.label} className="plan-stat">
                                <div className="value" style={{ color: item.color }}>
                                    {item.value ?? "—"}
                                </div>
                                <div className="label">{item.label}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}