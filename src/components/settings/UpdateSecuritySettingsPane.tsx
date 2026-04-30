export function UpdateSecuritySettingsPane() {
  return (
    <section className="settings-pane" data-settings-pane="update-security" hidden>
      <h3 className="settings-section-title">Updates</h3>
      <div className="settings-card updater-card">
        <div className="pipeline-status-row">
          <div id="updateStatusPill" className="status-pill" data-stage="idle">Idle</div>
          <p id="updateStatusText" className="status-detail">Check to see if a new version is available.</p>
        </div>
        <div className="latency-grid updater-grid" aria-live="polite">
          <p><span>Current</span><strong id="updateCurrentVersion">-</strong></p>
          <p><span>Latest</span><strong id="updateLatestVersion">-</strong></p>
          <p><span>Published</span><strong id="updatePublishedAt">-</strong></p>
          <p><span>Channel</span><strong>Stable</strong></p>
        </div>
        <div className="button-row">
          <button id="checkUpdatesBtn" className="ghost-action" type="button">Check for updates</button>
          <button id="installUpdateBtn" className="dark-action" type="button" disabled>Download & install</button>
        </div>
      </div>

      <h3 className="settings-section-title">Security</h3>
      <div className="settings-card">
        <p className="notice">
          Updates are fetched only from your configured GitHub releases and installed locally.
          Review release notes before installing any new build.
        </p>
      </div>
    </section>
  );
}
