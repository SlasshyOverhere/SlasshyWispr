import { HOME_HISTORY_STORAGE_KEY } from "../constants";
import type { HomeHistoryEntry } from "../types";
import { parseJson } from "./storage";

/**
 * Canonical history loader.
 *
 * Single owner — main.tsx `loadHomeHistory` was the identical duplicate.
 * Filter predicate must stay verbatim: speaker/content strings, tone in
 * {assistant, user}, finite timestamp.
 */
export function loadHistory(): HomeHistoryEntry[] {
  const parsed = parseJson<HomeHistoryEntry[]>(HOME_HISTORY_STORAGE_KEY, []);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((item) => {
    if (!item || typeof item.speaker !== "string" || typeof item.content !== "string") {
      return false;
    }
    if (item.tone !== "assistant" && item.tone !== "user") {
      return false;
    }
    return Number.isFinite(item.timestamp);
  });
}
