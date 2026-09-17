/**
 * Usage tracking — Phase 5 shell decomposition.
 *
 * Owns trackUsage: word counting, stats mutation, session append,
 * achievement unlock, store notify. Moved verbatim from main.tsx; shell
 * seams (stats/sessions reads+writes, recording start time, persist,
 * metrics render, unlock, store notify) arrive via initUsageTracker so
 * this module never touches main.tsx module globals.
 */
import type { AchievementState, AnalyticsSessionDetail, UsageStats } from "../types";
import { accumulateUsage, countWords, newlyUnlockedAchievements } from "./analytics-service";

export interface UsageTrackerDeps {
  getStats: () => UsageStats;
  setStats: (stats: UsageStats) => void;
  getSessions: () => AnalyticsSessionDetail[];
  setSessions: (sessions: AnalyticsSessionDetail[]) => void;
  getAchievements: () => readonly AchievementState[];
  appendAchievements: (unlocked: AchievementState[]) => void;
  getRecordingStartedAt: () => number;
  persistStats: () => void;
  persistSessions: () => void;
  persistAchievements: () => void;
  renderMetrics: () => void;
  notifyStoreUpdated: () => void;
}

let trackerDeps!: UsageTrackerDeps;

export function initUsageTracker(deps: UsageTrackerDeps): void {
  trackerDeps = deps;
}

export function trackUsage(transcript: string): void {
  const words = countWords(transcript);
  if (words === 0) return;
  const stats = trackerDeps.getStats();
  const startedAt = trackerDeps.getRecordingStartedAt();
  const { stats: next, session } = accumulateUsage(stats, transcript, startedAt, Date.now());
  trackerDeps.setStats(next);
  trackerDeps.persistStats();
  trackerDeps.renderMetrics();

  if (session) {
    const sessions = [...trackerDeps.getSessions(), session];
    trackerDeps.setSessions(
      sessions.length > 5000 ? sessions.slice(-5000) : sessions,
    );
    trackerDeps.persistSessions();
  }
  const unlocked = newlyUnlockedAchievements(next, trackerDeps.getAchievements(), Date.now());
  if (unlocked.length > 0) {
    trackerDeps.appendAchievements(unlocked);
    trackerDeps.persistAchievements();
  }
  // Notify the UI on every dictation. The previous `if (activePage === "analytics")`
  // guard meant that sessions dictated on the Home / History / etc. pages never
  // reached the React store, so switching to the Analytics tab afterwards showed
  // stale (empty) data until the page was reloaded.
  trackerDeps.notifyStoreUpdated();
}
