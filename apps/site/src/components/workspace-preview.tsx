export function WorkspacePreview() {
  return (
    <figure className="preview-figure">
      <div
        className="workspace-preview"
        aria-label="Illustration of a Dovo workspace with projects, agent threads and Git changes"
      >
        <div className="window-bar">
          <span className="window-dots" aria-hidden="true">
            ● ● ●
          </span>
          <span>Dovo Studio</span>
          <span className="connection-dot">● Local runtime</span>
        </div>
        <div className="preview-body">
          <aside className="preview-sidebar">
            <strong>Workspace</strong>
            <span className="sidebar-active">
              ⌘ Threads <b>3</b>
            </span>
            <span>⑂ Source control</span>
            <span>◷ Automations</span>
            <small>PROJECTS</small>
            <span>▱ studio</span>
            <span>▱ website</span>
            <span>▱ mobile</span>
            <div className="sidebar-bottom">
              ● Your computer
              <br />
              <small>Connected · Local runtime</small>
            </div>
          </aside>
          <div className="preview-threads">
            <div className="pane-label">
              Threads <span>＋</span>
            </div>
            <div className="thread-card active">
              <small className="live-label">● WORKING</small>
              <strong>Give the website a home</strong>
              <p>website · Codex</p>
              <span>Building the download page…</span>
            </div>
            <div className="thread-card">
              <small>READY FOR REVIEW</small>
              <strong>Polish the project picker</strong>
              <p>mobile · Claude</p>
            </div>
            <div className="thread-card">
              <small>COMPLETED</small>
              <strong>Keep the runtime running</strong>
              <p>studio · OpenCode</p>
            </div>
          </div>
          <div className="preview-conversation">
            <div className="pane-label">
              Give the website a home <span>⑂</span>
            </div>
            <div className="user-message">
              Build a clear download page and help people get started.
            </div>
            <div className="agent-message">
              <span className="agent-avatar">D</span>
              <div>
                <strong>
                  Codex <small>just now</small>
                </strong>
                <p>
                  The download page is ready. I’ve included desktop platforms and a guide for
                  connecting your runtime.
                </p>
              </div>
            </div>
            <div className="diff-preview">
              <div>
                ⑂ Changes <span>+42 −8</span>
              </div>
              <code>
                + Download on your computer
                <br />+ Connect from anywhere you work
                <br />+ Keep your projects on your host
              </code>
            </div>
            <div className="preview-composer">
              What should we build next?
              <div>
                <span>▱ website</span>
                <span>
                  Codex <b>↑</b>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption>One place for the work. Desktop workspace illustration.</figcaption>
    </figure>
  )
}
