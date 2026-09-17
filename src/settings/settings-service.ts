/**
 * Settings form service — Phase 4 settings ownership.
 *
 * Owns: form validation display + dictation-language + theme-card +
 * runtime-notice/visibility sync + document-theme apply. Moved verbatim
 * from main.tsx; element refs arrive via an explicit `SettingsFormRefs`
 * parameter so this module never touches the shell's module globals.
 * The one shell callback (`onStaleRuntimePane`) is injected for the same
 * reason.
 */
import type { PersistedSettings, RuntimeMode, ThemeMode } from "../types";
import {
  DEFAULT_ASSISTANT_NAME,
  DEFAULT_COMMAND_HOTKEY,
  DEFAULT_HOTKEY,
  DEFAULT_LOCAL_OLLAMA_BASE_URL,
  DEFAULT_MAX_TOKENS,
  DEFAULT_PIPER_SPEED,
  DEFAULT_PUSH_TO_TALK_SOUND_VOLUME,
  DEFAULT_TEMPERATURE,
} from "../constants";
import {
  asDictationLanguageMode,
  asPiperEmotion,
  asPiperQuality,
  asStyleProfile,
  asThemeMode,
  coerceInteger,
  coerceNumber,
  formatDictationLanguageLabel,
  normalizeDictationLanguageAllowList,
  normalizeDictationLanguageCode,
} from "../state/settings-store";
import type { DictationLanguageMode, TtsEngine } from "../types";
import { SETTINGS_STORAGE_KEY } from "../constants";
import {
  logClientEvent as ipcLogClientEvent,
  savePersistedLocalSettings as ipcSavePersistedLocalSettings,
} from "../ipc/client";
import { formatHotkeyForDisplay, parseHotkey } from "../hotkeys/hotkey-service";
import {
  asErrorMessage,
  boolFlag,
  captureModeLabel,
  validateApiBaseUrl,
  validateAssistantName,
} from "../utils";
import { applyInputValidationState, type SettingsFormRefs } from "./settings-form-refs";

export function applySettingsValidation(
  refs: SettingsFormRefs,
  next: PersistedSettings,
): void {
  applyInputValidationState(refs.apiBaseUrlInput, validateApiBaseUrl(next.apiBaseUrl));
  applyInputValidationState(refs.assistantNameInput, validateAssistantName(next.assistantName));
}

export function applyDictationLanguageSettingsToForm(
  refs: SettingsFormRefs,
  next: PersistedSettings,
): void {
  const primaryLanguage = normalizeDictationLanguageCode(next.dictationLanguage);
  let mode = asDictationLanguageMode(next.dictationLanguageMode);
  let allowList = normalizeDictationLanguageAllowList(next.dictationLanguageAllowList);
  if (mode === "multiple" && allowList.length === 0 && primaryLanguage) {
    allowList = [primaryLanguage];
  }
  if (allowList.length > 1) {
    mode = "multiple";
  }

  refs.dictationLanguageSelect.value = primaryLanguage;
  refs.dictationLanguageModeSingleInput.checked = mode === "single";
  refs.dictationLanguageModeMultipleInput.checked = mode === "multiple";
  refs.dictationLanguageMultiWrap.hidden = mode !== "multiple";

  for (const option of refs.dictationLanguageOptionInputs) {
    option.checked = mode === "multiple" && allowList.includes(option.value);
  }

  if (mode === "multiple") {
    if (allowList.length === 0) {
      refs.dictationLanguageSummary.textContent = "Whisper language mode: Multiple (choose at least one language).";
    } else {
      const labels = allowList.map((code) => formatDictationLanguageLabel(code)).join(", ");
      refs.dictationLanguageSummary.textContent = `Whisper language mode: Multiple (${labels}).`;
    }
  } else if (primaryLanguage) {
    refs.dictationLanguageSummary.textContent = `Whisper language mode: Single (${formatDictationLanguageLabel(primaryLanguage)}).`;
  } else {
    refs.dictationLanguageSummary.textContent = "Whisper language mode: Auto-detect.";
  }
}

export function syncThemeCardSelection(
  refs: SettingsFormRefs,
  themeMode: ThemeMode,
): void {
  for (const input of refs.themeCardInputs) {
    input.checked = input.value === themeMode;
  }
}

