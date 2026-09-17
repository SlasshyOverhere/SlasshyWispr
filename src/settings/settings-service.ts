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
  asDictationLanguageMode,
  formatDictationLanguageLabel,
  normalizeDictationLanguageAllowList,
  normalizeDictationLanguageCode,
} from "../state/settings-store";
import { validateApiBaseUrl, validateAssistantName } from "../utils";
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
