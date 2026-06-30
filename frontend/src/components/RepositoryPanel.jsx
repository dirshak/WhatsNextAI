// src/components/RepositoryPanel.jsx
import { useState, useEffect, useRef } from "react";
import { API } from '../config';
import Logo from './Logo';

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
            {/* Ambient background glows */}
            <div className="glow-blob-container">
                <div className="glow-blob glow-blob-blue" />
                <div className="glow-blob glow-blob-purple" />
                <div className="glow-blob glow-blob-cyan" />
            </div>

            <div className="repo-card">
                {/* Branding: logo + title + tagline in one centered row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "14px", marginBottom: "24px" }}>
                    <div className="repo-card-logo-wrapper" style={{ margin: 0, flexShrink: 0 }}>
                        <Logo className="repo-card-logo-img" />
                    </div>
                    <div>
                        <h1 style={{ fontSize: "22px", fontWeight: "800", color: "var(--text-primary)", margin: "0 0 4px 0", fontFamily: "var(--font-sans)", lineHeight: 1.2 }}>What's Next?</h1>
                        <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0, fontFamily: "var(--font-sans)", fontStyle: "italic", lineHeight: 1.4 }}>
                            "Propose. Preview. Implement. See the Change Before You Build It."
                        </p>
                    </div>
                </div>

                {/* Project description */}
                <p style={{ fontSize: "12px", lineHeight: "1.6", color: "var(--text-secondary)", margin: "0 0 20px 0", fontFamily: "var(--font-sans)" }}>
                    An AI-powered platform that turns feature ideas into architectural evolution — propose changes in natural language, instantly preview how your system adapts, and generate clear implementation plans with suggested files, services, and functions.
                </p>

                {/* Divider */}
                <div style={{ borderTop: "1px solid var(--border-color)", marginBottom: "20px" }} />

                {/* Repository URL */}
                <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Connect GitHub Repository
                </div>
                <div className="repo-input-group" style={{ marginBottom: "12px" }}>
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

                {/* Status */}
                <div className="repo-status" style={{ minHeight: "18px", marginBottom: "16px" }}>
                    {status === "loading" && (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <div className="spinner" />
                            <span>{progress}</span>
                        </div>
                    )}
                    {status === "error" && <span className="error">❌ {errorMsg}</span>}
                    {status === "done"  && <span className="success">✓ Repository ingested successfully.</span>}
                </div>

                {/* Feature textarea */}
                <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "16px" }}>
                    <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        New Feature <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(optional)</span>
                    </div>
                    <textarea
                        value={feature}
                        onChange={(e) => setFeature(e.target.value)}
                        placeholder="Describe the feature you want to add…"
                        className="feature-textarea"
                        style={{ width: "100%", minHeight: "72px", marginBottom: "0", resize: "vertical" }}
                    />
                </div>
            </div>
        </div>
    );
}