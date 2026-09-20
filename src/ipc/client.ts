import { invoke } from "@tauri-apps/api/core";
import { IPC_COMMANDS } from "./commands";
import type {
  AppUpdateCheckResponse,
  AssistantInfoResponse,
  AssistantPipelineResponse,
  ForegroundInputBlockStatus,
  InstallAppUpdateRequest,
  LocalSttDeactivateResponse,
  LocalSttDeleteResponse,
  LocalSttDownloadResponse,
  LocalSttDownloadStatusResponse,
  LocalSttHardwareAdviceResponse,
  LocalSttModelStatusResponse,
  LocalSttOpenPathResponse,
  LocalSttRuntimeStateResponse,
  LocalSttWarmupResponse,
  OllamaPullResponse,
  OllamaStatusResponse,
  PiperValidationResponse,
  ProviderModelsResponse,
  RecordingsStats,
  RuntimeSetupResponse,
  TtsSetupStatusResponse,
  VoiceInstallResponse,
} from "../types";

/**
 * Canonical typed IPC client.
 *
 * Single owner for Tauri invocation. Wrappers emit exactly the same command
 * names and argument shapes as the raw `invoke()` calls they replace —
 * no wire changes. Migrated verbatim from main.tsx, including
 * `invokeWithTimeout` semantics (reject on timeout, clear timer on settle).
 */
