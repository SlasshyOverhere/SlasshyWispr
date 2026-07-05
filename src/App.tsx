import { useEffect, useState, useMemo } from 'react';
import { SettingsModal } from './components/settings/SettingsModal';
import { uiStore } from './store';
import type { UIState } from './store';
import { AnalyticsPage } from './components/analytics/AnalyticsPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OnboardingWizard } from './components/OnboardingWizard';
import type { HomeHistoryEntry, DictionaryTerm, SnippetEntry, QuickNoteEntry } from './types';

function useUIState() {
  const [state, setState] = useState<UIState>(uiStore.getState());
  useEffect(() => {
    return uiStore.subscribe(setState);
  }, []);
  return state;
}

type HistoryFilter = { filter: "all" | "day" | "week" | "month"; specificDate?: string };

function useHistoryFilter(): HistoryFilter {
  const [hf, setHf] = useState<HistoryFilter>({ filter: "all" });
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<HistoryFilter>).detail;
      if (detail) setHf(detail);
    };
    window.addEventListener("slasshy:history-filter", handler);
    return () => window.removeEventListener("slasshy:history-filter", handler);
  }, []);
  return hf;
}

function useHistorySearch(): string {
  const [query, setQuery] = useState("");
  useEffect(() => {
    const el = document.getElementById("historySearchInput") as HTMLInputElement | null;
    if (!el) return;
    const handler = () => setQuery(el.value.toLowerCase());
    el.addEventListener("input", handler);
    return () => el.removeEventListener("input", handler);
  }, []);
  return query;
}

function filterHistory(entries: HomeHistoryEntry[], hf: HistoryFilter): HomeHistoryEntry[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (hf.specificDate) {
    const parts = hf.specificDate.split("-");
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const end = start + 24 * 60 * 60 * 1000;
    return entries.filter(e => e.timestamp >= start && e.timestamp < end);
  }
  if (hf.filter === "day") return entries.filter(e => e.timestamp >= todayStart);
  if (hf.filter === "week") {
    const dow = now.getDay();
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow).getTime();
    return entries.filter(e => e.timestamp >= weekStart);
  }
  if (hf.filter === "month") {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return entries.filter(e => e.timestamp >= monthStart);
  }
  return entries;
}