export function updateRuntimeModeNotice(
  refs: SettingsFormRefs,
  sttMode: RuntimeMode,
  aiMode: RuntimeMode,
): void {
  if (sttMode === "local" && aiMode === "local") {
    refs.runtimeModeNotice.textContent =
      "Offline mode is active for both STT and AI (local Parakeet + local Ollama).";
    return;
  }
  if (sttMode === "online" && aiMode === "online") {
    refs.runtimeModeNotice.textContent =
      "Online mode is active for both STT and AI (provider API base URL + API key).";
    return;
  }
  refs.runtimeModeNotice.textContent = `Hybrid mode: STT is ${sttMode}, AI is ${aiMode}.`;
}

export function syncHybridRuntimeFieldVisibility(
  refs: SettingsFormRefs,
  sttMode: RuntimeMode,
  aiMode: RuntimeMode,
): void {
  const sttOnline = sttMode === "online";
  const aiOnline = aiMode === "online";
  const sttLocal = sttMode === "local";
  const aiLocal = aiMode === "local";
  const anyOnline = sttOnline || aiOnline;
  const anyLocal = sttLocal || aiLocal;

  refs.onlineProviderSection.hidden = !anyOnline;
  refs.onlineSttModelField.hidden = !sttOnline;
  refs.onlineAiModelField.hidden = !aiOnline;
  refs.offlineOllamaSection.hidden = !aiLocal;
  refs.offlineSttSection.hidden = !sttLocal;
  refs.onlineProviderModeNotice.hidden = !anyOnline;
  refs.offlineRuntimeModeNotice.hidden = !anyLocal;

  if (sttOnline && aiOnline) {
    refs.onlineProviderModeNotice.textContent =
      "Online routing active for STT + AI. Configure API base URL, key, and provider models.";
  } else if (sttOnline) {
    refs.onlineProviderModeNotice.textContent =
      "Online routing active for STT. Configure API base URL, key, and online STT model.";
  } else if (aiOnline) {
    refs.onlineProviderModeNotice.textContent =
      "Online routing active for AI. Configure API base URL, key, and online AI model.";
  }

  if (!anyLocal) {
    return;
  }

  if (sttLocal && aiLocal) {
    refs.offlineRuntimeModeNotice.textContent =
      "Offline routing active for STT + AI. Configure local STT model and local Ollama model.";
  } else if (aiLocal) {
    refs.offlineRuntimeModeNotice.textContent =
      "Offline routing active for AI. Configure local Ollama model. STT stays online.";
  } else {
    refs.offlineRuntimeModeNotice.textContent =
      "Offline routing active for STT. Configure local STT model download/load. AI stays online.";
  }
}

export function syncRuntimeModePaneVisibility(
  refs: SettingsFormRefs,
  onStaleRuntimePane: () => void,
): void {
  const activePane = refs.settingsPanels.find((panel) => panel.classList.contains("is-active"));
  const activePaneId = activePane?.dataset.settingsPane;
  if (activePaneId === "online" || activePaneId === "offline" || activePaneId === "hybrid") {
    onStaleRuntimePane();
  }
}

export function applyTheme(themeMode: ThemeMode): void {
  const root = document.documentElement;
  if (themeMode === "system") {
    root.removeAttribute("data-theme");
    return;
  }

  root.setAttribute("data-theme", themeMode);
}

// --- Settings read/apply core (Phase 4c). Moved verbatim from main.tsx.
// Owns: form read (all panes), form apply (all panes), display refresh.
// Element refs arrive via an explicit SettingsFormRefs parameter; shell
// callbacks (capture flags, recordings refresh, active-pane nav) are
// injected via SettingsCoreDeps so this module never touches main.tsx
// module globals. Phase 5 shell decomposition consumes these seams.
let persistSettingsTimer: number | null = null;
let pendingSettingsToPersist: PersistedSettings | null = null;
let lastPersistDiagnosticsSignature = "";
let reportPersistError: ((message: string) => void) | null = null;

export function setPersistErrorReporter(
  reporter: ((message: string) => void) | null,
): void {
  reportPersistError = reporter;
}

export function flushPendingSettings(opts?: PersistOptions): void {
  if (persistSettingsTimer !== null) {
    window.clearTimeout(persistSettingsTimer);
    persistSettingsTimer = null;
  }
  if (pendingSettingsToPersist) {
    performPersistSettings(pendingSettingsToPersist, opts);
    pendingSettingsToPersist = null;
  }
}

