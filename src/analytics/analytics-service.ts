import { ACHIEVEMENT_DEFS } from "../state/achievements";
import type { AchievementState, AnalyticsSessionDetail, UsageStats } from "../types";

/**
 * Canonical analytics pure helpers — Phase 5g extraction from main.tsx.
 * No DOM, no module state. Callers pass stats/sessions explicitly.
 * DOM renderers (updateUsageMetrics/updateTrendIndicator) and trackUsage
 * stay in main.tsx — they mutate shell state + element refs.
 */

export function countWords(value: string): number {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function formatSpeakingTime(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours <= 0) {
    return `${minutes}m`;
  }

  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

export interface UsageAccumulation {
  stats: UsageStats;
  sessions: AnalyticsSessionDetail[];
}

/** Pure accumulation step of trackUsage: returns next stats + new session. */
export function accumulateUsage(
  stats: UsageStats,
  transcript: string,
  startedAtMs: number,
  nowMs: number,
): { stats: UsageStats; session: AnalyticsSessionDetail | null } {
  const words = countWords(transcript);
  if (words === 0) return { stats, session: null };
  const seconds = Math.max((nowMs - startedAtMs) / 1000, 1);
  const next: UsageStats = {
    ...stats,
    sessions: stats.sessions + 1,
    words: stats.words + words,
    speakingSeconds: stats.speakingSeconds + Math.round(seconds),
    avgWpm: 0,
  };
  const currentWpm = (words / seconds) * 60;
  next.avgWpm = Math.round(((stats.avgWpm * (next.sessions - 1)) + currentWpm) / next.sessions);
  return {
    stats: next,
    session: {
      date: startedAtMs,
      words,
      speakingSeconds: Math.round(seconds),
      wpm: Math.round(currentWpm),
    },
  };
}

/** Pure achievement unlock: returns states to append (no mutation). */
export function newlyUnlockedAchievements(
  stats: UsageStats,
  existing: readonly AchievementState[],
  nowMs: number,
): AchievementState[] {
  const out: AchievementState[] = [];
  for (const def of ACHIEVEMENT_DEFS) {
    const currentVal = def.metric === 'words' ? stats.words : def.metric === 'sessions' ? stats.sessions : stats.speakingSeconds;
    if (currentVal >= def.threshold) {
      if (!existing.some(a => a.id === def.id) && !out.some(a => a.id === def.id)) {
        out.push({ id: def.id, unlockedAt: nowMs });
      }
    }
  }
  return out;
}
