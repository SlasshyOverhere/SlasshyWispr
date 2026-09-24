/**
 * Canonical localStorage JSON helper.
 *
 * Single owner for safe JSON parsing. Storage keys remain owned by
 * `src/constants.ts` — import keys from there, parse with this.
 */

/**
 * F-035: preserve the unparseable payload instead of silently discarding it.
 * The bad value is copied to `<key>.corrupt-<timestamp>.bak` and the live key
 * is cleared, so boot recovers immediately and the bytes survive for support.
 * Best-effort: storage may be full or unavailable.
 */
function quarantineCorruptValue(key: string, raw: string): void {
  try {
    localStorage.setItem(`${key}.corrupt-${Date.now()}.bak`, raw);
  } catch {
    // Quarantine copy failed (quota/private mode); still clear the live key.
  }
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore — a later write will overwrite the bad value.
  }
}

/**
 * Parse an already-read payload. For the native settings document, which is not
 * a localStorage key and so has nothing to quarantine.
 */
export function parseJsonText<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function parseJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    quarantineCorruptValue(key, raw);
    return fallback;
  }
}

// ponytail: one-time rename slasshy-wispr-*/slasshy-desktop-assistant-* to
// slasshywispr-*. Runs on import so every later getItem sees migrated values.
// Remove once old keys are extinct in the wild.
const LEGACY_STORAGE_KEY_PAIRS: Array<[string, string]> = [
  ["slasshy-desktop-assistant-settings-v4", "slasshywispr-settings-v4"],
  ["slasshy-wispr-usage-v1", "slasshywispr-usage-v1"],
  ["slasshy-wispr-dock-layout-v2", "slasshywispr-dock-layout-v2"],
  ["slasshy-wispr-home-history-v1", "slasshywispr-home-history-v1"],
  ["slasshy-wispr-local-stt-hardware-advisor-v1", "slasshywispr-local-stt-hardware-advisor-v1"],
  ["slasshy-wispr-app-update-last-checked-at-v1", "slasshywispr-app-update-last-checked-at-v1"],
  ["slasshy-wispr-app-update-last-notified-version-v1", "slasshywispr-app-update-last-notified-version-v1"],
  ["slasshy-wispr-app-update-snoozed-until-v1", "slasshywispr-app-update-snoozed-until-v1"],
  ["slasshy-wispr-app-update-auto-check-enabled-v1", "slasshywispr-app-update-auto-check-enabled-v1"],
  ["slasshy-wispr-analytics-sessions-v1", "slasshywispr-analytics-sessions-v1"],
  ["slasshy-wispr-achievements-state-v1", "slasshywispr-achievements-state-v1"],
  ["slasshy-wispr-active-page-v1", "slasshywispr-active-page-v1"],
  ["slasshy-wispr-active-settings-pane-v1", "slasshywispr-active-settings-pane-v1"],
  ["slasshy-wispr-onboarding-dismissed-v1", "slasshywispr-onboarding-dismissed-v1"],
];

export function migrateLegacyLocalStorageKeys(): void {
  try {
    for (const [legacyKey, nextKey] of LEGACY_STORAGE_KEY_PAIRS) {
      if (localStorage.getItem(nextKey) !== null) {
        continue;
      }
      const legacyValue = localStorage.getItem(legacyKey);
      if (legacyValue === null) {
        continue;
      }
      localStorage.setItem(nextKey, legacyValue);
      localStorage.removeItem(legacyKey);
    }
  } catch {
    // Best-effort only; storage may be unavailable.
  }
}

try {
  migrateLegacyLocalStorageKeys();
} catch {
  // Ignore — migrate is already best-effort.
}
