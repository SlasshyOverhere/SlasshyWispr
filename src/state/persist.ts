/**
 * Shell persistence writers — Phase 5 shell decomposition.
 *
 * Owns the localStorage writers for usage stats, analytics sessions,
 * achievements, home history, persisted pages, and dock layout, plus
 * loadDockLayout (pure read/validate). Moved verbatim from main.tsx;
 * the in-memory lists arrive via accessors so this module never touches
 * main.tsx module globals. loadUsageStats keeps its 7-day rollover
 * semantics; the canonical thin loader stays in state/usage.ts.
 */
import {
  ACHIEVEMENTS_STATE_KEY,
  ACTIVE_PAGE_STORAGE_KEY,
  ANALYTICS_SESSIONS_KEY,
  DOCK_LAYOUT_STORAGE_KEY,
  HOME_HISTORY_STORAGE_KEY,
  USAGE_STORAGE_KEY,
} from "../constants";

// ponytail: key lives in main.tsx today; move to constants.ts when the
// settings-pane owner consolidates (Phase 4 follow-up), then import it.
const ACTIVE_SETTINGS_PANE_STORAGE_KEY = "slasshy-wispr-active-settings-pane-v1";
import type {
  AchievementState,
  AnalyticsSessionDetail,
  DockLayout,
  HomeHistoryEntry,
  MainPage,
  SettingsPane,
  UsageStats,
} from "../types";
import { coerceInteger, coerceNumber } from "./settings-store";
import { parseJson } from "./storage";

export interface ShellPersistDeps {
  getUsageStats: () => UsageStats;
  getSessions: () => AnalyticsSessionDetail[];
  getAchievements: () => AchievementState[];
  getHomeHistory: () => HomeHistoryEntry[];
  getDockLayout: () => DockLayout | null;
  setDockLayout: (layout: DockLayout) => void;
  parseMainPage: (value: string | undefined) => MainPage | null;
  parseSettingsPane: (value: string | undefined) => SettingsPane | null;
}

let persistDeps!: ShellPersistDeps;

export function initShellPersist(deps: ShellPersistDeps): void {
  persistDeps = deps;
}

export function loadUsageStats(): UsageStats {
  const raw = localStorage.getItem(USAGE_STORAGE_KEY);
  if (!raw) {
    return { sessions: 0, words: 0, avgWpm: 0, speakingSeconds: 0, prevSessions: 0, prevWords: 0, prevWpm: 0, prevSpeakingSeconds: 0, lastPeriodReset: Date.now() };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<UsageStats>;
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const lastReset = parsed.lastPeriodReset || 0;

    if (now - lastReset > sevenDaysMs) {
      const totalPrevWords = (parsed.prevWords || 0) + (parsed.words || 0);
      const totalPrevSeconds = (parsed.prevSpeakingSeconds || 0) + (parsed.speakingSeconds || 0);
      return {
        sessions: 0,
        words: 0,
        avgWpm: 0,
        speakingSeconds: 0,
        prevSessions: coerceInteger((parsed.prevSessions || 0) + (parsed.sessions || 0), 0, 0, 999_999),
        prevWords: coerceInteger(totalPrevWords, 0, 0, 99_999_999),
        prevWpm: coerceNumber(totalPrevSeconds > 0 ? Math.round((totalPrevWords / totalPrevSeconds) * 60) : 0, 0, 0, 600),
        prevSpeakingSeconds: coerceInteger(totalPrevSeconds, 0, 0, 99_999_999),
        lastPeriodReset: now,
      };
    }

    return {
      sessions: coerceInteger(parsed.sessions, 0, 0, 999_999),
      words: coerceInteger(parsed.words, 0, 0, 99_999_999),
      avgWpm: coerceNumber(parsed.avgWpm, 0, 0, 600),
      speakingSeconds: coerceInteger(parsed.speakingSeconds, 0, 0, 99_999_999),
      prevSessions: coerceInteger(parsed.prevSessions, 0, 0, 999_999),
      prevWords: coerceInteger(parsed.prevWords, 0, 0, 99_999_999),
      prevWpm: coerceNumber(parsed.prevWpm, 0, 0, 600),
      prevSpeakingSeconds: coerceInteger(parsed.prevSpeakingSeconds, 0, 0, 99_999_999),
      lastPeriodReset: coerceInteger(lastReset, 0, 0, Number.MAX_SAFE_INTEGER),
    };
  } catch {
    return { sessions: 0, words: 0, avgWpm: 0, speakingSeconds: 0, prevSessions: 0, prevWords: 0, prevWpm: 0, prevSpeakingSeconds: 0, lastPeriodReset: Date.now() };
  }
}

export function persistUsageStats(): void {
  localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(persistDeps.getUsageStats()));
}

export function persistAnalyticsSessionDetails(): void {
  localStorage.setItem(ANALYTICS_SESSIONS_KEY, JSON.stringify(persistDeps.getSessions()));
}

export function loadAchievementStates(): AchievementState[] {
  return parseJson<AchievementState[]>(ACHIEVEMENTS_STATE_KEY, []);
}

export function persistAchievementStates(): void {
  localStorage.setItem(ACHIEVEMENTS_STATE_KEY, JSON.stringify(persistDeps.getAchievements()));
}

export function loadPersistedMainPage(): MainPage {
  const persisted = localStorage.getItem(ACTIVE_PAGE_STORAGE_KEY);
  return persistDeps.parseMainPage(persisted ?? undefined) ?? "home";
}

export function loadPersistedSettingsPane(): SettingsPane {
  const persisted = localStorage.getItem(ACTIVE_SETTINGS_PANE_STORAGE_KEY);
  return persistDeps.parseSettingsPane(persisted ?? undefined) ?? "general";
}

export function persistHomeHistory(): void {
  localStorage.setItem(HOME_HISTORY_STORAGE_KEY, JSON.stringify(persistDeps.getHomeHistory()));
}

export function renderFullHistory(filter: "all" | "day" | "week" | "month" = "all", specificDate?: string): void {
  // React owns #fullHistoryLog. Dispatch filter event for React to apply.
  window.dispatchEvent(new CustomEvent("slasshy:history-filter", { detail: { filter, specificDate } }));
}

export function loadDockLayout(): DockLayout | null {
  const raw = localStorage.getItem(DOCK_LAYOUT_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DockLayout>;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) {
      return null;
    }

    return {
      x: Math.round(Number(parsed.x)),
      y: Math.round(Number(parsed.y)),
    };
  } catch {
    return null;
  }
}

export function persistDockLayout(layout: DockLayout): void {
  localStorage.setItem(DOCK_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}

export function updateAndPersistDockLayout(x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }

  persistDeps.setDockLayout({
    x: Math.round(x),
    y: Math.round(y),
  });
  persistDockLayout(persistDeps.getDockLayout() as DockLayout);
}
