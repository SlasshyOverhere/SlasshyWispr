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
  };
}

export function applyInputValidationState(
  input: HTMLInputElement | HTMLTextAreaElement,
  error: string | null,
): void {
  input.setCustomValidity(error ?? "");
  input.toggleAttribute("aria-invalid", Boolean(error));
}
