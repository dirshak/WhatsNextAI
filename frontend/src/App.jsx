// src/App.jsx
import './App.css';
import { useState, useEffect } from "react";
import Navbar from './components/Navbar';
import RepositoryPanel from './components/RepositoryPanel';
import Workspace from './components/Workspace';
import FeatureSidebar from './components/FeatureSidebar';
import BottomTabs from './components/BottomTabs';

const API = process.env.REACT_APP_API_URL || "http://localhost:8000/api";

export default function App() {
  const [repoId, setRepoId] = useState(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  const [activeTab, setActiveTab] = useState("architecture");
  const [proposalResult, setProposalResult] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  function toggleTheme() {
    setTheme(t => t === "dark" ? "light" : "dark");
  }

  return (
    <div className="app">
      <Navbar
        theme={theme}
        onToggleTheme={toggleTheme}
        repoUrl={repoUrl}
        isConnected={!!repoId}
      />

      <div className="workspace-layout">
        <div className="workspace-main">
          {!repoId ? (
            <div className="workspace-center">
              <RepositoryPanel onIngested={(id, url) => {
                setRepoId(id);
                setRepoUrl(url);
              }} />
            </div>
          ) : (
            <>
              <div className="workspace-center">
                <Workspace
                  repoId={repoId}
                  repoUrl={repoUrl}
                  activeTab={activeTab}
                  proposalResult={proposalResult}
                  isAnalyzing={isAnalyzing}
                  theme={theme}
                />
              </div>

              <FeatureSidebar
                repoId={repoId}
                onProposal={(result) => {
                  setProposalResult(result);
                  setIsAnalyzing(false);
                }}
                onAnalyzing={() => setIsAnalyzing(true)}
              />
            </>
          )}
        </div>

        {repoId && (
          <BottomTabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            proposalResult={proposalResult}
          />
        )}
      </div>
    </div>
  );
}