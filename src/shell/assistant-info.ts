/**
 * Assistant info render — Phase 5 shell decomposition.
 *
 * Owns renderAssistantInfo. Moved verbatim from main.tsx; the info
 * snapshot, runtime-ready flag, and shell seams (settings reads, form
 * refs, TTS gate, model catalog renders, settings commit) arrive via
 * initAssistantInfo so this module never touches main.tsx globals.
 */
import { DEFAULT_LOCAL_OLLAMA_BASE_URL } from "../constants";
import type { AssistantInfoResponse, RuntimeMode } from "../types";
import { updateRuntimeModeNotice as updateRuntimeModeNoticeService } from "../settings/settings-service";
import type { SettingsFormRefs } from "../settings/settings-form-refs";

export interface AssistantInfoElements {
  settingsVersionText: HTMLParagraphElement;
  updateCurrentVersion: HTMLElement;
  baseUrlValue: HTMLElement;
  sttModelValue: HTMLElement;
  aiModelValue: HTMLElement;
  piperStatusValue: HTMLElement;
  piperPathValue: HTMLElement;
  voiceStatusValue: HTMLElement;
  voicePathValue: HTMLElement;
}

export interface AssistantInfoDeps {
  getSttRuntimeMode: () => RuntimeMode;
  getAiRuntimeMode: () => RuntimeMode;
  getLocalOllamaBaseUrl: () => string;
  getApiBaseUrl: () => string;
  getLocalSttModel: () => string;
  getSttModelName: () => string;
  getLocalOllamaModel: () => string;
  getAiModelName: () => string;
  getFormRefs: () => SettingsFormRefs;
  setLatestDefaults: (info: AssistantInfoResponse) => void;
  setPiperRuntimeReady: (ready: boolean) => void;
  updateTtsSetupGate: () => void;
}

let infoElements!: AssistantInfoElements;
let infoDeps!: AssistantInfoDeps;

export function initAssistantInfo(
  elements: AssistantInfoElements,
  deps: AssistantInfoDeps,
): void {
  infoElements = elements;
  infoDeps = deps;
}

export function renderAssistantInfo(info: AssistantInfoResponse): void {
  infoDeps.setLatestDefaults(info);
  const appVersion = info.appVersion?.trim();
  infoElements.settingsVersionText.textContent = appVersion ? `SlasshyWispr v${appVersion}` : "SlasshyWispr";
  infoElements.updateCurrentVersion.textContent = appVersion || "-";
  const sttLocalMode = infoDeps.getSttRuntimeMode() === "local";
  const aiLocalMode = infoDeps.getAiRuntimeMode() === "local";
  const configuredBaseUrl =
    sttLocalMode && aiLocalMode
      ? infoDeps.getLocalOllamaBaseUrl().trim() || DEFAULT_LOCAL_OLLAMA_BASE_URL
      : infoDeps.getApiBaseUrl().trim();
  const configuredSttModel = sttLocalMode ? infoDeps.getLocalSttModel().trim() : infoDeps.getSttModelName().trim();
  const configuredAiModel = aiLocalMode ? infoDeps.getLocalOllamaModel().trim() : infoDeps.getAiModelName().trim();

  infoElements.baseUrlValue.textContent = configuredBaseUrl || info.baseUrl || "Not set";
  infoElements.sttModelValue.textContent = configuredSttModel || info.sttModel || "Not set";
  infoElements.aiModelValue.textContent = configuredAiModel || info.aiModel || "Not set";
  const formRefs = infoDeps.getFormRefs();
  formRefs.apiBaseUrlInput.placeholder = info.baseUrl || "Enter provider URL (example: https://api.example.com/v1)";
  formRefs.sttModelInput.placeholder = info.sttModel || "Enter STT model id";
  formRefs.aiModelInput.placeholder = info.aiModel || "Enter AI model id";
  formRefs.localOllamaBaseUrlInput.placeholder = DEFAULT_LOCAL_OLLAMA_BASE_URL;
  updateRuntimeModeNoticeService(formRefs, infoDeps.getSttRuntimeMode(), infoDeps.getAiRuntimeMode());
  infoElements.piperStatusValue.textContent = info.piperInstalled ? "Installed" : "Missing";
  infoElements.piperPathValue.textContent = info.piperPath || "-";
  infoElements.voiceStatusValue.textContent = info.voiceInstalled ? "Installed" : "Missing";
  infoElements.voicePathValue.textContent = info.voiceModelPath;
  infoDeps.setPiperRuntimeReady(Boolean(info.piperInstalled && info.voiceInstalled));
  infoDeps.updateTtsSetupGate();
}
