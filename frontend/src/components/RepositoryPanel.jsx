// src/components/RepositoryPanel.jsx
import { useState, useEffect, useRef } from "react";

const API = process.env.REACT_APP_API_URL || "http://localhost:8000/api";

const GITHUB_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?\/?$/;

export default function RepositoryPanel({ onIngested, onStatusChange, feature, setFeature }) {
    const [url, setUrl] = useState("");
    const [status, setStatus] = useState("idle"); // idle | loading | done | error
    const [progress, setProgress] = useState("");
    const [errorMsg, setErrorMsg] = useState("");
    const pollRef = useRef(null);

    useEffect(() => {
        return () => {
            if (pollRef.current) clearTimeout(pollRef.current);
        };
    }, []);

    const handleIngest = async (targetUrl = url) => {
        const trimmedUrl = targetUrl.trim();
        if (!trimmedUrl) {
            setStatus("error");
            setErrorMsg("Please enter a repository URL.");
            return;
        }

        if (!GITHUB_RE.test(trimmedUrl)) {
            setStatus("error");
            setErrorMsg("URL must be a valid GitHub repository (e.g., https://github.com/owner/repo).");
            return;
        }

        setStatus("loading");
        setProgress("Starting ingestion…");
        setErrorMsg("");
        if (onStatusChange) onStatusChange("loading");

        try {
            const res = await fetch(`${API}/ingest`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ repo_url: trimmedUrl }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || data.error || "Request failed");
            const { job_id } = data;

            const poll = () => {
                fetch(`${API}/ingest/status/${job_id}`)
                    .then((r) => {
                        if (!r.ok) {
                            return r.json().then((e) => {
                                throw new Error(e.detail || "Status check failed");
                            });
                        }
                        return r.json();
                    })
                    .then((s) => {
                        if (s.status === "done") {
                            setStatus("done");
                            if (onStatusChange) onStatusChange("done");
                            onIngested(s.repo_id, trimmedUrl);
                        } else if (s.status === "error") {
                            setStatus("error");
                            setErrorMsg(s.error || "Ingestion failed.");
                            if (onStatusChange) onStatusChange("error");
                        } else {
                            setProgress(s.progress || "Processing…");
                            pollRef.current = setTimeout(poll, 2000);
                        }
                    })
                    .catch((err) => {
                        setStatus("error");
                        setErrorMsg(err.message || "Lost connection to server. Please try again.");
                        if (onStatusChange) onStatusChange("error");
                    });
            };
            pollRef.current = setTimeout(poll, 1000);
        } catch (err) {
            setStatus("error");
            setErrorMsg(err.message || "Failed to start ingestion.");
            if (onStatusChange) onStatusChange("error");
        }
    };

    return (
        <div className="repo-card-wrapper">
            <div className="repo-card" style={{ maxWidth: "600px", width: "100%" }}>
                <div className="repo-card-header" style={{ marginBottom: "16px" }}>
                    <div className="repo-card-icon">🔗</div>
                    <div>
                        <div className="repo-card-title">Connect Repository</div>
                    </div>
                </div>

                {/* Description */}
                <p style={{
                    fontSize: "12px",
                    lineHeight: "1.65",
                    color: "var(--text-secondary)",
                    marginBottom: "24px",
                    fontFamily: "var(--font-sans)"
                }}>
                    GraphForgeAI is an AI-powered software architecture evolution platform that analyzes GitHub repositories, extracts their architecture, and visualizes relationships between folders, files, services, classes and functions. Users can understand unfamiliar codebases, propose new features in natural language, preview architectural changes, compare before/after graphs, generate implementation plans, and receive production-ready code suggestions—all from a single interactive workspace.
                </p>

                {/* Ingestion Link Group */}
                <div className="repo-input-group" style={{ marginBottom: "20px" }}>
                    <input
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleIngest()}
                        placeholder="https://github.com/owner/repo"
                        className="repo-input"
                        disabled={status === "loading"}
                        id="repo-url-input"
                    />
                    <button
                        onClick={() => handleIngest()}
                        disabled={status === "loading" || !url.trim()}
                        className="repo-btn"
                        id="repo-ingest-btn"
                    >
                        {status === "loading" ? "Ingesting…" : "Analyse →"}
                    </button>
                </div>

                {/* Ingest Status */}
                <div className="repo-status" style={{ marginBottom: "20px", minHeight: "0px" }}>
                    {status === "loading" && (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <div className="spinner" />
                            <span>{progress}</span>
                        </div>
                    )}
                    {status === "error" && (
                        <span className="error">❌ {errorMsg}</span>
                    )}
                    {status === "done" && (
                        <span className="success">✓ Repository ingested successfully.</span>
                    )}
                </div>

                {/* New Feature text block below itself */}
                <div style={{
                    borderTop: "1px solid var(--border-color)",
                    paddingTop: "20px"
                }}>
                    <div style={{
                        fontSize: "11px",
                        fontFamily: "var(--font-mono)",
                        fontWeight: "600",
                        color: "var(--text-secondary)",
                        marginBottom: "8px",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em"
                    }}>
                        New Feature
                    </div>
                    <textarea
                        value={feature}
                        onChange={(e) => setFeature(e.target.value)}
                        placeholder="Describe the feature you want to add eventually..."
                        className="feature-textarea"
                        style={{
                            width: "100%",
                            minHeight: "100px",
                            marginBottom: "8px"
                        }}
                    />
                    <div style={{
                        fontSize: "10px",
                        fontFamily: "var(--font-mono)",
                        color: "var(--text-muted)"
                    }}>
                        New feature should include (Graph diff, Plan).
                    </div>
                </div>
            </div>
        </div>
    );
}