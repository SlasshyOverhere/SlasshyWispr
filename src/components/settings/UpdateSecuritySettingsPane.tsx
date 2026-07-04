export function UpdateSecuritySettingsPane() {
  return (
    <section id="settingsPaneUpdateSecurity" className="settings-pane" data-settings-pane="update-security" hidden>

      <h3 className="settings-section-title">Software Updates</h3>

      <div className="update-hero">
        <div className="s-row">
          <span className="s-row-label">
            Version
            <span id="updateLastCheckedText" className="s-row-hint">Last checked: Never.</span>
          </span>
          <div id="updateStatusPill" className="status-pill" data-stage="idle" aria-live="polite">Idle</div>
        </div>
        <dl className="version-grid" aria-live="polite">
          <div className="version-item">
            <dt>Current</dt>
            <dd id="updateCurrentVersion">-</dd>
          </div>
          <div className="version-item">
            <dt>Latest</dt>
            <dd id="updateLatestVersion">-</dd>
          </div>
          <div className="version-item">
            <dt>Published</dt>
            <dd id="updatePublishedAt">-</dd>
          </div>
          <div className="version-item">
            <dt>Channel</dt>
            <dd>Stable</dd>
          </div>
        </dl>
      </div>

      <p id="updateStatusText" className="field-hint">Check to see if a new version is available.</p>

      <label className="s-row" htmlFor="autoCheckUpdatesToggle">
        <span className="s-row-label">Automatic update checks <span className="switch-desc">(every 12 hours)</span></span>
        <input id="autoCheckUpdatesToggle" className="switch-input" type="checkbox" />
      </label>

      <div className="btn-row">
        <button id="checkUpdatesBtn" className="btn" type="button">Check for updates</button>
        <button id="snoozeUpdateBtn" className="btn" type="button" disabled>Snooze 24h</button>
        <button id="installUpdateBtn" className="btn btn-primary" type="button" disabled>Download &amp; install</button>
        <button id="skipUpdateVersionBtn" className="btn" type="button" disabled>Skip this version</button>
      </div>

      <div id="updateManualDownloadRow" className="s-row-block" hidden>
        <p id="updateManualDownloadText" className="field-hint"></p>
        <button id="openGithubReleasesBtn" className="btn" type="button">Open GitHub Releases</button>
      </div>

      <div id="updateReleaseCard" className="release-card" hidden>
        <p className="release-name" id="updateReleaseName">-</p>
        <p id="updateReleaseNotes" className="release-notes">Release notes are unavailable for this build.</p>
        <a id="updateReleaseLink" className="release-link" href="https://github.com" target="_blank" rel="noreferrer" hidden>Open release page</a>
      </div>

      <div id="updateInstallProgressWrap" className="s-row-block" hidden>
        <div id="updateInstallProgressTrack" className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0} aria-valuetext="Waiting to start update download.">
          <span id="updateInstallProgressBar" className="progress-fill" style={{ width: "0%" }}></span>
        </div>
        <p id="updateInstallProgressText" className="progress-text">Waiting to start update download.</p>
      </div>

      <h3 className="settings-section-title">Security</h3>

      <p className="field-hint">
        Updates are fetched only from your configured GitHub releases and installed locally.
        Review release notes before installing any new build.
      </p>

    </section>
  );
}
