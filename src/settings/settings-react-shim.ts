/**
 * Pane-facing settings facade — Phase 4 per-pane conversion.
 *
 * Panes import from here instead of settings-react directly so tests can
 * swap the hook without touching React. Production re-exports the real
 * useSyncExternalStore binding; dispatchSettingsPatch is the single
 * write path back to main.tsx through SETTINGS_PATCH_EVENT.
 */
export {
  useMaxTokensBounds,
  useSettingsSnapshot,
  useSttTimeoutBounds,
  useTemperatureBounds,
} from "./settings-react";
export { dispatchSettingsPatch } from "./settings-state";
