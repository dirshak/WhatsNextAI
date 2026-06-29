// src/components/RepositoryPanel.jsx
import { useState, useEffect, useRef } from "react";

const API = process.env.REACT_APP_API_URL || "http://localhost:8000/api";

const GITHUB_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?\/?$/;

export default function RepositoryPanel({ onIngested }) {
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
            setErrorMsg("URL must be a valid GitHub repository URL (e.g., https://github.com/owner/repo).");
            return;
        }

        setStatus("loading");
        setProgress("Starting ingestion…");
        setErrorMsg("");

        try {
            const res = await fetch(`${API}/ingest`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ repo_url: trimmedUrl }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || data.error || "Request failed");
            const { job_id, repo_id } = data;

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
                            onIngested(s.repo_id, trimmedUrl);
                        } else if (s.status === "error") {
                            setStatus("error");
                            setErrorMsg(s.error || "Ingestion failed.");
                        } else {
                            setProgress(s.progress || "Processing…");
                            pollRef.current = setTimeout(poll, 2000);
                        }
                    })
                    .catch((err) => {
                        setStatus("error");
                        setErrorMsg(err.message || "Lost connection to server. Please try again.");
                    });
            };
            pollRef.current = setTimeout(poll, 1000);
        } catch (err) {
            setStatus("error");
            setErrorMsg(err.message || "Failed to start ingestion.");
        }
    };

    const examples = [
        "https://github.com/fastapi/fastapi",
        "https://github.com/pallets/flask",
        "https://github.com/django/django",
    ];

    return (
        <div className="repo-panel">
            <h1>
                Ask anything about <span className="highlight">any codebase.</span>
            </h1>
            <p className="subtitle">
                Paste a GitHub URL → ask natural language questions → get precise answers with file references.
            </p>

            <div className="repo-input-group">
                <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleIngest()}
                    placeholder="https://github.com/owner/repo"
                    className="repo-input"
                    disabled={status === "loading"}
                />
                <button
                    onClick={() => handleIngest()}
                    disabled={status === "loading" || !url.trim()}
                    className="repo-btn"
                >
                    {status === "loading" ? "Ingesting…" : "Ingest →"}
                </button>
            </div>

            {status !== "idle" && (
                <div className="repo-status">
                    {status === "loading" && (
                        <>
                            <div className="spinner" />
                            <span>{progress}</span>
                        </>
                    )}
                    {status === "error" && (
                        <span className="error">
                            ❌ {errorMsg}
                        </span>
                    )}
                    {status === "done" && (
                        <span className="success">✓ Repo ingested successfully.</span>
                    )}
                </div>
            )}

            <div className="repo-examples">
                <div className="repo-examples-label">Example Repositories</div>
                {examples.map((exUrl) => (
                    <div
                        key={exUrl}
                        className="repo-example"
                        onClick={() => {
                            if (status !== "loading") {
                                setUrl(exUrl);
                                handleIngest(exUrl);
                            }
                        }}
                    >
                        {exUrl.replace("https://github.com/", "")}
                    </div>
                ))}
            </div>
        </div>
    );
}