export function invokeWithTimeout<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    void invoke<T>(command, args)
      .then((result) => {
        window.clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

export const LOCAL_STT_RUNTIME_STATE_TIMEOUT_MS = 4000;
export const LOCAL_STT_COMMAND_TIMEOUT_MS = 12000;
export const LOCAL_STT_WARMUP_TIMEOUT_MS = 90000;

// ===== Updater =====

export function checkForAppUpdate(): Promise<AppUpdateCheckResponse> {
  return invoke<AppUpdateCheckResponse>(IPC_COMMANDS.checkForAppUpdate);
}

export function downloadAndInstallAppUpdate(request: InstallAppUpdateRequest): Promise<void> {
  return invoke(IPC_COMMANDS.downloadAndInstallAppUpdate, { request });
}

// ===== Settings =====

export function savePersistedLocalSettings(payload: string): Promise<void> {
  return invoke(IPC_COMMANDS.savePersistedLocalSettings, { payload });
}

export function loadPersistedLocalSettings(): Promise<string> {
  return invoke<string>(IPC_COMMANDS.loadPersistedLocalSettings);
}

// ===== Recordings =====

export function listDictationRecordingIds(): Promise<string[]> {
  return invoke<string[]>(IPC_COMMANDS.listDictationRecordingIds);
}

export function listDictationRecordingsStats(): Promise<RecordingsStats> {
  return invoke<RecordingsStats>(IPC_COMMANDS.listDictationRecordingsStats);
}

export function clearDictationRecordings(): Promise<number> {
  return invoke<number>(IPC_COMMANDS.clearDictationRecordings);
}

export function getDictationRecording(recordingId: string): Promise<string> {
  return invoke<string>(IPC_COMMANDS.getDictationRecording, { recordingId });
}

export function saveDictationRecording(args: {
  recordingId: string;
  mimeType: string;
  audioBase64: string;
}): Promise<number> {
  return invoke<number>(IPC_COMMANDS.saveDictationRecording, args);
}

// ===== Input / clipboard / media =====

export function captureSelectedText(): Promise<string> {
  return invoke<string>(IPC_COMMANDS.captureSelectedText);
}

export function setClipboardText(text: string): Promise<void> {
  return invoke(IPC_COMMANDS.setClipboardText, { text });
}

export function pasteTextViaClipboard(text: string): Promise<void> {
  return invoke(IPC_COMMANDS.pasteTextViaClipboard, { text });
}

export function pasteClipboardText(): Promise<void> {
  return invoke(IPC_COMMANDS.pasteClipboardText);
}

/** Snapshot the foreground window as the dictation paste target (record start). */
export function notePasteTarget(): Promise<number> {
  return invoke<number>(IPC_COMMANDS.notePasteTarget);
}

export function muteSystemAudio(mute: boolean): Promise<void> {
  return invoke(IPC_COMMANDS.muteSystemAudio, { mute });
}

export function getForegroundInputBlockStatus(): Promise<ForegroundInputBlockStatus> {
  return invoke<ForegroundInputBlockStatus>(IPC_COMMANDS.getForegroundInputBlockStatus);
}

export function configureLaunchAtLogin(enabled: boolean): Promise<void> {
  return invoke(IPC_COMMANDS.configureLaunchAtLogin, { enabled });
}

export function launchAtLoginStatus(): Promise<{
  enabled: boolean;
  path_matches: boolean;
  stored_value: string | null;
}> {
  return invoke(IPC_COMMANDS.launchAtLoginStatus);
}

export function logClientEvent(message: string): Promise<void> {
  return invoke(IPC_COMMANDS.logClientEvent, { message });
}

// ===== Providers / Ollama =====

export function getAssistantInfo(): Promise<AssistantInfoResponse> {
  return invoke<AssistantInfoResponse>(IPC_COMMANDS.getAssistantInfo);
}

export function fetchProviderModels(request: { apiKey: string; apiBaseUrl?: string | null }): Promise<ProviderModelsResponse> {
  return invoke<ProviderModelsResponse>(IPC_COMMANDS.fetchProviderModels, { request });
}

export function fetchOllamaModels(request: { baseUrl?: string | null }): Promise<ProviderModelsResponse> {
  return invoke<ProviderModelsResponse>(IPC_COMMANDS.fetchOllamaModels, { request });
}

export function pullOllamaModel(request: { baseUrl?: string | null; model: string }): Promise<OllamaPullResponse> {
  return invoke<OllamaPullResponse>(IPC_COMMANDS.pullOllamaModel, { request });
}

export function getOllamaStatus(request: { baseUrl?: string | null }): Promise<OllamaStatusResponse> {
  return invoke<OllamaStatusResponse>(IPC_COMMANDS.getOllamaStatus, { request });
}

export function installOllama(): Promise<OllamaStatusResponse> {
  return invoke<OllamaStatusResponse>(IPC_COMMANDS.installOllama);
}

// ===== Local STT =====

export function fetchLocalSttModels(): Promise<ProviderModelsResponse> {
  return invoke<ProviderModelsResponse>(IPC_COMMANDS.fetchLocalSttModels);
}

export function getLocalSttModelStatus(
  request: { model: string },
  timeoutMessage = "Local STT status check timed out.",
): Promise<LocalSttModelStatusResponse> {
  return invokeWithTimeout<LocalSttModelStatusResponse>(
    IPC_COMMANDS.getLocalSttModelStatus,
    { request },
    LOCAL_STT_COMMAND_TIMEOUT_MS,
    timeoutMessage,
  );
}

export function getLocalSttRuntimeState(
  timeoutMessage = "Local STT runtime state check timed out.",
): Promise<LocalSttRuntimeStateResponse> {
  return invokeWithTimeout<LocalSttRuntimeStateResponse>(
    IPC_COMMANDS.getLocalSttRuntimeState,
    undefined,
    LOCAL_STT_RUNTIME_STATE_TIMEOUT_MS,
    timeoutMessage,
  );
}

export function warmupLocalSttModel(
  request: { model: string },
  timeoutMs = LOCAL_STT_WARMUP_TIMEOUT_MS,
  timeoutMessage = "Local STT warmup timed out.",
): Promise<LocalSttWarmupResponse> {
  return invokeWithTimeout<LocalSttWarmupResponse>(
    IPC_COMMANDS.warmupLocalSttModel,
    { request },
    timeoutMs,
    timeoutMessage,
  );
}

export function deactivateLocalSttModel(
  request: { model: string | null },
  timeoutMessage = "Local STT unload timed out.",
): Promise<LocalSttDeactivateResponse> {
  return invokeWithTimeout<LocalSttDeactivateResponse>(
    IPC_COMMANDS.deactivateLocalSttModel,
    { request },
    LOCAL_STT_COMMAND_TIMEOUT_MS,
    timeoutMessage,
  );
}

export function getLocalSttDownloadStatus(): Promise<LocalSttDownloadStatusResponse> {
  return invoke<LocalSttDownloadStatusResponse>(IPC_COMMANDS.getLocalSttDownloadStatus);
}

export function downloadLocalSttModel(request: { model: string }): Promise<LocalSttDownloadResponse> {
  return invoke<LocalSttDownloadResponse>(IPC_COMMANDS.downloadLocalSttModel, { request });
}

export function deleteLocalSttModel(request: { model: string }): Promise<LocalSttDeleteResponse> {
  return invoke<LocalSttDeleteResponse>(IPC_COMMANDS.deleteLocalSttModel, { request });
}

export function openLocalSttModelPath(request: { model: string }): Promise<LocalSttOpenPathResponse> {
  return invoke<LocalSttOpenPathResponse>(IPC_COMMANDS.openLocalSttModelPath, { request });
}

export function getLocalSttHardwareAdvice(request: { selectedModel?: string }): Promise<LocalSttHardwareAdviceResponse> {
  return invoke<LocalSttHardwareAdviceResponse>(IPC_COMMANDS.getLocalSttHardwareAdvice, { request });
}

// ===== TTS =====

export function setupAssistantRuntime(): Promise<RuntimeSetupResponse> {
  return invoke<RuntimeSetupResponse>(IPC_COMMANDS.setupAssistantRuntime);
}

export function validatePiper(request: { piperPath?: string | null }): Promise<PiperValidationResponse> {
  return invoke<PiperValidationResponse>(IPC_COMMANDS.validatePiper, { request });
}

export function ensureVoiceModel(): Promise<VoiceInstallResponse> {
  return invoke<VoiceInstallResponse>(IPC_COMMANDS.ensureVoiceModel);
}

export function getTtsRuntimeSetupStatus(): Promise<TtsSetupStatusResponse> {
  return invoke<TtsSetupStatusResponse>(IPC_COMMANDS.getTtsRuntimeSetupStatus);
}

export function startTtsRuntimeSetup(request: { pythonPath?: string | null; useGpu?: boolean }): Promise<TtsSetupStatusResponse> {
  return invoke<TtsSetupStatusResponse>(IPC_COMMANDS.startTtsRuntimeSetup, { request });
}

export function setupCoquiRuntime(request: Record<string, unknown>): Promise<unknown> {
  return invoke(IPC_COMMANDS.setupCoquiRuntime, { request });
}

// ===== Pipeline =====

export function runAssistantPipeline(request: Record<string, unknown>): Promise<AssistantPipelineResponse> {
  return invoke<AssistantPipelineResponse>(IPC_COMMANDS.runAssistantPipeline, { request });
}

// ===== Windows =====

export function toggleMainWindowVisibility(): Promise<void> {
  return invoke(IPC_COMMANDS.toggleMainWindowVisibility);
}
