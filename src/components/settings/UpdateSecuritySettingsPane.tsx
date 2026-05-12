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

          <p id="updateLastCheckedText" className="notice">Last checked: Never.</p>

          <label className="switch-row" htmlFor="autoCheckUpdatesToggle">
            <span>Automatic update checks <span className="switch-desc">(every 12 hours)</span></span>
            <input id="autoCheckUpdatesToggle" className="switch-input" type="checkbox" />
          </label>

          <div className="button-row">
            <button id="checkUpdatesBtn" className="ghost-action" type="button">Check for updates</button>
            <button id="installUpdateBtn" className="dark-action" type="button" disabled>Download &amp; install</button>
          </div>

          <div id="updateReleaseCard" className="update-release-card" hidden>
            <p className="settings-group-label">Release</p>
            <p id="updateReleaseName" className="update-release-name">-</p>
            <p id="updateReleaseNotes" className="update-release-notes">Release notes are unavailable for this build.</p>
            <a
              id="updateReleaseLink"
              className="update-release-link"
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              hidden
            >
              Open release page
            </a>
          </div>

          <div id="updateInstallProgressWrap" className="update-progress" hidden>
            <div id="updateInstallProgressTrack" className="update-progress-bar-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0} aria-valuetext="Waiting to start update download.">
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
