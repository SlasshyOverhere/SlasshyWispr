/**
 * Settings service facade — Phase 4 barrel.
 *
 * settings-service.ts was split into focused owners; this module
 * re-exports the public surface so existing import sites keep working.
 * New code should import from the focused module directly.
 */
export {
  applySettingsValidation,
  applyDictationLanguageSettingsToForm,
  syncThemeCardSelection,
  updateRuntimeModeNotice,
  syncHybridRuntimeFieldVisibility,
  syncRuntimeModePaneVisibility,
  applyTheme,
} from "./settings-display";
export {
  setPersistErrorReporter,
  flushPendingSettings,
  persistSettings,
  performPersistSettings,
  resetPersistStateForTests,
} from "./settings-persist-core";
export type { PersistOptions } from "./settings-persist-core";
export {
  buildShortcutSyncSignature,
  summarizeSettingsForDiagnostics,
} from "./settings-signatures";
export {
  wireSettingsFormInputs,
} from "./settings-wiring";
export type {
  SettingsPaneWiring,
  SettingsCoreDeps,
} from "./settings-wiring";
export {
  readSettingsFromForm,
  updateWakePhrasePreview,
  refreshGeneralDisplayFromSettings,
  applySettingsToForm,
  normalizeHotkeyLabelsInPlace,
} from "./settings-form-core";
export {
  runSettingsHandlePipeline,
} from "./settings-handle";
export type {
  SettingsCatalogs,
  SettingsHandleEffects,
  SettingsHandleContext,
} from "./settings-handle";
export {
  hydrateSettingsFromNativeStorage,
} from "./settings-hydrate";
export type { SettingsHydrateDeps } from "./settings-hydrate";