export function persistSettings(next: PersistedSettings, opts?: PersistOptions): void {
  pendingSettingsToPersist = next;
  if (persistSettingsTimer === null) {
    performPersistSettings(next, opts);
    pendingSettingsToPersist = null;
  } else {
    window.clearTimeout(persistSettingsTimer);
  }

  persistSettingsTimer = window.setTimeout(() => {
    persistSettingsTimer = null;
    if (pendingSettingsToPersist) {
      performPersistSettings(pendingSettingsToPersist, opts);
      pendingSettingsToPersist = null;
    }
  }, 800);
}

export interface PersistOptions {
  isTauri?: boolean;
  saveNative?: (payload: string) => Promise<unknown>;
}

export function performPersistSettings(next: PersistedSettings, opts?: PersistOptions): void {
  // ponytail: isTauri/saveNative are seams for the persist unit test only.
  // Ceiling: full DI of the Tauri boundary. Upgrade when Phase 5 extracts
  // other persist call sites needing a fake native layer.
  const isTauri =
    opts?.isTauri ?? ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
  const nativePayload: PersistedSettings = {
    ...next,
    apiKey: next.rememberApiKey ? next.apiKey : "",
  };

  const localPayload: PersistedSettings = isTauri
    ? {
        ...nativePayload,
        // Keep API keys out of webview localStorage in desktop builds.
        apiKey: "",
      }
    : nativePayload;
  const serializedLocal = JSON.stringify(localPayload);
  localStorage.setItem(SETTINGS_STORAGE_KEY, serializedLocal);
  const diagnosticsSignature = [
    next.captureMode,
    next.sttRuntimeMode,
    next.aiRuntimeMode,
    boolFlag(next.rememberApiKey),
    boolFlag(next.apiKey.trim().length > 0),
    buildShortcutSyncSignature(next),
  ].join("|");
  if (diagnosticsSignature !== lastPersistDiagnosticsSignature) {
    lastPersistDiagnosticsSignature = diagnosticsSignature;
    logPersistEvent(
      `[settings.persist] tauri=${boolFlag(isTauri)} ${summarizeSettingsForDiagnostics(
        next,
      )} nativeApiKeyPresent=${boolFlag(nativePayload.apiKey.trim().length > 0)} localApiKeyPresent=${boolFlag(
        localPayload.apiKey.trim().length > 0,
      )}`,
    );
  }

  if (!isTauri) {
    return;
  }

  const serializedNative = JSON.stringify(nativePayload);
  logPersistEvent(
    `[settings.persist.native] payloadBytes=${serializedNative.length} remember=${boolFlag(
      nativePayload.rememberApiKey,
    )} apiKeyPresent=${boolFlag(nativePayload.apiKey.trim().length > 0)}`,
  );
  const saveNative = opts?.saveNative ?? ipcSavePersistedLocalSettings;
  void saveNative(serializedNative).catch((error) => {
    reportPersistError?.(
      `Unable to securely save settings: ${asErrorMessage(error)}. Check keyring access and try again.`,
    );
    logPersistEvent(`[settings.persist.native] failed: ${asErrorMessage(error)}`);
    console.warn(`[settings] failed to persist local settings: ${asErrorMessage(error)}`);
  });
}

function logPersistEvent(message: string): void {
  const line = message.trim();
  if (!line || !("__TAURI_INTERNALS__" in window || "__TAURI__" in window)) {
    return;
  }

  void ipcLogClientEvent(line).catch(() => {
    // Ignore logging failures in UI flow.
  });
}

export function resetPersistStateForTests(): void {
  pendingSettingsToPersist = null;
  lastPersistDiagnosticsSignature = "";
  reportPersistError = null;
  if (persistSettingsTimer !== null) {
    window.clearTimeout(persistSettingsTimer);
    persistSettingsTimer = null;
  }
}

export function buildShortcutSyncSignature(source: PersistedSettings): string {
  const captureMode = source.captureMode;
  const push = parseHotkey(source.pushToTalkHotkey)?.label ?? "";
  const commandEnabled = source.commandMode ? "1" : "0";
  const command = source.commandMode ? parseHotkey(source.commandHotkey)?.label ?? "" : "";
  return `${captureMode}|${push}|${commandEnabled}|${command}`;
}

