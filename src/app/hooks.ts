import { useEffect, useState } from 'react';
import { uiStore } from '../store';
import type { UIState } from '../store';
import { SETTINGS_STORAGE_KEY } from '../constants';
import { parseJson } from '../state/storage';
import type { AnalyticsSessionDetail, HomeHistoryEntry } from '../types';

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

export type HistoryFilter = { filter: "all" | "day" | "week" | "month"; specificDate?: string };

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

export function filterHistory(entries: HomeHistoryEntry[], hf: HistoryFilter): HomeHistoryEntry[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (hf.specificDate) {
    const parts = hf.specificDate.split("-");
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const end = start + 24 * 60 * 60 * 1000;
    return entries.filter(e => e.timestamp >= start && e.timestamp < end);
  }
  if (hf.filter === "day") return entries.filter(e => e.timestamp >= todayStart);
  if (hf.filter === "week") {
    const dow = now.getDay();
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow).getTime();
    return entries.filter(e => e.timestamp >= weekStart);
  }
  if (hf.filter === "month") {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return entries.filter(e => e.timestamp >= monthStart);
  }
  return entries;
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
  today.setHours(0, 0, 0, 0);
  const days: number[] = [0, 0, 0, 0, 0, 0, 0];
  const dayMs = 24 * 60 * 60 * 1000;
  const oldestStart = today.getTime() - 6 * dayMs;
  sessions.forEach((s) => {
    const sessionDay = new Date(s.date);
    sessionDay.setHours(0, 0, 0, 0);
    const idx = Math.round((sessionDay.getTime() - oldestStart) / dayMs);
    if (idx >= 0 && idx < 7) {
      days[idx] = (days[idx] || 0) + (s.words || 0);
    }
  });
  const oldestDate = new Date(oldestStart);
  return {
    points: days,
    oldest: oldestDate.toLocaleDateString([], { month: "short", day: "numeric" }),
  };
}
