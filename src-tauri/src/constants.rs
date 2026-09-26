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
/// ZipVoice-Distill int8 (zh+en), Apache-2.0, trained on Emilia (CC-BY-4.0).
pub const VOICE_CLONE_ARCHIVE_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2";
pub const VOICE_CLONE_VOCODER_URL: &str =
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos_24khz.onnx";
pub const VOICE_CLONE_VOCODER_FILE: &str = "vocos_24khz.onnx";
pub const VOICE_CLONE_ARCHIVE_FILE: &str = "zipvoice-distill-int8-zh-en-emilia.tar.bz2";
/// Flow-matching steps: 4 is the distill model's designed operating point (and what we
/// measured at RTF ~0.9-1.15 on CPU); more steps cost latency for little gain.
pub const VOICE_CLONE_NUM_STEPS: i32 = 4;
pub const VOICE_CLONE_MAX_REFERENCE_SECONDS: f32 = 30.0;
pub const VOICE_CLONE_REFERENCE_AUDIO_FILE: &str = "reference.wav";
pub const VOICE_CLONE_REFERENCE_TEXT_FILE: &str = "reference.txt";
pub const MAX_TTS_INPUT_LENGTH: usize = 2000;
pub const PENDING_SELECTION_REWRITE_TTL_SECS: u64 = 90;
pub const RECENT_SELECTION_CONTEXT_TTL_SECS: u64 = 240;

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const TRAY_ID: &str = "slasshywispr-tray";
pub const TRAY_MENU_COPY_LAST_TRANSCRIPTION_ID: &str = "copy-last-transcription";
pub const TRAY_MENU_COPY_LAST_RESPONSE_ID: &str = "copy-last-response";
pub const TRAY_MENU_DASHBOARD_ID: &str = "dashboard";
pub const TRAY_MENU_QUIT_ID: &str = "quit";
pub const STARTUP_ARG_START_IN_TRAY: &str = "--start-in-tray";
/// Per-user hive; Explorer verbs here need no elevation.
pub const SHELL_VERB_REGISTRY_ROOT: &str = "Software\\Classes";
/// Explorer passes the chosen file after this flag.
pub const SHELL_TRANSCRIBE_ARG: &str = "--transcribe-file";
/// Emitted when a second launch asks the running instance to transcribe a file.
pub const APP_EVENT_TRANSCRIBE_FILE: &str = "slasshywispr://transcribe-file";
/// Audio files above this are refused rather than read into memory.
pub const MAX_TRANSCRIBE_FILE_BYTES: u64 = 200 * 1024 * 1024;
/// Transcription paths held as "handed to the frontend" at once.
pub const MAX_ARMED_TRANSCRIBE_PATHS: usize = 8;
/// Extensions Explorer offers "Transcribe with SlasshyWispr" for. Kept as one
/// list so the verb registration and the MIME map cannot drift apart.
pub const TRANSCRIBE_FILE_EXTENSIONS: &[&str] = &[
    "wav", "mp3", "m4a", "mp4", "ogg", "oga", "opus", "flac", "webm", "aac", "aiff", "aif",
];
pub const APP_EVENT_MAIN_WINDOW_VISIBILITY: &str = "slasshywispr://main-window-visibility";
pub const APP_EVENT_UPDATE_INSTALL_PROGRESS: &str = "slasshywispr://update-install-progress";
pub const TRAY_MENU_UPDATE_AVAILABLE_ID: &str = "update-available";
pub const APP_EVENT_UPDATE_AVAILABLE: &str = "slasshywispr://update-available";
pub const LOCAL_STT_MODEL_UNLOAD_IDLE_TIMEOUT_SECS: u64 = 90;
pub const LOCAL_STT_DAEMON_IDLE_TIMEOUT_SECS: u64 = 15 * 60;
pub const LOCAL_STT_DAEMON_SWEEP_INTERVAL_SECS: u64 = 15;
pub const LOCAL_STT_MODEL_UNLOAD_IDLE_TIMEOUT_ENV: &str =
    "SLASSHYWISPR_STT_MODEL_UNLOAD_IDLE_TIMEOUT_SECS";
