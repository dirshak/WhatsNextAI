// src/components/FeatureSidebar.jsx
import { useState, useRef } from "react";

const API = process.env.REACT_APP_API_URL || "http://localhost:8000/api";

function Section({ icon, title, badge, badgeVariant = "blue", defaultOpen = true, children }) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className={`sidebar-section expandable ${open ? "expanded" : ""}`}>
            <div className="sidebar-section-header" onClick={() => setOpen(o => !o)}>
                <div className="sidebar-section-title">
                    <span className="sidebar-section-icon">{icon}</span>
                    {title}
                    {badge && (
                        <span className={`sidebar-section-badge ${badgeVariant}`}>{badge}</span>
                    )}
                </div>
                <span className={`sidebar-section-chevron ${open ? "open" : ""}`}>›</span>
            </div>
            {open && (
                <div className="sidebar-section-body">
                    {children}
                </div>
            )}
        </div>
    );
}

export default function FeatureSidebar({
    repoId,
    repoUrl,
    repoStatus,
    proposalResult,
    isAnalyzing,
    feature,
    setFeature,
    status,
    setStatus,
    errorMsg,
    setErrorMsg,
    onPropose,
}) {
    const textareaRef = useRef(null);

    async function handlePropose() {
        if (onPropose) {
            onPropose(repoId, feature);
        }
    }

    function handleKeyDown(e) {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            handlePropose();
        }
    }

    const examples = [
        "Add OAuth2 login",
        "Add Redis caching layer",
        "Add rate limiting middleware",
        "Add WebSocket support",
        "Add admin dashboard",
    ];

    const shortUrl = repoUrl ? repoUrl.replace("https://github.com/", "") : null;
    const diff = proposalResult?.diff_summary;

    const repoStatusDotClass = !repoId
        ? "idle"
        : repoStatus === "loading"
        ? "loading"
        : repoStatus === "error"
        ? "error"
        : "";

    return (
        <div className="feature-sidebar">

            {/* ── 1. Repository Status ── */}
            <Section icon="📁" title="Repository" defaultOpen={true}>
                <div className="repo-status-row">
                    <span className="label">Status</span>
                    <span className={`repo-status-dot-sm ${repoStatusDotClass}`} />
                    <span className="value">
                        {!repoId
                            ? "Not connected"
                            : repoStatus === "loading"
                            ? "Ingesting…"
                            : repoStatus === "error"
                            ? "Error"
                            : "Connected"}
                    </span>
                </div>
                {shortUrl && (
                    <div className="repo-status-row">
                        <span className="label">Repo</span>
                        <span className="value" title={repoUrl}>{shortUrl}</span>
                    </div>
                )}
                {diff && (
                    <>
                        <div className="repo-status-row">
                            <span className="label">Nodes +</span>
                            <span className="value" style={{ color: "var(--accent-green)" }}>
                                {diff.added_nodes ?? 0}
                            </span>
                        </div>
                        <div className="repo-status-row">
                            <span className="label">Edges +</span>
                            <span className="value" style={{ color: "var(--accent-blue)" }}>
                                {diff.added_edges ?? 0}
                            </span>
                        </div>
                    </>
                )}
            </Section>

            {/* ── 2. Feature Request ── */}
            <Section icon="⚡" title="Feature Request" badge="AI-Powered" defaultOpen={true}>
                {!repoId ? (
                    <div style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 8,
                        padding: "20px 0",
                        textAlign: "center",
                    }}>
                        <div style={{ fontSize: 24, opacity: 0.4 }}>🔗</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", lineHeight: 1.6 }}>
                            Connect a repository first to propose features.
                        </div>
                    </div>
                ) : (
                    <>
                        {isAnalyzing && (
                            <div className="thinking-indicator">
                                <div className="thinking-dot" />
                                <div className="thinking-dot" />
                                <div className="thinking-dot" />
                                Analysing architecture…
                            </div>
                        )}

                        <textarea
                            ref={textareaRef}
                            className="feature-textarea"
                            value={feature}
                            onChange={e => setFeature(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Describe the feature you want to add…"
                            disabled={isAnalyzing}
                        />
                        <div className="feature-shortcut">Ctrl+Enter to submit</div>

                        <div className="feature-examples">
                            <div className="feature-examples-label">Quick Ideas</div>
                            {examples.map(ex => (
                                <button
                                    key={ex}
                                    className="feature-example-btn"
                                    onClick={() => setFeature(ex)}
                                    disabled={isAnalyzing}
                                >
                                    + {ex}
                                </button>
                            ))}
                        </div>

                        {status === "error" && (
                            <div className="feature-status error">✗ {errorMsg}</div>
                        )}

                        {status === "done" && !isAnalyzing && (
                            <div className="feature-status success">
                                ✓ Proposal applied — architecture updated.
                            </div>
                        )}
                    </>
                )}
            </Section>

            {/* ── 3. AI Reasoning ── */}
            <Section
                icon="🤖"
                title="AI Reasoning"
                badge={proposalResult ? "Ready" : null}
                badgeVariant="green"
                defaultOpen={!!proposalResult}
            >
                {proposalResult?.rationale ? (
                    <div className="reasoning-text">{proposalResult.rationale}</div>
                ) : (
                    <div style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        fontFamily: "var(--font-mono)",
                        textAlign: "center",
                        padding: "8px 0",
                    }}>
                        No proposal yet
                    </div>
                )}
            </Section>

            {/* ── 4. Architecture Impact ── */}
            <Section
                icon="📊"
                title="Architecture Impact"
                badge={diff ? `+${(diff.added_nodes || 0) + (diff.added_edges || 0)}` : null}
                badgeVariant="green"
                defaultOpen={!!diff}
            >
                {diff ? (
                    <div className="impact-stat-grid">
                        <div className="impact-stat">
                            <div className="value">{diff.added_nodes ?? 0}</div>
                            <div className="label">New Nodes</div>
                        </div>
                        <div className="impact-stat">
                            <div className="value orange">{diff.modified_nodes ?? 0}</div>
                            <div className="label">Modified</div>
                        </div>
                        <div className="impact-stat">
                            <div className="value blue">{diff.added_edges ?? 0}</div>
                            <div className="label">New Edges</div>
                        </div>
                        <div className="impact-stat">
                            <div className="value" style={{ color: "var(--text-muted)", fontSize: 14 }}>
                                {diff.estimated_hours ? `~${diff.estimated_hours}h` : "—"}
                            </div>
                            <div className="label">Est. Hours</div>
                        </div>
                    </div>
                ) : (
                    <div style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        fontFamily: "var(--font-mono)",
                        textAlign: "center",
                        padding: "8px 0",
                    }}>
                        No impact data yet
                    </div>
                )}
            </Section>

            {/* ── Submit button (always at bottom) ── */}
            <div className="feature-sidebar-footer">
                <button
                    className="feature-submit-btn"
                    onClick={handlePropose}
                    disabled={status === "loading" || !feature.trim() || !repoId || isAnalyzing}
                >
                    {isAnalyzing ? "⏳ Analysing…" : status === "loading" ? "⏳ Proposing…" : "⚡ Propose Feature"}
                </button>
            </div>
        </div>
    );
}