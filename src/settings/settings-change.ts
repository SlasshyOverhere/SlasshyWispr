/**
 * Settings-change pipeline ownership — Phase 5 shell decomposition.
 *
 * Owns handleSettingsChange + settingsHandleEffects + settingsCoreDeps +
 * cachedHotkeyDisplay + hydrateSettingsFromNativeStorage + bootstrap's
 * achievement backfill block. Moved verbatim from main.tsx; settings
 * state, form refs/catalog selects, and every shell seam (settings read/
 * write, form core, pipeline inputs, notice/log, dock, STT/TTS/mic,
 * shortcuts, launch-at-login, usage stats) arrive via
 * initSettingsChange so this module never touches main.tsx module
 * globals.
 */
import type {
  AchievementState,
  AssistantInfoResponse,
  PersistedSettings,
  UsageStats,
} from "../types";
import { newlyUnlockedAchievements } from "../analytics/analytics-service";
import { formatHotkeyForDisplay } from "../hotkeys/hotkey-service";
import { coerceInteger, coerceNumber } from "../state/settings-store";
import {
  hydrateSettingsFromNativeStorage as hydrateSettingsFromNativeStoragePipeline,
  type SettingsHydrateDeps,
} from "./settings-hydrate";
import {
  runSettingsHandlePipeline,
  type SettingsCatalogs,
  type SettingsHandleEffects,
} from "./settings-handle";
import { buildShortcutSyncSignature, summarizeSettingsForDiagnostics } from "./settings-signatures";
import { maxTokensBounds } from "./max-tokens-bounds";
import { sttTimeoutBounds } from "./stt-timeout-bounds";
import { temperatureBounds } from "./temperature-bounds";
import type { SettingsFormRefs } from "./settings-form-refs";
import type { SettingsCoreDeps } from "./settings-wiring";

export interface SettingsChangeCaptureDeps {
  isCapturingHotkey: () => boolean;
  isCapturingCommandHotkey: () => boolean;
  refreshRecordingsStorageHint: () => void;
  isTauri: () => boolean;
  showStaleRuntimePane: () => void;
}

export interface SettingsChangeDeps {
  getSettings: () => PersistedSettings;
  setSettings: (next: PersistedSettings) => void;
  commitSettingsSnapshot: (next: PersistedSettings) => void;
  getFormRefs: () => SettingsFormRefs;
  getCatalogs: () => SettingsCatalogs;
  getAssistantInfoDefaults: () => AssistantInfoResponse | null;
  getStage: () => string;
  currentSettings: () => PersistedSettings;
  buildCaptureDeps: () => SettingsChangeCaptureDeps;
  formatHotkeyDisplay: (hotkey: string) => string;
  log: (message: string) => void;
  warn: (message: string) => void;
  renderSidebarLocalSttToggle: () => void;
  refreshRecordButton: () => void;
  syncActionAvailability: () => void;
  updateMicrophoneSummary: () => void;
  renderAssistantInfo: (info: AssistantInfoResponse) => void;
  setActiveTtsProfile: (profile: "piper") => void;
  setCatalogSelects: (next: PersistedSettings, catalogs: SettingsCatalogs) => void;
  requestGlobalShortcutSync: () => void;
  requestLaunchAtLoginSync: (enabled: boolean) => void;
  requestShellIntegrationSync: (enabled: boolean) => void;
  interruptTtsPlayback: () => void;
  notice: (message: string, isError?: boolean) => void;
  requestLocalSttRuntimeSyncForMode: (
    mode: string,
    options: { showLoadOverlay?: boolean },
  ) => void;
  updateTtsSetupGate: () => void;
  publishDockState: () => void;
  syncFloatingIndicatorWindow: () => void;
  primeCaptureReadiness: (deviceId: string, showFlowBar: boolean) => void;
  clearCaptureHolds: () => void;
  notifyIncognitoChanged: () => void;
  syncExternalMediaMute: (muted: boolean) => void;
  persist: (next: PersistedSettings) => void;
  notifyStoreUpdated: () => void;
  readSettingsFromForm: (refs: SettingsFormRefs, coreDeps: SettingsCoreDeps) => PersistedSettings;
  applySettingsToForm: (
    refs: SettingsFormRefs,
    coreDeps: SettingsCoreDeps,
    next: PersistedSettings,
  ) => void;
  // Bootstrap achievement backfill seams.
  getUsageStats: () => UsageStats;
  getSessionCount: () => number;
  getAchievements: () => AchievementState[];
  appendAchievements: (unlocked: AchievementState[]) => void;
  persistAchievements: () => void;
  // Hydrate seams.
  isTauri: () => boolean;
  loadNativeSettings: () => Promise<string>;
}

