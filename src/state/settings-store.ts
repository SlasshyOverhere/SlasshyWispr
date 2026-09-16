import {
  DEFAULT_ASSISTANT_NAME,
  DEFAULT_CAPTURE_MODE,
  DEFAULT_DICTATION_LANGUAGE_MODE,
  DEFAULT_HOTKEY,
  DEFAULT_COMMAND_HOTKEY,
  DEFAULT_LOCAL_OLLAMA_BASE_URL,
  DEFAULT_MAX_TOKENS,
  DEFAULT_PIPER_EMOTION,
  DEFAULT_PIPER_QUALITY,
  DEFAULT_PIPER_SPEED,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_API_BASE_URL,
  DEFAULT_AI_MODEL_NAME,
  DEFAULT_STT_MODEL_NAME,
  DEFAULT_STYLE_PROFILE,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TEMPERATURE,
  DEFAULT_TTS_ENGINE,
  DICTATION_LANGUAGE_LABELS,
  SETTINGS_STORAGE_KEY,
} from "../constants";
import type {
  DictationLanguageMode,
  PersistedSettings,
  PiperEmotion,
  PiperQuality,
  RuntimeMode,
  StyleProfile,
  ThemeMode,
  TtsEngine,
} from "../types";
import { parseJson } from "./storage";

/**
 * Canonical settings store — Phase 4a (service behind existing IDs).
 *
 * Owns: pure coercion/normalization helpers + loadSettings/persist payload
 * builders. DOM form read/apply (readSettingsFromForm/applySettingsToForm)
 * and handleSettingsChange stay in main.tsx until per-pane conversion
 * (Phase 4b-e), because they touch ~120 element refs + listeners.
 */

export function coerceNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric < min) return min;
  if (numeric > max) return max;
  return numeric;
}

export function coerceInteger(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(coerceNumber(value, fallback, min, max));
}

export function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

export function asStyleProfile(value: unknown): StyleProfile {
  if (
    value === "adaptive" ||
    value === "professional" ||
    value === "casual" ||
    value === "concise" ||
    value === "developer"
  ) {
    return value;
  }
  return DEFAULT_STYLE_PROFILE;
}

export function asThemeMode(value: unknown): ThemeMode {
  if (value === "light" || value === "dark" || value === "mono") {
    return value;
  }
  return "system";
}

export function asTtsEngine(_value: unknown): TtsEngine {
  return "piper";
}

export function asRuntimeMode(value: unknown): RuntimeMode {
  return value === "local" ? "local" : "online";
}

export function asDictationLanguageMode(value: unknown): DictationLanguageMode {
  return value === "multiple" ? "multiple" : "single";
}

export function normalizeDictationLanguageCode(value: unknown): string {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("_", "-");
  if (!raw) {
    return "";
  }

  const [base] = raw.split("-", 1);
  return DICTATION_LANGUAGE_LABELS[base] ? base : "";
}

export function normalizeDictationLanguageAllowList(value: unknown): string[] {
  let rawValues: unknown[];
  if (Array.isArray(value)) {
    rawValues = value;
  } else if (typeof value === "string") {
    rawValues = value.split(",");
  } else {
    return [];
  }

  const next: string[] = [];
  const seen = new Set<string>();

  for (const item of rawValues) {
    const normalized = normalizeDictationLanguageCode(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
}

export function formatDictationLanguageLabel(languageCode: string): string {
  return DICTATION_LANGUAGE_LABELS[languageCode] ?? languageCode;
}

export function asPiperQuality(value: unknown): PiperQuality {
  if (value === "fast" || value === "high") {
    return value;
  }
  return DEFAULT_PIPER_QUALITY;
}

export function asPiperEmotion(value: unknown): PiperEmotion {
  if (
    value === "calm" ||
    value === "happy" ||
    value === "excited" ||
    value === "serious" ||
    value === "sad"
  ) {
    return value;
  }
  return DEFAULT_PIPER_EMOTION;
}

export function defaultSettings(): PersistedSettings {
  return {
    apiKey: "",
    apiBaseUrl: DEFAULT_API_BASE_URL,
    sttModelName: DEFAULT_STT_MODEL_NAME,
    aiModelName: DEFAULT_AI_MODEL_NAME,
    runtimeMode: DEFAULT_RUNTIME_MODE,
    sttRuntimeMode: DEFAULT_RUNTIME_MODE,
    aiRuntimeMode: DEFAULT_RUNTIME_MODE,
    localOllamaBaseUrl: DEFAULT_LOCAL_OLLAMA_BASE_URL,
    localOllamaModel: "",
    localSttModel: "",
    rememberApiKey: false,
    captureMode: DEFAULT_CAPTURE_MODE,
    piperPath: "",
    microphoneDeviceId: "",
    pushToTalkHotkey: DEFAULT_HOTKEY,
    commandHotkey: DEFAULT_COMMAND_HOTKEY,
    dictationLanguage: "",
    dictationLanguageMode: DEFAULT_DICTATION_LANGUAGE_MODE,
    dictationLanguageAllowList: [],
    styleProfile: DEFAULT_STYLE_PROFILE,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: DEFAULT_MAX_TOKENS,
    launchAtLogin: true,
    showFlowBar: false,
    showDockAlways: false,
    commandMode: true,
    wakeWordEnabled: true,
    assistantName: DEFAULT_ASSISTANT_NAME,
    autoPasteDictation: true,
    contextAwareness: true,
    copyToClipboard: false,
    incognitoMode: false,
    themeMode: "system",
    dictationSoundEffects: true,
    muteMusicWhileDictating: false,
    rawMode: false,
    backtrackCorrection: true,
    removeFillers: true,
    autoPunctuation: true,
    numberedLists: true,
    noiseSuppression: false,
    ttsEngine: DEFAULT_TTS_ENGINE,
    piperSpeed: DEFAULT_PIPER_SPEED,
    piperQuality: DEFAULT_PIPER_QUALITY,
    piperEmotion: DEFAULT_PIPER_EMOTION,
    pushToTalkSound: "beep-start",
    pushToTalkEndSound: "beep-end",
    pushToTalkSoundVolume: 0.5,
    saveRecordings: false,
  };
}

export function resolveSttLanguageConfig(next: PersistedSettings): {
  language: string | null;
  allowedLanguages: string[] | null;
} {
  const primaryLanguage = normalizeDictationLanguageCode(next.dictationLanguage);
  const mode = asDictationLanguageMode(next.dictationLanguageMode);
  let allowedLanguages =
    mode === "multiple"
      ? normalizeDictationLanguageAllowList(next.dictationLanguageAllowList)
      : primaryLanguage
        ? [primaryLanguage]
        : [];

  if (mode === "multiple" && primaryLanguage && !allowedLanguages.includes(primaryLanguage)) {
    allowedLanguages = [primaryLanguage, ...allowedLanguages];
  }

  const language =
    mode === "multiple"
      ? primaryLanguage || allowedLanguages[0] || null
      : primaryLanguage || null;

  return {
    language,
    allowedLanguages: allowedLanguages.length > 0 ? allowedLanguages : null,
  };
}

/** Read raw persisted settings payload without defaults/coercion. */
export function readRawPersistedSettings(): Partial<PersistedSettings> & { localMode?: boolean } {
  return parseJson<Partial<PersistedSettings> & { localMode?: boolean }>(SETTINGS_STORAGE_KEY, {});
}
