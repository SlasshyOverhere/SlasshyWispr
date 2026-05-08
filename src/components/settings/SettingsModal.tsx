import { GeneralSettingsPane } from './GeneralSettingsPane';
import { ModelsSettingsPane } from './ModelsSettingsPane';
import { PipelineSettingsPane } from './PipelineSettingsPane';
import { SettingsSidebar } from './SettingsSidebar';
import { UpdateSecuritySettingsPane } from './UpdateSecuritySettingsPane';

export function SettingsModal() {
  return (
    <div id="settingsOverlay" className="settings-overlay" hidden>
      <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settingsPaneTitle">
        <SettingsSidebar />

        <section className="settings-main">
          <header className="settings-header">
            <div>
              <p className="settings-header-kicker">Workspace controls</p>
              <h2 id="settingsPaneTitle">General</h2>
              <p className="settings-header-copy">Review shortcuts, behavior, models, and pipeline controls in one place.</p>
            </div>
            <button id="closeSettingsBtn" className="close-settings" type="button" aria-label="Close settings">✕</button>
          </header>

          <GeneralSettingsPane />
          <UpdateSecuritySettingsPane />
          <ModelsSettingsPane />
          <PipelineSettingsPane />
        </section>
      </div>
    </div>
  );
}
