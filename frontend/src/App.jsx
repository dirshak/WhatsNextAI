// src/App.jsx
import './App.css';
import { useState } from "react";
import Navbar from './components/Navbar';
import Workspace from './components/Workspace';
import FeatureSidebar from './components/FeatureSidebar';
import BottomTabs from './components/BottomTabs';

export default function App() {
  const [repoId, setRepoId] = useState(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [repoStatus, setRepoStatus] = useState("idle"); // idle | loading | done | error
  const [activeTab, setActiveTab] = useState("architecture");
  const [proposalResult, setProposalResult] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [feature, setFeature] = useState("");
  const [proposalStatus, setProposalStatus] = useState("idle");
  const [proposalError, setProposalError] = useState("");

  async function triggerProposal(id = repoId, featureText = feature) {
    if (!featureText.trim() || isAnalyzing) return;
    setIsAnalyzing(true);
    setProposalStatus("loading");
    setProposalError("");

    try {
      const res = await fetch(`${process.env.REACT_APP_API_URL || "http://localhost:8000/api"}/propose-feature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_id: id, feature: featureText.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Request failed");
      setProposalResult(data);
      setProposalStatus("done");
      setIsAnalyzing(false);
      setActiveTab("diff"); // Show Graph Diff by default for a new feature proposal!
    } catch (err) {
      setProposalStatus("error");
      setProposalError(err.message || "Failed to propose feature.");
      setIsAnalyzing(false);
    }
  }

  function handleIngested(id, url) {
    setRepoId(id);
    setRepoUrl(url);
    setRepoStatus("done");
    if (feature.trim()) {
      triggerProposal(id, feature);
    }
  }

  return (
    <div className="app">
      <Navbar repoUrl={repoUrl} isConnected={!!repoId} />

      <div className="workspace-layout">
        <div className="workspace-main">
          <div className="workspace-center">
            <Workspace
              repoId={repoId}
              repoUrl={repoUrl}
              activeTab={activeTab}
              proposalResult={proposalResult}
              isAnalyzing={isAnalyzing}
              onIngested={handleIngested}
              onStatusChange={setRepoStatus}
              feature={feature}
              setFeature={setFeature}
              proposalStatus={proposalStatus}
              proposalError={proposalError}
              onPropose={triggerProposal}
            />
          </div>
        </div>

        <BottomTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
          proposalResult={proposalResult}
          repoId={repoId}
        />
      </div>
    </div>
  );
}