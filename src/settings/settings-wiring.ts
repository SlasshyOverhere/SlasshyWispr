/**
 * Settings input wiring — Phase 4d split from settings-service.
 *
 * Owns: wireSettingsFormInputs + SettingsPaneWiring/SettingsCoreDeps.
 */
import type { PersistedSettings } from "../types";
import type { SettingsFormRefs } from "./settings-form-refs";
import { isPaneConverted } from "./settings-state";

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
  if (!isPaneConverted("pipeline")) {
    refs.systemPromptInput.addEventListener("input", change);
    refs.temperatureInput.addEventListener("input", change);
    refs.maxTokensInput.addEventListener("input", change);
  }
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
