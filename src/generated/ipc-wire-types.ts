/**
 * IPC payload shapes, generated from the Rust structs.
 *
 * Do not edit — run `npm run generate:wire-types`. Each interface below is a
 * Rust struct named in the comment above it, so a payload is declared once and
 * the frontend cannot drift from the wire. `npm run build` and CI run the
 * generator with --check, so a stale file fails the build.
 */
// src-tauri/src/commands/updater.rs
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

// src-tauri/src/commands/updater.rs
export interface AppUpdateInstallProgressEvent {
  stage: string;
  message: string;
  downloadedBytes: number;
  totalBytes: number;
  progressPercent: number;
  completed: boolean;
  success: boolean;
}

// src-tauri/src/commands/ipc_types.rs
export interface AssistantInfoResponse {
  appVersion: string;
  baseUrl: string;
  sttModel: string;
  aiModel: string;
  piperInstalled: boolean;
  piperPath: string;
  voiceInstalled: boolean;
  voiceModelPath: string;
  voiceConfigPath: string;
  coquiInstalled: boolean;
  coquiPythonPath: string;
}

// src-tauri/src/commands/pipeline.rs
export interface AssistantPipelineResponse {
  /** Which stage handled the turn: "assistant" or "dictation". */
  mode: string;
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
  /** Never silent on TTS: "disabled"|"skipped"|"synthesized"|"failed". */
  ttsError?: string;
  /** Echoed run identity; backend mints one when the request omits it. */
  pipelineRunId?: string;
  /** Never silent on TTS: "disabled"|"skipped"|"synthesized"|"failed". */
  ttsStatus?: string;
}

// src-tauri/src/commands/files.rs
export interface AudioFilePayload {
  fileName: string;
  mimeType: string;
  base64: string;
  byteLength: number;
}

// src-tauri/src/platform/windows_types.rs
export interface ForegroundInputBlockStatus {
  blocked: boolean;
  processName: string;
  reason: string;
  fullscreen: boolean;
}

// src-tauri/src/commands/updater.rs
export interface InstallAppUpdateRequest {
  downloadUrl: string;
  assetName?: string;
  silent?: boolean;
  expectedSha256?: string;
  /**
   * Version the check-step advertised (e.g. "1.0.11"). Re-checked against
   * the download URL tag before any exec: a stale/relayed request that
   * would install an older build is rejected (downgrade guard).
   */
  expectedVersion?: string;
}

// src-tauri/src/commands/local_stt.rs
export interface LocalSttDeactivateResponse {
  model: string;
  provider: string;
  deactivated: boolean;
  details: string;
}

// src-tauri/src/commands/local_stt.rs
export interface LocalSttDeleteResponse {
  model: string;
  repoId: string;
  removed: boolean;
  localPath: string;
  details: string;
}

// src-tauri/src/commands/local_stt.rs
export interface LocalSttDownloadResponse {
  model: string;
  provider: string;
  method: string;
  localPath: string;
  details: string;
}

// src-tauri/src/pipeline/stt_download/progress.rs
/** Current local STT model download status, exposed over IPC. */
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

// src-tauri/src/commands/local_stt.rs
export interface LocalSttHardwareAdviceResponse {
  cpuName: string;
  logicalCores: number;
  totalRamGb: number;
  nvidiaGpuDetected: boolean;
  gpuName: string;
  gpuVramGb: number;
  performanceTier: string;
  slasshywisprSuggestionModel: string;
  suggestedModels: string[];
  cautionModels: string[];
  selectedModelWarning: string;
  details: string;
}

// src-tauri/src/commands/local_stt.rs
export interface LocalSttModelStatusResponse {
  model: string;
  provider: string;
  repoId: string;
  localPath: string;
  exists: boolean;
  details: string;
}

// src-tauri/src/commands/local_stt.rs
export interface LocalSttOpenPathResponse {
  model: string;
  repoId: string;
  localPath: string;
  opened: boolean;
  details: string;
}

// src-tauri/src/commands/local_stt.rs
export interface LocalSttRuntimeStateResponse {
  loaded: boolean;
  daemonCount: number;
  loadedDaemonCount: number;
  details: string;
}

// src-tauri/src/commands/local_stt.rs
export interface LocalSttWarmupResponse {
  model: string;
  provider: string;
  warmed: boolean;
  details: string;
}

// src-tauri/src/commands/ipc_types.rs
/** Same contract for the assistant's token ceiling. */
export interface MaxTokensBoundsResponse {
  defaultTokens: number;
  minTokens: number;
  maxTokens: number;
}

// src-tauri/src/audio/capture.rs
// Rust: CapturedAudio
/** A finished recording, already in the shapes the pipeline consumes. */
export interface NativeCapturedAudio {
  /** `[sample_rate: u32 LE][samples: f32 LE...]`, matching the webview fast path. */
  rawPcmBase64: string;
  /** 16-bit mono WAV, for the online STT upload path. */
  wavBase64: string;
  sampleRate: number;
  sampleCount: number;
  durationMs: number;
}

// src-tauri/src/audio/capture.rs
// Rust: CaptureInfo
/** What the device turned out to be, reported so the UI can log it. */
export interface NativeCaptureInfo {
  deviceName: string;
  sampleRate: number;
  fallbackUsed: boolean;
}

// src-tauri/src/commands/ipc_types.rs
export interface OllamaPullResponse {
  baseUrl: string;
  model: string;
  ok: boolean;
  status: string;
}

// src-tauri/src/commands/ipc_types.rs
export interface OllamaStatusResponse {
  installed: boolean;
  running: boolean;
  version: string;
  details: string;
}

// src-tauri/src/commands/tts.rs
export interface PiperValidationResponse {
  ok: boolean;
  details: string;
}

// src-tauri/src/commands/ipc_types.rs
export interface ProviderModelsResponse {
  baseUrl: string;
  models: string[];
}

// src-tauri/src/commands/recordings.rs
export interface RecordingsStats {
  fileCount: number;
  totalBytes: number;
}

// src-tauri/src/commands/tts.rs
export interface RuntimeSetupResponse {
  piperPath: string;
  voiceModelPath: string;
  voiceConfigPath: string;
}

// src-tauri/src/commands/ipc_types.rs
/**
 * Bounds the frontend renders and clamps with, so its limits come from the
 * same constants the backend enforces instead of being restated in TypeScript.
 */
export interface SttTimeoutBoundsResponse {
  defaultSeconds: number;
  minSeconds: number;
  maxSeconds: number;
}

// src-tauri/src/commands/tts.rs
export interface TtsSetupStatusResponse {
  running: boolean;
  completed: boolean;
  success: boolean;
  stage: string;
  logs: string[];
}

// src-tauri/src/commands/tts.rs
export interface VoiceInstallResponse {
  modelPath: string;
  configPath: string;
}

