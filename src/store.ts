import {
  ACHIEVEMENTS_STATE_KEY,
  ACTIVE_PAGE_STORAGE_KEY,
  ANALYTICS_SESSIONS_KEY,
  DICTIONARY_STORAGE_KEY,
  HOME_HISTORY_STORAGE_KEY,
  NOTES_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  SNIPPETS_STORAGE_KEY,
  USAGE_STORAGE_KEY,
} from './constants';
import { normalizeDictionaryEntries, normalizeSnippetEntries } from './utils';
import type {
  AchievementState,
  AnalyticsSessionDetail,
  DictionaryTerm,
  HomeHistoryEntry,
  MainPage,
  QuickNoteEntry,
  SnippetEntry,
  UsageStats,
} from './types';

function loadActivePage(): MainPage {
  const raw = localStorage.getItem(ACTIVE_PAGE_STORAGE_KEY);
  if (raw === 'home' || raw === 'history' || raw === 'dictionary' || raw === 'snippets' || raw === 'notes' || raw === 'analytics') {
    return raw;
  }
  return 'home';
}

export interface UIState {
  activePage: MainPage;
  sidebarCollapsed: boolean;
  usage: UsageStats;
  history: HomeHistoryEntry[];
  dictionary: DictionaryTerm[];
  snippets: SnippetEntry[];
  notes: QuickNoteEntry[];
  analyticsSessions: AnalyticsSessionDetail[];
  achievementStates: AchievementState[];
  incognitoMode: boolean;
}

type Listener = (state: UIState) => void;

function parseJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function loadUsageStats(): UsageStats {
  const parsed = parseJson<Partial<UsageStats>>(USAGE_STORAGE_KEY, {});
  return {
    sessions: Number.isFinite(parsed.sessions) ? parsed.sessions as number : 0,
    words: Number.isFinite(parsed.words) ? parsed.words as number : 0,
    avgWpm: Number.isFinite(parsed.avgWpm) ? parsed.avgWpm as number : 0,
    speakingSeconds: Number.isFinite(parsed.speakingSeconds) ? parsed.speakingSeconds as number : 0,
    prevSessions: Number.isFinite(parsed.prevSessions) ? parsed.prevSessions as number : 0,
    prevWords: Number.isFinite(parsed.prevWords) ? parsed.prevWords as number : 0,
    prevWpm: Number.isFinite(parsed.prevWpm) ? parsed.prevWpm as number : 0,
    prevSpeakingSeconds: Number.isFinite(parsed.prevSpeakingSeconds) ? parsed.prevSpeakingSeconds as number : 0,
    lastPeriodReset: Number.isFinite(parsed.lastPeriodReset) ? parsed.lastPeriodReset as number : Date.now(),
  };
}

function loadHistory(): HomeHistoryEntry[] {
  const parsed = parseJson<HomeHistoryEntry[]>(HOME_HISTORY_STORAGE_KEY, []);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((item) => {
    if (!item || typeof item.speaker !== 'string' || typeof item.content !== 'string') {
      return false;
    }
    if (item.tone !== 'assistant' && item.tone !== 'user') {
      return false;
    }
    return Number.isFinite(item.timestamp);
  });
}

const RECORDING_PREFIX = "rec_";
const RECORDING_MATCH_WINDOW_MS = 10_000;

function extractRecordingTimestamp(recordingId: string): number | null {
  if (!recordingId.startsWith(RECORDING_PREFIX)) {
    return null;
  }
  const parts = recordingId.split("_");
  if (parts.length < 2) {
    return null;
  }
  const ts = Number(parts[1]);
  return Number.isFinite(ts) ? ts : null;
}

export interface HistoryRecordingMatch {
  timestamp: number;
  recordingId: string;
}

export function matchHistoryToRecordings(
  entries: HomeHistoryEntry[],
  recordingIds: string[],
): HistoryRecordingMatch[] {
  const matches: HistoryRecordingMatch[] = [];
  for (const recordingId of recordingIds) {
    const recTs = extractRecordingTimestamp(recordingId);
    if (recTs === null) {
      continue;
    }
    for (const entry of entries) {
      if (entry.recordingId) {
        continue;
      }
      const diff = Math.abs(entry.timestamp - recTs);
      if (diff <= RECORDING_MATCH_WINDOW_MS) {
        matches.push({ timestamp: entry.timestamp, recordingId });
        break;
      }
    }
  }
  return matches;
}

function loadDictionary(): DictionaryTerm[] {
  const parsed = parseJson<DictionaryTerm[]>(DICTIONARY_STORAGE_KEY, []);
  return normalizeDictionaryEntries(Array.isArray(parsed) ? parsed : []);
}

