/**
 * Settings form element refs — Phase 4 settings ownership.
 *
 * Single place that queries the settings DOM ids rendered by the React
 * settings panes. `main.tsx` builds one `SettingsFormRefs` and passes it
 * to `settings-service`; the service never touches module globals.
 */
export function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

export interface SettingsFormRefs {
  apiBaseUrlInput: HTMLInputElement;
  assistantNameInput: HTMLInputElement;
  dictationLanguageSelect: HTMLSelectElement;
  dictationLanguageModeSingleInput: HTMLInputElement;
  dictationLanguageModeMultipleInput: HTMLInputElement;
  dictationLanguageMultiWrap: HTMLDivElement;
  dictationLanguageOptionInputs: HTMLInputElement[];
  dictationLanguageSummary: HTMLParagraphElement;
  themeCardInputs: HTMLInputElement[];
  runtimeModeNotice: HTMLParagraphElement;
  onlineProviderSection: HTMLDivElement;
  onlineSttModelField: HTMLElement;
  onlineAiModelField: HTMLElement;
  offlineOllamaSection: HTMLDivElement;
  offlineSttSection: HTMLDivElement;
  onlineProviderModeNotice: HTMLParagraphElement;
  offlineRuntimeModeNotice: HTMLParagraphElement;
  settingsPanels: HTMLElement[];
  apiKeyInput: HTMLInputElement;
  sttModelInput: HTMLInputElement;
  aiModelInput: HTMLInputElement;
  localOllamaBaseUrlInput: HTMLInputElement;
  localOllamaModelInput: HTMLInputElement;
  localSttModelInput: HTMLInputElement;
  rememberApiKeyInput: HTMLInputElement;
  captureModeSingleInput: HTMLInputElement;
  captureModePushToTalkInput: HTMLInputElement;
  microphoneSelect: HTMLSelectElement;
  hotkeyInput: HTMLInputElement;
  commandHotkeyInput: HTMLInputElement;
  styleProfileSelect: HTMLSelectElement;
  ttsEngineSelect: HTMLSelectElement;
  piperPathInput: HTMLInputElement;
  piperQualitySelect: HTMLSelectElement;
  piperEmotionSelect: HTMLSelectElement;
  piperSpeedInput: HTMLInputElement;
  piperSpeedValue: HTMLElement;
  systemPromptInput: HTMLTextAreaElement;
  temperatureInput: HTMLInputElement;
  temperatureValue: HTMLElement;
  maxTokensInput: HTMLInputElement;
  launchAtLoginToggle: HTMLInputElement;
  showFlowBarToggle: HTMLInputElement;
  showDockAlwaysToggle: HTMLInputElement;
  commandModeToggle: HTMLInputElement;
  wakeWordEnabledToggle: HTMLInputElement;
  wakePhrasePreview: HTMLParagraphElement;
  sttRuntimeModeOnlineInput: HTMLInputElement;
  sttRuntimeModeOfflineInput: HTMLInputElement;
  aiRuntimeModeOnlineInput: HTMLInputElement;
  aiRuntimeModeOfflineInput: HTMLInputElement;
  contextAwarenessToggle: HTMLInputElement;
  copyToClipboardToggle: HTMLInputElement;
  autoPasteDictationToggle: HTMLInputElement;
  incognitoModeToggle: HTMLInputElement;
  saveRecordingsToggle: HTMLInputElement;
  recordingsStorageHint: HTMLElement;
  recordingsStorageHintWeb: HTMLParagraphElement;
  clearRecordingsBtn: HTMLButtonElement;
  themeModeSelect: HTMLSelectElement;
  captureBackendSelect: HTMLSelectElement;
  shellIntegrationToggle: HTMLInputElement;
  dictationSoundEffectsToggle: HTMLInputElement;
  muteMusicWhileDictatingToggle: HTMLInputElement;
  pushToTalkSoundSelect: HTMLSelectElement;
  pushToTalkEndSoundSelect: HTMLSelectElement;
  pushToTalkSoundVolumeRange: HTMLInputElement;
  pttVolumeHint: HTMLElement;
  rawModeToggle: HTMLInputElement;
  backtrackToggle: HTMLInputElement;
  removeFillersToggle: HTMLInputElement;
  autoPunctuationToggle: HTMLInputElement;
  numberedListsToggle: HTMLInputElement;
  noiseSuppressionToggle: HTMLInputElement;
  hotkeyHint: HTMLElement;
  captureModeHint: HTMLElement;
}

