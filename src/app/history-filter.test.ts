/**
 * Calendar-day bucketing test (F-025).
 *
 * Pins filterHistory: a "day" filter matches by local calendar date rather
 * than a rolling 24-hour window, and the specific-date filter matches only
 * that local day. Guards the DST regression where a 23/25-hour day shifted
 * entries into the wrong bucket.
 */
import { describe, it, expect } from "bun:test";
import { filterHistory, localDayKey } from "./history-filter";
import type { HomeHistoryEntry } from "../types";

function entry(timestamp: number, content = "x"): HomeHistoryEntry {
  return { speaker: "You", content, tone: "user", timestamp };
}

describe("localDayKey", () => {
  it("formats a local calendar date as y-m-d with zero padding", () => {
    expect(localDayKey(new Date(2026, 0, 5, 23, 30).getTime())).toBe("2026-01-05");
    expect(localDayKey(new Date(2026, 8, 19, 0, 5).getTime())).toBe("2026-09-19");
  });
});

describe("filterHistory day bucket", () => {
  it("keeps only entries on the current local day", () => {
    const now = new Date();
    const earlierToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 1).getTime();
    const lateToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59).getTime();
    // 2am yesterday, which a rolling-24h window at 1am would still include.
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 2, 0).getTime();

    const result = filterHistory(
      [entry(earlierToday), entry(lateToday), entry(yesterday)],
      { filter: "day" },
    );
    expect(result.map((e) => e.timestamp)).toEqual([earlierToday, lateToday]);
  });

  it("matches a specific date by calendar day, not a +24h window", () => {
    const target = new Date(2026, 8, 19, 10, 0).getTime();
    const sameDayLate = new Date(2026, 8, 19, 23, 30).getTime();
    const nextDayEarly = new Date(2026, 8, 20, 0, 30).getTime();

    const result = filterHistory(
      [entry(target), entry(sameDayLate), entry(nextDayEarly)],
      { filter: "all", specificDate: "2026-09-19" },
    );
    expect(result.map((e) => e.timestamp)).toEqual([target, sameDayLate]);
  });
});