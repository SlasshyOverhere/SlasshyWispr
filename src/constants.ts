import type {
  RuntimeMode,
  CaptureMode,
  StyleProfile,
  TtsEngine,
  PiperQuality,
  PiperEmotion,
  DictationLanguageMode,
} from "./types";

export const SELECTION_POPUP_WIDTH = 640;
export const SELECTION_POPUP_MIN_WIDTH = 420;
export const SELECTION_POPUP_MIN_HEIGHT = 120;
export const SELECTION_POPUP_MAX_HEIGHT = 560;
export const SELECTION_POPUP_CHARS_PER_LINE = 68;

export const SETTINGS_STORAGE_KEY = "slasshy-desktop-assistant-settings-v4";
export const DICTIONARY_STORAGE_KEY = "slasshy-wispr-dictionary-v1";
export const SNIPPETS_STORAGE_KEY = "slasshy-wispr-snippets-v1";
export const NOTES_STORAGE_KEY = "slasshy-wispr-notes-v1";
export const USAGE_STORAGE_KEY = "slasshy-wispr-usage-v1";
export const DOCK_LAYOUT_STORAGE_KEY = "slasshy-wispr-dock-layout-v2";
export const HOME_HISTORY_STORAGE_KEY = "slasshy-wispr-home-history-v1";
export const SIDEBAR_COLLAPSED_STORAGE_KEY = "slasshy-wispr-sidebar-collapsed-v1";
export const LOCAL_STT_HARDWARE_ADVISOR_STORAGE_KEY = "slasshy-wispr-local-stt-hardware-advisor-v1";
export const GITHUB_RELEASES_PAGE_URL = "https://github.com/SlasshyOverhere/SlasshyWispr/releases/latest";
export const APP_UPDATE_LAST_CHECKED_AT_STORAGE_KEY = "slasshy-wispr-app-update-last-checked-at-v1";
export const APP_UPDATE_LAST_NOTIFIED_VERSION_STORAGE_KEY = "slasshy-wispr-app-update-last-notified-version-v1";
export const APP_UPDATE_SNOOZED_UNTIL_STORAGE_KEY = "slasshy-wispr-app-update-snoozed-until-v1";
export const APP_UPDATE_AUTO_CHECK_ENABLED_STORAGE_KEY = "slasshy-wispr-app-update-auto-check-enabled-v1";
export const ANALYTICS_SESSIONS_KEY = "slasshy-wispr-analytics-sessions-v1";
export const ACHIEVEMENTS_STATE_KEY = "slasshy-wispr-achievements-state-v1";
export const ACTIVE_PAGE_STORAGE_KEY = "slasshy-wispr-active-page-v1";
export const APP_EVENT_TOGGLE_DICTATION = "slasshy://toggle-dictation";
export const EMPTY_HISTORY_HINT = "No turns yet. Start dictating to see your recent activity.";
export const DEFAULT_SYSTEM_PROMPT =
  "You are SlasshyWispr, a helpful desktop voice assistant. Keep replies concise and easy to speak aloud.";
export const DEFAULT_TEMPERATURE = 0.35;
export const DEFAULT_MAX_TOKENS = 320;
export const DEFAULT_API_BASE_URL = "";
export const DEFAULT_STT_MODEL_NAME = "";
export const DEFAULT_AI_MODEL_NAME = "";
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "online";
export const DEFAULT_LOCAL_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const DEFAULT_HOTKEY = "Ctrl+Space";
export const DEFAULT_COMMAND_HOTKEY = "Ctrl+Shift+Space";
export const DEFAULT_CAPTURE_MODE: CaptureMode = "push-to-talk";
export const DEFAULT_STYLE_PROFILE: StyleProfile = "adaptive";
export const DEFAULT_TTS_ENGINE: TtsEngine = "piper";
export const DEFAULT_ASSISTANT_NAME = "Lily";
export const DEFAULT_PIPER_SPEED = 1.08;
export const DEFAULT_PIPER_QUALITY: PiperQuality = "fast";
export const DEFAULT_PIPER_EMOTION: PiperEmotion = "neutral";
export const DEFAULT_DICTATION_LANGUAGE_MODE: DictationLanguageMode = "single";
export const DICTATION_LANGUAGE_OPTIONS: Array<{ code: string; label: string }> = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "hi", label: "Hindi" },
  { code: "bn", label: "Bengali" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "ar", label: "Arabic" },
  { code: "ru", label: "Russian" },
];
export const DICTATION_LANGUAGE_LABELS: Record<string, string> = Object.fromEntries(
  DICTATION_LANGUAGE_OPTIONS.map((item) => [item.code, item.label]),
);
export const LOCAL_STT_MODEL_SIZE_LABELS: Record<string, string> = {
  "nvidia/parakeet-tdt-0.6b-v3": "Parakeet v3 (478 MB)",
  "nvidia/parakeet-tdt_ctc-110m": "Parakeet v2 (473 MB)",
};
export const MAX_COQUI_REFERENCE_SECONDS = 30;
export const ACCIDENTAL_PTT_HOTKEY_MAX_HOLD_MS = 1_000;
export const MAX_HISTORY_ITEMS = 100;
export const FOREGROUND_BLOCK_CHECK_CACHE_MS = 320;
export const BLOCKED_INPUT_NOTICE_COOLDOWN_MS = 2400;

export const DEFAULT_PUSH_TO_TALK_SOUND = "beep-start";
export const DEFAULT_PUSH_TO_TALK_END_SOUND = "beep-end";
export const DEFAULT_PUSH_TO_TALK_SOUND_VOLUME = 0.5;
export const DEFAULT_SAVE_RECORDINGS = false;

export const PUSH_TO_TALK_SOUND_OPTIONS = [
  { id: "beep-start", label: "Beep (Start)" },
  { id: "beep-end", label: "Beep (End)" },
  { id: "click", label: "Click" },
  { id: "pop", label: "Pop" },
  { id: "ding", label: "Ding" },
  { id: "chirp", label: "Chirp" },
  { id: "blip", label: "Blip" },
  { id: "thud", label: "Thud" },
  { id: "whoosh", label: "Whoosh" },
  { id: "chime", label: "Chime" },
  { id: "buzz", label: "Buzz" },
  { id: "ping", label: "Ping" },
];
