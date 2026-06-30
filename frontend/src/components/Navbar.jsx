// src/components/Navbar.jsx
import Logo from './Logo';

export default function Navbar({ repoUrl, isConnected, onDisconnect }) {
  const shortUrl = repoUrl ? repoUrl.replace('https://github.com/', '') : null;

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <Logo className="navbar-logo-img" alt="What's Next Logo" />
        {isConnected && (
          <div>
            <div className="navbar-title">What's Next?</div>
            <div className="navbar-subtitle">Propose. Preview. Implement. See the Change Before You Build It.</div>
          </div>
        )}
      </div>

      <div className="navbar-actions">
        {isConnected && shortUrl && (
          <>
            <div className="navbar-status">
              <span className="navbar-status-dot" />
              {shortUrl}
            </div>
            <button className="navbar-reconnect-btn" onClick={onDisconnect} title="Disconnect and re-ingest a repository">
              ↩ Reconnect
            </button>
          </>
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