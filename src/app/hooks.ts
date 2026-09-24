import { useEffect, useState } from 'react';
import { uiStore } from '../store';
import type { UIState } from '../store';
import { SETTINGS_STORAGE_KEY } from '../constants';
import { parseJson } from '../state/storage';
import type { AnalyticsSessionDetail } from '../types';
import { type HistoryFilter, localDayKey } from './history-filter';

/**
 * Canonical App-level hooks (Phase 3 extraction from App.tsx).
 * Behavior-preserving move — no logic changes.
 */

export function useUIState(): UIState {
  const [state, setState] = useState<UIState>(uiStore.getState());
  useEffect(() => {
    return uiStore.subscribe(setState);
  }, []);
  return state;
}

export type { HistoryFilter } from "./history-filter";
export { filterHistory, localDayKey } from "./history-filter";

export function useHistoryFilter(): HistoryFilter {
  const [hf, setHf] = useState<HistoryFilter>({ filter: "all" });
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<HistoryFilter>).detail;
      if (detail) setHf(detail);
    };
    window.addEventListener("slasshywispr:history-filter", handler);
    return () => window.removeEventListener("slasshywispr:history-filter", handler);
  }, []);
  return hf;
}

export function useHistorySearch(): string {
  const [query, setQuery] = useState("");
  useEffect(() => {
    const el = document.getElementById("historySearchInput") as HTMLInputElement | null;
    if (!el) return;
    const handler = () => setQuery(el.value.toLowerCase());
    el.addEventListener("input", handler);
    return () => el.removeEventListener("input", handler);
  }, []);
  return query;
}

/* Reads the persisted push-to-talk hotkey so the rail's Quick start
   card can echo it back. Returns a token array (["Ctrl","Space"])
   or empty. */
export function useUserHotkeyTokens(): string[] {
  const [tokens, setTokens] = useState<string[]>([]);
  useEffect(() => {
    const read = () => {
      const parsed = parseJson<{ pushToTalkHotkey?: string } | null>(SETTINGS_STORAGE_KEY, null);
      if (!parsed) return;
      const hotkey = String(parsed.pushToTalkHotkey ?? "").trim();
      if (!hotkey) return;
      setTokens(
        hotkey
          .split("+")
          .map((p) => p.trim())
          .filter(Boolean)
      );
    };
    read();
    window.addEventListener("slasshywispr:store-updated", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("slasshywispr:store-updated", read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return tokens;
}

/* Build the last 7 calendar days of words spoken, padded with zeros
   for missing days. Returns an array of length 7 plus the oldest
   calendar date for the chip label. */
export function useLastSevenDaysWords(
  sessions: AnalyticsSessionDetail[]
): { points: number[]; oldest: string } {
  const today = new Date();
  const days: number[] = [0, 0, 0, 0, 0, 0, 0];
  // F-025: build the seven buckets by walking calendar days back from today,
  // so a DST shift cannot put an extra (or missing) day in the window.
  const bucketKeys: string[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    bucketKeys.push(localDayKey(day.getTime()));
  }
  sessions.forEach((s) => {
    const idx = bucketKeys.indexOf(localDayKey(s.date));
    if (idx >= 0) {
      days[idx] += s.words || 0;
    }
  });
  const oldestDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
  return {
    points: days,
    oldest: oldestDate.toLocaleDateString([], { month: "short", day: "numeric" }),
  };
}
