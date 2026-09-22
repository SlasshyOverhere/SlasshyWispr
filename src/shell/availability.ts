/**
 * Action availability sync — Phase 5 shell decomposition.
 *
 * Owns syncActionAvailability. Moved verbatim from main.tsx; busy flags,
 * runtime state, form refs, and button elements arrive via initAvailability
 * so this module never touches main.tsx module globals.
 */
import type { SettingsFormRefs } from "../settings/settings-form-refs";

export interface AvailabilityElements {
  refreshMicsBtn: HTMLButtonElement;
  setupRuntimeBtn: HTMLButtonElement;
  validatePiperBtn: HTMLButtonElement;
  downloadVoiceBtn: HTMLButtonElement;
  setupAllTtsBtn: HTMLButtonElement;
  clearHistoryBtn: HTMLButtonElement;
  fetchProviderModelsBtn: HTMLButtonElement;
  applyModelToAiBtn: HTMLButtonElement;
  applyModelToSttBtn: HTMLButtonElement;
  checkOllamaStatusBtn: HTMLButtonElement;
  installOllamaBtn: HTMLButtonElement;
  fetchOllamaModelsBtn: HTMLButtonElement;
  useOllamaModelBtn: HTMLButtonElement;
  pullOllamaModelBtn: HTMLButtonElement;
  sidebarToggleLocalSttBtn: HTMLButtonElement;
  downloadLocalSttModelBtn: HTMLButtonElement;
  deleteLocalSttModelBtn: HTMLButtonElement;
  openLocalSttModelPathBtn: HTMLButtonElement;
  providerModelCatalogSelect: HTMLSelectElement;
  localOllamaModelCatalogSelect: HTMLSelectElement;
  localSttModelInput: HTMLInputElement;
  localSttModelCatalogSelect: HTMLSelectElement;
  ttsEngineSelect: HTMLSelectElement;
  hotkeyInput: HTMLInputElement;
  commandHotkeyInput: HTMLInputElement;
  toggleMicEditorBtn: HTMLButtonElement;
  toggleHotkeyEditorBtn: HTMLButtonElement;
}

export interface AvailabilityDeps {
  isPipelineRunning: () => boolean;
  getStage: () => string;
  isTtsSetupRunning: () => boolean;
  isOllamaStatusBusy: () => boolean;
  isOllamaInstallBusy: () => boolean;
  isOllamaPullBusy: () => boolean;
  isLocalSttHardwareAdvisorOpen: () => boolean;
  isLocalSttBusy: () => boolean;
  getSttRuntimeMode: () => string;
  getAiRuntimeMode: () => string;
  getFormRefs: () => SettingsFormRefs;
  renderLocalSttSettingsStatus: () => void;
}

let availabilityElements!: AvailabilityElements;
let availabilityDeps!: AvailabilityDeps;

export function initAvailability(
  elements: AvailabilityElements,
  deps: AvailabilityDeps,
): void {
  availabilityElements = elements;
  availabilityDeps = deps;
}