pub const LOCAL_STT_DAEMON_IDLE_TIMEOUT_ENV: &str = "SLASSHYWISPR_STT_DAEMON_IDLE_TIMEOUT_SECS";
pub const LOCAL_STT_DAEMON_SWEEP_INTERVAL_ENV: &str = "SLASSHYWISPR_STT_DAEMON_SWEEP_INTERVAL_SECS";
pub const LOCAL_STT_PARAKEET_UNLOAD_AFTER_TRANSCRIBE_ENV: &str =
    "SLASSHYWISPR_STT_PARAKEET_UNLOAD_AFTER_TRANSCRIBE";
#[cfg(target_os = "windows")]
pub const STARTUP_RUN_VALUE_NAME: &str = "SlasshyWispr";
#[cfg(target_os = "windows")]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;
pub const UPDATE_REPOSITORY_OWNER: &str = "SlasshyOverhere";
pub const UPDATE_REPOSITORY_NAME: &str = "SlasshyWispr";
pub const UPDATE_REPOSITORY_OWNER_ENV: &str = "SLASSHYWISPR_UPDATE_REPOSITORY_OWNER";
pub const UPDATE_REPOSITORY_NAME_ENV: &str = "SLASSHYWISPR_UPDATE_REPOSITORY_NAME";
pub const UPDATE_GITHUB_TOKEN_ENV: &str = "SLASSHYWISPR_UPDATE_GITHUB_TOKEN";
/// Minisign public key (base64) trusted to sign release installers.
/// Empty means unprovisioned, and the updater then refuses to execute any
/// installer rather than running one it cannot verify.
pub const UPDATE_SIGNING_PUBKEY: &str = "RWQmglb8/flENyaNz4vEgKwYJMFK7hfYlIAPvGkyYIykbgyRCflNdDbn";
pub const UPDATE_SIGNING_PUBKEY_ENV: &str = "SLASSHYWISPR_UPDATE_SIGNING_PUBKEY";
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
pub const LOCAL_STT_ARCHIVE_PARALLEL_CHUNKS_ENV: &str = "SLASSHYWISPR_STT_ARCHIVE_PARALLEL_CHUNKS";

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
    "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx";
pub const SILERO_VAD_MODEL_FILE: &str = "silero_vad.onnx";
pub const SILERO_VAD_FRAME_SIZE: usize = 512;
pub const SILERO_VAD_SAMPLE_RATE: u32 = 16_000;
pub const SILERO_VAD_THRESHOLD: f64 = 0.5;
pub const SILERO_VAD_MIN_SPEECH_FRAMES: usize = 3;
pub const SILERO_VAD_MIN_SILENCE_FRAMES: usize = 6;

pub const INSECURE_HTTP_HOSTS_ENV: &str = "SLASSHYWISPR_ALLOW_INSECURE_HTTP_HOSTS";
pub const API_KEY_FINGERPRINT_HMAC_SECRET_ENV: &str = "SLASSHYWISPR_FINGERPRINT_HMAC_SECRET";
pub const API_KEY_FINGERPRINT_HMAC_SECRET_DEFAULT: &str = "SlasshyWispr-local-fingerprint-v1";

pub const LOCAL_STT_MODEL_EXPECTED_SHA256: &[(&str, &str)] = &[
    ("nvidia/parakeet-tdt-0.6b-v3", ""),
    ("nvidia/parakeet-tdt_ctc-110m", ""),
];

pub fn local_stt_model_expected_sha256(model: &str) -> Option<&'static str> {
    let canonical = model.trim();
    LOCAL_STT_MODEL_EXPECTED_SHA256
        .iter()
        .find(|(known, _)| *known == canonical)
        .map(|(_, hash)| *hash)
        .filter(|hash| !hash.is_empty())
}

/// Upstream `files/silero_vad.onnx` was removed; the model now lives under
/// `src/silero_vad/data/`. Pinned to a commit so the asset is immutable.
pub const SILERO_VAD_PINNED_COMMIT: &str = "5cd7945676eb32225748052e2e6a0580e4686a08";
pub const SILERO_VAD_MODEL_EXPECTED_SHA256: &str =
    "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3";

pub fn silero_vad_model_url() -> String {
    if SILERO_VAD_PINNED_COMMIT.trim().is_empty() {
        SILERO_VAD_MODEL_URL.to_string()
    } else {
        format!(
            "https://github.com/snakers4/silero-vad/raw/{}/src/silero_vad/data/silero_vad.onnx",
            SILERO_VAD_PINNED_COMMIT.trim()
        )
    }
}