export function querySettingsFormRefs(): SettingsFormRefs {
  return {
    apiBaseUrlInput: requiredElement<HTMLInputElement>("#apiBaseUrlInput"),
    assistantNameInput: requiredElement<HTMLInputElement>("#assistantNameInput"),
    dictationLanguageSelect: requiredElement<HTMLSelectElement>("#dictationLanguageSelect"),
    dictationLanguageModeSingleInput: requiredElement<HTMLInputElement>(
      "#dictationLanguageModeSingle",
    ),
    dictationLanguageModeMultipleInput: requiredElement<HTMLInputElement>(
      "#dictationLanguageModeMultiple",
    ),
    dictationLanguageMultiWrap: requiredElement<HTMLDivElement>("#dictationLanguageMultiWrap"),
    dictationLanguageOptionInputs: Array.from(
      document.querySelectorAll<HTMLInputElement>("[data-dictation-lang-option]"),
    ),
    dictationLanguageSummary: requiredElement<HTMLParagraphElement>("#dictationLanguageSummary"),
    themeCardInputs: Array.from(
      document.querySelectorAll<HTMLInputElement>("input[data-theme-card]"),
    ),
    runtimeModeNotice: requiredElement<HTMLParagraphElement>("#runtimeModeNotice"),
    onlineProviderSection: requiredElement<HTMLDivElement>("#onlineProviderSection"),
    onlineSttModelField: requiredElement<HTMLElement>('[data-online-field="stt-model"]'),
    onlineAiModelField: requiredElement<HTMLElement>('[data-online-field="ai-model"]'),
    offlineOllamaSection: requiredElement<HTMLDivElement>("#offlineOllamaSection"),
    offlineSttSection: requiredElement<HTMLDivElement>("#offlineSttSection"),
    onlineProviderModeNotice: requiredElement<HTMLParagraphElement>("#onlineProviderModeNotice"),
    offlineRuntimeModeNotice: requiredElement<HTMLParagraphElement>("#offlineRuntimeModeNotice"),
    settingsPanels: Array.from(document.querySelectorAll<HTMLElement>("[data-settings-pane]")),
    apiKeyInput: requiredElement<HTMLInputElement>("#apiKeyInput"),
    sttModelInput: requiredElement<HTMLInputElement>("#sttModelInput"),
    aiModelInput: requiredElement<HTMLInputElement>("#aiModelInput"),
    localOllamaBaseUrlInput: requiredElement<HTMLInputElement>("#localOllamaBaseUrlInput"),
    localOllamaModelInput: requiredElement<HTMLInputElement>("#localOllamaModelInput"),
    localSttModelInput: requiredElement<HTMLInputElement>("#localSttModelInput"),
    rememberApiKeyInput: requiredElement<HTMLInputElement>("#rememberApiKeyInput"),
    captureModeSingleInput: requiredElement<HTMLInputElement>("#captureModeSingle"),
    captureModePushToTalkInput: requiredElement<HTMLInputElement>("#captureModePushToTalk"),
    microphoneSelect: requiredElement<HTMLSelectElement>("#microphoneSelect"),
    hotkeyInput: requiredElement<HTMLInputElement>("#hotkeyInput"),
    commandHotkeyInput: requiredElement<HTMLInputElement>("#commandHotkeyInput"),
    styleProfileSelect: requiredElement<HTMLSelectElement>("#styleProfileSelect"),
    ttsEngineSelect: requiredElement<HTMLSelectElement>("#ttsEngineSelect"),
    piperPathInput: requiredElement<HTMLInputElement>("#piperPathInput"),
    piperQualitySelect: requiredElement<HTMLSelectElement>("#piperQualitySelect"),
    piperEmotionSelect: requiredElement<HTMLSelectElement>("#piperEmotionSelect"),
    piperSpeedInput: requiredElement<HTMLInputElement>("#piperSpeedInput"),
    piperSpeedValue: requiredElement<HTMLElement>("#piperSpeedValue"),
    systemPromptInput: requiredElement<HTMLTextAreaElement>("#systemPromptInput"),
    temperatureInput: requiredElement<HTMLInputElement>("#temperatureInput"),
    temperatureValue: requiredElement<HTMLElement>("#temperatureValue"),
    maxTokensInput: requiredElement<HTMLInputElement>("#maxTokensInput"),
    launchAtLoginToggle: requiredElement<HTMLInputElement>("#launchAtLoginToggle"),
    showFlowBarToggle: requiredElement<HTMLInputElement>("#showFlowBarToggle"),
    showDockAlwaysToggle: requiredElement<HTMLInputElement>("#showDockAlwaysToggle"),
    commandModeToggle: requiredElement<HTMLInputElement>("#commandModeToggle"),
    wakeWordEnabledToggle: requiredElement<HTMLInputElement>("#wakeWordEnabledToggle"),
    wakePhrasePreview: requiredElement<HTMLParagraphElement>("#wakePhrasePreview"),
    sttRuntimeModeOnlineInput: requiredElement<HTMLInputElement>("#sttRuntimeModeOnline"),
    sttRuntimeModeOfflineInput: requiredElement<HTMLInputElement>("#sttRuntimeModeOffline"),
    aiRuntimeModeOnlineInput: requiredElement<HTMLInputElement>("#aiRuntimeModeOnline"),
    aiRuntimeModeOfflineInput: requiredElement<HTMLInputElement>("#aiRuntimeModeOffline"),
    contextAwarenessToggle: requiredElement<HTMLInputElement>("#contextAwarenessToggle"),
    copyToClipboardToggle: requiredElement<HTMLInputElement>("#copyToClipboardToggle"),
    autoPasteDictationToggle: requiredElement<HTMLInputElement>("#autoPasteDictationToggle"),
    incognitoModeToggle: requiredElement<HTMLInputElement>("#incognitoModeToggle"),
    saveRecordingsToggle: requiredElement<HTMLInputElement>("#saveRecordingsToggle"),
    recordingsStorageHint: requiredElement<HTMLElement>("#recordingsStorageHint"),
    recordingsStorageHintWeb: requiredElement<HTMLParagraphElement>("#recordingsStorageHintWeb"),
    clearRecordingsBtn: requiredElement<HTMLButtonElement>("#clearRecordingsBtn"),
    themeModeSelect: requiredElement<HTMLSelectElement>("#themeModeSelect"),
    captureBackendSelect: requiredElement<HTMLSelectElement>("#captureBackendSelect"),
    shellIntegrationToggle: requiredElement<HTMLInputElement>("#shellIntegrationToggle"),
    dictationSoundEffectsToggle: requiredElement<HTMLInputElement>("#dictationSoundEffectsToggle"),
    muteMusicWhileDictatingToggle: requiredElement<HTMLInputElement>(
      "#muteMusicWhileDictatingToggle",
    ),
    pushToTalkSoundSelect: requiredElement<HTMLSelectElement>("#pushToTalkSoundSelect"),
    pushToTalkEndSoundSelect: requiredElement<HTMLSelectElement>("#pushToTalkEndSoundSelect"),
    pushToTalkSoundVolumeRange: requiredElement<HTMLInputElement>("#pushToTalkSoundVolumeRange"),
    pttVolumeHint: requiredElement<HTMLElement>("#pttVolumeHint"),
    rawModeToggle: requiredElement<HTMLInputElement>("#rawModeToggle"),
    backtrackToggle: requiredElement<HTMLInputElement>("#backtrackToggle"),
    removeFillersToggle: requiredElement<HTMLInputElement>("#removeFillersToggle"),
    autoPunctuationToggle: requiredElement<HTMLInputElement>("#autoPunctuationToggle"),
    numberedListsToggle: requiredElement<HTMLInputElement>("#numberedListsToggle"),
    noiseSuppressionToggle: requiredElement<HTMLInputElement>("#noiseSuppressionToggle"),
    hotkeyHint: requiredElement<HTMLElement>("#hotkeyHint"),
    captureModeHint: requiredElement<HTMLElement>("#captureModeHint"),
  };
}

export function applyInputValidationState(
  input: HTMLInputElement | HTMLTextAreaElement,
  error: string | null,
): void {
  input.setCustomValidity(error ?? "");
  input.toggleAttribute("aria-invalid", Boolean(error));
}