export function summarizeSettingsForDiagnostics(source: PersistedSettings): string {
  const pushLabel = parseHotkey(source.pushToTalkHotkey)?.label ?? source.pushToTalkHotkey.trim();
  const commandLabel = source.commandMode
    ? parseHotkey(source.commandHotkey)?.label ?? source.commandHotkey.trim()
    : "disabled";
  const apiKeyPresent = source.apiKey.trim().length > 0;
  return [
    `capture=${source.captureMode}`,
    `stt=${source.sttRuntimeMode}`,
    `ai=${source.aiRuntimeMode}`,
    `remember=${boolFlag(source.rememberApiKey)}`,
    `apiKeyPresent=${boolFlag(apiKeyPresent)}`,
    `commandMode=${boolFlag(source.commandMode)}`,
    `push=${pushLabel || "-"}`,
    `command=${commandLabel || "-"}`,
  ].join(" ");
}

export interface SettingsPaneWiring {
  refs: SettingsFormRefs;
  onFieldChange: () => void;
  onThemeCardChange: (value: string) => void;
  onVolumePreview: (value: string) => void;
}

export interface SettingsCoreDeps {
  isCapturingHotkey: () => boolean;
  isCapturingCommandHotkey: () => boolean;
  currentSettings: () => PersistedSettings;
  refreshRecordingsStorageHint: () => void;
  isTauri: () => boolean;
  showStaleRuntimePane: () => void;
}

export function wireSettingsFormInputs(wiring: SettingsPaneWiring): void {
  const { refs } = wiring;
  const change = wiring.onFieldChange;
  refs.apiKeyInput.addEventListener("input", change);
  refs.apiBaseUrlInput.addEventListener("input", change);
  refs.sttModelInput.addEventListener("input", change);
  refs.aiModelInput.addEventListener("input", change);
  refs.localOllamaBaseUrlInput.addEventListener("input", change);
  refs.localOllamaModelInput.addEventListener("input", change);
  refs.localSttModelInput.addEventListener("input", change);
  refs.rememberApiKeyInput.addEventListener("change", change);
  refs.piperPathInput.addEventListener("input", change);
  refs.piperQualitySelect.addEventListener("change", change);
  refs.piperEmotionSelect.addEventListener("change", change);
  refs.piperSpeedInput.addEventListener("input", change);
  refs.ttsEngineSelect.addEventListener("change", change);
  refs.systemPromptInput.addEventListener("input", change);
  refs.temperatureInput.addEventListener("input", change);
  refs.maxTokensInput.addEventListener("input", change);
  refs.microphoneSelect.addEventListener("change", change);
  refs.dictationLanguageSelect.addEventListener("change", change);
  refs.dictationLanguageModeSingleInput.addEventListener("change", change);
  refs.dictationLanguageModeMultipleInput.addEventListener("change", change);
  for (const option of refs.dictationLanguageOptionInputs) {
    option.addEventListener("change", change);
  }
  refs.styleProfileSelect.addEventListener("change", change);
  refs.captureModeSingleInput.addEventListener("change", change);
  refs.captureModePushToTalkInput.addEventListener("change", change);
  refs.launchAtLoginToggle.addEventListener("change", change);
  refs.showFlowBarToggle.addEventListener("change", change);
  refs.commandModeToggle.addEventListener("change", change);
  refs.wakeWordEnabledToggle.addEventListener("change", change);
  refs.showDockAlwaysToggle.addEventListener("change", change);
  refs.assistantNameInput.addEventListener("input", change);
  refs.sttRuntimeModeOnlineInput.addEventListener("change", change);
  refs.sttRuntimeModeOfflineInput.addEventListener("change", change);
  refs.aiRuntimeModeOnlineInput.addEventListener("change", change);
  refs.aiRuntimeModeOfflineInput.addEventListener("change", change);
  refs.contextAwarenessToggle.addEventListener("change", change);
  refs.copyToClipboardToggle.addEventListener("change", change);
  refs.autoPasteDictationToggle.addEventListener("change", change);
  refs.incognitoModeToggle.addEventListener("change", change);
  refs.saveRecordingsToggle.addEventListener("change", change);
  refs.themeModeSelect.addEventListener("change", change);
  for (const cardInput of refs.themeCardInputs) {
    cardInput.addEventListener("change", () => {
      if (!cardInput.checked) {
        return;
      }
      wiring.onThemeCardChange(cardInput.value);
    });
  }
  refs.dictationSoundEffectsToggle.addEventListener("change", change);
  refs.pushToTalkSoundSelect.addEventListener("change", change);
  refs.pushToTalkEndSoundSelect.addEventListener("change", change);
  refs.pushToTalkSoundVolumeRange.addEventListener("input", () => {
    wiring.onVolumePreview(refs.pushToTalkSoundVolumeRange.value);
  });
  refs.pushToTalkSoundVolumeRange.addEventListener("change", change);
  refs.muteMusicWhileDictatingToggle.addEventListener("change", change);
  refs.rawModeToggle.addEventListener("change", change);
  refs.backtrackToggle.addEventListener("change", change);
  refs.removeFillersToggle.addEventListener("change", change);
  refs.autoPunctuationToggle.addEventListener("change", change);
  refs.numberedListsToggle.addEventListener("change", change);
  refs.noiseSuppressionToggle.addEventListener("change", change);
}

