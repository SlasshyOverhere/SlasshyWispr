/**
 * Settings form read/apply — Phase 4c split from settings-service.
 *
 * Owns: readSettingsFromForm, applySettingsToForm, display refresh,
 * wake preview, hotkey normalization. Depends on settings-display.
 */
import {
  DEFAULT_ASSISTANT_NAME,
  DEFAULT_COMMAND_HOTKEY,
  DEFAULT_HOTKEY,
  DEFAULT_LOCAL_OLLAMA_BASE_URL,
  DEFAULT_PIPER_SPEED,
  DEFAULT_PUSH_TO_TALK_SOUND_VOLUME,
} from "../constants";
import type { PersistedSettings } from "../types";
import {
  asPiperEmotion,
  asPiperQuality,
  asStyleProfile,
  asCaptureBackend,
  asThemeMode,
  coerceInteger,
  coerceNumber,
  normalizeDictationLanguageAllowList,
  normalizeDictationLanguageCode,
} from "../state/settings-store";
import type { DictationLanguageMode, TtsEngine } from "../types";
import { captureModeLabel } from "../utils";
import { formatHotkeyForDisplay, parseHotkey } from "../hotkeys/hotkey-service";
import type { SettingsFormRefs } from "./settings-form-refs";
import { maxTokensBounds } from "./max-tokens-bounds";
import { sttTimeoutBounds } from "./stt-timeout-bounds";
import { temperatureBounds } from "./temperature-bounds";
import {
  applyDictationLanguageSettingsToForm,
  applyTheme,
  syncHybridRuntimeFieldVisibility,
  syncRuntimeModePaneVisibility,
  syncThemeCardSelection,
  updateRuntimeModeNotice,
} from "./settings-display";
import type { SettingsCoreDeps } from "./settings-wiring";

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
    temperature: coerceNumber(
      Number(refs.temperatureInput.value),
      temperatureBounds().defaultTemperature,
      temperatureBounds().minTemperature,
      temperatureBounds().maxTemperature,
    ),
    maxTokens: coerceInteger(
      Number(refs.maxTokensInput.value),
      maxTokensBounds().defaultTokens,
      maxTokensBounds().minTokens,
      maxTokensBounds().maxTokens,
    ),
    sttTimeoutSeconds: coerceInteger(
      Number(refs.sttTimeoutSecondsInput.value),
      sttTimeoutBounds().defaultSeconds,
      sttTimeoutBounds().minSeconds,
      sttTimeoutBounds().maxSeconds,
    ),
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
    captureBackend: asCaptureBackend(refs.captureBackendSelect.value),
    shellIntegration: refs.shellIntegrationToggle.checked,
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
  refs.captureBackendSelect.value = next.captureBackend;
  refs.shellIntegrationToggle.checked = next.shellIntegration;
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
  refs.sttTimeoutSecondsInput.value = String(next.sttTimeoutSeconds);
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

