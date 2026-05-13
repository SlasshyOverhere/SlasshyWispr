export type Stage = "idle" | "recording" | "processing" | "speaking" | "error";
export type CaptureMode = "single-tap" | "push-to-talk";
export type ThemeMode = "system" | "light" | "dark";
export type StyleProfile = "adaptive" | "professional" | "casual" | "concise" | "developer";
export type MainPage = "home" | "history" | "dictionary" | "snippets" | "notes" | "analytics";
export type SettingsPane =
  | "general"
  | "models"
  | "online"
  | "offline"
  | "hybrid"
  | "update-security"
  | "pipeline";
export type TtsEngine = "piper" | "coqui";
export type RuntimeMode = "online" | "local";
export type DictationLanguageMode = "single" | "multiple";
export type PiperQuality = "fast" | "balanced" | "high";
export type PiperEmotion = "neutral" | "calm" | "happy" | "excited" | "serious" | "sad";
export type CoquiQuality = "fast" | "balanced" | "high";
export type CoquiEmotion = "neutral" | "calm" | "happy" | "excited" | "serious" | "sad";
export type TtsProfilePane = "piper" | "coqui";
export type HoldSource = "notes-button" | "hotkey";

export type LocalSttHardwareAdvisorChoice = "suggestion" | "selected" | "cancel";

export interface AssistantInfoResponse {
  appVersion: string;
  baseUrl: string;
  sttModel: string;
  aiModel: string;
  piperInstalled: boolean;
  piperPath: string;
  voiceInstalled: boolean;
  voiceModelPath: string;
  coquiInstalled: boolean;
  coquiPythonPath: string;
}

export interface RuntimeSetupResponse {
  piperPath: string;
  voiceModelPath: string;
}

export interface VoiceInstallResponse {
  modelPath: string;
}

export interface PiperValidationResponse {
  ok: boolean;
  details: string;
}

export interface CoquiStatusResponse {
  available: boolean;
  pythonPath: string;
  ttsVersion: string;
  cudaAvailable: boolean;
  voiceDir: string;
  voices: string[];
  defaultModel: string;
  error: string;
}

export interface CoquiSetupResponse {
  pythonPath: string;
  details: string;
}

export interface CoquiValidationResponse {
  ok: boolean;
  details: string;
}

export interface CoquiVoicesResponse {
  voiceDir: string;
  voices: string[];
}

export interface CoquiModelsResponse {
  models: string[];
}

export interface ProviderModelsResponse {
  baseUrl: string;
  models: string[];
}

export interface OllamaPullResponse {
  baseUrl: string;
  model: string;
  ok: boolean;
  status: string;
}

export interface OllamaStatusResponse {
  installed: boolean;
  running: boolean;
  version: string;
  details: string;
}

export interface LocalSttDownloadResponse {
  model: string;
  provider: string;
  method: string;
  localPath: string;
  details: string;
}

export interface LocalSttDeleteResponse {
  model: string;
  repoId: string;
  removed: boolean;
  localPath: string;
  details: string;
}

export interface LocalSttOpenPathResponse {
  model: string;
  repoId: string;
  localPath: string;
  opened: boolean;
  details: string;
}

export interface LocalSttModelStatusResponse {
  model: string;
  provider: string;
  repoId: string;
  localPath: string;
  exists: boolean;
  details: string;
}

export interface LocalSttWarmupResponse {
  model: string;
  provider: string;
  warmed: boolean;
  details: string;
}

export interface LocalSttDeactivateResponse {
  model: string;
  provider: string;
  deactivated: boolean;
  details: string;
}

export interface LocalSttRuntimeStateResponse {
  loaded: boolean;
  daemonCount: number;
  loadedDaemonCount: number;
  details: string;
}

export interface LocalSttHardwareAdviceResponse {
  cpuName: string;
  logicalCores: number;
  totalRamGb: number;
  nvidiaGpuDetected: boolean;
  gpuName: string;
  gpuVramGb: number;
  performanceTier: string;
  slasshySuggestionModel: string;
  suggestedModels: string[];
  cautionModels: string[];
  selectedModelWarning: string;
  details: string;
}

export interface LocalSttDownloadStatusResponse {
  active: boolean;
  completed: boolean;
  success: boolean;
  model: string;
  repoId: string;
  stage: string;
  message: string;
  currentFile: string;
  downloadedBytes: number;
  totalBytes: number;
  filesCompleted: number;
  filesTotal: number;
  progressPercent: number;
  updatedAtMs: number;
}

export interface CoquiVoiceCloneResponse {
  speakerId: string;
  durationSeconds: number;
  voiceDir: string;
  voices: string[];
  previewAudioBase64: string;
}

export interface CoquiVoicePreviewResponse {
  audioBase64: string;
  text: string;
}

export interface TtsSetupStatusResponse {
  running: boolean;
  completed: boolean;
  success: boolean;
  stage: string;
  logs: string[];
}

export interface AssistantPipelineResponse {
  mode: "assistant" | "dictation";
  selectionRewrite: boolean;
  selectionPending: boolean;
  selectionContextCleared: boolean;
  selectionContextUsed: boolean;
  transcript: string;
  assistantResponse: string;
  audioBase64: string;
  sttLatencyMs: number;
  aiLatencyMs: number;
  ttsLatencyMs: number;
  totalLatencyMs: number;
}

export interface AppUpdateCheckResponse {
  currentVersion: string;
  latestVersion: string;
  available: boolean;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string;
  releaseUrl: string;
  installerDownloadUrl: string;
  installerAssetName: string;
  expectedSha256: string;
}

export interface InstallAppUpdateRequest {
  downloadUrl: string;
  assetName?: string;
  silent?: boolean;
  expectedSha256?: string;
}

export interface AppUpdateInstallProgressEvent {
  stage: string;
  message: string;
  downloadedBytes: number;
  totalBytes: number;
  progressPercent: number;
  completed: boolean;
  success: boolean;
}

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
  backtrackCorrection: boolean;
  removeFillers: boolean;
  autoPunctuation: boolean;
  numberedLists: boolean;
  ttsEngine: TtsEngine;
  piperSpeed: number;
  piperQuality: PiperQuality;
  piperEmotion: PiperEmotion;
  coquiPythonPath: string;
  coquiModelName: string;
  coquiLanguage: string;
  coquiVoiceId: string;
  coquiSpeed: number;
  coquiQuality: CoquiQuality;
  coquiEmotion: CoquiEmotion;
  coquiUseGpu: boolean;
  coquiSplitSentences: boolean;
  pushToTalkSound: string;
  pushToTalkEndSound: string;
  pushToTalkSoundVolume: number;
}

export interface HotkeySpec {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
  label: string;
}

export interface DictionaryTerm {
  id: string;
  source: string;
  target: string;

  createdAt: number;
}

export interface SnippetEntry {
  id: string;
  trigger: string;
  expansion: string;

  createdAt: number;
}

export interface QuickNoteEntry {
  id: string;
  text: string;
  createdAt: number;
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

export interface ForegroundInputBlockStatus {
  blocked: boolean;
  processName: string;
  reason: string;
  fullscreen: boolean;
}

export interface HomeHistoryEntry {
  speaker: string;
  content: string;
  tone: "assistant" | "user";
  timestamp: number;
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