export function readSettingsFromForm(
  refs: SettingsFormRefs,
  deps: SettingsCoreDeps,
): PersistedSettings {
  const dictationLanguageMode: DictationLanguageMode = refs.dictationLanguageModeMultipleInput.checked
    ? "multiple"
    : "single";
  const primaryDictationLanguage = normalizeDictationLanguageCode(refs.dictationLanguageSelect.value);
  let dictationLanguageAllowList =
    dictationLanguageMode === "multiple"
      ? normalizeDictationLanguageAllowList(
          refs.dictationLanguageOptionInputs
            .filter((option) => option.checked)
            .map((option) => option.value),
        )
      : [];

  if (
    dictationLanguageMode === "multiple" &&
    primaryDictationLanguage &&
    !dictationLanguageAllowList.includes(primaryDictationLanguage)
  ) {
    dictationLanguageAllowList = [primaryDictationLanguage, ...dictationLanguageAllowList];
  }

  const dictationLanguage =
    dictationLanguageMode === "multiple"
      ? primaryDictationLanguage || dictationLanguageAllowList[0] || ""
      : primaryDictationLanguage;
  const resolvedTtsEngine: TtsEngine = "piper";

  return {
    apiKey: refs.apiKeyInput.value.trim(),
    apiBaseUrl: refs.apiBaseUrlInput.value.trim(),
    sttModelName: refs.sttModelInput.value.trim(),
    aiModelName: refs.aiModelInput.value.trim(),
    runtimeMode:
      refs.sttRuntimeModeOfflineInput.checked && refs.aiRuntimeModeOfflineInput.checked ? "local" : "online",
    sttRuntimeMode: refs.sttRuntimeModeOfflineInput.checked ? "local" : "online",
    aiRuntimeMode: refs.aiRuntimeModeOfflineInput.checked ? "local" : "online",
    localOllamaBaseUrl: refs.localOllamaBaseUrlInput.value.trim() || DEFAULT_LOCAL_OLLAMA_BASE_URL,
    localOllamaModel: refs.localOllamaModelInput.value.trim(),
    localSttModel: refs.localSttModelInput.value.trim(),
    rememberApiKey: refs.rememberApiKeyInput.checked,
    captureMode: refs.captureModeSingleInput.checked ? "single-tap" : "push-to-talk",
    piperPath: refs.piperPathInput.value.trim(),
    ttsEngine: resolvedTtsEngine,
    piperSpeed: coerceNumber(Number(refs.piperSpeedInput.value), DEFAULT_PIPER_SPEED, 0.5, 2),
    piperQuality: asPiperQuality(refs.piperQualitySelect.value),
    piperEmotion: asPiperEmotion(refs.piperEmotionSelect.value),
    microphoneDeviceId: refs.microphoneSelect.value,
    pushToTalkHotkey: deps.isCapturingHotkey()
      ? deps.currentSettings().pushToTalkHotkey
      : refs.hotkeyInput.value.trim() || DEFAULT_HOTKEY,
    commandHotkey: deps.isCapturingCommandHotkey()
      ? deps.currentSettings().commandHotkey
      : refs.commandHotkeyInput.value.trim() || DEFAULT_COMMAND_HOTKEY,
    dictationLanguage,
    dictationLanguageMode,
    dictationLanguageAllowList,
    styleProfile: asStyleProfile(refs.styleProfileSelect.value),
    systemPrompt: refs.systemPromptInput.value,
    temperature: coerceNumber(Number(refs.temperatureInput.value), DEFAULT_TEMPERATURE, 0, 1.2),
    maxTokens: coerceInteger(Number(refs.maxTokensInput.value), DEFAULT_MAX_TOKENS, 64, 4096),
    launchAtLogin: refs.launchAtLoginToggle.checked,
    showFlowBar: refs.showFlowBarToggle.checked,
    showDockAlways: refs.showDockAlwaysToggle.checked,
    commandMode: refs.commandModeToggle.checked,
    wakeWordEnabled: refs.wakeWordEnabledToggle.checked,
    assistantName: refs.assistantNameInput.value,
    autoPasteDictation: refs.autoPasteDictationToggle.checked,
    contextAwareness: refs.contextAwarenessToggle.checked,
    copyToClipboard: refs.copyToClipboardToggle.checked,
    incognitoMode: refs.incognitoModeToggle.checked,
    themeMode: asThemeMode(refs.themeModeSelect.value),
    dictationSoundEffects: refs.dictationSoundEffectsToggle.checked,
    muteMusicWhileDictating: refs.muteMusicWhileDictatingToggle.checked,
    rawMode: refs.rawModeToggle.checked,
    backtrackCorrection: refs.backtrackToggle.checked,
    removeFillers: refs.removeFillersToggle.checked,
    autoPunctuation: refs.autoPunctuationToggle.checked,
    numberedLists: refs.numberedListsToggle.checked,
    noiseSuppression: refs.noiseSuppressionToggle.checked,
    pushToTalkSound: refs.pushToTalkSoundSelect.value,
    pushToTalkEndSound: refs.pushToTalkEndSoundSelect.value,
    pushToTalkSoundVolume: coerceNumber(Number(refs.pushToTalkSoundVolumeRange.value) / 100, DEFAULT_PUSH_TO_TALK_SOUND_VOLUME, 0, 1),
    saveRecordings: refs.saveRecordingsToggle.checked,
  };
}

