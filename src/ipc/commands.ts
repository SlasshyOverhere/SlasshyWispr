/**
 * Canonical Tauri command-name constants.
 *
 * Single owner for IPC command strings — call sites use these instead of
 * raw string literals so renames drift in one place. Wire-compatible:
 * values must match the `#[tauri::command]` names in src-tauri/src/lib.rs.
 */
export const IPC_COMMANDS = {
  // Updater
  checkForAppUpdate: "check_for_app_update",
  downloadAndInstallAppUpdate: "download_and_install_app_update",
  // Settings
  loadPersistedLocalSettings: "load_persisted_local_settings",
  savePersistedLocalSettings: "save_persisted_local_settings",
  // Recordings
  listDictationRecordingIds: "list_dictation_recording_ids",
  listDictationRecordingsStats: "list_dictation_recordings_stats",
  clearDictationRecordings: "clear_dictation_recordings",
  getDictationRecording: "get_dictation_recording",
  saveDictationRecording: "save_dictation_recording",
  // Input / clipboard / media
  captureSelectedText: "capture_selected_text",
  setClipboardText: "set_clipboard_text",
  pasteTextViaClipboard: "paste_text_via_clipboard",
  pasteClipboardText: "paste_clipboard_text",
  muteSystemAudio: "mute_system_audio",
  getForegroundInputBlockStatus: "get_foreground_input_block_status",
  configureLaunchAtLogin: "configure_launch_at_login",
  launchAtLoginStatus: "launch_at_login_status",
  logClientEvent: "log_client_event",
  // Providers / Ollama
  getAssistantInfo: "get_assistant_info",
  fetchProviderModels: "fetch_provider_models",
  fetchOllamaModels: "fetch_ollama_models",
  pullOllamaModel: "pull_ollama_model",
  getOllamaStatus: "get_ollama_status",
  installOllama: "install_ollama",
  // Local STT
  fetchLocalSttModels: "fetch_local_stt_models",
  getLocalSttModelStatus: "get_local_stt_model_status",
  getLocalSttDownloadStatus: "get_local_stt_download_status",
  downloadLocalSttModel: "download_local_stt_model",
  deleteLocalSttModel: "delete_local_stt_model",
  openLocalSttModelPath: "open_local_stt_model_path",
  getLocalSttRuntimeState: "get_local_stt_runtime_state",
  warmupLocalSttModel: "warmup_local_stt_model",
  deactivateLocalSttModel: "deactivate_local_stt_model",
  getLocalSttHardwareAdvice: "get_local_stt_hardware_advice",
  // TTS
  setupAssistantRuntime: "setup_assistant_runtime",
  validatePiper: "validate_piper",
  ensureVoiceModel: "ensure_voice_model",
  getTtsRuntimeSetupStatus: "get_tts_runtime_setup_status",
  startTtsRuntimeSetup: "start_tts_runtime_setup",
  setupCoquiRuntime: "setup_coqui_runtime",
  // Pipeline
  runAssistantPipeline: "run_assistant_pipeline",
  // Windows
  toggleMainWindowVisibility: "toggle_main_window_visibility",
} as const;

export type IpcCommandName = (typeof IPC_COMMANDS)[keyof typeof IPC_COMMANDS];
