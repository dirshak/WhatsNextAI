// src/components/BottomTabs.jsx
const tabs = [
    { id: "architecture", icon: "🏗️", label: "Architecture" },
    { id: "graph", icon: "🔗", label: "Graph" },
    { id: "knowledge", icon: "🧠", label: "Knowledge" },
    { id: "chat", icon: "💬", label: "Chat" },
];

export default function BottomTabs({ activeTab, onTabChange, proposalResult }) {
    return (
        <div className="bottom-tabs">
            {tabs.map(tab => (
                <button
                    key={tab.id}
                    className={`bottom-tab ${activeTab === tab.id ? 'active' : ''}`}
                    onClick={() => onTabChange(tab.id)}
                >
                    <span className="icon">{tab.icon}</span>
                    <span className="label">{tab.label}</span>
                    {tab.id === "architecture" && proposalResult && (
                        <span className="badge">Updated</span>
                    )}
                </button>
            ))}
        </div>
    );
}