/**
 * React binding for the settings snapshot — Phase 4 per-pane conversion.
 *
 * Thin useSyncExternalStore wrapper over settings-state. Pane components
 * subscribe here; main.tsx commits the snapshot after every change.
 */
import { useSyncExternalStore } from "react";
import { getSettingsSnapshot, subscribeSettings } from "./settings-state";
import {
  maxTokensBounds,
  subscribeMaxTokensBounds,
} from "./max-tokens-bounds";
import {
  sttTimeoutBounds,
  subscribeSttTimeoutBounds,
} from "./stt-timeout-bounds";
import {
  subscribeTemperatureBounds,
  temperatureBounds,
} from "./temperature-bounds";
import type {
  MaxTokensBoundsResponse,
  PersistedSettings,
  SttTimeoutBoundsResponse,
  TemperatureBoundsResponse,
} from "../types";

export function useSettingsSnapshot(): PersistedSettings {
  return useSyncExternalStore(
    subscribeSettings,
    getSettingsSnapshot,
    getSettingsSnapshot,
  );
}

/**
 * Subscribes because a pane renders before bootstrap asks the backend for its
 * bounds, so the first paint may carry the fallback.
 */
export function useSttTimeoutBounds(): SttTimeoutBoundsResponse {
  return useSyncExternalStore(
    subscribeSttTimeoutBounds,
    sttTimeoutBounds,
    sttTimeoutBounds,
  );
}

export function useMaxTokensBounds(): MaxTokensBoundsResponse {
  return useSyncExternalStore(
    subscribeMaxTokensBounds,
    maxTokensBounds,
    maxTokensBounds,
  );
}

export function useTemperatureBounds(): TemperatureBoundsResponse {
  return useSyncExternalStore(
    subscribeTemperatureBounds,
    temperatureBounds,
    temperatureBounds,
  );
}
