import {
  APP_UPDATE_AUTO_CHECK_ENABLED_STORAGE_KEY,
  APP_UPDATE_LAST_CHECKED_AT_STORAGE_KEY,
  APP_UPDATE_SNOOZED_UNTIL_STORAGE_KEY,
} from "../constants";

/**
 * Canonical updater storage + pure helpers — Phase 5b extraction.
 * Moved verbatim from main.tsx. DOM-writing functions
 * (setUpdaterStatus, refreshUpdateLastCheckedText, setUpdateInstallProgress,
 * panel wiring, check/install flows) stay in main.tsx — they touch ~15
 * element refs and the update state machine.
 */

export const DEFAULT_APP_UPDATE_AUTO_CHECK_ENABLED = true;
export const APP_UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

export function readAppUpdateAutoCheckEnabled(): boolean {
  const raw = localStorage.getItem(APP_UPDATE_AUTO_CHECK_ENABLED_STORAGE_KEY);
  if (raw === null) {
    return DEFAULT_APP_UPDATE_AUTO_CHECK_ENABLED;
  }
  return raw !== "0";
}

export function readUpdateSnoozedUntilMs(): number {
  const raw = localStorage.getItem(APP_UPDATE_SNOOZED_UNTIL_STORAGE_KEY);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
}

export function isUpdateSnoozed(): boolean {
  return Date.now() < readUpdateSnoozedUntilMs();
}

export function snoozeUpdateFor24Hours(): void {
  localStorage.setItem(APP_UPDATE_SNOOZED_UNTIL_STORAGE_KEY, String(Date.now() + 24 * 60 * 60 * 1000));
}

export function readLastAppUpdateCheckedAtMs(): number {
  const raw = localStorage.getItem(APP_UPDATE_LAST_CHECKED_AT_STORAGE_KEY);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return parsed;
}

export function shouldRunStartupUpdateCheck(): boolean {
  const lastCheckedAt = readLastAppUpdateCheckedAtMs();
  if (lastCheckedAt <= 0) {
    return true;
  }
  return Date.now() - lastCheckedAt >= APP_UPDATE_CHECK_INTERVAL_MS;
}

export function msUntilNextAutomaticUpdateCheck(): number {
  const lastCheckedAt = readLastAppUpdateCheckedAtMs();
  if (lastCheckedAt <= 0) {
    return 0;
  }

  const elapsedMs = Date.now() - lastCheckedAt;
  if (elapsedMs >= APP_UPDATE_CHECK_INTERVAL_MS) {
    return 0;
  }

  return APP_UPDATE_CHECK_INTERVAL_MS - elapsedMs;
}

export function isSafeGithubReleasePageUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" && parsed.hostname === "github.com" && parsed.pathname.includes("/releases/");
  } catch {
    return false;
  }
}

const UPDATE_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatPublishedDate(raw: string): string {
  const cleaned = raw.trim();
  if (!cleaned) {
    return "-";
  }

  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) {
    return cleaned;
  }
  return UPDATE_DATE_FORMATTER.format(parsed);
}
