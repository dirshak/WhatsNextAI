// src/components/FeatureSidebar.jsx
import { useState, useRef } from "react";

const API = process.env.REACT_APP_API_URL || "http://localhost:8000/api";

export default function FeatureSidebar({ repoId, onProposal, onAnalyzing }) {
    const [feature, setFeature] = useState("");
    const [status, setStatus] = useState("idle");
    const [errorMsg, setErrorMsg] = useState("");
    const textareaRef = useRef(null);

    async function handlePropose() {
        if (!feature.trim() || status === "loading") return;
        setStatus("loading");
        setErrorMsg("");
        if (onAnalyzing) onAnalyzing();

        try {
            const res = await fetch(`${API}/propose-feature`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ repo_id: repoId, feature: feature.trim() }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || data.error || "Request failed");
            setStatus("done");
            if (onProposal) onProposal(data);
        } catch (err) {
            setStatus("error");
            setErrorMsg(err.message || "Failed to propose feature.");
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

    return (
        <div className="feature-sidebar">
            <div className="feature-sidebar-header">
                <h3>
                    ⚡ Feature Request
                    <span className="badge">AI-Powered</span>
                </h3>
            </div>

            <div className="feature-sidebar-body">
                <textarea
                    ref={textareaRef}
                    className="feature-textarea"
                    value={feature}
                    onChange={e => setFeature(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Describe the feature you want to add…"
                />
                <div className="feature-shortcut">Ctrl+Enter to submit</div>

                <div className="feature-examples">
                    <div className="feature-examples-label">Quick Ideas</div>
                    {examples.map(ex => (
                        <button
                            key={ex}
                            className="feature-example-btn"
                            onClick={() => setFeature(ex)}
                        >
                            + {ex}
                        </button>
                    ))}
                </div>

                {status === "loading" && (
                    <div className="feature-status loading">
                        <div className="spinner" style={{ width: 14, height: 14 }} />
                        Analysing architecture and proposing changes…
                    </div>
                )}

                {status === "error" && (
                    <div className="feature-status error">✗ {errorMsg}</div>
                )}

                {status === "done" && (
                    <div className="feature-status success">
                        ✓ Proposal applied — architecture updated below.
                    </div>
                )}
            </div>

            <div className="feature-sidebar-footer">
                <button
                    className="feature-submit-btn"
                    onClick={handlePropose}
                    disabled={status === "loading" || !feature.trim()}
                >
                    {status === "loading" ? "Proposing…" : "⚡ Propose Feature"}
                </button>
            </div>
        </div>
    );
}