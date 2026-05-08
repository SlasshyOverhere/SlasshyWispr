import {
  DICTIONARY_STORAGE_KEY,
  HOME_HISTORY_STORAGE_KEY,
  NOTES_STORAGE_KEY,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  SNIPPETS_STORAGE_KEY,
  USAGE_STORAGE_KEY,
} from './constants';
import { normalizeDictionaryEntries, normalizeSnippetEntries } from './utils';
import type {
  DictionaryTerm,
  HomeHistoryEntry,
  MainPage,
  QuickNoteEntry,
  SnippetEntry,
  UsageStats,
} from './types';

export interface UIState {
  activePage: MainPage;
  sidebarCollapsed: boolean;
  usage: UsageStats;
  history: HomeHistoryEntry[];
  dictionary: DictionaryTerm[];
  snippets: SnippetEntry[];
  notes: QuickNoteEntry[];
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

function loadInitialState(): UIState {
  return {
    activePage: 'home',
    sidebarCollapsed: localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true',
    usage: loadUsageStats(),
    history: loadHistory(),
    dictionary: loadDictionary(),
    snippets: loadSnippets(),
    notes: loadNotes(),
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
  };
}

export const uiStore = createUIStore();
