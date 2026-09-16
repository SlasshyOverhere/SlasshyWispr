/**
 * IPC wrapper round-trip tests — Phase 2 boundary guard.
 *
 * Each typed wrapper must emit exactly the command string + argument shape
 * the raw `invoke()` site emitted. Mocks `invoke` at the module level and
 * asserts command + args per wrapper. No wire changes allowed.
 */
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { IPC_COMMANDS } from "./commands";

const calls: Array<{ command: string; args: unknown }> = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => {
    calls.push({ command, args });
    return Promise.resolve(null);
  },
}));

// Import after the mock so wrappers bind the mocked invoke.
const client = await import("./client");

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
});

describe("IPC command constants match backend command names", () => {
  it("uses backend #[tauri::command] names verbatim", () => {
    expect(IPC_COMMANDS.checkForAppUpdate).toBe("check_for_app_update");
    expect(IPC_COMMANDS.downloadAndInstallAppUpdate).toBe("download_and_install_app_update");
    expect(IPC_COMMANDS.loadPersistedLocalSettings).toBe("load_persisted_local_settings");
    expect(IPC_COMMANDS.savePersistedLocalSettings).toBe("save_persisted_local_settings");
    expect(IPC_COMMANDS.listDictationRecordingIds).toBe("list_dictation_recording_ids");
    expect(IPC_COMMANDS.listDictationRecordingsStats).toBe("list_dictation_recordings_stats");
    expect(IPC_COMMANDS.clearDictationRecordings).toBe("clear_dictation_recordings");
    expect(IPC_COMMANDS.getDictationRecording).toBe("get_dictation_recording");
    expect(IPC_COMMANDS.saveDictationRecording).toBe("save_dictation_recording");
    expect(IPC_COMMANDS.captureSelectedText).toBe("capture_selected_text");
    expect(IPC_COMMANDS.setClipboardText).toBe("set_clipboard_text");
    expect(IPC_COMMANDS.pasteTextViaClipboard).toBe("paste_text_via_clipboard");
    expect(IPC_COMMANDS.pasteClipboardText).toBe("paste_clipboard_text");
    expect(IPC_COMMANDS.muteSystemAudio).toBe("mute_system_audio");
    expect(IPC_COMMANDS.getForegroundInputBlockStatus).toBe("get_foreground_input_block_status");
    expect(IPC_COMMANDS.configureLaunchAtLogin).toBe("configure_launch_at_login");
    expect(IPC_COMMANDS.launchAtLoginStatus).toBe("launch_at_login_status");
    expect(IPC_COMMANDS.logClientEvent).toBe("log_client_event");
    expect(IPC_COMMANDS.getAssistantInfo).toBe("get_assistant_info");
    expect(IPC_COMMANDS.fetchProviderModels).toBe("fetch_provider_models");
    expect(IPC_COMMANDS.fetchOllamaModels).toBe("fetch_ollama_models");
    expect(IPC_COMMANDS.pullOllamaModel).toBe("pull_ollama_model");
    expect(IPC_COMMANDS.getOllamaStatus).toBe("get_ollama_status");
    expect(IPC_COMMANDS.installOllama).toBe("install_ollama");
    expect(IPC_COMMANDS.fetchLocalSttModels).toBe("fetch_local_stt_models");
    expect(IPC_COMMANDS.getLocalSttModelStatus).toBe("get_local_stt_model_status");
    expect(IPC_COMMANDS.getLocalSttRuntimeState).toBe("get_local_stt_runtime_state");
    expect(IPC_COMMANDS.warmupLocalSttModel).toBe("warmup_local_stt_model");
    expect(IPC_COMMANDS.deactivateLocalSttModel).toBe("deactivate_local_stt_model");
    expect(IPC_COMMANDS.getLocalSttDownloadStatus).toBe("get_local_stt_download_status");
    expect(IPC_COMMANDS.downloadLocalSttModel).toBe("download_local_stt_model");
    expect(IPC_COMMANDS.deleteLocalSttModel).toBe("delete_local_stt_model");
    expect(IPC_COMMANDS.openLocalSttModelPath).toBe("open_local_stt_model_path");
    expect(IPC_COMMANDS.getLocalSttHardwareAdvice).toBe("get_local_stt_hardware_advice");
    expect(IPC_COMMANDS.setupAssistantRuntime).toBe("setup_assistant_runtime");
    expect(IPC_COMMANDS.validatePiper).toBe("validate_piper");
    expect(IPC_COMMANDS.ensureVoiceModel).toBe("ensure_voice_model");
    expect(IPC_COMMANDS.getTtsRuntimeSetupStatus).toBe("get_tts_runtime_setup_status");
    expect(IPC_COMMANDS.startTtsRuntimeSetup).toBe("start_tts_runtime_setup");
    expect(IPC_COMMANDS.setupCoquiRuntime).toBe("setup_coqui_runtime");
    expect(IPC_COMMANDS.runAssistantPipeline).toBe("run_assistant_pipeline");
    expect(IPC_COMMANDS.toggleMainWindowVisibility).toBe("toggle_main_window_visibility");
  });
});

