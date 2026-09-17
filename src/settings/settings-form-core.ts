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
  DEFAULT_MAX_TOKENS,
  DEFAULT_PIPER_SPEED,
  DEFAULT_PUSH_TO_TALK_SOUND_VOLUME,
  DEFAULT_TEMPERATURE,
} from "../constants";
import type { PersistedSettings } from "../types";
import {
  asPiperEmotion,
  asPiperQuality,
  asStyleProfile,
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