function loadSnippets(): SnippetEntry[] {
  const parsed = parseJson<SnippetEntry[]>(SNIPPETS_STORAGE_KEY, []);
  return normalizeSnippetEntries(Array.isArray(parsed) ? parsed : []);
}

function loadNotes(): QuickNoteEntry[] {
  const parsed = parseJson<QuickNoteEntry[]>(NOTES_STORAGE_KEY, []);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((item) => item && typeof item.text === 'string');
}

function loadAnalyticsSessions(): AnalyticsSessionDetail[] {
  const parsed = parseJson<AnalyticsSessionDetail[]>(ANALYTICS_SESSIONS_KEY, []);
  if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  return backfillAnalyticsSessions();
}

function backfillAnalyticsSessions(): AnalyticsSessionDetail[] {
  const statsRaw = localStorage.getItem(USAGE_STORAGE_KEY);
  if (!statsRaw) return [];
  let stats: Partial<UsageStats>;
  try { stats = JSON.parse(statsRaw); } catch { return []; }
  const totalSessions = (stats.sessions ?? 0) + (stats.prevSessions ?? 0);
  const totalWords = (stats.words ?? 0) + (stats.prevWords ?? 0);
  const totalSeconds = (stats.speakingSeconds ?? 0) + (stats.prevSpeakingSeconds ?? 0);
  const avgWpm = stats.avgWpm ?? 0;
  if (totalSessions === 0 || totalWords === 0) return [];

  const historyRaw = localStorage.getItem(HOME_HISTORY_STORAGE_KEY);
  if (!historyRaw) return [];
  let historyEntries: HomeHistoryEntry[];
  try {
    historyEntries = JSON.parse(historyRaw);
    if (!Array.isArray(historyEntries) || historyEntries.length === 0) return [];
  } catch { return []; }

  const entries = [...historyEntries].reverse();
  const count = Math.min(entries.length, totalSessions);
  const sessions: AnalyticsSessionDetail[] = [];
  for (let i = 0; i < count; i++) {
    const wordEstimate = i < count - 1
      ? Math.round(totalWords / count)
      : totalWords - Math.round(totalWords / count) * (count - 1);
    const timeEstimate = i < count - 1
      ? Math.round(totalSeconds / count)
      : totalSeconds - Math.round(totalSeconds / count) * (count - 1);
    const wpm = timeEstimate > 0 ? Math.round((wordEstimate / timeEstimate) * 60) : Math.round(avgWpm);
    sessions.push({
      date: entries[i].timestamp,
      words: wordEstimate,
      speakingSeconds: timeEstimate,
      wpm: wpm || Math.round(avgWpm),
    });
  }
  if (sessions.length > 0) {
    localStorage.setItem(ANALYTICS_SESSIONS_KEY, JSON.stringify(sessions));
  }
  return sessions;
}

function loadAchievementStates(): AchievementState[] {
  const parsed = parseJson<AchievementState[]>(ACHIEVEMENTS_STATE_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}

function loadIncognitoMode(): boolean {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed?.incognitoMode === true;
  } catch {
    return false;
  }
}

function loadInitialState(): UIState {
  return {
    activePage: loadActivePage(),
    sidebarCollapsed: localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true',
    usage: loadUsageStats(),
    history: loadHistory(),
    dictionary: loadDictionary(),
    snippets: loadSnippets(),
    notes: loadNotes(),
    analyticsSessions: loadAnalyticsSessions(),
    achievementStates: loadAchievementStates(),
    incognitoMode: loadIncognitoMode(),
  };
}

function createUIStore() {
  let state = loadInitialState();
  const listeners = new Set<Listener>();

  const notify = () => {
    state = loadInitialState();
    listeners.forEach((listener) => listener(state));
  };

  window.addEventListener('storage', notify);
  window.addEventListener('slasshy:store-updated', notify);

  return {
    getState(): UIState {
      return state;
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reNotify(): void {
      notify();
    },
  };
}

export const uiStore = createUIStore();

/**
 * Remove a single history entry by its timestamp. History entries don't
 * carry a stable id, so we match on timestamp. Safe to call when no
 * entry matches — it's a no-op.
 */
export function removeHistoryEntry(timestamp: number): void {
  try {
    const raw = localStorage.getItem(HOME_HISTORY_STORAGE_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw) as HomeHistoryEntry[];
    if (!Array.isArray(entries)) return;
    const filtered = entries.filter((e) => e && e.timestamp !== timestamp);
    localStorage.setItem(HOME_HISTORY_STORAGE_KEY, JSON.stringify(filtered));
    window.dispatchEvent(new CustomEvent('slasshy:store-updated'));
  } catch {
    /* swallow — UI keeps the entry on screen; next store sync will retry */
  }
}
