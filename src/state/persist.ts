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
const ACTIVE_SETTINGS_PANE_STORAGE_KEY = "slasshywispr-active-settings-pane-v1";
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
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

/**
 * F-024: the write-heavy keys (usage, sessions, history, dock) were being
 * stringified synchronously on every dictation and every dock drag frame.
 * Coalesce them into one write per key per 300ms window and flush on
 * hide/unload so nothing is lost when the window closes.
 */
const PERSIST_DEBOUNCE_MS = 300;
const MAX_PERSISTED_SESSIONS = 5000;

const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

function writeNow(key: string, serialize: () => string): void {
  const pending = pendingWrites.get(key);
  if (pending !== undefined) {
    clearTimeout(pending);
    pendingWrites.delete(key);
  }
  try {
    localStorage.setItem(key, serialize());
  } catch {
    // Quota exceeded — keep the in-memory state; the next write retries.
  }
}

function debouncedWrite(key: string, serialize: () => string): void {
  const pending = pendingWrites.get(key);
  if (pending !== undefined) {
    clearTimeout(pending);
  }
  pendingWrites.set(
    key,
    setTimeout(() => {
      pendingWrites.delete(key);
      writeNow(key, serialize);
    }, PERSIST_DEBOUNCE_MS),
  );
}

/** F-024: write every pending key immediately (window hide / beforeunload). */
export function flushPendingWrites(): void {
  for (const [key, pending] of pendingWrites) {
    clearTimeout(pending);
    pendingWrites.delete(key);
    try {
      localStorage.setItem(key, serializeForKey(key));
    } catch {
      // Best-effort on the way out.
    }
  }
}

function serializeForKey(key: string): string {
  switch (key) {
    case USAGE_STORAGE_KEY:
      return JSON.stringify(persistDeps.getUsageStats());
    case ANALYTICS_SESSIONS_KEY:
      return JSON.stringify(persistDeps.getSessions().slice(-MAX_PERSISTED_SESSIONS));
    case HOME_HISTORY_STORAGE_KEY:
      return JSON.stringify(persistDeps.getHomeHistory());
    default:
      return "null";
  }
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", flushPendingWrites);
}
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushPendingWrites();
    }
  });
}

export function persistUsageStats(): void {
  debouncedWrite(USAGE_STORAGE_KEY, () => serializeForKey(USAGE_STORAGE_KEY));
}

export function persistAnalyticsSessionDetails(): void {
  debouncedWrite(ANALYTICS_SESSIONS_KEY, () => serializeForKey(ANALYTICS_SESSIONS_KEY));
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
  debouncedWrite(HOME_HISTORY_STORAGE_KEY, () => serializeForKey(HOME_HISTORY_STORAGE_KEY));
}

export function renderFullHistory(filter: "all" | "day" | "week" | "month" = "all", specificDate?: string): void {
  // React owns #fullHistoryLog. Dispatch filter event for React to apply.
  window.dispatchEvent(new CustomEvent("slasshywispr:history-filter", { detail: { filter, specificDate } }));
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

export async function persistDockPositionFromWindow(win: WebviewWindow | null): Promise<void> {
  if (!win) {
    return;
  }

  try {
    const position = await win.outerPosition();
    updateAndPersistDockLayout(position.x, position.y);
  } catch {
    // Best-effort snapshot only.
  }
}
