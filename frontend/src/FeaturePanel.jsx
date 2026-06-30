import { useState, useRef } from "react";
import { API } from "./config";

/**
 * FeaturePanel — GraphForgeAI Feature Request Panel
 *
 * Renders a panel with a textbox and Propose button.
 * On submit, calls POST /api/propose-feature and emits the result
 * via onProposal(result) callback.
 */
export default function FeaturePanel({ repoId, onProposal, onClose }) {
  const [feature, setFeature] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [errorMsg, setErrorMsg] = useState("");
  const textareaRef = useRef(null);

  async function handlePropose() {
    if (!feature.trim() || status === "loading") return;
    setStatus("loading");
    setErrorMsg("");

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

  const panelStyle = {
    position: "fixed",
    right: 0,
    top: 0,
    bottom: 0,
    width: 360,
    background: "var(--surface)",
    borderLeft: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    zIndex: 200,
    boxShadow: "-8px 0 32px rgba(0,0,0,0.4)",
    animation: "slideInRight 0.3s ease both",
  };

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={{
        padding: "16px 20px",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "var(--bg)",
      }}>
        <div style={{
          width: 28,
          height: 28,
          background: "linear-gradient(135deg, #22c55e, #4ef0c0)",
          borderRadius: 6,
          display: "grid",
          placeItems: "center",
          fontSize: 14,
          flexShrink: 0,
        }}>⚡</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", letterSpacing: "-0.01em" }}>
            Feature Request
          </div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--mono)", marginTop: 1 }}>
            GraphForgeAI — Architecture Evolution
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            color: "var(--text-dim)",
            width: 28,
            height: 28,
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            fontSize: 14,
          }}
          title="Close panel"
        >×</button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Input section */}
        <div>
          <label style={{
            display: "block",
            fontSize: 10,
            fontFamily: "var(--mono)",
            color: "var(--text-dim)",
            marginBottom: 8,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}>
            Describe the feature
          </label>
          <textarea
            ref={textareaRef}
            id="feature-request-input"
            value={feature}
            onChange={e => setFeature(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Add OAuth2 login with Google&#10;e.g. Add Redis caching layer&#10;e.g. Add WebSocket support"
            rows={5}
            style={{
              width: "100%",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "10px 14px",
              color: "var(--text)",
              fontFamily: "var(--mono)",
              fontSize: 13,
              outline: "none",
              resize: "vertical",
              lineHeight: 1.6,
              boxSizing: "border-box",
              transition: "border-color 0.2s",
            }}
            onFocus={e => e.target.style.borderColor = "var(--accent)"}
            onBlur={e => e.target.style.borderColor = "var(--border)"}
          />
          <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--mono)", marginTop: 4 }}>
            Ctrl+Enter to submit
          </div>
        </div>

        {/* Example suggestions */}
        <div>
          <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--mono)", marginBottom: 8, letterSpacing: "0.08em" }}>
            EXAMPLE FEATURES
          </div>
          {[
            "Add OAuth2 login",
            "Add Redis caching layer",
            "Add rate limiting middleware",
            "Add WebSocket support",
            "Add admin dashboard",
          ].map(ex => (
            <button
              key={ex}
              onClick={() => setFeature(ex)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "7px 10px",
                marginBottom: 4,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                fontSize: 12,
                fontFamily: "var(--mono)",
                color: "var(--text-dim)",
                cursor: "pointer",
                transition: "border-color 0.15s, color 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              + {ex}
            </button>
          ))}
        </div>

        {/* Status feedback */}
        {status === "loading" && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 14px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            fontSize: 12,
            fontFamily: "var(--mono)",
            color: "var(--text-dim)",
          }}>
            <div style={{
              width: 14,
              height: 14,
              border: "2px solid var(--muted)",
              borderTopColor: "#22c55e",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              flexShrink: 0,
            }} />
            Analysing architecture and proposing changes…
          </div>
        )}

        {status === "error" && (
          <div style={{
            padding: "12px 14px",
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: "var(--radius)",
            fontSize: 12,
            fontFamily: "var(--mono)",
            color: "#ef4444",
          }}>
            ✗ {errorMsg}
          </div>
        )}

        {status === "done" && (
          <div style={{
            padding: "12px 14px",
            background: "rgba(34,197,94,0.08)",
            border: "1px solid rgba(34,197,94,0.3)",
            borderRadius: "var(--radius)",
            fontSize: 12,
            fontFamily: "var(--mono)",
            color: "#22c55e",
          }}>
            ✓ Proposal applied — graph and diagrams updated below.
          </div>
        )}
      </div>

      {/* Footer — Propose button */}
      <div style={{
        padding: "16px 20px",
        borderTop: "1px solid var(--border)",
        background: "var(--bg)",
      }}>
        <button
          id="propose-feature-btn"
          onClick={handlePropose}
          disabled={status === "loading" || !feature.trim()}
          style={{
            width: "100%",
            padding: "12px 20px",
            background: status === "loading" || !feature.trim()
              ? "var(--muted)"
              : "linear-gradient(135deg, #22c55e, #4ef0c0)",
            color: status === "loading" || !feature.trim() ? "var(--text-dim)" : "#000",
            border: "none",
            borderRadius: "var(--radius)",
            fontFamily: "var(--sans)",
            fontWeight: 700,
            fontSize: 14,
            cursor: status === "loading" || !feature.trim() ? "not-allowed" : "pointer",
            transition: "opacity 0.2s, transform 0.1s",
            letterSpacing: "-0.01em",
          }}
          onMouseEnter={e => { if (status !== "loading") e.currentTarget.style.opacity = "0.9"; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
          onMouseDown={e => { if (status !== "loading") e.currentTarget.style.transform = "scale(0.98)"; }}
          onMouseUp={e => { e.currentTarget.style.transform = "scale(1)"; }}
        >
          {status === "loading" ? "Proposing…" : "⚡ Propose"}
        </button>
      </div>
    </div>
  );
}
