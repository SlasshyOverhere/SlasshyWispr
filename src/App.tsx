import { SettingsModal } from './components/settings/SettingsModal';

export function App() {
  return (
    <>
      <div className="app-frame">
        <header className="app-titlebar">
          <div id="appTitlebarDrag" className="app-titlebar-drag" data-tauri-drag-region="true">
            <div className="brand-row">
              <strong>SlasshyWispr</strong>
            </div>
          </div>
          <div className="app-titlebar-actions">
            <button id="windowMinimizeBtn" className="titlebar-action" type="button" aria-label="Minimize">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
            <button id="windowMaximizeBtn" className="titlebar-action" type="button" aria-label="Maximize">
              <svg id="windowMaximizeGlyph" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="1" ry="1"></rect></svg>
            </button>
            <button id="windowCloseBtn" className="titlebar-action titlebar-close" type="button" aria-label="Close">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        </header>

        <div className="flow-shell">
          <aside className="flow-sidebar">
            <nav className="nav-main" aria-label="Main navigation">
              <button className="nav-item" data-page-nav="home" data-label="Home" data-hotkey="Alt+1" aria-label="Home (Alt+1)" type="button">
                <span className="nav-glyph">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                </span>
                <span>Home</span>
                <span className="nav-keyhint">Alt+1</span>
              </button>
              <button className="nav-item" data-page-nav="history" data-label="History" data-hotkey="Alt+2" aria-label="History (Alt+2)" type="button">
                <span className="nav-glyph">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l4 2"></path></svg>
                </span>
                <span>History</span>
                <span className="nav-keyhint">Alt+2</span>
              </button>
              <button className="nav-item" data-page-nav="dictionary" data-label="Dictionary" data-hotkey="Alt+3" aria-label="Dictionary (Alt+3)" type="button">
                <span className="nav-glyph">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path></svg>
                </span>
                <span>Dictionary</span>
                <span className="nav-keyhint">Alt+3</span>
              </button>
              <button className="nav-item" data-page-nav="snippets" data-label="Snippets" data-hotkey="Alt+4" aria-label="Snippets (Alt+4)" type="button">
                <span className="nav-glyph">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
                </span>
                <span>Snippets</span>
                <span className="nav-keyhint">Alt+4</span>
              </button>
              <button className="nav-item" data-page-nav="notes" data-label="Notes" data-hotkey="Alt+5" aria-label="Notes (Alt+5)" type="button">
                <span className="nav-glyph">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </span>
                <span>Notes</span>
                <span className="nav-keyhint">Alt+5</span>
              </button>
            </nav>

            <div className="nav-divider"></div>

            <nav className="nav-secondary" aria-label="Secondary navigation">
              <button id="sidebarToggleLocalSttBtn" className="secondary-link secondary-link-local-stt" data-label="Load local STT model" data-hotkey="Alt+D" aria-label="Load local STT model (Alt+D)" data-stt-state="ready" type="button" hidden>
                <span id="sidebarToggleLocalSttGlyph" className="secondary-glyph">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" x2="12" y1="19" y2="22"></line></svg>
                </span>
                <span id="sidebarToggleLocalSttLabel">Load STT</span>
                <span className="nav-keyhint">Alt+D</span>
              </button>
              <button id="toggleSidebarBtn" className="secondary-link" type="button" data-label="Collapse sidebar" data-hotkey="Alt+B" aria-label="Collapse sidebar (Alt+B)">
                <span className="secondary-glyph">
                  <span className="ico-grid secondary-glyph"></span>
                </span>
                <span>Collapse Sidebar</span>
                <span className="nav-keyhint">Alt+B</span>
              </button>
        <button id="openSettingsBtn" className="secondary-link" data-label="Settings" data-hotkey="Alt+S" aria-label="Settings (Alt+S)" type="button">
          <span className="secondary-glyph">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </span>
          <span>Settings</span>
          <span className="nav-keyhint">Alt+S</span>
        </button>            </nav>
          </aside>

          <main className="flow-content">
            <section className="flow-page is-active" data-page="home">
              <div className="flow-page-inner home-page">
                <header className="overview-header">
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
                    <div className="stat-meta">
                      <span className="stat-trend stat-trend-up" id="wordsTrend">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                        <span>+0%</span>
                      </span>
                      <span className="stat-period">vs last 7 days</span>
                    </div>
                  </article>
                  <article className="stat-card">
                    <div className="stat-card-header">
                      <span className="stat-label">SPEAKING TIME</span>
                      <span className="stat-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                      </span>
                    </div>
                    <div className="stat-value" id="metricSpeakingTime">0m</div>
                    <div className="stat-meta">
                      <span className="stat-trend stat-trend-up" id="timeTrend">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                        <span>+0%</span>
                      </span>
                      <span className="stat-period">vs last 7 days</span>
                    </div>
                  </article>
                  <article className="stat-card">
                    <div className="stat-card-header">
                      <span className="stat-label">SESSIONS</span>
                      <span className="stat-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>
                      </span>
                    </div>
                    <div className="stat-value" id="metricSessions">0</div>
                    <div className="stat-meta">
                      <span className="stat-trend stat-trend-up" id="sessionsTrend">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                        <span>+0%</span>
                      </span>
                      <span className="stat-period">vs last 7 days</span>
                    </div>
                  </article>
                  <article className="stat-card">
                    <div className="stat-card-header">
                      <span className="stat-label">AVG PACE</span>
                      <span className="stat-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>
                      </span>
                    </div>
                    <div className="stat-value" id="metricWpm">0 <span className="stat-unit">wpm</span></div>
                    <div className="stat-meta">
                      <span className="stat-trend stat-trend-up" id="wpmTrend">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                        <span>+0%</span>
                      </span>
                      <span className="stat-period">vs last 7 days</span>
                    </div>
                  </article>
                </div>

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
                  <button id="dictionaryAddBtnTop" className="dark-action" type="button">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    Add new
                  </button>
                </header>
                
                <div className="dictionary-container">
                  <article id="dictionaryFormCard" className="focus-card dictionary-form-card is-collapsed">
                    <div className="card-header-simple">
                      <div className="card-icon-title">
                        <div className="card-icon-bg">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path></svg>
                        </div>
                        <h3>Vocabulary Training</h3>
                      </div>
                      <button id="dictionaryFormCloseBtn" className="icon-close-btn" type="button">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                      </button>
                    </div>
                    
                    <p className="card-description">
                      Add specific pronunciations or spellings for names, products, and technical terms 
                      to ensure perfect transcription.
                    </p>

                    <form id="dictionaryForm" className="dictionary-form-grid">
                      <div className="input-group">
                        <label htmlFor="dictionarySourceInput">Spoken term</label>
                        <div className="input-with-icon">
                          <div className="input-icon">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path></svg>
                          </div>
                          <input id="dictionarySourceInput" type="text" placeholder="e.g., slashy" autoComplete="off" />
                        </div>
                      </div>

                      <div className="input-connector">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                      </div>

                      <div className="input-group">
                        <label htmlFor="dictionaryTargetInput">Correct term</label>
                        <div className="input-with-icon">
                          <div className="input-icon">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                          </div>
                          <input id="dictionaryTargetInput" type="text" placeholder="e.g., Slasshy" autoComplete="off" />
                        </div>
                      </div>

                      <div className="form-actions">
                        <button id="dictionaryAddBtn" className="dark-action" type="submit">Add term</button>
                      </div>
                    </form>
                  </article>

                  <div className="dictionary-list-header">
                    <h3>Active Dictionary</h3>
                    <span id="dictionaryCount" className="badge-count">0 terms</span>
                  </div>

                  <div id="dictionaryList" className="dictionary-list-enhanced">
                    {/* Populated by renderDictionaryList() */}
                  </div>
                </div>
              </div>
            </section>

            <section className="flow-page" data-page="snippets" hidden>
              <div className="flow-page-inner">
                <header className="page-header-row">
                  <div>
                    <h1>Snippets</h1>
                    <p className="page-subtitle">
                      <span id="snippetsCountBadge" className="badge-count">0 snippets</span>
                      Create shortcuts for text you use frequently.
                    </p>
                  </div>
                  <button id="snippetsAddBtnTop" className="dark-action" type="button">Add new</button>
                </header>

                <div className="search-bar-row">
                  <div className="search-input-wrapper">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    <input id="snippetsSearchInput" type="text" placeholder="Search snippets..." autoComplete="off" />
                  </div>
                </div>

                <article id="snippetFormContainer" className="focus-card is-collapsed">
                  <h2>Text Shortcuts</h2>
                  <p>Define short phrases that expand into full paragraphs or templates instantly.</p>
                  <form id="snippetForm" className="inline-create-form">
                    <input id="snippetTriggerInput" type="text" placeholder="Trigger (example: /sig)" autoComplete="off" />
                    <input id="snippetExpansionInput" type="text" placeholder="Expansion text" autoComplete="off" />

                    <button id="snippetAddBtn" className="dark-action" type="submit">Add snippet</button>
                  </form>
                </article>

                <div id="snippetsList" className="snippets-grid">
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
