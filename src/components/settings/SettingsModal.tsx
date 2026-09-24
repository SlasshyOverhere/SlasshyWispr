import type { SettingsPane } from "../../types";
import { SETTINGS_SECTIONS } from "../../settings/settings-directory";
import { ErrorBoundary } from "../ErrorBoundary";
import { GeneralSettingsPane } from "./GeneralSettingsPane";
import { ModelsSettingsPane } from "./ModelsSettingsPane";
import { PipelineSettingsPane } from "./PipelineSettingsPane";
import { UpdateSecuritySettingsPane } from "./UpdateSecuritySettingsPane";

const PANES: SettingsPane[] = ["general", "models", "pipeline", "update-security"];

export function SettingsModal() {
  return (
    <section id="settingsPage" className="settings-page flow-page-inner" aria-labelledby="settingsPaneTitle">
      <div className="settings-layout">
        <nav className="settings-navigation" aria-label="Settings sections">
          <div className="settings-primary-nav">
            <button className="settings-tab is-active" data-settings-pane-nav="general" type="button" aria-controls="settingsPaneGeneral">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1-1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              General
            </button>
            <button className="settings-tab" data-settings-pane-nav="models" type="button" aria-controls="settingsPaneModels">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
              Models
            </button>
            <button className="settings-tab" data-settings-pane-nav="pipeline" type="button" aria-controls="settingsPanePipeline">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
              Pipeline
            </button>
            <button className="settings-tab" data-settings-pane-nav="update-security" type="button" aria-controls="settingsPaneUpdateSecurity">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
              Updates
            </button>
          </div>

          <div className="settings-section-nav">
            {PANES.map((pane) => (
              <div
                className="settings-section-nav-group"
                data-settings-section-owner={pane}
                key={pane}
                hidden={pane !== "general"}
              >
                {SETTINGS_SECTIONS[pane].map((section) => (
                  <button
                    className="settings-section-tab"
                    data-settings-section-nav={section.id}
                    type="button"
                    aria-controls={`settingsSection-${pane}-${section.id}`}
                    key={section.id}
                  >
                    {section.title}
                  </button>
                ))}
              </div>
            ))}
          </div>

          <p id="settingsVersionText" className="settings-version">SlasshyWispr</p>
        </nav>

        <main className="settings-content">
          <header className="settings-content-header">
            <h2 id="settingsPaneTitle" className="settings-content-title">Audio &amp; shortcuts</h2>
            <p id="settingsSectionDescription" className="settings-content-description">Choose how dictation starts and what it listens to.</p>
          </header>

          <ErrorBoundary>
            <div className="settings-panes">
              <GeneralSettingsPane />
              <ModelsSettingsPane />
              <PipelineSettingsPane />
              <UpdateSecuritySettingsPane />
            </div>
          </ErrorBoundary>
        </main>
      </div>
    </section>
  );
}
