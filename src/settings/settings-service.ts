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
import { SETTINGS_STORAGE_KEY } from "../constants";
import {
  logClientEvent as ipcLogClientEvent,
  savePersistedLocalSettings as ipcSavePersistedLocalSettings,
} from "../ipc/client";
import { parseHotkey } from "../hotkeys/hotkey-service";
import { asErrorMessage, boolFlag, validateApiBaseUrl, validateAssistantName } from "../utils";
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

// --- Settings persistence hub (Phase 4b). Moved verbatim from main.tsx.
// Owns: in-memory settings, debounced persist, payload split, diagnostics.
// setNotice stays in main.tsx (Phase 5 shell), so native-save failures
// arrive via the injected `reportPersistError` callback.
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
