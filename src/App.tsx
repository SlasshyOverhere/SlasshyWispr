import { SettingsModal } from './components/settings/SettingsModal';

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
        <img src="/logo.png" alt="" className="brand-logo" style={{ width: "24px", height: "24px", objectFit: "contain" }} />
        <strong>SlasshyWispr</strong>
        <span className="brand-plan">Basic</span>
      </div>

      <nav className="nav-main" aria-label="Main navigation">
        <button className="nav-item" data-page-nav="home" data-label="Home" aria-label="Home" type="button"><span className="nav-glyph">⌂</span>Home</button>
        <button className="nav-item" data-page-nav="history" data-label="History" aria-label="History" type="button"><span className="nav-glyph">↺</span>History</button>
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
              <img src="/logo.png" alt="" style={{ width: "24px", height: "24px", objectFit: "contain" }} />
            </div>
            <div>
              <h1 className="overview-title">Overview</h1>
              <p className="overview-subtitle">Your SlasshyWispr performance snapshot, recent activity, and productivity trends.</p>
            </div>
          </header>

          <div className="section-head">
            <div>
              <h3 id="statsTitle">Productivity Trends</h3>
              <p className="section-sub">Real-time metrics from your dictation sessions.</p>
            </div>
            <div className="section-actions">
              <button id="clearStatsBtn" className="inline-link" type="button">Clear Stats</button>
            </div>
          </div>

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
              <div className="section-actions">
                <button id="viewFullHistoryBtn" className="inline-link" type="button">View Full History</button>
                <button id="clearHistoryBtn" className="inline-link" type="button">Clear History</button>
              </div>
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

      <section className="flow-page" data-page="history" hidden>
        <div className="flow-page-inner">
          <header className="page-header-row">
            <div>
              <h1>History</h1>
              <p className="page-subtitle">A full log of your transcriptions and AI interactions.</p>
            </div>
            <button id="clearHistoryBtnFull" className="dark-action" type="button">Clear all</button>
          </header>
          <div id="fullHistoryLog" className="conversation-log full-history-log" role="log" aria-live="polite">
            {/* Populated dynamically */}
          </div>
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

  <SettingsModal />

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
