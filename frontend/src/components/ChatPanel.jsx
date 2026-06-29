// src/components/ChatPanel.jsx
import ReactMarkdown from 'react-markdown';
import { useState, useEffect, useRef } from "react";
import MermaidBlock from './MermaidBlock';

const API = process.env.REACT_APP_API_URL || "http://localhost:8000/api";

export default function ChatPanel({ repoId, repoUrl, theme }) {
    const [question, setQuestion] = useState("");
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(false);
    const bottomRef = useRef(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, loading]);

    async function handleQuery() {
        if (!question.trim() || loading) return;
        const q = question;
        setQuestion("");
        setMessages(prev => [...prev, { role: "user", text: q }]);
        setLoading(true);
        try {
            const res = await fetch(`${API}/query`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ repo_id: repoId, question: q }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail);
            setMessages(prev => [...prev, {
                role: "assistant",
                text: data.answer,
                sources: data.sources,
                mermaid: data.mermaid || null,
            }]);
        } catch {
            setMessages(prev => [...prev, { role: "assistant", text: "Something went wrong. Please try again.", error: true }]);
        } finally {
            setLoading(false);
        }
    }

    function exportTxt() {
        const lines = messages.map(m => {
            const role = m.role === "user" ? "You" : "Assistant";
            const sources = m.sources?.length ? `\nSources: ${m.sources.join(", ")}` : "";
            return `[${role}]\n${m.text}${sources}`;
        });
        const blob = new Blob([lines.join("\n\n---\n\n")], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `chat-${repoUrl.split("/").pop()}.txt`; a.click();
        URL.revokeObjectURL(url);
    }

    function exportCsv() {
        const header = "role,message,sources";
        const rows = messages.map(m => {
            const msg = `"${m.text.replace(/"/g, '""')}"`;
            const srcs = `"${(m.sources || []).join("; ")}"`;
            return `${m.role},${msg},${srcs}`;
        });
        const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `chat-${repoUrl.split("/").pop()}.csv`; a.click();
        URL.revokeObjectURL(url);
    }

    return (
        <div className="workspace-content" style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            background: "var(--bg-secondary)",
        }}>
            {/* Chat header */}
            <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 16px",
                borderBottom: "1px solid var(--border-color)",
                flexShrink: 0,
                background: "var(--bg-tertiary)",
                minHeight: 40,
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>Repository Chat</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
                        {repoUrl.replace("https://github.com/", "")}
                    </span>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                    {messages.length > 0 && (
                        <>
                            <button
                                onClick={exportTxt}
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
                            >
                                .txt
                            </button>
                            <button
                                onClick={exportCsv}
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
                            >
                                .csv
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Messages */}
            <div style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: "12px 16px",
            }}>
                {messages.length === 0 && (
                    <div style={{
                        color: "var(--text-muted)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        marginTop: 20,
                        textAlign: "center",
                        lineHeight: 2,
                    }}>
                        Ask anything about this codebase ↓
                        <br />
                        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                            Try: "Explain the architecture" or "Where is authentication handled?"
                        </span>
                    </div>
                )}
                {messages.map((msg, i) => (
                    <div key={i} style={{
                        animation: "fadeIn 0.3s ease both",
                        alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                        maxWidth: "85%",
                        minWidth: 0,
                    }}>
                        <div style={{
                            background: msg.role === "user" ? "var(--accent-blue)" : "var(--bg-card)",
                            color: msg.role === "user" ? "white" : "var(--text-primary)",
                            border: msg.role === "assistant" ? "1px solid var(--border-color)" : "none",
                            borderRadius: "var(--radius)",
                            padding: "10px 14px",
                            fontSize: 13,
                            lineHeight: 1.6,
                            fontFamily: msg.role === "user" ? "var(--font-sans)" : "var(--font-mono)",
                            fontWeight: msg.role === "user" ? 500 : 400,
                        }}>
                            <ReactMarkdown
                                components={{
                                    pre: ({ children, ...props }) => (
                                        <pre style={{
                                            background: "var(--bg-secondary)",
                                            border: "1px solid var(--border-color)",
                                            borderRadius: "var(--radius)",
                                            padding: "10px 14px",
                                            overflowX: "auto",
                                            margin: "6px 0",
                                            fontSize: 11,
                                            lineHeight: 1.5,
                                        }} {...props}>{children}</pre>
                                    ),
                                    code: ({ node, inline, children, ...props }) => inline
                                        ? <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.9em", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: 3, padding: "1px 5px" }} {...props}>{children}</code>
                                        : <code style={{ fontFamily: "var(--font-mono)", fontSize: 11 }} {...props}>{children}</code>,
                                    p: ({ children, ...props }) => <p style={{ marginBottom: 6 }} {...props}>{children}</p>,
                                }}
                            >{msg.text}</ReactMarkdown>
                            {msg.mermaid && <MermaidBlock code={msg.mermaid} theme={theme} />}
                        </div>
                        {msg.sources && msg.sources.length > 0 && (
                            <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {msg.sources.map((src, j) => (
                                    <span key={j} style={{
                                        background: "var(--bg-card)",
                                        border: "1px solid var(--border-color)",
                                        borderRadius: "var(--radius)",
                                        padding: "1px 6px",
                                        fontSize: 9,
                                        fontFamily: "var(--font-mono)",
                                        color: "var(--accent-blue)"
                                    }}>
                                        {src.split("/").pop()}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
                {loading && (
                    <div style={{
                        alignSelf: "flex-start",
                        display: "flex",
                        gap: 6,
                        alignItems: "center",
                        color: "var(--text-muted)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        padding: "4px 0",
                    }}>
                        <div style={{
                            width: 14,
                            height: 14,
                            border: "2px solid var(--border-color)",
                            borderTopColor: "var(--accent-blue)",
                            borderRadius: "50%",
                            animation: "spin 0.8s linear infinite"
                        }} />
                        Searching codebase…
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div style={{
                display: "flex",
                gap: 8,
                padding: "10px 16px",
                background: "var(--bg-card)",
                borderTop: "1px solid var(--border-color)",
                flexShrink: 0,
            }}>
                <input
                    value={question}
                    onChange={e => setQuestion(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleQuery()}
                    placeholder="Ask anything about the codebase…"
                    style={{
                        flex: 1,
                        background: "var(--bg-secondary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius)",
                        padding: "8px 12px",
                        color: "var(--text-primary)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        outline: "none",
                        transition: "border-color 0.2s",
                    }}
                    onFocus={e => e.target.style.borderColor = "var(--accent-blue)"}
                    onBlur={e => e.target.style.borderColor = "var(--border-color)"}
                />
                <button
                    onClick={handleQuery}
                    disabled={loading}
                    style={{
                        background: loading ? "var(--bg-tertiary)" : "var(--accent-blue)",
                        color: loading ? "var(--text-muted)" : "white",
                        border: "none",
                        borderRadius: "var(--radius)",
                        padding: "8px 16px",
                        fontFamily: "var(--font-sans)",
                        fontWeight: 600,
                        fontSize: 12,
                        cursor: loading ? "not-allowed" : "pointer",
                        transition: "var(--transition)",
                    }}
                >
                    {loading ? "…" : "Ask →"}
                </button>
            </div>
        </div>
    );
}