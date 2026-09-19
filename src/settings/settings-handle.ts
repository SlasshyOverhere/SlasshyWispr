/**
 * Settings handle pipeline — Phase 4e split from settings-service.
 *
 * Owns: runSettingsHandlePipeline + context/effects interfaces.
 * Depends on settings-form-core + settings-display + signatures.
 */
import type { PersistedSettings } from "../types";
import { boolFlag } from "../utils";
import type { SettingsFormRefs } from "./settings-form-refs";
import {
  applyDictationLanguageSettingsToForm,
  applyTheme,
  syncHybridRuntimeFieldVisibility,
  syncRuntimeModePaneVisibility,
  updateRuntimeModeNotice,
} from "./settings-display";
import {
  normalizeHotkeyLabelsInPlace,
  readSettingsFromForm,
  refreshGeneralDisplayFromSettings,
} from "./settings-form-core";
import { applySettingsValidation } from "./settings-display";
import { buildShortcutSyncSignature } from "./settings-signatures";
import type { SettingsCoreDeps } from "./settings-wiring";

export interface SettingsCatalogs {
  providerModels: string[];
  localOllamaModels: string[];
  localSttModels: string[];
}

export interface SettingsHandleEffects {
  notifyChange: (previous: PersistedSettings, next: PersistedSettings) => void;
  syncDerivedFormState: (
    refs: SettingsFormRefs,
    next: PersistedSettings,
    catalogs: SettingsCatalogs,
    assistantInfo: unknown,
  ) => void;
  clearCaptureHolds: () => void;
  notifyIncognitoChanged: () => void;
  syncExternalMediaMute: (muted: boolean, stage: string) => void;
  persist: (next: PersistedSettings) => void;
  afterPersist: (previous: PersistedSettings, next: PersistedSettings, stage: string) => void;
}

export interface SettingsHandleContext {
  refs: SettingsFormRefs;
  coreDeps: SettingsCoreDeps;
  previous: PersistedSettings;
  catalogs: SettingsCatalogs;
  assistantInfo: unknown;
  stage: string;
  effects: SettingsHandleEffects;
  updateCachedHotkeyDisplay: (display: string) => void;
}

export function runSettingsHandlePipeline(
  context: SettingsHandleContext,
): PersistedSettings {
  const { refs, coreDeps, previous, effects } = context;
  const next = readSettingsFromForm(refs, coreDeps);

  normalizeHotkeyLabelsInPlace(refs, next);

  applySettingsValidation(refs, next);
  const previousDiagnosticsSignature = [
    previous.captureMode,
    previous.sttRuntimeMode,
    previous.aiRuntimeMode,
    boolFlag(previous.rememberApiKey),
    boolFlag(previous.apiKey.trim().length > 0),
    buildShortcutSyncSignature(previous),
    boolFlag(previous.commandMode),
  ].join("|");
  const nextDiagnosticsSignature = [
    next.captureMode,
    next.sttRuntimeMode,
    next.aiRuntimeMode,
    boolFlag(next.rememberApiKey),
    boolFlag(next.apiKey.trim().length > 0),
    buildShortcutSyncSignature(next),
    boolFlag(next.commandMode),
  ].join("|");
  if (previousDiagnosticsSignature !== nextDiagnosticsSignature) {
    effects.notifyChange(previous, next);
  }
  applyDictationLanguageSettingsToForm(refs, next);
  refreshGeneralDisplayFromSettings(refs, next);
  context.updateCachedHotkeyDisplay(next.pushToTalkHotkey);
  applyTheme(next.themeMode);
  updateRuntimeModeNotice(refs, next.sttRuntimeMode, next.aiRuntimeMode);
  syncRuntimeModePaneVisibility(refs, coreDeps.showStaleRuntimePane);
  syncHybridRuntimeFieldVisibility(refs, next.sttRuntimeMode, next.aiRuntimeMode);
  effects.syncDerivedFormState(refs, next, context.catalogs, context.assistantInfo);

  if (previous.captureMode !== next.captureMode) {
    effects.clearCaptureHolds();
  }

  if (previous.incognitoMode !== next.incognitoMode) {
    effects.notifyIncognitoChanged();
  }

  if (
    !previous.muteMusicWhileDictating &&
    next.muteMusicWhileDictating &&
    context.stage === "recording"
  ) {
    effects.syncExternalMediaMute(true, context.stage);
  } else if (previous.muteMusicWhileDictating && !next.muteMusicWhileDictating) {
    effects.syncExternalMediaMute(false, context.stage);
  }

  effects.persist(next);
  effects.afterPersist(previous, next, context.stage);
  return next;
}
