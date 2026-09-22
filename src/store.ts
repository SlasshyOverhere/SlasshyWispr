import {
  ACHIEVEMENTS_STATE_KEY,
  ACTIVE_PAGE_STORAGE_KEY,
  HOME_HISTORY_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
} from './constants';
import { parseJson } from './state/storage';
import { loadHistory } from './state/history';
import { loadUsageStats, loadAnalyticsSessions } from './state/usage';
import type {
  AchievementState,
  AnalyticsSessionDetail,
  HomeHistoryEntry,
  MainPage,
  UsageStats,
} from './types';

function loadActivePage(): MainPage {
  const raw = localStorage.getItem(ACTIVE_PAGE_STORAGE_KEY);
  if (raw === 'home' || raw === 'history' || raw === 'analytics') {
    return raw;
  }
  return 'home';
}

export interface UIState {
  activePage: MainPage;
  usage: UsageStats;
  history: HomeHistoryEntry[];
  analyticsSessions: AnalyticsSessionDetail[];
  achievementStates: AchievementState[];
  incognitoMode: boolean;
}

type Listener = (state: UIState) => void;

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
    usage: loadUsageStats(),
    history: loadHistory(),
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
  window.addEventListener('slasshywispr:store-updated', notify);

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
    window.dispatchEvent(new CustomEvent('slasshywispr:store-updated'));
  } catch {
    /* swallow — UI keeps the entry on screen; next store sync will retry */
  }
}
