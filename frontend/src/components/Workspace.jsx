// src/components/Workspace.jsx
import { useState, useEffect } from "react";
import GraphPanel from "./GraphPanel";
import DiagramPanel from "./DiagramPanel";
import KnowledgeGraph from "./KnowledgeGraph";
import ChatPanel from "./ChatPanel";
import ImplementationPlan from "./ImplementationPlan";

export default function Workspace({
    repoId,
    repoUrl,
    activeTab,
    proposalResult,
    isAnalyzing,
    theme
}) {
    const [showPlan, setShowPlan] = useState(!!proposalResult);

    useEffect(() => {
        if (proposalResult) setShowPlan(true);
    }, [proposalResult]);

    if (isAnalyzing) {
        return (
            <div className="workspace-container">
                <div className="workspace-loading">
                    <div className="spinner" />
                    <div>AI analyzing architecture…</div>
                </div>
            </div>
        );
    }

    const renderPanel = () => {
        switch (activeTab) {
            case "graph":
                return (
                    <GraphPanel
                        repoId={repoId}
                        repoUrl={repoUrl}
                        theme={theme}
                        proposalResult={proposalResult}
                    />
                );
            case "architecture":
                return (
                    <DiagramPanel
                        repoId={repoId}
                        repoUrl={repoUrl}
                        mode="architecture"
                        theme={theme}
                        proposalResult={proposalResult}
                    />
                );
            case "knowledge":
                return (
                    <KnowledgeGraph
                        repoId={repoId}
                        repoUrl={repoUrl}
                        theme={theme}
                    />
                );
            case "chat":
                return (
                    <ChatPanel
                        repoId={repoId}
                        repoUrl={repoUrl}
                        theme={theme}
                    />
                );
            default:
                return <div>Select a tab</div>;
        }
    };

    return (
        <div className="workspace-container">
            {renderPanel()}
            {showPlan && proposalResult && (
                <ImplementationPlan
                    result={proposalResult}
                    onClose={() => setShowPlan(false)}
                />
            )}
        </div>
    );
}