describe("IPC wrapper argument shapes", () => {
  it("checkForAppUpdate sends no args", async () => {
    await client.checkForAppUpdate();
    expect(calls).toEqual([{ command: "check_for_app_update", args: undefined }]);
  });

  it("downloadAndInstallAppUpdate wraps request", async () => {
    const request = { downloadUrl: "https://example.com/a.exe", silent: true };
    await client.downloadAndInstallAppUpdate(request);
    expect(calls).toEqual([{ command: "download_and_install_app_update", args: { request } }]);
  });

  it("save/load persisted settings use payload/plain shapes", async () => {
    await client.savePersistedLocalSettings("{\"a\":1}");
    expect(calls[0]).toEqual({
      command: "save_persisted_local_settings",
      args: { payload: "{\"a\":1}" },
    });
    calls.length = 0;
    await client.loadPersistedLocalSettings();
    expect(calls).toEqual([{ command: "load_persisted_local_settings", args: undefined }]);
  });

  it("recordings wrappers use id/stats/clear shapes", async () => {
    await client.listDictationRecordingIds();
    await client.listDictationRecordingsStats();
    await client.clearDictationRecordings();
    await client.getDictationRecording("rec_1");
    await client.saveDictationRecording({ recordingId: "rec_1", mimeType: "audio/webm", audioBase64: "eA==" });
    expect(calls.map((c) => c.command)).toEqual([
      "list_dictation_recording_ids",
      "list_dictation_recordings_stats",
      "clear_dictation_recordings",
      "get_dictation_recording",
      "save_dictation_recording",
    ]);
    expect(calls[3].args).toEqual({ recordingId: "rec_1" });
    expect(calls[4].args).toEqual({ recordingId: "rec_1", mimeType: "audio/webm", audioBase64: "eA==" });
  });

  it("clipboard/paste/mute wrappers use text/mute shapes", async () => {
    await client.setClipboardText("hello");
    await client.pasteTextViaClipboard("hello");
    await client.pasteClipboardText();
    await client.muteSystemAudio(true);
    expect(calls).toEqual([
      { command: "set_clipboard_text", args: { text: "hello" } },
      { command: "paste_text_via_clipboard", args: { text: "hello" } },
      { command: "paste_clipboard_text", args: undefined },
      { command: "mute_system_audio", args: { mute: true } },
    ]);
  });

  it("provider/ollama wrappers use request envelope", async () => {
    await client.fetchProviderModels({ apiKey: "k", apiBaseUrl: null });
    await client.fetchOllamaModels({ baseUrl: null });
    await client.pullOllamaModel({ baseUrl: null, model: "llama3" });
    await client.getOllamaStatus({ baseUrl: null });
    await client.installOllama();
    expect(calls[0]).toEqual({
      command: "fetch_provider_models",
      args: { request: { apiKey: "k", apiBaseUrl: null } },
    });
    expect(calls[1].args).toEqual({ request: { baseUrl: null } });
    expect(calls[2].args).toEqual({ request: { baseUrl: null, model: "llama3" } });
    expect(calls[3].args).toEqual({ request: { baseUrl: null } });
    expect(calls[4]).toEqual({ command: "install_ollama", args: undefined });
  });

  it("local-STT wrappers use request envelope and timeouts", async () => {
    await client.getLocalSttModelStatus({ model: "m" });
    await client.getLocalSttRuntimeState();
    await client.warmupLocalSttModel({ model: "m" });
    await client.deactivateLocalSttModel({ model: "m" });
    await client.getLocalSttDownloadStatus();
    await client.downloadLocalSttModel({ model: "m" });
    await client.deleteLocalSttModel({ model: "m" });
    await client.openLocalSttModelPath({ model: "m" });
    await client.getLocalSttHardwareAdvice({ selectedModel: "m" });
    expect(calls[0]).toEqual({
      command: "get_local_stt_model_status",
      args: { request: { model: "m" } },
    });
    expect(calls[1]).toEqual({ command: "get_local_stt_runtime_state", args: undefined });
    expect(calls[2]).toEqual({
      command: "warmup_local_stt_model",
      args: { request: { model: "m" } },
    });
    expect(calls[4].command).toBe("get_local_stt_download_status");
    expect(calls[8].args).toEqual({ request: { selectedModel: "m" } });
  });

  it("TTS wrappers use request envelope", async () => {
    await client.setupAssistantRuntime();
    await client.validatePiper({ piperPath: null });
    await client.ensureVoiceModel();
    await client.getTtsRuntimeSetupStatus();
    await client.startTtsRuntimeSetup({ pythonPath: null, useGpu: false });
    expect(calls[0]).toEqual({ command: "setup_assistant_runtime", args: undefined });
    expect(calls[1]).toEqual({ command: "validate_piper", args: { request: { piperPath: null } } });
    expect(calls[4].args).toEqual({
      request: { pythonPath: null, useGpu: false },
    });
  });

  it("runAssistantPipeline passes request through untouched", async () => {
    const request = { apiKey: "k", audioBase64: "eA==" };
    await client.runAssistantPipeline(request);
    expect(calls).toEqual([{ command: "run_assistant_pipeline", args: { request } }]);
  });

  it("toggleMainWindowVisibility sends no args", async () => {
    await client.toggleMainWindowVisibility();
    expect(calls).toEqual([{ command: "toggle_main_window_visibility", args: undefined }]);
  });
});
