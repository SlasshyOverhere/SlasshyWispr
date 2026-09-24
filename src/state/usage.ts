import {
  ANALYTICS_SESSIONS_KEY,
  HOME_HISTORY_STORAGE_KEY,
  USAGE_STORAGE_KEY,
} from "../constants";
import type { AnalyticsSessionDetail, HomeHistoryEntry, UsageStats } from "../types";
import { parseJson } from "./storage";

/**
 * Canonical usage + analytics-session loaders.
 *
 * Single owner — store.ts `loadUsageStats` is the thin variant kept here;
 * the 7-day rollover variant in main.tsx stays there until the settings/shell
 * phases (it needs main.tsx coercion helpers). The analytics backfill was
 * verbatim duplicated between store.ts and main.tsx; this is the one copy.
 */
export function loadUsageStats(): UsageStats {
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

export function loadAnalyticsSessions(): AnalyticsSessionDetail[] {
  const parsed = parseJson<AnalyticsSessionDetail[]>(ANALYTICS_SESSIONS_KEY, []);
  if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  return backfillAnalyticsSessions();
}

export function backfillAnalyticsSessions(): AnalyticsSessionDetail[] {
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
