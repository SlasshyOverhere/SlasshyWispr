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
  metricElements.words.textContent = `${totalWords} words`;
  metricElements.speakingTime.textContent = formatSpeakingTime(totalSeconds);
  metricElements.sessions.textContent = `${totalSessions}`;
  const lifetimeWpm = totalSeconds > 0 ? Math.round((totalWords / totalSeconds) * 60) : 0;
  metricElements.wpm.textContent = `${lifetimeWpm} `;
  const unit = document.createElement("span");
  unit.className = "stat-unit";
  unit.textContent = "wpm";
  metricElements.wpm.append(unit);

  updateTrendIndicator(metricElements.wordsTrend, usageStats.words, usageStats.prevWords);
  updateTrendIndicator(metricElements.timeTrend, usageStats.speakingSeconds, usageStats.prevSpeakingSeconds);
  updateTrendIndicator(metricElements.sessionsTrend, usageStats.sessions, usageStats.prevSessions);
  updateTrendIndicator(metricElements.wpmTrend, usageStats.avgWpm, usageStats.prevWpm);
}

export function updateTrendIndicator(element: HTMLElement, current: number, previous: number): void {
  const span = element.querySelector("span");
  if (!span) return;

  if (previous === 0 || current === 0) {
    element.className = "stat-trend stat-trend-neutral";
    span.textContent = "--";
    return;
  }

  const percentChange = ((current - previous) / previous) * 100;

  if (percentChange > 0) {
    element.className = "stat-trend stat-trend-up";
    span.textContent = `+${Math.round(percentChange)}%`;
  } else if (percentChange < 0) {
    element.className = "stat-trend stat-trend-down";
    span.textContent = `${Math.round(percentChange)}%`;
  } else {
    element.className = "stat-trend stat-trend-neutral";
    span.textContent = "0%";
  }
}
