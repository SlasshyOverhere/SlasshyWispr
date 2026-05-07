export function UpdateSecuritySettingsPane() {
  return (
    <section className="settings-pane" data-settings-pane="update-security" hidden>

      <details className="settings-section" open>
        <summary>Software updates</summary>
        <div className="section-body">
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
            <button id="installUpdateBtn" className="dark-action" type="button" disabled>Download &amp; install</button>
          </div>

          <div id="updateInstallProgressWrap" className="update-progress" hidden>
            <div className="update-progress-bar-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}>
              <span id="updateInstallProgressBar" className="update-progress-bar-fill" style={{ width: "0%" }}></span>
            </div>
            <p id="updateInstallProgressText" className="update-progress-text">Waiting to start update download.</p>
          </div>
        </div>
      </details>

      <details className="settings-section">
        <summary>Security</summary>
        <div className="section-body">
          <p className="notice">
            Updates are fetched only from your configured GitHub releases and installed locally.
            Review release notes before installing any new build.
          </p>
        </div>
      </details>

    </section>
  );
}
