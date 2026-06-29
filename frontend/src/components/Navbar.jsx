// src/components/Navbar.jsx
export default function Navbar({ theme, onToggleTheme, repoUrl, isConnected }) {
  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <div className="navbar-logo">G</div>
        <div>
          <div className="navbar-title">GraphForgeAI</div>
          <div className="navbar-subtitle">Architecture Evolution</div>
        </div>
      </div>

      <div className="navbar-actions">
        {repoUrl && (
          <div className="navbar-status">
            <span className={`navbar-status-dot ${isConnected ? '' : 'disconnected'}`} />
            {isConnected ? repoUrl.replace('https://github.com/', '') : 'Disconnected'}
          </div>
        )}
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </div>
    </nav>
  );
}