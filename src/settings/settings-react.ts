/**
 * React binding for the settings snapshot — Phase 4 per-pane conversion.
 *
 * Thin useSyncExternalStore wrapper over settings-state. Pane components
 * subscribe here; main.tsx commits the snapshot after every change.
 */
import { useSyncExternalStore } from "react";
import { getSettingsSnapshot, subscribeSettings } from "./settings-state";
import type { PersistedSettings } from "../types";

export function useSettingsSnapshot(): PersistedSettings {
  return useSyncExternalStore(
    subscribeSettings,
    getSettingsSnapshot,
    getSettingsSnapshot,
  );
}
