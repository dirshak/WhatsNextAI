// src/components/Navbar.jsx
export default function Navbar({ repoUrl, isConnected }) {
  const shortUrl = repoUrl ? repoUrl.replace('https://github.com/', '') : null;

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <div className="navbar-logo">G</div>
        <div>
          <div className="navbar-title">What's Next?</div>
          <div className="navbar-subtitle">Propose. Preview. Implement. See the Change Before You Build It.</div>
        </div>
      </div>

      <div className="navbar-actions">
        {isConnected && shortUrl && (
          <div className="navbar-status">
            <span className="navbar-status-dot" />
            {shortUrl}
          </div>
        )}
        {!isConnected && (
          <div className="navbar-status">
            <span className="navbar-status-dot disconnected" />
            No repository
          </div>
        )}
      </div>
    </nav>
  );
}