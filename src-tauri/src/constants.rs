pub const DEFAULT_BASE_URL: &str = "";
pub const DEFAULT_STT_MODEL: &str = "";
pub const DEFAULT_AI_MODEL: &str = "";
pub const DEFAULT_LOCAL_OLLAMA_BASE_URL: &str = "http://127.0.0.1:11434";
pub const DEFAULT_LOCAL_STT_PROVIDER: &str = "parakeet";
pub const DEFAULT_SYSTEM_PROMPT: &str =
    "You are SlasshyWispr, an assistant in a speech-to-text app.
Default mode is cleanup of spoken text while preserving intent and tone.
Agent mode activates when directly addressed with a request.
If selected text context is provided, use it as primary context.
Output only final content with no meta-commentary or preamble.";

pub const VOICE_MODEL_URL: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx";
pub const VOICE_CONFIG_URL: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx.json";
pub const VOICE_MODEL_FILE: &str = "en_US-hfc_female-medium.onnx";
pub const VOICE_CONFIG_FILE: &str = "en_US-hfc_female-medium.onnx.json";
pub const PIPER_DEFAULT_SPEED: f32 = 1.08;
pub const PIPER_DEFAULT_QUALITY: &str = "fast";
pub const PIPER_DEFAULT_EMOTION: &str = "neutral";
pub const COQUI_DEFAULT_MODEL: &str = "tts_models/multilingual/multi-dataset/xtts_v2";
pub const COQUI_DEFAULT_LANGUAGE: &str = "en";
pub const COQUI_DEFAULT_QUALITY: &str = "balanced";
pub const COQUI_DEFAULT_EMOTION: &str = "neutral";
pub const COQUI_MAX_REFERENCE_SECONDS: f32 = 30.0;
pub const MAX_TTS_INPUT_LENGTH: usize = 2000;
pub const PENDING_SELECTION_REWRITE_TTL_SECS: u64 = 90;
pub const RECENT_SELECTION_CONTEXT_TTL_SECS: u64 = 240;
pub const LOCAL_STT_BRIDGE_SCRIPT: &str = include_str!("../local_stt_bridge.py");
pub const MAIN_WINDOW_LABEL: &str = "main";
pub const TRAY_ID: &str = "slasshywispr-tray";
pub const TRAY_MENU_COPY_LAST_TRANSCRIPTION_ID: &str = "copy-last-transcription";
pub const TRAY_MENU_COPY_LAST_RESPONSE_ID: &str = "copy-last-response";
pub const TRAY_MENU_DASHBOARD_ID: &str = "dashboard";
pub const TRAY_MENU_QUIT_ID: &str = "quit";
pub const STARTUP_ARG_START_IN_TRAY: &str = "--start-in-tray";
pub const APP_EVENT_MAIN_WINDOW_VISIBILITY: &str = "slasshy://main-window-visibility";
pub const APP_EVENT_UPDATE_INSTALL_PROGRESS: &str = "slasshy://update-install-progress";
pub const TRAY_MENU_UPDATE_AVAILABLE_ID: &str = "update-available";
pub const APP_EVENT_UPDATE_AVAILABLE: &str = "slasshy://update-available";
pub const LOCAL_STT_MODEL_UNLOAD_IDLE_TIMEOUT_SECS: u64 = 90;
pub const LOCAL_STT_DAEMON_IDLE_TIMEOUT_SECS: u64 = 5 * 60;
pub const LOCAL_STT_DAEMON_SWEEP_INTERVAL_SECS: u64 = 15;
pub const LOCAL_STT_MODEL_UNLOAD_IDLE_TIMEOUT_ENV: &str =
    "SLASSHY_STT_MODEL_UNLOAD_IDLE_TIMEOUT_SECS";
pub const LOCAL_STT_DAEMON_IDLE_TIMEOUT_ENV: &str = "SLASSHY_STT_DAEMON_IDLE_TIMEOUT_SECS";
pub const LOCAL_STT_DAEMON_SWEEP_INTERVAL_ENV: &str = "SLASSHY_STT_DAEMON_SWEEP_INTERVAL_SECS";
pub const LOCAL_STT_PARAKEET_UNLOAD_AFTER_TRANSCRIBE_ENV: &str =
    "SLASSHY_STT_PARAKEET_UNLOAD_AFTER_TRANSCRIBE";