export function updateWakePhrasePreview(refs: SettingsFormRefs, name: string): void {
  const wakeName = name.trim() || DEFAULT_ASSISTANT_NAME;
  refs.wakePhrasePreview.textContent = `Wake phrase examples: "Hey ${wakeName}", "Hi ${wakeName}", "Okay ${wakeName}"`;
}

export function refreshGeneralDisplayFromSettings(
  refs: SettingsFormRefs,
  next: PersistedSettings,
): void {
  refs.themeModeSelect.value = next.themeMode;
  updateWakePhrasePreview(refs, next.assistantName);
  refs.hotkeyHint.textContent = formatHotkeyForDisplay(next.pushToTalkHotkey);
  refs.captureModeHint.textContent = captureModeLabel(next.captureMode);
  refs.pttVolumeHint.textContent = Math.round(next.pushToTalkSoundVolume * 100) + "%";
  refs.temperatureValue.textContent = next.temperature.toFixed(2);
  refs.piperSpeedValue.textContent = next.piperSpeed.toFixed(2) + "x";
}

export function applySettingsToForm(
  refs: SettingsFormRefs,
  deps: SettingsCoreDeps,
  next: PersistedSettings,
): void {
  refs.apiKeyInput.value = next.apiKey;
  refs.apiBaseUrlInput.value = next.apiBaseUrl;
  refs.sttModelInput.value = next.sttModelName;
  refs.aiModelInput.value = next.aiModelName;
  refs.sttRuntimeModeOnlineInput.checked = next.sttRuntimeMode !== "local";
  refs.sttRuntimeModeOfflineInput.checked = next.sttRuntimeMode === "local";
  refs.aiRuntimeModeOnlineInput.checked = next.aiRuntimeMode !== "local";
  refs.aiRuntimeModeOfflineInput.checked = next.aiRuntimeMode === "local";
  refs.localOllamaBaseUrlInput.value = next.localOllamaBaseUrl || DEFAULT_LOCAL_OLLAMA_BASE_URL;
  refs.localOllamaModelInput.value = next.localOllamaModel;
  refs.localSttModelInput.value = next.localSttModel;
  refs.rememberApiKeyInput.checked = next.rememberApiKey;
  // Only set microphone selection when the dropdown already has options populated
  // (refreshMicrophones runs later during bootstrap and handles the initial selection).
  if (next.microphoneDeviceId && refs.microphoneSelect.options.length > 0) {
    refs.microphoneSelect.value = next.microphoneDeviceId;
  }
  refs.piperPathInput.value = next.piperPath;
  refs.ttsEngineSelect.value = next.ttsEngine;
  refs.piperSpeedInput.value = next.piperSpeed.toFixed(2);
  refs.piperQualitySelect.value = next.piperQuality;
  refs.piperEmotionSelect.value = next.piperEmotion;
  refs.hotkeyInput.value = next.pushToTalkHotkey;
  refs.commandHotkeyInput.value = next.commandHotkey;
  applyDictationLanguageSettingsToForm(refs, next);
  refs.styleProfileSelect.value = next.styleProfile;
  refs.systemPromptInput.value = next.systemPrompt;
  refs.temperatureInput.value = next.temperature.toFixed(2);
  refs.maxTokensInput.value = String(next.maxTokens);
  refs.captureModeSingleInput.checked = next.captureMode === "single-tap";
  refs.captureModePushToTalkInput.checked = next.captureMode === "push-to-talk";
  refs.launchAtLoginToggle.checked = next.launchAtLogin;
  refs.showFlowBarToggle.checked = next.showFlowBar;
  refs.showDockAlwaysToggle.checked = next.showDockAlways;
  refs.commandModeToggle.checked = next.commandMode;
  refs.wakeWordEnabledToggle.checked = next.wakeWordEnabled;
  refs.assistantNameInput.value = next.assistantName;
  refs.autoPasteDictationToggle.checked = next.autoPasteDictation;
  refs.contextAwarenessToggle.checked = next.contextAwareness;
  refs.copyToClipboardToggle.checked = next.copyToClipboard;
  refs.incognitoModeToggle.checked = next.incognitoMode;
  refreshGeneralDisplayFromSettings(refs, next);
  refs.dictationSoundEffectsToggle.checked = next.dictationSoundEffects;
  refs.muteMusicWhileDictatingToggle.checked = next.muteMusicWhileDictating;
  refs.rawModeToggle.checked = next.rawMode;
  refs.backtrackToggle.checked = next.backtrackCorrection;
  refs.removeFillersToggle.checked = next.removeFillers;
  refs.autoPunctuationToggle.checked = next.autoPunctuation;
  refs.numberedListsToggle.checked = next.numberedLists;
  refs.noiseSuppressionToggle.checked = next.noiseSuppression;
  refs.pushToTalkSoundSelect.value = next.pushToTalkSound;
  refs.pushToTalkEndSoundSelect.value = next.pushToTalkEndSound;
  refs.pushToTalkSoundVolumeRange.value = String(Math.round(next.pushToTalkSoundVolume * 100));
  refs.saveRecordingsToggle.checked = next.saveRecordings;
  if (deps.isTauri()) {
    refs.recordingsStorageHintWeb.hidden = true;
    deps.refreshRecordingsStorageHint();
  } else {
    refs.recordingsStorageHint.textContent = "Desktop only";
    refs.recordingsStorageHintWeb.hidden = false;
  }

  applyTheme(next.themeMode);
  syncThemeCardSelection(refs, next.themeMode);
  updateRuntimeModeNotice(refs, next.sttRuntimeMode, next.aiRuntimeMode);
  syncRuntimeModePaneVisibility(refs, deps.showStaleRuntimePane);
  syncHybridRuntimeFieldVisibility(refs, next.sttRuntimeMode, next.aiRuntimeMode);
}

export function normalizeHotkeyLabelsInPlace(
  refs: SettingsFormRefs,
  next: PersistedSettings,
): void {
  const parsed = parseHotkey(next.pushToTalkHotkey);
  const commandParsed = parseHotkey(next.commandHotkey);

  if (parsed) {
    next.pushToTalkHotkey = parsed.label;
    refs.hotkeyInput.value = parsed.label;
  }

  if (commandParsed) {
    next.commandHotkey = commandParsed.label;
    refs.commandHotkeyInput.value = commandParsed.label;
  }
}
