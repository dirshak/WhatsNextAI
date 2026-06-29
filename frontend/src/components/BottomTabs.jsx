const tabs = [
    { id: "architecture", icon: "🏗️", label: "Architecture" },
    { id: "graph",        icon: "🔗", label: "Dep. Graph"   },
    { id: "chat",         icon: "💬", label: "Repository Chat" },
];

export default function BottomTabs({ activeTab, onTabChange, repoId }) {
    const disabled = !repoId;

    return (
        <div className="bottom-tabs">
            {/* "No repo" hint when disabled */}
            {disabled && (
                <span style={{
                    display: "flex",
                    alignItems: "center",
                    paddingRight: 16,
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--text-muted)",
                    borderRight: "1px solid var(--border-color)",
                    marginRight: 4,
                    whiteSpace: "nowrap",
                }}>
                    Connect a repo to unlock tabs
                </span>
            )}
            {tabs.map(tab => (
                <button
                    key={tab.id}
                    id={`tab-${tab.id}`}
                    className={`bottom-tab ${activeTab === tab.id ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
                    onClick={() => !disabled && onTabChange(tab.id)}
                    title={disabled ? "Connect a repository first" : tab.label}
                    disabled={disabled}
                    style={{ opacity: disabled ? 0.35 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
                >
                    <span className="icon">{tab.icon}</span>
                    <span className="label">{tab.label}</span>
                </button>
            ))}
        </div>
    );
}