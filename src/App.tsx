import { lazy, Suspense, useEffect } from 'react';
import { toggleMainWindowVisibility } from './ipc/client';
import { SettingsModal } from './components/settings/SettingsModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OnboardingWizard } from './components/OnboardingWizard';
import type { HomeHistoryEntry } from './types';
import {
  useUIState,
  useHistoryFilter,
  useHistorySearch,
  useLastSevenDaysWords,
  filterHistory,
} from './app/hooks';
import { buildHomeList } from './app/rows/HomeEntryCard';
import { PaceSparkline } from './app/rows/PaceSparkline';
import { HistoryRow } from './app/rows/HistoryRow';

/**
 * F-023: analytics is the heaviest pane and is not on the default (Home) view,
 * so it loads on demand. The Suspense fallback is a plain placeholder — never
 * an animation gate, so the pane is always reachable.
 */
const AnalyticsPage = lazy(() =>
  import('./components/analytics/AnalyticsPage').then((mod) => ({ default: mod.AnalyticsPage })),
);

export function App() {
  const state = useUIState();
  const historyFilter = useHistoryFilter();
  const historySearch = useHistorySearch();
  const pace = useLastSevenDaysWords(state.analyticsSessions);

  /* Copy handler for Home entry cards. Promise-safe with a timeout
     fallback so the "Copied" tick always clears. */
  const handleEntryCopy = async (
    entry: HomeHistoryEntry,
    setCopied: (v: boolean) => void
  ) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(entry.content);
      }
    } catch {
      /* clipboard might not exist in some sandboxes — best effort. */
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  useEffect(() => {
    const onDblClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      // Only fire when the user double-clicks the custom titlebar / drag region,
      // not when double-clicking on content (sidebar / pages / buttons).
      const inDragRegion = target.closest(
        '[data-tauri-drag-region="true"], .app-drag-region'
      );
      if (!inDragRegion) return;
      void toggleMainWindowVisibility().catch((err) => {
        console.error('toggle_main_window_visibility failed', err);
      });
    };
    document.addEventListener('dblclick', onDblClick);
    return () => document.removeEventListener('dblclick', onDblClick);
  }, []);

  function hf(entries: HomeHistoryEntry[]): HomeHistoryEntry[] {
    let f = filterHistory(entries, historyFilter);
    if (historySearch) {
      f = f.filter(e => e.content.toLowerCase().includes(historySearch));
    }
    return f;
  }

  return (
    <>
      <div className={`app-frame ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="window-controls">
          <button id="windowMinimizeBtn" className="window-btn" type="button" aria-label="Minimize">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </button>
          <button id="windowCloseBtn" className="window-btn window-close" type="button" aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        <div className="flow-shell">
          <div className="app-drag-region" data-tauri-drag-region="true"></div>
          <header className="topbar">
            <div className="brand-strip">
              <span className="brand-glyph" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" x2="12" y1="19" y2="22" />
                </svg>
              </span>
              <strong className="brand-word">SlasshyWispr<span className="brand-tagline">voice</span></strong>
            </div>

            <nav className="nav-main" aria-label="Main navigation">
              <button className={`nav-item ${state.activePage === 'home' ? 'is-active' : ''}`} data-page-nav="home" data-label="Home" data-hotkey="Alt+1" aria-label="Home (Alt+1)" type="button">
                <span className="nav-glyph">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                </span>
                <span>Home</span>
                <span className="nav-keyhint">Alt+1</span>
              </button>
              <button className={`nav-item ${state.activePage === 'history' ? 'is-active' : ''}`} data-page-nav="history" data-label="History" data-hotkey="Alt+2" aria-label="History (Alt+2)" type="button">
                <span className="nav-glyph">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l4 2"></path></svg>
                </span>
                <span>History</span>
                <span className="nav-keyhint">Alt+2</span>
              </button>
              <button className={`nav-item ${state.activePage === 'analytics' ? 'is-active' : ''}`} data-page-nav="analytics" data-label="Analytics" data-hotkey="Alt+3" aria-label="Analytics (Alt+3)" type="button">
                <span className="nav-glyph">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
                </span>
                <span>Analytics</span>
                <span className="nav-keyhint">Alt+3</span>
              </button>
            </nav>

            <nav className="nav-secondary" aria-label="Secondary navigation">
              <button id="sidebarToggleLocalSttBtn" className="secondary-link secondary-link-local-stt" data-label="Load local STT model" data-hotkey="Alt+D" aria-label="Load local STT model (Alt+D)" data-stt-state="ready" type="button" hidden>
                <span id="sidebarToggleLocalSttGlyph" className="secondary-glyph">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" x2="12" y1="19" y2="22"></line></svg>
                </span>
                <span id="sidebarToggleLocalSttLabel">Load STT</span>
                <span className="nav-keyhint">Alt+D</span>
              </button>
              <button id="toggleSidebarBtn" className="secondary-link" type="button" data-label="Compact tabs" data-hotkey="Alt+B" aria-label="Compact tabs (Alt+B)">
                <span className="secondary-glyph">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m14 9-3 3 3 3"/></svg>
                </span>
                <span>Compact</span>
                <span className="nav-keyhint">Alt+B</span>
              </button>
              <button id="openSettingsBtn" className="secondary-link" data-label="Settings" data-hotkey="Alt+S" aria-label="Settings (Alt+S)" type="button">
                <span className="secondary-glyph">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                </span>
                <span>Settings</span>
                <span className="nav-keyhint">Alt+S</span>
              </button>            </nav>
          </header>

          <main className="flow-content">
            <section className={`flow-page ${state.activePage === 'home' ? 'is-active' : ''}`} data-page="home">
              <div className="flow-page-inner home-page">
                <div className="home-main">
                  {/* Instrument panel: lifetime numbers and weekly pace. */}
                  <aside className="home-side">
                  {/* Stats row: three metric cards + trends. Hidden spans
                      are the existing main.tsx/analytics-render write
                      targets — do not rename their ids. */}
                  <section className="home-metrics" aria-label="Lifetime stats">
                    <div className="home-metric-head">
                      <span className="home-metric-kicker">Your numbers</span>
                      <span className="home-metric-head-r">
                        <button
                          id="viewFullHistoryBtn"
                          className="home-card-link"
                          type="button"
                        >
                          Detail
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="9 18 15 12 9 6"></polyline>
                          </svg>
                        </button>
                        <button
                          id="clearStatsBtn"
                          className="home-card-reset"
                          type="button"
                        >
                          Reset stats
                        </button>
                      </span>
                    </div>
                    <div className="home-metric-grid">
                      <div className="home-metric-card">
                        <span className="home-metric-num" id="metricWords">
                          {((state.usage?.words ?? 0) + (state.usage?.prevWords ?? 0)).toLocaleString()}
                        </span>
                        <span className="home-metric-label">Words</span>
                        <span className="home-trend stat-trend-neutral" id="wordsTrend"><span>--</span></span>
                      </div>
                      <div className="home-metric-card">
                        <span className="home-metric-num" id="metricWpm">
                          {state.usage ? Math.round(((state.usage.words + state.usage.prevWords) / Math.max(1, state.usage.speakingSeconds + state.usage.prevSpeakingSeconds)) * 60) : 0}
                        </span>
                        <span className="home-metric-label">Avg WPM</span>
                        <span className="home-trend stat-trend-neutral" id="wpmTrend"><span>--</span></span>
                      </div>
                      <div className="home-metric-card">
                        <span className="home-metric-num" id="metricSessions">
                          {(state.usage?.sessions ?? 0).toLocaleString()}
                        </span>
                        <span className="home-metric-label">Sessions</span>
                        <span className="home-trend stat-trend-neutral" id="sessionsTrend"><span>--</span></span>
                      </div>
                    </div>
                    <span id="metricSpeakingTime" hidden>{state.usage ? Math.floor(((state.usage?.speakingSeconds ?? 0) + (state.usage?.prevSpeakingSeconds ?? 0)) / 60) : 0}</span>
                    <span id="statsTitle" hidden>Stats</span>
                    <span id="timeTrend" hidden>--</span>
                  </section>

                  {/* Pace sparkline card — last 7 days + analytics link. */}
                  <section className="home-card home-pace" aria-label="Weekly pace">
                    <div className="home-card-head">
                      <h3 className="home-card-title">Pace</h3>
                      <span className="home-card-meta">
                        Last 7 days · from {pace.oldest}
                      </span>
                    </div>
                    <PaceSparkline points={pace.points} />
                    <div className="home-pace-footnote">
                      <span>
                        <strong>{state.usage?.words ?? 0}</strong> words today
                      </span>
                      <button
                        id="openAnalyticsBtn"
                        className="home-card-link"
                        type="button"
                        onClick={() => {
                          window.dispatchEvent(
                            new CustomEvent("slasshywispr:focus-analytics")
                          );
                        }}
                      >
                        Open analytics
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                      </button>
                    </div>
                  </section>

                  </aside>

                  {/* The dictation stream — the app's primary artifact. */}
                  <div className="home-stream">
                  <div className="home-list-head">
                    <span className="home-list-head-l">
                      <span className="home-list-head-icon" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 8v4l3 2" />
                          <circle cx="12" cy="12" r="9" />
                        </svg>
                      </span>
                      <span style={{ fontSize: '12.5px', fontWeight: 500, color: 'var(--ink-muted)', letterSpacing: '0.04em' }}>Recent activity</span>
                    </span>
                    <span className="home-list-head-r">
                      <button
                        id="clearHistoryBtn"
                        className="home-list-head-link"
                        type="button"
                        title="Clear all entries"
                      >
                        Clear
                      </button>
                      <button
                        id="historySearchBtn"
                        className="home-list-head-action"
                        type="button"
                        aria-label="Search history"
                        title="Search history"
                        onClick={() => {
                          /* Hand off to main.tsx so it can switch the
                             active page to History AND focus the search
                             input on the next frame. App.tsx alone can't
                             move the active page since main.tsx owns
                             that transition. */
                          window.dispatchEvent(
                            new CustomEvent("slasshywispr:focus-history-search")
                          );
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="8" />
                          <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                      </button>
                    </span>
                  </div>

                  <section className="home-log" role="log" aria-live="polite">
                    <div id="conversationLog" className="conversation-log">
                      {state.incognitoMode ? (
                        <p className="empty-hint">Incognito mode enabled. History is hidden.</p>
                      ) : state.history.length === 0 ? (
                        <div className="home-empty">
                          <span className="home-empty-title">Speak first. Edit second.</span>
                          <span className="home-empty-sub">
                            Start talking — your words land here, grouped by the day you said them.
                          </span>
                        </div>
                      ) : (
                        <ul className="home-list">
                          {buildHomeList(state.history, handleEntryCopy)}
                        </ul>
                      )}
                    </div>
                  </section>
                  </div>
                </div>
              </div>
            </section>

            <section className={`flow-page ${state.activePage === 'history' ? 'is-active' : ''}`} data-page="history">
              <div className="flow-page-inner">
                <header className="page-header-row hist-header">
                  <div>
                    <h1>History</h1>
                    <p className="page-subtitle">Every transcription in one place. <span className="hist-count">{state.history.length} {state.history.length === 1 ? "entry" : "entries"}</span></p>
                  </div>
                  <button id="clearHistoryBtnFull" className="history-clear-btn" type="button">Clear all</button>
                </header>
                <div className="history-filters">
                  <div className="hist-seg" role="group" aria-label="Time range">
                    <button className="filter-btn active" data-filter="all">All</button>
                    <button className="filter-btn" data-filter="day">Today</button>
                    <button className="filter-btn" data-filter="week">This Week</button>
                    <button className="filter-btn" data-filter="month">This Month</button>
                  </div>
                  <button id="datePickerBtn" className="filter-btn date-picker-btn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                    <span>Select Date</span>
                  </button>
                  <div id="customDatePicker" className="custom-date-picker" hidden>
                    <div className="date-picker-header">
                      <button type="button" className="date-nav-btn" id="prevMonthBtn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
                      </button>
                      <span id="currentMonthYear">May 2026</span>
                      <button type="button" className="date-nav-btn" id="nextMonthBtn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
                      </button>
                    </div>
                    <div className="date-picker-weekdays">
                      <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
                    </div>
                    <div id="datePickerDays" className="date-picker-days"></div>
                  </div>
                  <div className="search-input-wrapper">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    <input id="historySearchInput" type="text" placeholder="Search history..." autoComplete="off" />
                  </div>
                </div>
                <div id="fullHistoryLog" className="conversation-log full-history-log" role="log" aria-live="polite">
                   {state.incognitoMode ? (
                      <p className="empty-hint">Incognito mode enabled. History is hidden.</p>
                    ) : (() => {
                      const filtered = hf(state.history);
                      return filtered.length === 0 ? (
                        <div className="empty-hint hist-empty">
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
                          <h4>{state.history.length === 0 ? "No history yet" : "Nothing matches"}</h4>
                          <p>{state.history.length === 0 ? "Dictate anywhere and every word lands here, searchable by date." : "Try a different date range or search term."}</p>
                        </div>
                      ) : (
                        filtered.map((entry, i) => (
                          <HistoryRow key={`full-${entry.timestamp}-${i}`} entry={entry} />
                        ))
                      );
                    })()}
                </div>
              </div>
            </section>








            <section className={`flow-page ${state.activePage === 'analytics' ? 'is-active' : ''}`} data-page="analytics">
              <div className="flow-page-inner">
                <ErrorBoundary>
                  <Suspense fallback={<div className="empty-state"><p>Loading analytics…</p></div>}>
                    <AnalyticsPage usage={state.usage} analyticsSessions={state.analyticsSessions} achievementStates={state.achievementStates} />
                  </Suspense>
                </ErrorBoundary>
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

      {/* The notice area lives in the shell, not in a settings pane: a notice
          the user has to open Settings to read is not a notice. */}
      <div className="notice-toasts">
        <div id="noticeStack" className="notice-stack" aria-live="polite" />
      </div>

      <SettingsModal />

      <OnboardingWizard />

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