let changeDeps!: SettingsChangeDeps;
let changeCoreDeps!: SettingsCoreDeps;
let cachedHotkeyDisplay = "";

export function initSettingsChange(deps: SettingsChangeDeps): void {
  changeDeps = deps;
  changeCoreDeps = {
    isCapturingHotkey: () => deps.buildCaptureDeps().isCapturingHotkey(),
    isCapturingCommandHotkey: () => deps.buildCaptureDeps().isCapturingCommandHotkey(),
    currentSettings: () => deps.currentSettings(),
    refreshRecordingsStorageHint: () => deps.buildCaptureDeps().refreshRecordingsStorageHint(),
    isTauri: () => deps.buildCaptureDeps().isTauri(),
    showStaleRuntimePane: () => deps.buildCaptureDeps().showStaleRuntimePane(),
  };
  cachedHotkeyDisplay = deps.formatHotkeyDisplay(deps.getSettings().pushToTalkHotkey);
  deps.applySettingsToForm(deps.getFormRefs(), changeCoreDeps, deps.getSettings());
}

export function getSettingsCoreDeps(): SettingsCoreDeps {
  return changeCoreDeps;
}

export function getCachedHotkeyDisplay(): string {
  return cachedHotkeyDisplay;
}

export async function hydrateSettingsFromNativeStorage(): Promise<void> {
  const hydrated = await hydrateSettingsFromNativeStoragePipeline({
    isTauri: () => changeDeps.isTauri(),
    loadNative: () => changeDeps.loadNativeSettings(),
    log: (message) => changeDeps.log(message),
    warn: (message) => changeDeps.warn(message),
    applyAll: (next) => {
      changeDeps.setSettings(next);
      changeDeps.applySettingsToForm(changeDeps.getFormRefs(), changeCoreDeps, next);
    },
    onChanged: () => {
      void handleSettingsChange();
    },
  } satisfies SettingsHydrateDeps);
  if (hydrated) {
    changeDeps.setSettings(hydrated);
    changeDeps.commitSettingsSnapshot(hydrated);
  }
}

/// A stored STT timeout that had to be moved back inside the backend's bounds.
///
/// Returned rather than announced so the caller decides how to surface it.
export interface SttTimeoutCorrection {
  previousSeconds: number;
  seconds: number;
  minSeconds: number;
  maxSeconds: number;
}

export function describeSttTimeoutCorrection(correction: SttTimeoutCorrection): string {
  return `Request Timeout ${correction.previousSeconds}s is outside the supported ${correction.minSeconds}-${correction.maxSeconds}s range; set to ${correction.seconds}s. Change it in Settings > Pipeline.`;
}

/// A stored token ceiling that had to be moved back inside the backend's bounds.
export interface MaxTokensCorrection {
  previousTokens: number;
  tokens: number;
  minTokens: number;
  maxTokens: number;
}

export function describeMaxTokensCorrection(correction: MaxTokensCorrection): string {
  return `Max Tokens ${correction.previousTokens} is outside the supported ${correction.minTokens}-${correction.maxTokens} range; set to ${correction.tokens}. Change it in Settings > Pipeline.`;
}

/// A stored temperature that had to be moved back inside the backend's bounds.
export interface TemperatureCorrection {
  previousTemperature: number;
  temperature: number;
  minTemperature: number;
  maxTemperature: number;
}

export function describeTemperatureCorrection(correction: TemperatureCorrection): string {
  return `Temperature ${correction.previousTemperature} is outside the supported ${correction.minTemperature}-${correction.maxTemperature} range; set to ${correction.temperature}. Change it in Settings > Pipeline.`;
}

/**
 * Bring a stored STT timeout back inside the backend's bounds.
 *
 * Settings load before bootstrap can ask the backend for its bounds, so a value
 * persisted under an older, wider range would otherwise stay on screen — and be
 * silently clamped on every request — until the user next edited a field.
 *
 * Correcting persists the new value, so this fires at most once per stale value
 * rather than on every launch.
 */
