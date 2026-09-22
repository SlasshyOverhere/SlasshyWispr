/**
 * Frontend types.
 *
 * Everything the IPC boundary carries is generated from the Rust structs into
 * ./generated/ipc-wire-types.ts and re-exported below, so a payload field is
 * declared once, in Rust, and cannot drift. Edit those in Rust and run
 * `npm run generate:wire-types`; this file only holds what the frontend owns
 * alone. (Two generated shapes are named differently from their Rust structs:
 * `NativeCaptureInfo` and `NativeCapturedAudio` are `CaptureInfo` and
 * `CapturedAudio` in src-tauri/src/audio/capture.rs.)
 */
export type {
  AppUpdateCheckResponse,
  AppUpdateInstallProgressEvent,
  AssistantInfoResponse,
  AssistantPipelineResponse,
  AudioFilePayload,
  ForegroundInputBlockStatus,
  InstallAppUpdateRequest,
  LaunchAtLoginStatus,
  LocalSttDeactivateResponse,
  LocalSttDeleteResponse,
  LocalSttDownloadResponse,
  LocalSttDownloadStatusResponse,
  LocalSttHardwareAdviceResponse,
  LocalSttModelStatusResponse,
  LocalSttOpenPathResponse,
  LocalSttRuntimeStateResponse,
  LocalSttWarmupResponse,
  MaxTokensBoundsResponse,
  NativeCapturedAudio,
  NativeCaptureInfo,
  OllamaPullResponse,
  OllamaStatusResponse,
  PiperValidationResponse,
  ProviderModelsResponse,
  RecordingsStats,
  RuntimeSetupResponse,
  SttTimeoutBoundsResponse,
  TemperatureBoundsResponse,
  TtsSetupStatusResponse,
  VoiceCloneEngineResponse,
  VoiceCloneListResponse,
  VoiceCloneModelResponse,
  VoiceClonePreviewResponse,
  VoiceCloneResponse,
  VoiceCloneStatusResponse,
  VoiceInstallResponse,
} from "./generated/ipc-wire-types";

export type Stage = "idle" | "recording" | "processing" | "speaking" | "error";
export type CaptureMode = "single-tap" | "push-to-talk";
export type ThemeMode = "system" | "dark" | "light" | "mono";
export type StyleProfile = "adaptive" | "professional" | "casual" | "concise" | "developer";
export type MainPage = "home" | "history" | "analytics";
export type SettingsPane =
  | "general"
  | "models"
  | "update-security"
  | "pipeline";
export type TtsEngine = "piper" | "zipvoice";

// "webview" keeps MediaRecorder in the WebView; "native" captures in Rust.
export type CaptureBackend = "webview" | "native";

export type RuntimeMode = "online" | "local";
export type DictationLanguageMode = "single" | "multiple";
export type PiperQuality = "fast" | "balanced" | "high";
export type PiperEmotion = "neutral" | "calm" | "happy" | "excited" | "serious" | "sad";
export type TtsProfilePane = "piper";

export type LocalSttHardwareAdvisorChoice = "suggestion" | "selected" | "cancel";

export interface PersistedSettings {
  apiKey: string;
  apiBaseUrl: string;
  sttModelName: string;
  aiModelName: string;
  runtimeMode: RuntimeMode;
  sttRuntimeMode: RuntimeMode;
  aiRuntimeMode: RuntimeMode;
  localOllamaBaseUrl: string;
  localOllamaModel: string;
  localSttModel: string;
  rememberApiKey: boolean;
  captureMode: CaptureMode;
  piperPath: string;
  microphoneDeviceId: string;
  pushToTalkHotkey: string;
  commandHotkey: string;
  dictationLanguage: string;
  dictationLanguageMode: DictationLanguageMode;
  dictationLanguageAllowList: string[];
  styleProfile: StyleProfile;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  /** How long a single online transcription may take before it is abandoned. */
  sttTimeoutSeconds: number;
  launchAtLogin: boolean;
  showFlowBar: boolean;
  showDockAlways: boolean;
  commandMode: boolean;
  wakeWordEnabled: boolean;
  assistantName: string;
  autoPasteDictation: boolean;
  contextAwareness: boolean;
  copyToClipboard: boolean;
  incognitoMode: boolean;
  themeMode: ThemeMode;
  dictationSoundEffects: boolean;
  muteMusicWhileDictating: boolean;
  rawMode: boolean;
  backtrackCorrection: boolean;
  removeFillers: boolean;
  autoPunctuation: boolean;
  numberedLists: boolean;
  noiseSuppression: boolean;
  captureBackend: CaptureBackend;
  ttsEngine: TtsEngine;
  piperSpeed: number;
  piperQuality: PiperQuality;
  piperEmotion: PiperEmotion;
  voiceCloneSpeakerId: string;
  voiceCloneSpeed: number;
  pushToTalkSound: string;
  pushToTalkEndSound: string;
  pushToTalkSoundVolume: number;
  saveRecordings: boolean;
  shellIntegration: boolean;
}

export interface HotkeySpec {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
  label: string;
}

export interface UsageStats {
  sessions: number;
  words: number;
  avgWpm: number;
  speakingSeconds: number;
  prevSessions: number;
  prevWords: number;
  prevWpm: number;
  prevSpeakingSeconds: number;
  lastPeriodReset: number;
}

export interface AnalyticsSessionDetail {
  date: number;
  words: number;
  speakingSeconds: number;
  wpm: number;
}

export interface AchievementDef {
  id: string;
  label: string;
  description: string;
  threshold: number;
  metric: "words" | "sessions" | "speakingSeconds";
}

export interface AchievementState {
  id: string;
  unlockedAt: number | null;
}

export interface DockLayout {
  x: number;
  y: number;
}

export interface HomeHistoryEntry {
  speaker: string;
  content: string;
  tone: "assistant" | "user";
  timestamp: number;
  wpm?: number;
  pipelineMs?: number;
  spokenSeconds?: number;
  recordingId?: string;
}

export interface DockPlacementBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ActiveTtsPlayback {
  interrupted: boolean;
  finish: (completed: boolean) => void;
}

export type SelectionPopupMode = "rewrite" | "answer" | "pending";

export interface SelectionPopupPayload {
  token: number;
  mode: SelectionPopupMode;
  title: string;
  text: string;
  audioBase64: string;
}