export function applySettingsPatchToForm(
  refs: SettingsFormRefs,
  patch: Partial<PersistedSettings>,
): void {
  if (patch.systemPrompt !== undefined) refs.systemPromptInput.value = patch.systemPrompt;
  if (patch.temperature !== undefined) refs.temperatureInput.value = String(patch.temperature);
  if (patch.maxTokens !== undefined) refs.maxTokensInput.value = String(patch.maxTokens);
  if (patch.sttTimeoutSeconds !== undefined) {
    refs.sttTimeoutSecondsInput.value = String(patch.sttTimeoutSeconds);
  }
  if (patch.apiKey !== undefined) refs.apiKeyInput.value = patch.apiKey;
  if (patch.apiBaseUrl !== undefined) refs.apiBaseUrlInput.value = patch.apiBaseUrl;
  if (patch.sttModelName !== undefined) refs.sttModelInput.value = patch.sttModelName;
  if (patch.aiModelName !== undefined) refs.aiModelInput.value = patch.aiModelName;
  if (patch.rememberApiKey !== undefined) refs.rememberApiKeyInput.checked = patch.rememberApiKey;
  if (patch.sttRuntimeMode !== undefined) {
    refs.sttRuntimeModeOnlineInput.checked = patch.sttRuntimeMode !== "local";
    refs.sttRuntimeModeOfflineInput.checked = patch.sttRuntimeMode === "local";
  }
  if (patch.aiRuntimeMode !== undefined) {
    refs.aiRuntimeModeOnlineInput.checked = patch.aiRuntimeMode !== "local";
    refs.aiRuntimeModeOfflineInput.checked = patch.aiRuntimeMode === "local";
  }
  if (patch.localOllamaBaseUrl !== undefined) refs.localOllamaBaseUrlInput.value = patch.localOllamaBaseUrl;
  if (patch.localOllamaModel !== undefined) refs.localOllamaModelInput.value = patch.localOllamaModel;
  if (patch.piperPath !== undefined) refs.piperPathInput.value = patch.piperPath;
  if (patch.piperQuality !== undefined) refs.piperQualitySelect.value = patch.piperQuality;
  if (patch.piperEmotion !== undefined) refs.piperEmotionSelect.value = patch.piperEmotion;
  if (patch.piperSpeed !== undefined) refs.piperSpeedInput.value = patch.piperSpeed.toFixed(2);
  if (patch.captureMode !== undefined) {
    refs.captureModeSingleInput.checked = patch.captureMode === "single-tap";
    refs.captureModePushToTalkInput.checked = patch.captureMode === "push-to-talk";
  }
  if (patch.themeMode !== undefined) {
    refs.themeModeSelect.value = patch.themeMode;
    for (const input of refs.themeCardInputs) {
      input.checked = input.value === patch.themeMode;
    }
  }
  if (patch.captureBackend !== undefined) refs.captureBackendSelect.value = patch.captureBackend;
  if (patch.shellIntegration !== undefined) refs.shellIntegrationToggle.checked = patch.shellIntegration;
  if (patch.dictationLanguage !== undefined) refs.dictationLanguageSelect.value = patch.dictationLanguage;
  if (patch.dictationLanguageMode !== undefined) {
    refs.dictationLanguageModeSingleInput.checked = patch.dictationLanguageMode === "single";
    refs.dictationLanguageModeMultipleInput.checked = patch.dictationLanguageMode === "multiple";
  }
  if (patch.dictationLanguageAllowList !== undefined) {
    for (const option of refs.dictationLanguageOptionInputs) {
      option.checked = patch.dictationLanguageAllowList.includes(option.value);
    }
  }
  if (patch.styleProfile !== undefined) refs.styleProfileSelect.value = patch.styleProfile;
  if (patch.rawMode !== undefined) refs.rawModeToggle.checked = patch.rawMode;
  if (patch.backtrackCorrection !== undefined) refs.backtrackToggle.checked = patch.backtrackCorrection;
  if (patch.removeFillers !== undefined) refs.removeFillersToggle.checked = patch.removeFillers;
  if (patch.autoPunctuation !== undefined) refs.autoPunctuationToggle.checked = patch.autoPunctuation;
  if (patch.numberedLists !== undefined) refs.numberedListsToggle.checked = patch.numberedLists;
  if (patch.noiseSuppression !== undefined) refs.noiseSuppressionToggle.checked = patch.noiseSuppression;
  if (patch.commandMode !== undefined) refs.commandModeToggle.checked = patch.commandMode;
  if (patch.wakeWordEnabled !== undefined) refs.wakeWordEnabledToggle.checked = patch.wakeWordEnabled;
  if (patch.assistantName !== undefined) refs.assistantNameInput.value = patch.assistantName;
  if (patch.contextAwareness !== undefined) refs.contextAwarenessToggle.checked = patch.contextAwareness;
  if (patch.copyToClipboard !== undefined) refs.copyToClipboardToggle.checked = patch.copyToClipboard;
  if (patch.autoPasteDictation !== undefined) refs.autoPasteDictationToggle.checked = patch.autoPasteDictation;
  if (patch.launchAtLogin !== undefined) refs.launchAtLoginToggle.checked = patch.launchAtLogin;
  if (patch.showFlowBar !== undefined) refs.showFlowBarToggle.checked = patch.showFlowBar;
  if (patch.showDockAlways !== undefined) refs.showDockAlwaysToggle.checked = patch.showDockAlways;
  if (patch.incognitoMode !== undefined) refs.incognitoModeToggle.checked = patch.incognitoMode;
  if (patch.saveRecordings !== undefined) refs.saveRecordingsToggle.checked = patch.saveRecordings;
  if (patch.dictationSoundEffects !== undefined) refs.dictationSoundEffectsToggle.checked = patch.dictationSoundEffects;
  if (patch.pushToTalkSound !== undefined) refs.pushToTalkSoundSelect.value = patch.pushToTalkSound;
  if (patch.pushToTalkEndSound !== undefined) refs.pushToTalkEndSoundSelect.value = patch.pushToTalkEndSound;
  if (patch.pushToTalkSoundVolume !== undefined) {
    refs.pushToTalkSoundVolumeRange.value = String(Math.round(patch.pushToTalkSoundVolume * 100));
  }
  if (patch.muteMusicWhileDictating !== undefined) {
    refs.muteMusicWhileDictatingToggle.checked = patch.muteMusicWhileDictating;
  }
}