export function reconcileSttTimeoutWithBounds(): SttTimeoutCorrection | null {
  const current = changeDeps.getSettings();
  const { defaultSeconds, minSeconds, maxSeconds } = sttTimeoutBounds();
  const reconciled = coerceInteger(
    current.sttTimeoutSeconds,
    defaultSeconds,
    minSeconds,
    maxSeconds,
  );
  if (reconciled === current.sttTimeoutSeconds) {
    return null;
  }

  const next: PersistedSettings = { ...current, sttTimeoutSeconds: reconciled };
  changeDeps.setSettings(next);
  changeDeps.applySettingsToForm(changeDeps.getFormRefs(), changeCoreDeps, next);
  changeDeps.commitSettingsSnapshot(next);
  changeDeps.warn(
    `[settings] stt timeout ${current.sttTimeoutSeconds}s was outside the backend bounds ${minSeconds}-${maxSeconds}s; corrected to ${reconciled}s`,
  );
  if (changeDeps.isTauri()) {
    changeDeps.persist(next);
  }
  return {
    previousSeconds: current.sttTimeoutSeconds,
    seconds: reconciled,
    minSeconds,
    maxSeconds,
  };
}

/// Same shape as the STT-timeout reconcile, and the same reason: the backend
/// validator accepted up to 2.0 while the request path clamped to 1.2, so a
/// stored value in between was accepted, displayed and then silently changed.
export function reconcileTemperatureWithBounds(): TemperatureCorrection | null {
  const current = changeDeps.getSettings();
  const { defaultTemperature, minTemperature, maxTemperature } = temperatureBounds();
  const reconciled = coerceNumber(
    current.temperature,
    defaultTemperature,
    minTemperature,
    maxTemperature,
  );
  if (reconciled === current.temperature) {
    return null;
  }

  const next: PersistedSettings = { ...current, temperature: reconciled };
  changeDeps.setSettings(next);
  changeDeps.applySettingsToForm(changeDeps.getFormRefs(), changeCoreDeps, next);
  changeDeps.commitSettingsSnapshot(next);
  changeDeps.warn(
    `[settings] temperature ${current.temperature} was outside the backend bounds ${minTemperature}-${maxTemperature}; corrected to ${reconciled}`,
  );
  if (changeDeps.isTauri()) {
    changeDeps.persist(next);
  }
  return {
    previousTemperature: current.temperature,
    temperature: reconciled,
    minTemperature,
    maxTemperature,
  };
}

/// Same shape as the STT-timeout reconcile, and the same reason: settings load
/// before bootstrap can ask the backend for its bounds, so a value stored under
/// an older, wider range would otherwise stay on screen and be clamped silently.
export function reconcileMaxTokensWithBounds(): MaxTokensCorrection | null {
  const current = changeDeps.getSettings();
  const { defaultTokens, minTokens, maxTokens } = maxTokensBounds();
  const reconciled = coerceInteger(current.maxTokens, defaultTokens, minTokens, maxTokens);
  if (reconciled === current.maxTokens) {
    return null;
  }

  const next: PersistedSettings = { ...current, maxTokens: reconciled };
  changeDeps.setSettings(next);
  changeDeps.applySettingsToForm(changeDeps.getFormRefs(), changeCoreDeps, next);
  changeDeps.commitSettingsSnapshot(next);
  changeDeps.warn(
    `[settings] max tokens ${current.maxTokens} was outside the backend bounds ${minTokens}-${maxTokens}; corrected to ${reconciled}`,
  );
  if (changeDeps.isTauri()) {
    changeDeps.persist(next);
  }
  return {
    previousTokens: current.maxTokens,
    tokens: reconciled,
    minTokens,
    maxTokens,
  };
}

export async function handleSettingsChange(): Promise<void> {
  const previousSettings = { ...changeDeps.getSettings() };

  changeDeps.setSettings(
    runSettingsHandlePipeline({
      refs: changeDeps.getFormRefs(),
      coreDeps: changeCoreDeps,
      previous: previousSettings,
      catalogs: changeDeps.getCatalogs(),
      assistantInfo: changeDeps.getAssistantInfoDefaults(),
      stage: changeDeps.getStage(),
      effects: settingsHandleEffects,
      updateCachedHotkeyDisplay: (display) => {
        cachedHotkeyDisplay = formatHotkeyForDisplay(display);
      },
    }),
  );
  changeDeps.commitSettingsSnapshot(changeDeps.getSettings());
}