export function syncActionAvailability(): void {
  const busy =
    availabilityDeps.isPipelineRunning() ||
    availabilityDeps.getStage() === "recording" ||
    availabilityDeps.isTtsSetupRunning() ||
    availabilityDeps.isOllamaStatusBusy() ||
    availabilityDeps.isOllamaInstallBusy() ||
    availabilityDeps.isOllamaPullBusy() ||
    availabilityDeps.isLocalSttHardwareAdvisorOpen();
  const localSttBusy = busy || availabilityDeps.isLocalSttBusy();
  const sttRuntimeIsLocal = availabilityDeps.getSttRuntimeMode() === "local";
  const formRefs = availabilityDeps.getFormRefs();
  availabilityElements.refreshMicsBtn.disabled = busy;
  availabilityElements.setupRuntimeBtn.disabled = busy;
  availabilityElements.validatePiperBtn.disabled = busy;
  availabilityElements.downloadVoiceBtn.disabled = busy;
  availabilityElements.setupAllTtsBtn.disabled = busy;
  availabilityElements.clearHistoryBtn.disabled = busy;
  availabilityElements.fetchProviderModelsBtn.disabled = busy;
  availabilityElements.applyModelToAiBtn.disabled = busy;
  availabilityElements.applyModelToSttBtn.disabled = busy;
  availabilityElements.checkOllamaStatusBtn.disabled = busy;
  availabilityElements.installOllamaBtn.disabled = busy;
  availabilityElements.fetchOllamaModelsBtn.disabled = busy;
  availabilityElements.useOllamaModelBtn.disabled = busy;
  availabilityElements.pullOllamaModelBtn.disabled = busy;
  availabilityElements.sidebarToggleLocalSttBtn.disabled = localSttBusy || !sttRuntimeIsLocal;
  availabilityElements.downloadLocalSttModelBtn.disabled = localSttBusy;
  availabilityElements.deleteLocalSttModelBtn.disabled = localSttBusy;
  availabilityElements.openLocalSttModelPathBtn.disabled = localSttBusy;
  formRefs.sttRuntimeModeOnlineInput.disabled = availabilityDeps.isPipelineRunning() || availabilityDeps.getStage() === "recording" || availabilityDeps.isTtsSetupRunning();
  formRefs.sttRuntimeModeOfflineInput.disabled = availabilityDeps.isPipelineRunning() || availabilityDeps.getStage() === "recording" || availabilityDeps.isTtsSetupRunning();
  formRefs.aiRuntimeModeOnlineInput.disabled = busy;
  formRefs.aiRuntimeModeOfflineInput.disabled = busy;
  formRefs.microphoneSelect.disabled = busy;
  formRefs.dictationLanguageSelect.disabled = busy;
  formRefs.dictationLanguageModeSingleInput.disabled = busy;
  formRefs.dictationLanguageModeMultipleInput.disabled = busy;
  for (const option of formRefs.dictationLanguageOptionInputs) {
    option.disabled = busy;
  }
  formRefs.styleProfileSelect.disabled = busy;
  formRefs.apiKeyInput.disabled = busy;
  formRefs.rememberApiKeyInput.disabled = busy;
  formRefs.apiBaseUrlInput.disabled = busy;
  formRefs.sttModelInput.disabled =busy;
  formRefs.aiModelInput.disabled =busy;
  availabilityElements.providerModelCatalogSelect.disabled = busy;
  formRefs.localOllamaBaseUrlInput.disabled = busy;
  formRefs.localOllamaModelInput.disabled = busy;
  availabilityElements.localOllamaModelCatalogSelect.disabled = busy;
  availabilityElements.localSttModelInput.disabled = localSttBusy;
  availabilityElements.localSttModelCatalogSelect.disabled = localSttBusy;
  availabilityElements.ttsEngineSelect.disabled = busy;
  formRefs.piperPathInput.disabled = busy;
  formRefs.piperQualitySelect.disabled = busy;
  formRefs.piperEmotionSelect.disabled = busy;
  formRefs.piperSpeedInput.disabled = busy;
  availabilityElements.hotkeyInput.disabled = busy;
  availabilityElements.commandHotkeyInput.disabled = busy;
  formRefs.captureModeSingleInput.disabled = busy;
  formRefs.captureModePushToTalkInput.disabled = busy;
  formRefs.commandModeToggle.disabled = busy;
  formRefs.wakeWordEnabledToggle.disabled = busy;
  formRefs.assistantNameInput.disabled = busy;
  formRefs.autoPasteDictationToggle.disabled = busy;
  formRefs.contextAwarenessToggle.disabled = busy;
  formRefs.copyToClipboardToggle.disabled = busy;
  formRefs.incognitoModeToggle.disabled = busy;
  formRefs.themeModeSelect.disabled = busy;
  for (const cardInput of formRefs.themeCardInputs) {
    cardInput.disabled = busy;
  }
  formRefs.backtrackToggle.disabled = busy;
  formRefs.removeFillersToggle.disabled = busy;
  formRefs.autoPunctuationToggle.disabled = busy;
  formRefs.numberedListsToggle.disabled = busy;
  availabilityElements.toggleMicEditorBtn.disabled = busy;
  availabilityElements.toggleHotkeyEditorBtn.disabled = busy;
  availabilityDeps.renderLocalSttSettingsStatus();

  const allRuntimeLocal = availabilityDeps.getSttRuntimeMode() === "local" && availabilityDeps.getAiRuntimeMode() === "local";
  availabilityElements.fetchProviderModelsBtn.disabled = availabilityElements.fetchProviderModelsBtn.disabled || allRuntimeLocal;
  availabilityElements.applyModelToAiBtn.disabled = availabilityElements.applyModelToAiBtn.disabled || allRuntimeLocal;
  availabilityElements.applyModelToSttBtn.disabled = availabilityElements.applyModelToSttBtn.disabled || allRuntimeLocal;
  formRefs.apiKeyInput.disabled = formRefs.apiKeyInput.disabled || allRuntimeLocal;
  formRefs.rememberApiKeyInput.disabled = formRefs.rememberApiKeyInput.disabled || allRuntimeLocal;
  formRefs.apiBaseUrlInput.disabled = formRefs.apiBaseUrlInput.disabled || allRuntimeLocal;
  formRefs.sttModelInput.disabled = formRefs.sttModelInput.disabled || allRuntimeLocal;
  formRefs.aiModelInput.disabled = formRefs.aiModelInput.disabled || allRuntimeLocal;
  availabilityElements.providerModelCatalogSelect.disabled = availabilityElements.providerModelCatalogSelect.disabled || allRuntimeLocal;
}
