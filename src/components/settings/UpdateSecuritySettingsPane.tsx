import { useEffect, useState } from 'react';
import {
  readAppUpdateAutoCheckEnabled,
  APP_UPDATE_AUTO_CHECK_CHANGED_EVENT,
  requestAppUpdateAutoCheckChange,
} from '../../updater/updater-client-shim';

export function UpdateSecuritySettingsPane() {
  const [autoCheck, setAutoCheck] = useState(readAppUpdateAutoCheckEnabled);

  useEffect(() => {
    const sync = () => setAutoCheck(readAppUpdateAutoCheckEnabled());
    window.addEventListener(APP_UPDATE_AUTO_CHECK_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(APP_UPDATE_AUTO_CHECK_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return (
    <section id="settingsPaneUpdateSecurity" className="settings-pane" data-settings-pane="update-security" hidden>
      <div
        id="settingsSection-update-security-updates"
        className="settings-category"
        data-settings-section-owner="update-security"
        data-settings-section="updates"
      >
        <section className="settings-group">
          <h3 className="settings-group-title">Installed release</h3>
          <div className="settings-group-body">
            <div className="update-hero">
              <div className="s-row" title="Installed version and the last time updates were checked.">
                <span className="s-row-label">
                  Version
                  <span id="updateLastCheckedText" className="s-row-hint">Last checked: Never.</span>
                </span>
                <div id="updateStatusPill" className="status-pill" data-stage="idle" aria-live="polite">Idle</div>
              </div>
              <dl className="version-grid" aria-live="polite" title="Version numbers for this install.">
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

            <label className="s-row" htmlFor="autoCheckUpdatesToggle" title="Check GitHub for new releases twice a day.">
              <span className="s-row-label">Automatic update checks <span className="switch-desc">Every 12 hours</span></span>
              <input
                id="autoCheckUpdatesToggle"
                className="switch-input"
                type="checkbox"
                checked={autoCheck}
                onChange={(event) => requestAppUpdateAutoCheckChange(event.target.checked)}
              />
            </label>

            <div className="btn-row" title="Update actions unlock once a newer release is found.">
              <button id="checkUpdatesBtn" className="btn" type="button" title="Ask GitHub for the newest release.">Check for updates</button>
              <button id="snoozeUpdateBtn" className="btn" type="button" title="Stop update prompts for a day." disabled>Snooze 24h</button>
              <button id="installUpdateBtn" className="btn btn-primary" type="button" title="Download and run the installer." disabled>Download &amp; install</button>
              <button id="skipUpdateVersionBtn" className="btn" type="button" title="Never offer this release again." disabled>Skip this version</button>
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
                <span id="updateInstallProgressBar" className="progress-fill" style={{ ["--p" as string]: 0 }}></span>
              </div>
              <p id="updateInstallProgressText" className="progress-text">Waiting to start update download.</p>
            </div>
          </div>
        </section>

        <details className="settings-advanced">
          <summary>Security and release policy</summary>
          <div className="settings-advanced-body">
            <p className="field-hint">
              Updates are fetched only from the configured GitHub releases and installed locally. Review release notes before installing a new build.
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}