pub const LOCAL_STT_PARAKEET_CPU_INT8_ENV: &str = "SLASSHY_STT_PARAKEET_CPU_INT8";
pub const LOCAL_STT_PARAKEET_FORCE_CPU_ENV: &str = "SLASSHY_STT_PARAKEET_FORCE_CPU";
pub const LOCAL_STT_RUNTIME_READY_MARKER_FILE: &str = "runtime.ready.v2";
pub const LOCAL_STT_RUNTIME_READY_MARKER_CONTENT: &str = "nemo+faster-whisper+torch";
pub const ZERO_PYTHON_MODE_ENV: &str = "SLASSHY_ZERO_PYTHON_MODE";
pub const ZERO_PYTHON_STT_NOTICE: &str =
    "Zero-Python mode is enabled. Only native Parakeet local STT models are supported.";
pub const ZERO_PYTHON_COQUI_NOTICE: &str =
    "Coqui TTS is disabled in zero-Python mode. Use Piper TTS.";
#[cfg(target_os = "windows")]
pub const STARTUP_RUN_VALUE_NAME: &str = "SlasshyWispr";
#[cfg(target_os = "windows")]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;
pub const UPDATE_REPOSITORY_OWNER: &str = "SlasshyOverhere";
pub const UPDATE_REPOSITORY_NAME: &str = "SlasshyWispr";
pub const UPDATE_REPOSITORY_OWNER_ENV: &str = "SLASSHY_UPDATE_REPOSITORY_OWNER";
pub const UPDATE_REPOSITORY_NAME_ENV: &str = "SLASSHY_UPDATE_REPOSITORY_NAME";
pub const UPDATE_GITHUB_TOKEN_ENV: &str = "SLASSHY_UPDATE_GITHUB_TOKEN";
pub const UPDATE_HTTP_USER_AGENT: &str = "SlasshyWispr-Updater";
pub const PERSISTED_SETTINGS_DIR_NAME: &str = "SlasshyWisprData";
pub const PERSISTED_SETTINGS_FILE_NAME: &str = "settings.json";
pub const PARAKEET_V2_INT8_ARCHIVE_URL: &str = "https://github.com/SlasshyOverhere/parakeet-int8-mirror/releases/download/models-parakeet-int8-v1/parakeet-v2-int8.tar.gz";
pub const PARAKEET_V3_INT8_ARCHIVE_URL: &str = "https://github.com/SlasshyOverhere/parakeet-int8-mirror/releases/download/models-parakeet-int8-v1/parakeet-v3-int8.tar.gz";
pub const PARAKEET_V2_INT8_ROOT_DIR: &str = "parakeet-tdt-0.6b-v2-int8";
pub const PARAKEET_V3_INT8_ROOT_DIR: &str = "parakeet-tdt-0.6b-v3-int8";
pub const LOCAL_STT_ARCHIVE_PARALLEL_CHUNKS_DEFAULT: usize = 4;
pub const LOCAL_STT_ARCHIVE_PARALLEL_CHUNKS_MAX: usize = 8;
pub const LOCAL_STT_ARCHIVE_MIN_BYTES_PER_CHUNK: u64 = 24 * 1024 * 1024;
pub const LOCAL_STT_ARCHIVE_PARALLEL_CHUNKS_ENV: &str = "SLASSHY_STT_ARCHIVE_PARALLEL_CHUNKS";

#[cfg(target_os = "windows")]
pub const PIPER_ARCHIVE_URL: &str =
    "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip";
#[cfg(target_os = "windows")]
pub const PIPER_ARCHIVE_FILE: &str = "piper_windows_amd64.zip";
#[cfg(target_os = "windows")]
pub const PIPER_BINARY_NAME: &str = "piper.exe";
#[cfg(not(target_os = "windows"))]
pub const PIPER_BINARY_NAME: &str = "piper";
#[cfg(target_os = "windows")]
pub const OLLAMA_WINDOWS_INSTALLER_URL: &str = "https://ollama.com/download/OllamaSetup.exe";
#[cfg(target_os = "windows")]
pub const OLLAMA_WINDOWS_INSTALLER_FILE: &str = "OllamaSetup.exe";

pub const SILERO_VAD_MODEL_URL: &str =
    "https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.onnx";
pub const SILERO_VAD_MODEL_FILE: &str = "silero_vad.onnx";
pub const SILERO_VAD_FRAME_SIZE: usize = 512;
pub const SILERO_VAD_SAMPLE_RATE: u32 = 16_000;
pub const SILERO_VAD_THRESHOLD: f64 = 0.5;
pub const SILERO_VAD_MIN_SPEECH_FRAMES: usize = 3;
pub const SILERO_VAD_MIN_SILENCE_FRAMES: usize = 6;
