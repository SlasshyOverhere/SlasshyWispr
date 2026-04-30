import { DEFAULT_ASSISTANT_NAME, DEFAULT_COQUI_MODEL, DEFAULT_LOCAL_OLLAMA_BASE_URL } from './constants';

export function App() {
  return (
    <>
      
  <div className="app-frame">
    <header className="app-titlebar">
      <div id="appTitlebarDrag" className="app-titlebar-drag" data-tauri-drag-region="true">
        <span className="app-titlebar-dot" aria-hidden="true"></span>
        <span className="app-titlebar-name">SlasshyWispr</span>
      </div>
      <div className="app-titlebar-actions">
        <button id="windowMinimizeBtn" className="titlebar-action" type="button" aria-label="Minimize">−</button>
        <button id="windowMaximizeBtn" className="titlebar-action" type="button" aria-label="Maximize">
          <span id="windowMaximizeGlyph">□</span>
        </button>
        <button id="windowCloseBtn" className="titlebar-action titlebar-close" type="button" aria-label="Close">×</button>
      </div>
    </header>

    <div className="flow-shell">
    <aside className="flow-sidebar">
      <div className="window-controls">
        <button id="toggleSidebarBtn" className="chrome-icon" type="button" data-label="Collapse sidebar" aria-label="Collapse sidebar">
          <span className="ico-grid"></span>
        </button>
      </div>

      <div className="brand-row">
        <div className="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
        <strong>SlasshyWispr</strong>
        <span className="brand-plan">Basic</span>
      </div>

      <nav className="nav-main" aria-label="Main navigation">
        <button className="nav-item is-active" data-page-nav="home" data-label="Home" aria-label="Home" type="button"><span className="nav-glyph">⌂</span>Home</button>
        <button className="nav-item" data-page-nav="dictionary" data-label="Dictionary" aria-label="Dictionary" type="button"><span className="nav-glyph">◱</span>Dictionary</button>
        <button className="nav-item" data-page-nav="snippets" data-label="Snippets" aria-label="Snippets" type="button"><span className="nav-glyph">⌘</span>Snippets</button>
        <button className="nav-item" data-page-nav="notes" data-label="Notes" aria-label="Notes" type="button"><span className="nav-glyph">✎</span>Notes</button>
      </nav>

      <nav className="nav-secondary" aria-label="Secondary navigation">
        <button id="sidebarToggleLocalSttBtn" className="secondary-link" data-label="Load local STT model" aria-label="Load local STT model" type="button"><span id="sidebarToggleLocalSttGlyph" className="secondary-glyph">▶</span><span id="sidebarToggleLocalSttLabel">Load STT</span></button>
        <button id="openSettingsBtn" className="secondary-link" data-label="Settings" aria-label="Settings" type="button"><span className="secondary-glyph">⚙</span>Settings</button>
      </nav>
    </aside>

    <main className="flow-content">
      <section className="flow-page is-active" data-page="home">
        <div className="flow-page-inner home-page">
          <header className="overview-header">
            <div className="overview-icon-wrap">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></svg>
            </div>
            <div>
              <h1 className="overview-title">Overview</h1>
              <p className="overview-subtitle">Your SlasshyWispr performance snapshot, recent activity, and productivity trends.</p>
            </div>
          </header>

          <div className="stat-cards-grid">
            <article className="stat-card">
              <div className="stat-card-header">
                <span className="stat-label">TOTAL WORDS</span>
                <span className="stat-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 7-7 7 7"></path><path d="M12 19V5"></path></svg>
                </span>
              </div>
              <div className="stat-value" id="metricWords">0</div>
              <div className="stat-desc">Words transcribed</div>
            </article>
            <article className="stat-card">
              <div className="stat-card-header">
                <span className="stat-label">SPEAKING TIME</span>
                <span className="stat-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                </span>
              </div>
              <div className="stat-value" id="metricSpeakingTime">0m</div>
              <div className="stat-desc">Total duration</div>
            </article>
            <article className="stat-card">
              <div className="stat-card-header">
                <span className="stat-label">SESSIONS</span>
                <span className="stat-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>
                </span>
              </div>
              <div className="stat-value" id="metricSessions">0</div>
              <div className="stat-desc">Total recordings</div>
            </article>
            <article className="stat-card">
              <div className="stat-card-header">
                <span className="stat-label">AVG PACE</span>
                <span className="stat-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>
                </span>
              </div>
              <div className="stat-value" id="metricWpm">0 <span className="stat-unit">wpm</span></div>
              <div className="stat-desc">Words per minute</div>
            </article>
          </div>

          <section className="home-output" id="homeOutputSection" style={{ display: "none" }}>
            <article className="home-output-card">
              <h3>Transcript</h3>
              <p id="transcriptText" className="output-text muted">Your transcribed speech will appear here.</p>
            </article>
            <article className="home-output-card">
              <h3>Assistant Response</h3>
              <p id="assistantText" className="output-text muted">The AI response will appear here.</p>
            </article>
          </section>

          <section className="home-log">
            <div className="section-head">
              <div>
                <h3 id="activityDate">Recent Activity</h3>
                <p className="section-sub">Your latest transcriptions from this device.</p>
              </div>
              <button id="clearHistoryBtn" className="inline-link view-full-history" type="button">View Full History</button>
            </div>
            <div id="conversationLog" className="conversation-log" role="log" aria-live="polite">
              <div className="empty-hint">
                <div className="empty-hint-icon">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>
                </div>
                <h4>No activity yet</h4>
                <p>Start dictating to see your recent transcriptions here.</p>
              </div>
            </div>
          </section>
        </div>
      </section>

      <section className="flow-page" data-page="dictionary" hidden>
        <div className="flow-page-inner">
          <header className="page-header-row">
            <div>
              <h1>Dictionary</h1>
              <p className="page-subtitle">Teach SlasshyWispr your unique vocabulary and jargon.</p>
            </div>
            <button id="dictionaryAddBtnTop" className="dark-action" type="button">Add new</button>
          </header>
          
          <div className="mini-tabs" role="tablist" aria-label="Dictionary filters">
            <button className="mini-tab is-active" data-dictionary-filter="all" type="button">All</button>
            <button className="mini-tab" data-dictionary-filter="personal" type="button">Personal</button>
            <button className="mini-tab" data-dictionary-filter="shared" type="button">Shared with team</button>
          </div>

          <article className="focus-card">
            <h2>Vocabulary Training</h2>
            <p>
              Add specific pronunciations or spellings for names, products, and technical terms 
              to ensure perfect transcription every time.
            </p>
            <form id="dictionaryForm" className="inline-create-form is-collapsed">
              <input id="dictionarySourceInput" type="text" placeholder="Spoken term (example: slashy)" autoComplete="off" />
              <input id="dictionaryTargetInput" type="text" placeholder="Correct term (example: Slasshy)" autoComplete="off" />
              <label className="inline-check"><input id="dictionarySharedInput" type="checkbox" />Shared with team</label>
              <button id="dictionaryAddBtn" className="dark-action" type="submit">Add term</button>
            </form>
          </article>

          <div id="dictionaryList" className="simple-list">
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path></svg>
              </div>
              <h4>No terms yet</h4>
              <p>Your dictionary is currently empty. Start by adding a term above.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="flow-page" data-page="snippets" hidden>
        <div className="flow-page-inner">
          <header className="page-header-row">
            <div>
              <h1>Snippets</h1>
              <p className="page-subtitle">Create shortcuts for text you use frequently.</p>
            </div>
            <button id="snippetsAddBtnTop" className="dark-action" type="button">Add new</button>
          </header>

          <div className="mini-tabs" role="tablist" aria-label="Snippet filters">
            <button className="mini-tab is-active" data-snippet-filter="all" type="button">All</button>
            <button className="mini-tab" data-snippet-filter="personal" type="button">Personal</button>
            <button className="mini-tab" data-snippet-filter="shared" type="button">Shared with team</button>
          </div>

          <article className="focus-card">
            <h2>Text Shortcuts</h2>
            <p>Define short phrases that expand into full paragraphs or templates instantly.</p>
            <form id="snippetForm" className="inline-create-form is-collapsed">
              <input id="snippetTriggerInput" type="text" placeholder="Trigger (example: /sig)" autoComplete="off" />
              <input id="snippetExpansionInput" type="text" placeholder="Expansion text" autoComplete="off" />
              <label className="inline-check"><input id="snippetSharedInput" type="checkbox" />Shared with team</label>
              <button id="snippetAddBtn" className="dark-action" type="submit">Add snippet</button>
            </form>
          </article>

          <div id="snippetsList" className="simple-list">
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
              </div>
              <h4>No snippets yet</h4>
              <p>Save time by creating your first text expansion shortcut.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="flow-page" data-page="notes" hidden>
        <div className="flow-page-inner notes-layout">
          <header className="page-header-row">
            <div>
              <h1>Quick Notes</h1>
              <p className="page-subtitle">Voice-captured thoughts, ready for review.</p>
            </div>
          </header>

          <article className="quick-note-card">
            <div className="quick-note-info">
              <h3>Capture a thought</h3>
              <p>Tap to record a voice note</p>
            </div>
            <button id="notesQuickMicBtn" className="notes-mic-btn" type="button" aria-label="Dictate a quick note">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>
            </button>
          </article>

          <div className="section-head notes-head">
            <h3>Recent Notes</h3>
          </div>

          <div id="notesList" className="notes-list">
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </div>
              <h4>No notes found</h4>
              <p>Your captured thoughts will appear here.</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>

  </div>

  <div id="sttLoadOverlay" className="stt-load-overlay" hidden>
    <div className="stt-load-dialog" role="dialog" aria-modal="true" aria-labelledby="sttLoadTitle">
      <span className="stt-load-spinner" aria-hidden="true"></span>
      <h3 id="sttLoadTitle">Loading Local STT Model</h3>
      <p id="sttLoadModel" className="stt-load-model">Model: -</p>
      <p id="sttLoadDetail" className="stt-load-detail">
        Preparing runtime. Load time depends on your CPU/GPU, RAM, and model size.
      </p>
    </div>
  </div>

  <div id="sttHardwareAdvisorOverlay" className="stt-advisor-overlay" hidden>
    <div className="stt-advisor-dialog" role="dialog" aria-modal="true" aria-labelledby="sttHardwareAdvisorTitle">
      <h3 id="sttHardwareAdvisorTitle">Local STT Hardware Recommendation</h3>
      <p id="sttHardwareAdvisorHardware" className="stt-advisor-hardware">Checking your hardware profile...</p>
      <p id="sttHardwareAdvisorSuggestion" className="stt-advisor-suggestion">SlasshyWispr Suggestion: -</p>
      <p id="sttHardwareAdvisorWarning" className="stt-advisor-warning">
        Warning: Higher models can be system-hungry and can feel slow on basic hardware.
      </p>
      <p id="sttHardwareAdvisorList" className="stt-advisor-list">Recommended models: -</p>
      <div className="stt-advisor-actions">
        <button id="sttHardwareAdvisorUseSuggestionBtn" className="dark-action" type="button">Use suggestion</button>
        <button id="sttHardwareAdvisorContinueBtn" className="ghost-action" type="button">Continue selected</button>
        <button id="sttHardwareAdvisorCancelBtn" className="ghost-action" type="button">Cancel</button>
      </div>
    </div>
  </div>

  <div id="settingsOverlay" className="settings-overlay" hidden>
    <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settingsPaneTitle">
      <aside className="settings-sidebar">
        <p className="settings-kicker">Settings</p>
        <nav className="settings-nav" aria-label="Settings sections">
          <button className="settings-nav-item is-active" data-settings-pane-nav="general" type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            General
          </button>
          <button className="settings-nav-item" data-settings-pane-nav="models" type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
            Models
          </button>
          <button className="settings-nav-item" data-settings-pane-nav="update-security" type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
            Update and Security
          </button>
          <button className="settings-nav-item" data-settings-pane-nav="pipeline" type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
            Pipeline
          </button>
        </nav>

        <p id="settingsVersionText" className="settings-version">SlasshyWispr</p>
      </aside>

      <section className="settings-main">
        <header className="settings-header">
          <h2 id="settingsPaneTitle">General</h2>
          <button id="closeSettingsBtn" className="close-settings" type="button" aria-label="Close settings">✕</button>
        </header>

        <section className="settings-pane is-active" data-settings-pane="general">
          <div className="settings-card">
            <div className="settings-row">
              <div>
                <h3>Keyboard shortcuts</h3>
                <p>Dictation shortcut is <strong id="hotkeyHint">Ctrl + Space</strong>. <span className="learn-link">Learn more →</span></p>
                <div id="hotkeyEditor" className="inline-editor" hidden>
                  <label className="field">
                    <span>Push-To-Talk Hotkey</span>
                    <input id="hotkeyInput" type="text" placeholder="Click and press keys" autoComplete="off" />
                  </label>
                  <label className="field">
                    <span>Command Mode Hotkey</span>
                    <input id="commandHotkeyInput" type="text" placeholder="Ctrl+Shift+Space" autoComplete="off" />
                  </label>
                </div>
              </div>
              <button id="toggleHotkeyEditorBtn" className="ghost-action" type="button">Change</button>
            </div>

            <div className="settings-row">
              <div>
                <h3>Microphone</h3>
                <p id="microphoneSummary">Auto-detect</p>
                <div id="microphoneEditor" className="inline-editor" hidden>
                  <label className="field">
                    <span>Microphone Device</span>
                    <select id="microphoneSelect"></select>
                  </label>
                  <button id="refreshMicsBtn" className="ghost-action mini" type="button">Refresh</button>
                </div>
              </div>
              <button id="toggleMicEditorBtn" className="ghost-action" type="button">Change</button>
            </div>

            <div className="settings-row">
              <div>
                <h3>Dictation languages</h3>
                <p id="dictationLanguageSummary">Whisper language mode: Auto-detect.</p>
                <div className="inline-editor">
                  <div className="capture-mode-pills">
                    <label><input id="dictationLanguageModeSingle" name="dictationLanguageMode" type="radio" value="single" />Single language</label>
                    <label><input id="dictationLanguageModeMultiple" name="dictationLanguageMode" type="radio" value="multiple" />Multiple languages</label>
                  </div>
                  <label className="field">
                    <span>Primary language</span>
                    <select id="dictationLanguageSelect">
                      <option value="">Auto-detect</option>
                      <option value="en">English</option>
                      <option value="es">Spanish</option>
                      <option value="fr">French</option>
                      <option value="de">German</option>
                      <option value="it">Italian</option>
                      <option value="pt">Portuguese</option>
                      <option value="hi">Hindi</option>
                      <option value="bn">Bengali</option>
                      <option value="ja">Japanese</option>
                      <option value="ko">Korean</option>
                      <option value="zh">Chinese</option>
                      <option value="ar">Arabic</option>
                      <option value="ru">Russian</option>
                    </select>
                  </label>
                  <div id="dictationLanguageMultiWrap" className="dictation-language-multi" hidden>
                    <p className="dictation-language-multi-label">Allowed languages (Whisper will stay inside these)</p>
                    <div className="dictation-language-grid">
                      <label><input type="checkbox" value="en" data-dictation-lang-option />English</label>
                      <label><input type="checkbox" value="es" data-dictation-lang-option />Spanish</label>
                      <label><input type="checkbox" value="fr" data-dictation-lang-option />French</label>
                      <label><input type="checkbox" value="de" data-dictation-lang-option />German</label>
                      <label><input type="checkbox" value="it" data-dictation-lang-option />Italian</label>
                      <label><input type="checkbox" value="pt" data-dictation-lang-option />Portuguese</label>
                      <label><input type="checkbox" value="hi" data-dictation-lang-option />Hindi</label>
                      <label><input type="checkbox" value="bn" data-dictation-lang-option />Bengali</label>
                      <label><input type="checkbox" value="ja" data-dictation-lang-option />Japanese</label>
                      <label><input type="checkbox" value="ko" data-dictation-lang-option />Korean</label>
                      <label><input type="checkbox" value="zh" data-dictation-lang-option />Chinese</label>
                      <label><input type="checkbox" value="ar" data-dictation-lang-option />Arabic</label>
                      <label><input type="checkbox" value="ru" data-dictation-lang-option />Russian</label>
                    </div>
                    <p className="notice">Online and Offline Whisper will decode only the selected languages.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="settings-row">
              <div>
                <h3>Capture mode</h3>
                <p id="captureModeHint">Push-To-Talk</p>
                <div className="capture-mode-pills">
                  <label><input id="captureModeSingle" name="captureMode" type="radio" value="single-tap" />Single tap</label>
                  <label><input id="captureModePushToTalk" name="captureMode" type="radio" value="push-to-talk" />Push-to-talk</label>
                </div>
              </div>
            </div>

            <div className="settings-row">
              <div>
                <h3>Style profile</h3>
                <p>Choose how SlasshyWispr rewrites and responds.</p>
                <label className="field inline-select">
                  <span>Style</span>
                  <select id="styleProfileSelect">
                    <option value="adaptive">Adaptive</option>
                    <option value="professional">Professional</option>
                    <option value="casual">Casual</option>
                    <option value="concise">Concise</option>
                    <option value="developer">Developer</option>
                  </select>
                </label>
              </div>
            </div>

          </div>

          <h3 className="settings-section-title">App settings</h3>
          <div className="settings-card">
            <label className="switch-row"><span>Launch app at login</span><input id="launchAtLoginToggle" className="switch-input" type="checkbox" /></label>
            <label className="switch-row"><span>Show floating dock at all times</span><input id="showFlowBarToggle" className="switch-input" type="checkbox" /></label>
            <label className="switch-row"><span>Show app in dock</span><input id="showAppInDockToggle" className="switch-input" type="checkbox" /></label>
            <label className="switch-row"><span>Command mode</span><input id="commandModeToggle" className="switch-input" type="checkbox" /></label>
            <label className="switch-row"><span>Require wake phrase for AI replies</span><input id="wakeWordEnabledToggle" className="switch-input" type="checkbox" /></label>
            <label className="field">
              <span>Assistant wake name (say "Hey name")</span>
              <input id="assistantNameInput" type="text" placeholder={DEFAULT_ASSISTANT_NAME} autoComplete="off" />
            </label>
            <p id="wakePhrasePreview" className="notice">Wake phrase examples: "Hey {DEFAULT_ASSISTANT_NAME}", "Hi {DEFAULT_ASSISTANT_NAME}", "Okay {DEFAULT_ASSISTANT_NAME}"</p>
            <label className="switch-row"><span>Context awareness (recent turns)</span><input id="contextAwarenessToggle" className="switch-input" type="checkbox" /></label>
            <label className="switch-row"><span>Copy assistant response to clipboard</span><input id="copyToClipboardToggle" className="switch-input" type="checkbox" /></label>
            <label className="switch-row"><span>Auto paste dictation after copy</span><input id="autoPasteDictationToggle" className="switch-input" type="checkbox" /></label>
            <label className="switch-row"><span>Incognito mode (no local history/notes)</span><input id="incognitoModeToggle" className="switch-input" type="checkbox" /></label>
            <label className="select-row">
              <span>Theme</span>
              <select id="themeModeSelect">
                <option value="system">Match system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
          </div>

          <h3 className="settings-section-title">Sound</h3>
          <div className="settings-card">
            <label className="switch-row"><span>Dictation sound effects</span><input id="dictationSoundEffectsToggle" className="switch-input" type="checkbox" /></label>
            <label className="switch-row"><span>Mute music while dictating</span><input id="muteMusicWhileDictatingToggle" className="switch-input" type="checkbox" /></label>
          </div>

          <h3 className="settings-section-title">Transcript refinement</h3>
          <div className="settings-card">
            <label className="switch-row"><span>Backtrack corrections (e.g. "scratch that")</span><input id="backtrackToggle" className="switch-input" type="checkbox" /></label>
            <label className="switch-row"><span>Remove filler words</span><input id="removeFillersToggle" className="switch-input" type="checkbox" /></label>
            <label className="switch-row"><span>Auto punctuation</span><input id="autoPunctuationToggle" className="switch-input" type="checkbox" /></label>
            <label className="switch-row"><span>Auto numbered lists</span><input id="numberedListsToggle" className="switch-input" type="checkbox" /></label>
          </div>
        </section>

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

        <section className="settings-pane" data-settings-pane="models" hidden>
          <h3 className="settings-section-title">Models</h3>
          <div className="settings-card">
            <div className="settings-row">
              <div className="full-row">
                <h3>Runtime routing</h3>
                <p>Choose STT and AI runtime independently.</p>
                <div className="capture-mode-pills runtime-mode-pills">
                  <span>STT:</span>
                  <label><input id="sttRuntimeModeOnline" name="sttRuntimeModeProfile" type="radio" value="online" />Online</label>
                  <label><input id="sttRuntimeModeOffline" name="sttRuntimeModeProfile" type="radio" value="offline" />Offline</label>
                </div>
                <div className="capture-mode-pills runtime-mode-pills">
                  <span>AI:</span>
                  <label><input id="aiRuntimeModeOnline" name="aiRuntimeModeProfile" type="radio" value="online" />Online</label>
                  <label><input id="aiRuntimeModeOffline" name="aiRuntimeModeProfile" type="radio" value="offline" />Offline</label>
                </div>
                <p id="runtimeModeNotice" className="notice">
                  Online mode is active. API base URL + API key will be used for STT and AI.
                </p>
              </div>
            </div>

            <div id="onlineProviderSection" className="settings-row">
              <div className="full-row">
                <h3>Online provider models</h3>
                <div className="compact-grid">
                  <label className="field" data-online-field="base-url">
                    <span>API Base URL</span>
                    <input id="apiBaseUrlInput" type="text" placeholder="Use default provider URL" autoComplete="off" />
                  </label>
                  <label className="field" data-online-field="stt-model">
                    <span>STT model</span>
                    <input id="sttModelInput" type="text" placeholder="Use default STT model" autoComplete="off" />
                  </label>
                </div>
                <label className="field">
                  <span>Provider API Key</span>
                  <input id="apiKeyInput" type="password" placeholder="Paste your API key" autoComplete="off" />
                </label>
                <label className="checkbox-field">
                  <input id="rememberApiKeyInput" type="checkbox" />
                  <span>Remember API key locally on this machine</span>
                </label>
                <label className="field" data-online-field="ai-model">
                  <span>AI model</span>
                  <input id="aiModelInput" type="text" placeholder="Use default AI model" autoComplete="off" />
                </label>
                <label className="field">
                  <span>Model catalog</span>
                  <select id="providerModelCatalogSelect">
                    <option value="">Fetch models to load catalog...</option>
                  </select>
                </label>
                <div className="button-row">
                  <button id="fetchProviderModelsBtn" className="ghost-action" type="button">Fetch models</button>
                  <button id="applyModelToAiBtn" className="ghost-action" type="button">Use for AI</button>
                  <button id="applyModelToSttBtn" className="ghost-action" type="button">Use for STT</button>
                </div>
                <p id="onlineProviderModeNotice" className="notice">Used only in online mode.</p>
              </div>
            </div>

            <div id="offlineOllamaSection" className="settings-row">
              <div className="full-row">
                <h3>Ollama (local AI / offline LLM)</h3>
                <div className="compact-grid">
                  <label className="field">
                    <span>Ollama Base URL</span>
                    <input id="localOllamaBaseUrlInput" type="text" placeholder={DEFAULT_LOCAL_OLLAMA_BASE_URL} autoComplete="off" />
                  </label>
                  <label className="field">
                    <span>Ollama model</span>
                    <input id="localOllamaModelInput" type="text" placeholder="llama3.1:8b, qwen2.5:7b, etc." autoComplete="off" />
                  </label>
                </div>
                <label className="field">
                  <span>Ollama model catalog</span>
                  <select id="localOllamaModelCatalogSelect">
                    <option value="">Fetch models to load catalog...</option>
                  </select>
                </label>
                <p id="ollamaStatusNotice" className="notice">Ollama status has not been checked yet.</p>
                <div className="button-row">
                  <button id="checkOllamaStatusBtn" className="ghost-action" type="button">Check Ollama status</button>
                  <button id="installOllamaBtn" className="ghost-action" type="button">Install Ollama</button>
                  <button id="fetchOllamaModelsBtn" className="ghost-action" type="button">Fetch Ollama models</button>
                  <button id="useOllamaModelBtn" className="ghost-action" type="button">Use selected model</button>
                  <button id="pullOllamaModelBtn" className="ghost-action" type="button">Pull/download model</button>
                </div>
              </div>
            </div>

            <div id="offlineSttSection" className="settings-row">
              <div className="full-row">
                <h3>Local STT (Native Parakeet)</h3>
                <label className="field">
                  <span>Selected local STT model</span>
                  <input id="localSttModelInput" type="text" placeholder="Select a model from catalog below" autoComplete="off" readOnly />
                </label>
                <label className="field">
                  <span>Model catalog (NVIDIA Parakeet)</span>
                  <select id="localSttModelCatalogSelect">
                    <option value="">Loading built-in model catalog...</option>
                  </select>
                </label>
                <div className="button-row">
                  <button id="downloadLocalSttModelBtn" className="ghost-action" type="button">Download & install selected model</button>
                  <button id="deleteLocalSttModelBtn" className="ghost-action" type="button">Delete selected model</button>
                  <button id="openLocalSttModelPathBtn" className="ghost-action" type="button">Open selected model folder</button>
                </div>
                <div className="stt-download-status" aria-live="polite">
                  <div className="stt-download-track" role="progressbar" aria-valuemin={0} aria-valuemax={100}>
                    <span id="localSttDownloadProgressBar" className="stt-download-fill"></span>
                  </div>
                  <p id="localSttDownloadProgressText" className="notice">No local STT download in progress.</p>
                </div>
                <p id="localSttDownloadNotice" className="notice" style={{ display: "none" }}>
                  Pick a model from catalog and install it directly from inside the app.
                </p>
                <p className="notice">
                  Available models: Parakeet v3 (478 MB), Parakeet v2 (473 MB).
                </p>
              </div>
            </div>
            <p id="offlineRuntimeModeNotice" className="notice">
              In local mode, pipeline uses Ollama for AI and your selected local STT model for transcription.
            </p>
          </div>

          <h3 className="settings-section-title">Setup</h3>
          <div id="ttsBootstrapCard" className="settings-card tts-bootstrap-card">
            <div className="tts-bootstrap-head">
              <div>
                <h3>TTS Runtime Bootstrap</h3>
                <p>
                  Use one button to install and configure Piper runtime dependencies with live progress logs.
                </p>
              </div>
              <button id="setupAllTtsBtn" className="dark-action" type="button">Setup TTS runtime</button>
            </div>
            <p id="ttsSetupStatus" className="notice">Waiting for setup.</p>
            <div id="ttsSetupLogs" className="setup-log-list" aria-live="polite">
              <p className="setup-log-item">No setup logs yet.</p>
            </div>
          </div>

          <div id="ttsProfilesArea" hidden>
            <h3 className="settings-section-title">Profiles</h3>
            <div className="settings-card tts-engine-card">
              <label className="field inline-select">
                <span>Active engine profile</span>
                <select id="ttsEngineSelect">
                  <option value="piper">Piper (Main)</option>
                  <option value="coqui">Coqui (Disabled)</option>
                </select>
              </label>

              <div className="compact-grid">
                <label className="field">
                  <span>Quality</span>
                  <select id="coquiQualitySelect">
                    <option value="fast">Fast</option>
                    <option value="balanced">Balanced</option>
                    <option value="high">High quality</option>
                  </select>
                </label>
                <label className="field">
                  <span>Emotion style</span>
                  <select id="coquiEmotionSelect">
                    <option value="neutral">Neutral</option>
                    <option value="calm">Calm</option>
                    <option value="happy">Happy</option>
                    <option value="excited">Excited</option>
                    <option value="serious">Serious</option>
                    <option value="sad">Sad</option>
                  </select>
                </label>
              </div>

              <label className="field">
                <span>Speed <strong id="coquiSpeedValue">1.00x</strong></span>
                <input id="coquiSpeedInput" type="range" min="0.5" max="2" step="0.05" />
              </label>
              <label className="checkbox-field">
                <input id="coquiSplitSentencesToggle" type="checkbox" />
                <span>Split long replies into shorter sentence chunks (Coqui)</span>
              </label>
            </div>

            <div className="tts-profile-tabs" role="tablist" aria-label="TTS profiles">
              <button id="ttsProfilePiperTab" className="mini-tab is-active" type="button">Piper (Main)</button>
              <button id="ttsProfileCoquiTab" className="mini-tab" type="button">Coqui (Beta)</button>
            </div>

            <div id="ttsProfilePiperPanel" className="settings-card tts-profile-panel">
              <div className="tts-profile-grid">
                <label className="field">
                  <span>Piper executable path (optional override)</span>
                  <input id="piperPathInput" type="text" placeholder="Auto-filled after runtime setup" autoComplete="off" />
                </label>
                <div className="compact-grid">
                  <label className="field">
                    <span>Voice quality</span>
                    <select id="piperQualitySelect">
                      <option value="fast">Fast</option>
                      <option value="balanced">Balanced</option>
                      <option value="high">High quality</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Emotion style</span>
                    <select id="piperEmotionSelect">
                      <option value="neutral">Neutral</option>
                      <option value="calm">Calm</option>
                      <option value="happy">Happy</option>
                      <option value="excited">Excited</option>
                      <option value="serious">Serious</option>
                      <option value="sad">Sad</option>
                    </select>
                  </label>
                </div>
                <label className="field">
                  <span>Speed <strong id="piperSpeedValue">1.00x</strong></span>
                  <input id="piperSpeedInput" type="range" min="0.5" max="2" step="0.05" />
                </label>
                <p className="notice">Emotion/quality for Piper are expressive presets, not true voice cloning.</p>

                <div className="button-row">
                  <button id="setupRuntimeBtn" className="ghost-action" type="button">Re-setup Piper</button>
                  <button id="validatePiperBtn" className="ghost-action" type="button">Validate Piper</button>
                  <button id="downloadVoiceBtn" className="ghost-action" type="button">Download voice only</button>
                </div>
              </div>

              <div className="model-meta">
                <p><span>Base URL</span><code id="baseUrlValue">loading...</code></p>
                <p><span>STT Model</span><code id="sttModelValue">loading...</code></p>
                <p><span>AI Model</span><code id="aiModelValue">loading...</code></p>
                <p><span>Piper</span><code id="piperStatusValue">checking...</code></p>
                <p><span>Piper Path</span><code id="piperPathValue">-</code></p>
                <p><span>Voice</span><code id="voiceStatusValue">checking...</code></p>
                <p><span>Voice Path</span><code id="voicePathValue">-</code></p>
              </div>
            </div>

            <div id="ttsProfileCoquiPanel" className="settings-card tts-profile-panel" hidden>
              <p className="notice">Coqui is beta and loads only when you select it.</p>
              <div className="tts-profile-grid">
                <label className="field">
                  <span>Python path (optional override)</span>
                  <input id="coquiPythonPathInput" type="text" placeholder="Leave blank to use bundled/runtime python" autoComplete="off" />
                </label>
                <label className="field">
                  <span>Coqui model</span>
                  <input id="coquiModelInput" type="text" placeholder={DEFAULT_COQUI_MODEL} autoComplete="off" />
                </label>
                <label className="field">
                  <span>Language code</span>
                  <input id="coquiLanguageInput" type="text" placeholder="en" autoComplete="off" />
                </label>
                <label className="checkbox-field">
                  <input id="coquiUseGpuToggle" type="checkbox" />
                  <span>Use CUDA/GPU if available</span>
                </label>

                <div className="button-row">
                  <button id="setupCoquiBtn" className="ghost-action" type="button">Re-setup Coqui</button>
                  <button id="validateCoquiBtn" className="ghost-action" type="button">Validate Coqui</button>
                  <button id="refreshCoquiModelsBtn" className="ghost-action" type="button">Refresh models</button>
                </div>

                <label className="field">
                  <span>Model catalog</span>
                  <select id="coquiModelCatalogSelect">
                    <option value="">Load models list...</option>
                  </select>
                </label>

                <div className="model-meta">
                  <p><span>Status</span><code id="coquiStatusValue">checking...</code></p>
                  <p><span>Python</span><code id="coquiPythonValue">-</code></p>
                  <p><span>TTS Version</span><code id="coquiVersionValue">-</code></p>
                  <p><span>CUDA</span><code id="coquiCudaValue">-</code></p>
                  <p><span>Voice Dir</span><code id="coquiVoiceDirValue">-</code></p>
                </div>
              </div>

              <div className="tts-clone-card">
                <label className="field">
                  <span>Voice profile ID</span>
                  <input id="coquiVoiceIdInput" type="text" placeholder="my_voice_profile" autoComplete="off" />
                </label>
                <label className="field">
                  <span>Reference sample (WAV/MP3/WEBM, max 30 seconds)</span>
                  <input id="coquiVoiceFileInput" type="file" accept="audio/*" />
                </label>
                <p id="coquiCloneStatus" className="notice">Ready to clone a voice sample.</p>
                <div className="button-row">
                  <button id="cloneCoquiVoiceBtn" className="ghost-action" type="button">Clone voice</button>
                  <button id="testCoquiVoiceBtn" className="ghost-action" type="button">Test selected voice</button>
                  <button id="refreshCoquiVoicesBtn" className="ghost-action" type="button">Refresh voices</button>
                </div>
                <label className="field">
                  <span>Saved cloned voices</span>
                  <select id="coquiVoiceSelect">
                    <option value="">No voices found</option>
                  </select>
                </label>
                <audio id="coquiVoicePreview" controls preload="none"></audio>
                <p className="notice">Upload a clean sample between 3 and 30 seconds for best cloning quality.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="settings-pane" data-settings-pane="pipeline" hidden>
          <h3 className="settings-section-title">Prompting</h3>
          <div className="settings-card">
            <label className="field">
              <span>System Prompt</span>
              <textarea id="systemPromptInput" rows={4} spellCheck="false"></textarea>
            </label>
            <div className="compact-grid">
              <label className="field">
                <span>Temperature <strong id="temperatureValue">0.35</strong></span>
                <input id="temperatureInput" type="range" min="0" max="1.2" step="0.05" />
              </label>
              <label className="field">
                <span>Max Tokens</span>
                <input id="maxTokensInput" type="number" min="64" max="1024" step="16" />
              </label>
            </div>
          </div>

          <h3 className="settings-section-title">Pipeline status</h3>
          <div className="settings-card">
            <div className="pipeline-status-row">
              <div id="statusPill" className="status-pill" data-stage="idle">Idle</div>
              <p id="statusDetail" className="status-detail">Ready.</p>
            </div>
            <div className="latency-grid" aria-live="polite">
              <p><span>STT</span><strong id="sttLatency">-</strong></p>
              <p><span>AI</span><strong id="aiLatency">-</strong></p>
              <p><span>TTS</span><strong id="ttsLatency">-</strong></p>
              <p><span>Total</span><strong id="totalLatency">-</strong></p>
            </div>
            <p id="noticeText" className="notice">Ready.</p>
            <audio id="assistantAudio" controls preload="none"></audio>
          </div>
        </section>
      </section>
    </div>
  </div>

  <div id="flowBar" className="flow-bar" style={{ display: "none" }} data-tauri-drag-region="true">
    <button className="dock-mic-btn" type="button" aria-label="Toggle recording">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>
    </button>
    <div className="visualizer-container">
      <div className="viz-bar" style={{ height: "40%" }}></div>
      <div className="viz-bar" style={{ height: "70%" }}></div>
      <div className="viz-bar" style={{ height: "50%" }}></div>
      <div className="viz-bar" style={{ height: "90%" }}></div>
      <div className="viz-bar" style={{ height: "30%" }}></div>
    </div>
    <span id="dockStatus" className="dock-status">Ready</span>
  </div>

  <div id="selectionPopup" className="selection-popup" style={{ display: "none" }}>
    <div className="popup-text" id="selectionAssistantText">Processing...</div>
    <div className="popup-actions">
      <button className="ghost-action mini" type="button">Copy</button>
      <button className="ghost-action mini" type="button">Replace</button>
      <button className="close-settings mini" type="button">✕</button>
    </div>
  </div>

  <div className="hidden-runtime-state" aria-hidden="true" hidden>
    <span id="recordTimer">00.0s</span>
    <button id="recordBtn" className="hidden-record" type="button">Start Recording</button>
  </div>

    </>
  );
}