export function App() {
  const state = useUIState();
  const historyFilter = useHistoryFilter();
  const historySearch = useHistorySearch();

  // Bolt: Memoize the filtered history to avoid recalculating the filter
  // on every render, especially when unrelated global state changes.
  const filteredHistory = useMemo(() => {
    let f = filterHistory(state.history, historyFilter);
    if (historySearch) {
      f = f.filter(e => e.content.toLowerCase().includes(historySearch));
    }
    return f;
  }, [state.history, historyFilter, historySearch]);

  // Bolt: Memoize the mapping of history entries to React elements
  // to prevent unnecessary DOM diffing and recreation on unrelated re-renders.
  const homeHistoryElements = useMemo(() => {
    if (state.incognitoMode || state.history.length === 0) return null;

    const formatDate = (ts: number) => {
      const d = new Date(ts);
      const day = d.getDate();
      const month = d.toLocaleString('en-US', { month: 'long' }).toUpperCase();
      const year = d.getFullYear();
      return `${day} ${month} ${year}`;
    };

    const getDateKey = (ts: number) => {
      const d = new Date(ts);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    };

    let lastDateKey = '';
    const elements: React.ReactNode[] = [];

    state.history.forEach((entry, i) => {
      const dateKey = getDateKey(entry.timestamp);
      if (dateKey !== lastDateKey) {
        lastDateKey = dateKey;
        elements.push(
          <div key={`date-${dateKey}`} className="history-date-header">
            <span>{formatDate(entry.timestamp)}</span>
          </div>
        );
      }
      elements.push(
        <HistoryRow key={`${entry.timestamp}-${i}`} entry={entry} />
      );
    });

    return elements;
  }, [state.history, state.incognitoMode]);

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
          <aside className="flow-sidebar">
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
              <button className={`nav-item ${state.activePage === 'dictionary' ? 'is-active' : ''}`} data-page-nav="dictionary" data-label="Dictionary" data-hotkey="Alt+3" aria-label="Dictionary (Alt+3)" type="button">
                <span className="nav-glyph">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path></svg>
                </span>
                <span>Dictionary</span>
                <span className="nav-keyhint">Alt+3</span>
              </button>
              <button className={`nav-item ${state.activePage === 'snippets' ? 'is-active' : ''}`} data-page-nav="snippets" data-label="Snippets" data-hotkey="Alt+4" aria-label="Snippets (Alt+4)" type="button">
                <span className="nav-glyph">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
                </span>
                <span>Snippets</span>
                <span className="nav-keyhint">Alt+4</span>
              </button>
              <button className={`nav-item ${state.activePage === 'notes' ? 'is-active' : ''}`} data-page-nav="notes" data-label="Notes" data-hotkey="Alt+5" aria-label="Notes (Alt+5)" type="button">
                <span className="nav-glyph">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </span>
                <span>Notes</span>
                <span className="nav-keyhint">Alt+5</span>
              </button>
              <button className={`nav-item ${state.activePage === 'analytics' ? 'is-active' : ''}`} data-page-nav="analytics" data-label="Analytics" data-hotkey="Alt+6" aria-label="Analytics (Alt+6)" type="button">
                <span className="nav-glyph">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
                </span>
                <span>Analytics</span>
                <span className="nav-keyhint">Alt+6</span>
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
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m14 9-3 3 3 3"/></svg>
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
            <section className={`flow-page ${state.activePage === 'home' ? 'is-active' : ''}`} data-page="home">
              <div className="flow-page-inner home-page">
                <header className="overview-header">
                  <h1 className="overview-title">Overview</h1>

                  <div className="overview-stats" id="statsHero" aria-label="Today's stats">
                    <div className="overview-stat">
                      <span className="overview-stat-label" id="statsTitle">Words</span>
                      <span className="overview-stat-value" id="metricWords">{((state.usage?.words ?? 0) + (state.usage?.prevWords ?? 0)).toLocaleString()}<span className="overview-stat-unit">w</span></span>
                      <span className="stat-trend" id="wordsTrend"><span>--</span></span>
                    </div>
                    <div className="overview-stat">
                      <span className="overview-stat-label">Spoken</span>
                      <span className="overview-stat-value" id="metricSpeakingTime">{state.usage ? Math.floor(((state.usage?.speakingSeconds ?? 0) + (state.usage?.prevSpeakingSeconds ?? 0)) / 60) : 0}<span className="overview-stat-unit">min</span></span>
                      <span className="stat-trend" id="timeTrend"><span>--</span></span>
                    </div>
                    <div className="overview-stat">
                      <span className="overview-stat-label">Sessions</span>
                      <span className="overview-stat-value" id="metricSessions">{((state.usage?.sessions ?? 0) + (state.usage?.prevSessions ?? 0)).toLocaleString()}</span>
                      <span className="stat-trend" id="sessionsTrend"><span>--</span></span>
                    </div>
                    <div className="overview-stat">
                      <span className="overview-stat-label">Pace</span>
                      <span className="overview-stat-value" id="metricWpm">{state.usage ? (() => { const totalLifeWords = state.usage.words + state.usage.prevWords; const totalLifeTime = state.usage.speakingSeconds + state.usage.prevSpeakingSeconds; return totalLifeTime > 0 ? Math.round((totalLifeWords / totalLifeTime) * 60) : 0; })() : 0}<span className="overview-stat-unit">wpm</span></span>
                      <span className="stat-trend" id="wpmTrend"><span>--</span></span>
                    </div>
                    <button id="clearStatsBtn" className="overview-clear-btn" type="button">Clear</button>
                  </div>
                </header>

                <section className="home-log">
                  <div className="section-head">
                    <div className="section-actions">
                      <button id="viewFullHistoryBtn" className="btn-secondary" type="button">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        View Full History
                      </button>
                      <button id="clearHistoryBtn" className="btn-ghost" type="button">Clear</button>
                    </div>
                  </div>
                  <div id="conversationLog" className="conversation-log" role="log" aria-live="polite">
                    {state.incognitoMode ? (
                      <p className="empty-hint">Incognito mode enabled. History is hidden.</p>
                    ) : state.history.length === 0 ? (
                      <div className="empty-hint">
                        <div className="empty-hint-icon">
                          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>
                        </div>
                        <h4>No activity yet</h4>
                        <p>Start dictating to see your recent transcriptions here.</p>
                      </div>
                    ) : (
                      homeHistoryElements
                    )}
                  </div>
                </section>
              </div>
            </section>

            <section className={`flow-page ${state.activePage === 'history' ? 'is-active' : ''}`} data-page="history">
              <div className="flow-page-inner">
                <header className="page-header-row">
                  <div>
                    <h1>History</h1>
                    <p className="page-subtitle">A full log of your transcriptions and AI interactions.</p>
                  </div>
                  <button id="clearHistoryBtnFull" className="dark-action" type="button">Clear all</button>
                </header>
                <div className="history-filters">
                  <button className="filter-btn active" data-filter="all">All</button>
                  <button className="filter-btn" data-filter="day">Today</button>
                  <button className="filter-btn" data-filter="week">This Week</button>
                  <button className="filter-btn" data-filter="month">This Month</button>
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
                  <div className="search-input-wrapper" style={{ marginLeft: 'auto', maxWidth: '220px' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    <input id="historySearchInput" type="text" placeholder="Search history..." autoComplete="off" />
                  </div>
                </div>
                <div id="fullHistoryLog" className="conversation-log full-history-log" role="log" aria-live="polite">
                   {state.incognitoMode ? (
                      <p className="empty-hint">Incognito mode enabled. History is hidden.</p>
                    ) : filteredHistory.length === 0 ? (
                      <div className="empty-hint">
                         <h4>No history yet</h4>
                      </div>
                    ) : (
                      filteredHistory.map((entry, i) => (
                        <HistoryRow key={`full-${entry.timestamp}-${i}`} entry={entry} />
                      ))
                    )}
                </div>
              </div>
            </section>

            <section className={`flow-page ${state.activePage === 'dictionary' ? 'is-active' : ''}`} data-page="dictionary">
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
                    <span id="dictionaryCount" className="badge-count">{state.dictionary.length} terms</span>
                  </div>

                  <div id="dictionaryList" className="dictionary-list-enhanced">
                    {state.dictionary.length === 0 ? (
                      <div className="empty-state">
                        <h4>No terms yet</h4>
                      </div>
                    ) : (
                      state.dictionary.map(term => (
                        <DictionaryRow key={term.id} term={term} />
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className={`flow-page ${state.activePage === 'snippets' ? 'is-active' : ''}`} data-page="snippets">
              <div className="flow-page-inner">
                <header className="page-header-row">
                  <div>
                    <h1>Snippets</h1>
                    <p className="page-subtitle">
                      <span id="snippetsCountBadge" className="badge-count">{state.snippets.length} snippets</span>
                      Create shortcuts for text you use frequently.
                    </p>
                  </div>
                  <button id="snippetsAddBtnTop" className="dark-action" type="button">Add new</button>
                </header>



                <article id="snippetFormContainer" className="snippet-card is-collapsed">
                  <div className="snippet-card-header">
                    <div className="snippet-card-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15V19A2 2 0 0 0 19 21H5A2 2 0 0 0 3 19V15"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                    </div>
                    <div className="snippet-card-title">
                      <h2>Text Shortcuts</h2>
                      <p>Define short phrases that expand into full paragraphs instantly.</p>
                    </div>
                  </div>
                  <form id="snippetForm" className="snippet-create-form">
                    <div className="snippet-input-group">
                      <div className="snippet-field">
                        <label htmlFor="snippetTriggerInput">Trigger</label>
                        <input id="snippetTriggerInput" type="text" placeholder="e.g., /sig" autoComplete="off" />
                      </div>
                      <div className="snippet-field">
                        <label htmlFor="snippetExpansionInput">Expansion</label>
                        <input id="snippetExpansionInput" type="text" placeholder="The text to insert" autoComplete="off" />
                      </div>
                    </div>
                    <div className="snippet-form-actions">
                      <button id="snippetAddBtn" className="dark-action" type="submit">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        <span>Add Shortcut</span>
                      </button>
                    </div>
                  </form>
                </article>

                <div id="snippetsList" className="snippets-grid">
                  {state.snippets.length === 0 ? (
                    <div className="empty-state">
                      <h4>No snippets yet</h4>
                    </div>
                  ) : (
                    state.snippets.map(snippet => (
                      <SnippetRow key={snippet.id} snippet={snippet} />
                    ))
                  )}
                </div>
              </div>
            </section>

            <section className={`flow-page ${state.activePage === 'notes' ? 'is-active' : ''}`} data-page="notes">
              <div className="flow-page-inner notes-layout">
                <header className="page-header-row">
                  <div>
                    <h1>Quick Notes</h1>
                    <p className="page-subtitle">Voice-captured thoughts, ready for review.</p>
                  </div>
                </header>

                <article className="quick-note-card">
                  <div className="quick-note-content">
                    <div className="quick-note-info">
                      <span className="quick-note-label">Capture a thought</span>
                      <h3>Tap to record a voice note</h3>
                    </div>
                    <button id="notesQuickMicBtn" className="notes-mic-btn" type="button" aria-label="Dictate a quick note">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>
                    </button>
                  </div>
                </article>

                <div className="notes-ledger">
                  <div className="notes-ledger-head">
                    <h3>Recent Notes</h3>
                  </div>
                  <div id="notesList" className="notes-list">
                    {state.notes.map(note => (
                      <NoteRow key={note.id} note={note} />
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className={`flow-page ${state.activePage === 'analytics' ? 'is-active' : ''}`} data-page="analytics">
              <div className="flow-page-inner">
                <ErrorBoundary>
                  <AnalyticsPage usage={state.usage} analyticsSessions={state.analyticsSessions} achievementStates={state.achievementStates} />
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

function HistoryRow({ entry }: { entry: HomeHistoryEntry }) {
  const [copied, setCopied] = useState(false);
  const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isAssistant = entry.tone === "assistant";

  const handleCopy = async () => {
    await navigator.clipboard.writeText(entry.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`conversation-entry ${isAssistant ? 'is-assistant' : 'is-user'}`}>
      <span className="entry-time">{time}</span>
      <p className="entry-content">{entry.content}</p>
      <div className="entry-actions">
        {copied ? (
          <span className="entry-copied">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </span>
        ) : (
          <button type="button" className="entry-action" onClick={handleCopy}>Copy</button>
        )}
      </div>
    </div>
  );
}

function DictionaryRow({ term }: { term: DictionaryTerm }) {
  return (
    <div className="dictionary-item-row" data-id={term.id}>
      <div className="dict-term spoken">
        <span className="term-label">Spoken</span>
        <code className="term-value">{term.source}</code>
      </div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="dict-connector" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>
      <div className="dict-term correct">
        <span className="term-label">Correct</span>
        <span className="term-value">{term.target}</span>
      </div>
      <button className="dictionary-remove-btn" type="button" data-action="remove-term" aria-label="Remove term">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
  );
}

function SnippetRow({ snippet }: { snippet: SnippetEntry }) {
  return (
    <article className="snippet-row" data-id={snippet.id}>
      <div className="managed-row-main">
        <code className="snippet-trigger">{snippet.trigger}</code>
      </div>
      <p className="snippet-expansion">{snippet.expansion}</p>
      <button className="delete-btn" type="button" data-action="remove-snippet" aria-label="Remove snippet">
        Remove
      </button>
    </article>
  );
}

function NoteRow({ note }: { note: QuickNoteEntry }) {
  const time = new Date(note.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  
  const handleRemove = (): void => {
    const raw = localStorage.getItem('slasshy-desktop-assistant-notes');
    if (!raw) return;
    try {
      const notes = JSON.parse(raw) as QuickNoteEntry[];
      const filtered = notes.filter(n => n.id !== note.id);
      localStorage.setItem('slasshy-desktop-assistant-notes', JSON.stringify(filtered));
      window.dispatchEvent(new CustomEvent('slasshy:store-updated'));
    } catch { /* ignore */ }
  };

  return (
    <div className="conversation-entry" data-id={note.id}>
      <span className="entry-time">{time}</span>
      <p className="entry-content">{note.text}</p>
      <div className="entry-actions">
        <button type="button" className="entry-action" onClick={handleRemove}>Remove</button>
      </div>
    </div>
  );
}
