// src/components/MermaidBlock.jsx
import { useEffect, useRef } from "react";

export default function MermaidBlock({ code, theme }) {
    const ref = useRef(null);

    useEffect(() => {
        if (!ref.current || !code) return;

        import("mermaid").then(m => {
            const mermaidTheme = theme === "light" ? "default" : "dark";
            m.default.initialize({
                startOnLoad: false,
                theme: mermaidTheme,
                themeVariables: {
                    fontFamily: "JetBrains Mono, monospace",
                    ...(theme === "light" ? {
                        background: "#F8FAFC",
                        primaryColor: "#FFFFFF",
                        primaryTextColor: "#0F172A",
                        primaryBorderColor: "#059669",
                        lineColor: "#E2E8F0",
                    } : {
                        background: "#0F172A",
                        primaryColor: "#1E293B",
                        primaryTextColor: "#F8FAFC",
                        primaryBorderColor: "#10B981",
                        lineColor: "#334155",
                    }),
                },
            });

            const id = `mermaid-${Math.random().toString(36).slice(2)}`;
            m.default.render(id, code).then(({ svg }) => {
                if (ref.current) ref.current.innerHTML = svg;
            }).catch(() => {
                if (ref.current) ref.current.innerHTML = `<pre style="color:var(--accent-blue);font-size:10px;overflow:auto">${code}</pre>`;
            });
        });
    }, [code, theme]);

    return (
        <div ref={ref} style={{
            marginTop: 6,
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius)",
            padding: 12,
            overflow: "auto",
        }} />
    );
}