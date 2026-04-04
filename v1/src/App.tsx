import './App.css'

function App() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          ProcessMap V1
        </div>
        <div className="top-actions">
          <button type="button" className="btn ghost">
            Review Queue
          </button>
          <button type="button" className="btn">
            Export
          </button>
          <button type="button" className="btn primary">
            New Project
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="panel left-panel">
          <h2>Projects</h2>
          <div className="project-list">
            <button type="button" className="project-item active">
              Customer Support Journey
            </button>
            <button type="button" className="project-item">
              Onboarding Experience
            </button>
          </div>
          <div className="left-footer">
            <button type="button" className="btn full">
              + New Artifact
            </button>
          </div>
        </aside>

        <section className="panel center-panel">
          <div className="tab-row">
            <button type="button" className="tab active">
              Journey Flow
            </button>
            <button type="button" className="tab">
              Journey Map
            </button>
          </div>

          <div className="canvas">
            <div className="canvas-empty">
              <h3>Editor canvas (Phase 1 shell)</h3>
              <p>
                Next phases will add canonical store integration, node editing, map projection, and
                imports.
              </p>
            </div>
          </div>
        </section>

        <aside className="panel right-panel">
          <h2>Inspector</h2>
          <p className="muted">No selection yet.</p>
          <div className="field-group">
            <label htmlFor="labelField">Label</label>
            <input id="labelField" type="text" placeholder="Select a node first" disabled />
          </div>
          <div className="field-group">
            <label htmlFor="actorField">Actor</label>
            <select id="actorField" disabled>
              <option>Unassigned</option>
            </select>
          </div>
        </aside>
      </main>
    </div>
  )
}

export default App
