// src/components/MermaidBlock.jsx
import { useEffect, useRef } from "react";

export default function MermaidBlock({ code }) {
    const ref = useRef(null);

    useEffect(() => {
        if (!ref.current || !code) return;

        import("mermaid").then(m => {
            m.default.initialize({
                startOnLoad: false,
                theme: "dark",
                themeVariables: {
                    background:         "#0B1220",
                    primaryColor:       "#161D2E",
                    primaryTextColor:   "#F8FAFC",
                    primaryBorderColor: "#22C55E",
                    lineColor:          "#2D3748",
                    secondaryColor:     "#1F2937",
                    tertiaryColor:      "#0B1220",
                    fontFamily:         "JetBrains Mono, monospace",
                },
            });

            const id = `mermaid-${Math.random().toString(36).slice(2)}`;
            m.default.render(id, code).then(({ svg }) => {
                if (ref.current) ref.current.innerHTML = svg;
            }).catch(() => {
                if (ref.current) ref.current.innerHTML = `<pre style="color:var(--accent-blue);font-size:10px;overflow:auto">${code}</pre>`;
            });
        });
    }, [code]);

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