/**
 * Pure history filtering — react-free so it can be unit-tested without the
 * hook module's React dependency.
 *
 * F-025: local calendar-day key ("2026-09-19"). Fixed 24h arithmetic breaks
 * across DST transitions (a 23- or 25-hour day), so buckets are keyed by the
 * local date parts instead of by elapsed milliseconds.
 */
import type { HomeHistoryEntry } from "../types";

export type HistoryFilter = { filter: "all" | "day" | "week" | "month"; specificDate?: string };

export function localDayKey(timestamp: number): string {
  const d = new Date(timestamp);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export function filterHistory(entries: HomeHistoryEntry[], hf: HistoryFilter): HomeHistoryEntry[] {
  const now = new Date();
  if (hf.specificDate) {
    // Same-day match on the calendar key, not a +24h window.
    return entries.filter((e) => localDayKey(e.timestamp) === hf.specificDate);
  }
  if (hf.filter === "day") {
    const todayKey = localDayKey(now.getTime());
    return entries.filter((e) => localDayKey(e.timestamp) === todayKey);
  }
  if (hf.filter === "week") {
    const dow = now.getDay();
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow).getTime();
    return entries.filter((e) => e.timestamp >= weekStart);
  }
  if (hf.filter === "month") {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return entries.filter((e) => e.timestamp >= monthStart);
  }
  return entries;
}
