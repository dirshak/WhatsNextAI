// src/App.jsx
import './App.css';
import { useState } from "react";
import Navbar from './components/Navbar';
import Workspace from './components/Workspace';
import BottomTabs from './components/BottomTabs';
import { API } from './config';

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
      const res = await fetch(`${API}/propose-feature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_id: id, feature: featureText.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Request failed");
      setProposalResult(data);
      setProposalStatus("done");
      setIsAnalyzing(false);
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

  function handleDisconnect() {
    setRepoId(null);
    setRepoUrl("");
    setRepoStatus("idle");
    setProposalResult(null);
    setProposalStatus("idle");
    setProposalError("");
    setFeature("");
    setActiveTab("architecture");
  }

  return (
    <div className="app">
      <Navbar repoUrl={repoUrl} isConnected={!!repoId} onDisconnect={handleDisconnect} />

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

        <footer className="app-footer">
          Dirshak Depak Patro | <a href="https://dirshak.vercel.app" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-blue)", textDecoration: "none" }}>dirshak.vercel.app</a> | <a href="https://github.com/dirshak" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-blue)", textDecoration: "none" }}>github.com/dirshak</a>
        </footer>
      </div>
    </div>
  );
}