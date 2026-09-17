/**
 * Shell-persist move-boundary test — Phase 5 shell decomposition.
 *
 * Pins the writers moved to state/persist: usage rollover on stale
 * lastPeriodReset, malformed-JSON fallback, achievement load, home
 * history round-trip, persisted page/pane fallbacks, dock layout
 * validation, and updateAndPersistDockLayout rounding. Runs against
 * the real localStorage via test-setup preload.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import {
  ANALYTICS_SESSIONS_KEY,
  DOCK_LAYOUT_STORAGE_KEY,
  HOME_HISTORY_STORAGE_KEY,
  USAGE_STORAGE_KEY,
} from "../constants";
import type {
  AchievementState,
  AnalyticsSessionDetail,
  DockLayout,
  HomeHistoryEntry,
  UsageStats,
} from "../types";
import {
  initShellPersist,
  loadAchievementStates,
  loadDockLayout,
  loadPersistedMainPage,
  loadPersistedSettingsPane,
  loadUsageStats,
  persistAchievementStates,
  persistAnalyticsSessionDetails,
  persistDockLayout,
  persistHomeHistory,
  persistUsageStats,
  renderFullHistory,
  updateAndPersistDockLayout,
} from "./persist";

function baseStats(): UsageStats {
  return {
    sessions: 0,
    words: 0,
    avgWpm: 0,
    speakingSeconds: 0,
    prevSessions: 0,
    prevWords: 0,
    prevWpm: 0,
    prevSpeakingSeconds: 0,
    lastPeriodReset: Date.now(),
  };
}

function wireHarness() {
  let stats = baseStats();
  let sessions: AnalyticsSessionDetail[] = [];
  let achievements: AchievementState[] = [];
  let history: HomeHistoryEntry[] = [];
  let layout: DockLayout | null = null;
  initShellPersist({
    getUsageStats: () => stats,
    getSessions: () => sessions,
    getAchievements: () => achievements,
    getHomeHistory: () => history,
    getDockLayout: () => layout,
    setDockLayout: (next) => {
      layout = next;
    },
    parseMainPage: (value) =>
      value === "home" || value === "history" ? (value as "home" | "history") : null,
    parseSettingsPane: (value) => (value === "general" ? "general" : null),
  });
  return {
    setStats: (next: UsageStats) => {
      stats = next;
    },
    setHistory: (next: HomeHistoryEntry[]) => {
      history = next;
    },
    setAchievements: (next: AchievementState[]) => {
      achievements = next;
    },
    getLayout: () => layout,
  };
}

beforeEach(() => {
  localStorage.clear();
  wireHarness();
});

describe("loadUsageStats", () => {
  it("returns zeroed stats when nothing is stored", () => {
    const stats = loadUsageStats();
    expect(stats.sessions).toBe(0);
    expect(stats.lastPeriodReset).toBeGreaterThan(0);
  });

  it("rolls current totals into prev after seven days", () => {
    const stale = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem(
      USAGE_STORAGE_KEY,
      JSON.stringify({ ...baseStats(), words: 100, sessions: 5, lastPeriodReset: stale }),
    );
    const stats = loadUsageStats();
    expect(stats.words).toBe(0);
    expect(stats.sessions).toBe(0);
    expect(stats.prevWords).toBe(100);
    expect(stats.prevSessions).toBe(5);
  });

  it("falls back to zeroed stats on malformed JSON", () => {
    localStorage.setItem(USAGE_STORAGE_KEY, "{broken");
    expect(loadUsageStats().words).toBe(0);
  });
});

describe("writers round-trip through localStorage", () => {
  it("persists stats, sessions, achievements, and history", () => {
    const harness = wireHarness();
    harness.setStats({ ...baseStats(), words: 42 });
    harness.setHistory([
      { speaker: "You", content: "hi", tone: "user", timestamp: 1 },
    ]);
    harness.setAchievements([{ id: "words-1k", unlockedAt: 2 }]);
    persistUsageStats();
    persistHomeHistory();
    persistAchievementStates();
    persistAnalyticsSessionDetails();
    expect(loadUsageStats().words).toBe(42);
    expect(loadAchievementStates()).toEqual([{ id: "words-1k", unlockedAt: 2 }]);
    expect(
      JSON.parse(localStorage.getItem(HOME_HISTORY_STORAGE_KEY) ?? "[]").length,
    ).toBe(1);
    expect(
      JSON.parse(localStorage.getItem(ANALYTICS_SESSIONS_KEY) ?? "[]"),
    ).toEqual([]);
  });
});

describe("pages, panes, and dock layout", () => {
  it("falls back to home/general on unknown values", () => {
    expect(loadPersistedMainPage()).toBe("home");
    expect(loadPersistedSettingsPane()).toBe("general");
  });

  it("validates dock layout coordinates", () => {
    expect(loadDockLayout()).toBeNull();
    localStorage.setItem(DOCK_LAYOUT_STORAGE_KEY, JSON.stringify({ x: 10.6, y: 20.4 }));
    expect(loadDockLayout()).toEqual({ x: 11, y: 20 });
    localStorage.setItem(DOCK_LAYOUT_STORAGE_KEY, JSON.stringify({ x: "a", y: 1 }));
    expect(loadDockLayout()).toBeNull();
  });

  it("rounds and persists layout updates, ignoring NaN", () => {
    const harness = wireHarness();
    updateAndPersistDockLayout(10.4, 20.5);
    expect(harness.getLayout()).toEqual({ x: 10, y: 21 });
    persistDockLayout({ x: 1, y: 2 });
    expect(loadDockLayout()).toEqual({ x: 1, y: 2 });
    updateAndPersistDockLayout(NaN, 1);
    expect(harness.getLayout()).toEqual({ x: 10, y: 21 });
  });

  it("dispatches the history filter event", () => {
    const seen: unknown[] = [];
    const listener = (event: Event) => {
      seen.push((event as CustomEvent).detail);
    };
    window.addEventListener("slasshy:history-filter", listener);
    try {
      renderFullHistory("week", "2026-01-01");
      expect(seen).toEqual([{ filter: "week", specificDate: "2026-01-01" }]);
    } finally {
      window.removeEventListener("slasshy:history-filter", listener);
    }
  });
});