export const settingsHandleEffects: SettingsHandleEffects = {
  notifyChange: (previous, next) => {
    changeDeps.log(
      `[settings.change] from="${summarizeSettingsForDiagnostics(
        previous,
      )}" to="${summarizeSettingsForDiagnostics(next)}"`,
    );
  },
  syncDerivedFormState: (_refs, next, catalogs, assistantInfo) => {
    changeDeps.setActiveTtsProfile("piper");
    changeDeps.setCatalogSelects(next, catalogs);
    if (assistantInfo) {
      changeDeps.renderAssistantInfo(assistantInfo as AssistantInfoResponse);
    }
  },
  clearCaptureHolds: () => changeDeps.clearCaptureHolds(),
  notifyIncognitoChanged: () => {
    // Notify React to re-render with updated incognito state from localStorage.
    changeDeps.notifyStoreUpdated();
  },
  syncExternalMediaMute: (muted) => {
    changeDeps.syncExternalMediaMute(muted);
  },
  persist: (next) => changeDeps.persist(next),
  afterPersist: (previous, next, stageAtChange) => {
    const previousMicrophoneDeviceId = previous.microphoneDeviceId;
    const previousShowFlowBar = previous.showFlowBar;
    const previousLaunchAtLogin = previous.launchAtLogin;
    const previousShellIntegration = previous.shellIntegration;
    const previousTtsEngine = previous.ttsEngine;
    const previousSttRuntimeMode = previous.sttRuntimeMode;
    const previousAiRuntimeMode = previous.aiRuntimeMode;
    const previousShortcutSignature = buildShortcutSyncSignature(previous);
    changeDeps.renderSidebarLocalSttToggle();
    changeDeps.refreshRecordButton();
    changeDeps.syncActionAvailability();
    changeDeps.updateMicrophoneSummary();
    const nextShortcutSignature = buildShortcutSyncSignature(next);
    if (previousShortcutSignature !== nextShortcutSignature) {
      changeDeps.requestGlobalShortcutSync();
    }
    if (previousLaunchAtLogin !== next.launchAtLogin) {
      changeDeps.requestLaunchAtLoginSync(next.launchAtLogin);
    }
    if (previousShellIntegration !== next.shellIntegration) {
      changeDeps.requestShellIntegrationSync(next.shellIntegration);
    }
    if (previousTtsEngine !== next.ttsEngine) {
      changeDeps.interruptTtsPlayback();
    }
    const sttRuntimeModeChanged = previousSttRuntimeMode !== next.sttRuntimeMode;
    const aiRuntimeModeChanged = previousAiRuntimeMode !== next.aiRuntimeMode;
    if (sttRuntimeModeChanged || aiRuntimeModeChanged) {
      if (next.sttRuntimeMode === next.aiRuntimeMode) {
        changeDeps.notice(
          next.sttRuntimeMode === "local"
            ? "Offline mode enabled for both STT and AI."
            : "Online mode enabled for both STT and AI.",
        );
      } else {
        changeDeps.notice(
          `Hybrid mode enabled (STT: ${next.sttRuntimeMode}, AI: ${next.aiRuntimeMode}).`,
        );
      }
    }
    if (sttRuntimeModeChanged) {
      changeDeps.requestLocalSttRuntimeSyncForMode(next.sttRuntimeMode, {
        showLoadOverlay: next.sttRuntimeMode === "local",
      });
    }
    changeDeps.updateTtsSetupGate();
    changeDeps.publishDockState();
    void changeDeps.syncFloatingIndicatorWindow();
    if (
      stageAtChange === "idle" &&
      (previousMicrophoneDeviceId !== next.microphoneDeviceId ||
        (!previousShowFlowBar && next.showFlowBar))
    ) {
      void changeDeps.primeCaptureReadiness(next.microphoneDeviceId, next.showFlowBar);
    }
  },
};

export function backfillAchievementsFromUsageStats(): void {
  if (changeDeps.getSessionCount() <= 0 || changeDeps.getAchievements().length !== 0) {
    return;
  }
  const usageStats = changeDeps.getUsageStats();
  const totalWords = usageStats.words + usageStats.prevWords;
  const totalSessions = usageStats.sessions + usageStats.prevSessions;
  const totalSeconds = usageStats.speakingSeconds + usageStats.prevSpeakingSeconds;
  if (totalWords > 0 || totalSessions > 0 || totalSeconds > 0) {
    const unlocked = newlyUnlockedAchievements(
      {
        ...usageStats,
        words: totalWords,
        sessions: totalSessions,
        speakingSeconds: totalSeconds,
      },
      changeDeps.getAchievements(),
      Date.now(),
    );
    if (unlocked.length > 0) {
      changeDeps.appendAchievements(unlocked);
      changeDeps.persistAchievements();
    }
    changeDeps.notifyStoreUpdated();
  }
}
