import { useState } from "react";
import RepositoryPanel from "./RepositoryPanel";
import GraphPanel from "./GraphPanel";
import DiagramPanel from "./DiagramPanel";
import ChatPanel from "./ChatPanel";
import GraphDiff from "./GraphDiff";

export default function Workspace({
    repoId,
    repoUrl,
    activeTab,
    proposalResult,
    isAnalyzing,
    onIngested,
    onStatusChange,
    feature,
    setFeature,
    proposalError,
    onPropose,
}) {
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    // No repo connected → show repository card centred in workspace
    if (!repoId) {
        return (
            <div className="workspace-container fade-in">
                <RepositoryPanel
                    onIngested={onIngested}
                    onStatusChange={onStatusChange}
                    feature={feature}
                    setFeature={setFeature}
                />
            </div>
        );
    }

    const renderPanel = () => {
        switch (activeTab) {
            case "graph":
                // NOTE: proposalResult is intentionally NOT passed — the base graph
                // should never be coloured by proposal diffs.
                return (
                    <GraphPanel
                        repoId={repoId}
                        repoUrl={repoUrl}
                    />
                );
            case "architecture":
                // Architecture diagram is also unaffected by proposals
                return (
                    <DiagramPanel
                        repoId={repoId}
                        repoUrl={repoUrl}
                        mode="architecture"
                    />
                );
            case "chat":
                return (
                    <ChatPanel
                        repoId={repoId}
                        repoUrl={repoUrl}
                    />
                );
            default:
                return null;
        }
    };

    return (
        <div className="workspace-container" style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%" }}>
            {/* AI analysis overlay — blurs graph while thinking */}
            {isAnalyzing && (
                <div className="workspace-analyzing-overlay">
                    <div className="workspace-analyzing-content">
                        <div className="thinking-dot" style={{ width: 10, height: 10 }} />
                        <div className="thinking-dot" style={{ width: 10, height: 10 }} />
                        <div className="thinking-dot" style={{ width: 10, height: 10 }} />
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--accent-blue)", marginLeft: 10 }}>
                            AI analyzing architecture…
                        </span>
                    </div>
                </div>
            )}

            {/* Active tab content at top */}
            <div style={{ flex: 1, position: "relative", minHeight: 0, filter: isAnalyzing ? "blur(3px) brightness(0.6)" : "none", transition: "filter 0.4s ease" }}>
                {renderPanel()}
            </div>

            {/* Bottom Propose Feature Button Bar */}
            <div className="workspace-bottom-feature-bar" style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                padding: "10px 16px",
                borderTop: "1px solid var(--border-color)",
                background: "var(--bg-tertiary)",
                flexShrink: 0,
            }}>
                <button
                    className="feature-drawer-trigger-btn"
                    onClick={() => setIsDrawerOpen(true)}
                    style={{
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius)",
                        padding: "8px 24px",
                        color: "var(--text-primary)",
                        fontFamily: "var(--font-sans)",
                        fontWeight: "600",
                        fontSize: "12px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        transition: "var(--transition)",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.2)"
                    }}
                >
                    <span>⚡</span>
                    Propose Feature
                </button>
            </div>

            {/* Premium Fullscreen Drawer Overlay */}
            {isDrawerOpen && (
                <div className="feature-drawer-overlay fade-in">
                    <div className="feature-drawer-content slide-up">
                        {/* Header */}
                        <div className="drawer-header" style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "14px 20px",
                            borderBottom: "1px solid var(--border-color)",
                            background: "var(--bg-tertiary)"
                        }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <span style={{ fontSize: "16px" }}>⚡</span>
                                <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--text-primary)" }}>New Feature Architecture Preview</span>
                            </div>
                            <button
                                onClick={() => setIsDrawerOpen(false)}
                                style={{
                                    background: "transparent",
                                    border: "none",
                                    color: "var(--text-muted)",
                                    fontSize: "24px",
                                    lineHeight: "1",
                                    cursor: "pointer",
                                    padding: "0 6px",
                                    transition: "var(--transition)"
                                }}
                                title="Close Preview"
                            >
                                ×
                            </button>
                        </div>

                        {/* Drawer Body */}
                        <div className="drawer-body" style={{
                            display: "flex",
                            flex: 1,
                            minHeight: 0,
                            overflow: "hidden"
                        }}>
                            {/* Left Side: Controls, Reasoning & Impact Stats */}
                            <div className="drawer-sidebar-pane" style={{
                                width: "420px",
                                borderRight: "1px solid var(--border-color)",
                                background: "var(--bg-tertiary)",
                                padding: "20px",
                                overflowY: "auto",
                                display: "flex",
                                flexDirection: "column",
                                gap: "24px",
                                flexShrink: 0
                            }}>
                                <div className="drawer-section">
                                    <div className="col-header" style={{ marginBottom: "10px" }}>Describe Feature Request</div>
                                    <textarea
                                        value={feature}
                                        onChange={(e) => setFeature(e.target.value)}
                                        placeholder="Describe the feature you want to add..."
                                        className="feature-textarea"
                                        style={{ height: "100px", resize: "none", fontSize: "12px", width: "100%", boxSizing: "border-box" }}
                                        disabled={isAnalyzing}
                                    />
                                    <button
                                        className="feature-submit-btn"
                                        onClick={() => onPropose(repoId, feature)}
                                        disabled={isAnalyzing || !feature.trim()}
                                        style={{ width: "100%", marginTop: "12px", padding: "8px" }}
                                    >
                                        {isAnalyzing ? "⏳ Proposing..." : "⚡ Propose Feature"}
                                    </button>
                                    {proposalError && (
                                        <div className="feature-status error" style={{ marginTop: "10px", padding: "6px 10px", fontSize: "11px" }}>
                                            ✗ {proposalError}
                                        </div>
                                    )}
                                </div>

                                {proposalResult && (
                                    <>
                                        <div className="drawer-section" style={{ borderTop: "1px solid var(--border-color)", paddingTop: "20px" }}>
                                            <div className="col-header" style={{ marginBottom: "10px" }}>🤖 AI Reasoning</div>
                                            <div className="reasoning-text" style={{ fontSize: "11px", lineHeight: "1.6", color: "var(--text-secondary)", maxHeight: "150px", overflowY: "auto" }}>
                                                {proposalResult.rationale}
                                            </div>
                                        </div>

                                        <div className="drawer-section" style={{ borderTop: "1px solid var(--border-color)", paddingTop: "20px" }}>
                                            <div className="col-header" style={{ marginBottom: "10px" }}>📋 Implementation Plan</div>
                                            <div className="plan-list" style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "220px", overflowY: "auto", paddingRight: "4px" }}>
                                                {(proposalResult.implementation_plan || []).map((step, idx) => (
                                                    <div key={idx} style={{
                                                        background: "var(--bg-secondary)",
                                                        border: "1px solid var(--border-color)",
                                                        borderRadius: "var(--radius)",
                                                        padding: "8px 12px",
                                                        fontSize: "11px",
                                                        color: "var(--text-secondary)",
                                                        lineHeight: "1.5"
                                                    }}>
                                                        <strong style={{ color: "var(--accent-blue)", display: "block", marginBottom: "4px" }}>Step {idx + 1}</strong>
                                                        {step}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="drawer-section" style={{ borderTop: "1px solid var(--border-color)", paddingTop: "20px" }}>
                                            <div className="col-header" style={{ marginBottom: "10px" }}>📊 Architecture Impact</div>
                                            <div className="impact-stat-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                                                <div className="impact-stat" style={{ padding: "6px 10px" }}>
                                                    <div className="value" style={{ fontSize: "16px" }}>{proposalResult.diff_summary?.added_nodes ?? 0}</div>
                                                    <div className="label" style={{ fontSize: "8px" }}>New Nodes</div>
                                                </div>
                                                <div className="impact-stat" style={{ padding: "6px 10px" }}>
                                                    <div className="value orange" style={{ fontSize: "16px" }}>{proposalResult.diff_summary?.modified_nodes ?? 0}</div>
                                                    <div className="label" style={{ fontSize: "8px" }}>Modified</div>
                                                </div>
                                                <div className="impact-stat" style={{ padding: "6px 10px" }}>
                                                    <div className="value blue" style={{ fontSize: "16px" }}>{proposalResult.diff_summary?.added_edges ?? 0}</div>
                                                    <div className="label" style={{ fontSize: "8px" }}>New Edges</div>
                                                </div>
                                                <div className="impact-stat" style={{ padding: "6px 10px" }}>
                                                    <div className="value" style={{ color: "var(--text-muted)", fontSize: "16px" }}>
                                                        {proposalResult.diff_summary?.estimated_hours ? `~${proposalResult.diff_summary.estimated_hours}h` : "—"}
                                                    </div>
                                                    <div className="label" style={{ fontSize: "8px" }}>Est. Hours</div>
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Right Side: Graph Diff Panel */}
                            <div className="drawer-graph-pane" style={{
                                flex: 1,
                                height: "100%",
                                position: "relative",
                                background: "var(--bg-secondary)"
                            }}>
                                {proposalResult ? (
                                    <GraphDiff proposalResult={proposalResult} />
                                ) : (
                                    <div className="empty-state" style={{ height: "100%" }}>
                                        <div className="empty-state-icon">⚡</div>
                                        <div className="empty-state-title">No Diff Generated Yet</div>
                                        <div className="empty-state-desc">
                                            Describe your feature request on the left and click 'Propose Feature' to generate the diff graph preview.
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}