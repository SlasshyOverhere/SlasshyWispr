/**
 * Analytics DOM render — Phase 5 shell decomposition.
 *
 * Owns updateUsageMetrics + updateTrendIndicator. Moved verbatim from
 * main.tsx; metric elements and the stats read arrive via
 * initAnalyticsRender so this module never touches main.tsx module
 * globals.
 */
import type { UsageStats } from "../types";
import { formatSpeakingTime } from "./analytics-service";

export interface AnalyticsMetricElements {
  words: HTMLElement;
  speakingTime: HTMLElement;
  sessions: HTMLElement;
  wpm: HTMLElement;
  wordsTrend: HTMLElement;
  timeTrend: HTMLElement;
  sessionsTrend: HTMLElement;
  wpmTrend: HTMLElement;
}

export interface AnalyticsRenderDeps {
  getStats: () => UsageStats;
}

let metricElements!: AnalyticsMetricElements;
let renderDeps!: AnalyticsRenderDeps;

export function initAnalyticsRender(
  elements: AnalyticsMetricElements,
  deps: AnalyticsRenderDeps,
): void {
  metricElements = elements;
  renderDeps = deps;
}

export function updateUsageMetrics(): void {
  const usageStats = renderDeps.getStats();
  const totalWords = usageStats.words + usageStats.prevWords;
  const totalSeconds = usageStats.speakingSeconds + usageStats.prevSpeakingSeconds;
  const totalSessions = usageStats.sessions + usageStats.prevSessions;
  metricElements.words.textContent = totalWords.toLocaleString();
  metricElements.speakingTime.textContent = formatSpeakingTime(totalSeconds);
  metricElements.sessions.textContent = totalSessions.toLocaleString();
  const lifetimeWpm = totalSeconds > 0 ? Math.round((totalWords / totalSeconds) * 60) : 0;
  /* Number only — the card label already says "Avg WPM". (The old
     .stat-unit append is display:none legacy.) */
  metricElements.wpm.textContent = `${lifetimeWpm}`;

  updateTrendIndicator(metricElements.wordsTrend, usageStats.words, usageStats.prevWords);
  updateTrendIndicator(metricElements.timeTrend, usageStats.speakingSeconds, usageStats.prevSpeakingSeconds);
  updateTrendIndicator(metricElements.sessionsTrend, usageStats.sessions, usageStats.prevSessions);
  updateTrendIndicator(metricElements.wpmTrend, usageStats.avgWpm, usageStats.prevWpm);
}

export function updateTrendIndicator(element: HTMLElement, current: number, previous: number): void {
  const span = element.querySelector("span");
  if (!span) return;

  /* Preserve host classes (e.g. home-trend) — only swap the stat-trend
     modifier so restyled hosts keep their own styling. */
  element.classList.remove("stat-trend-up", "stat-trend-down", "stat-trend-neutral");
  element.classList.add("stat-trend");

  if (previous === 0 || current === 0) {
    element.classList.add("stat-trend-neutral");
    span.textContent = "--";
    return;
  }

  const percentChange = ((current - previous) / previous) * 100;

  if (percentChange > 0) {
    element.classList.add("stat-trend-up");
    span.textContent = `+${Math.round(percentChange)}%`;
  } else if (percentChange < 0) {
    element.classList.add("stat-trend-down");
    span.textContent = `${Math.round(percentChange)}%`;
  } else {
    element.classList.add("stat-trend-neutral");
    span.textContent = "0%";
  }
}
