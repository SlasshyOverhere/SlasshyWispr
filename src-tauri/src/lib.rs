use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use flate2::read::GzDecoder;
use keyring::Entry;
use log::{error, info, warn};
use reqwest::{
    header::{ACCEPT_RANGES, RANGE, USER_AGENT},
    multipart, Client, Url,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap};
use std::fs;
#[cfg(target_os = "windows")]
use std::io;
use std::io::{BufRead, BufReader, Write};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex, OnceLock,
};
#[cfg(target_os = "windows")]
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tar::Archive;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State,
};
use transcribe_rs::{
    engines::parakeet::{
        ParakeetEngine, ParakeetInferenceParams, ParakeetModelParams, TimestampGranularity,
    },
    TranscriptionEngine,
};
#[cfg(target_os = "windows")]
use zip::ZipArchive;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::LocalFree;

pub mod constants;
use constants::*;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalSttDownloadStatusResponse {
    active: bool,
    completed: bool,
    success: bool,
    model: String,
    repo_id: String,
    stage: String,
    message: String,
    current_file: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    files_completed: usize,
    files_total: usize,
    progress_percent: f64,
    updated_at_ms: u64,
}

impl Default for LocalSttDownloadStatusResponse {
    fn default() -> Self {
        Self {
            active: false,
            completed: false,
            success: false,
            model: String::new(),
            repo_id: String::new(),
            stage: "Idle".to_string(),
            message: "No local STT download in progress.".to_string(),
            current_file: String::new(),
            downloaded_bytes: 0,
            total_bytes: 0,
            files_completed: 0,
            files_total: 0,
            progress_percent: 0.0,
            updated_at_ms: now_unix_ms(),
        }
    }
}

struct AppState {
    http: Client,
    pending_selection_rewrite: Mutex<Option<PendingSelectionRewrite>>,
    recent_selection_context: Mutex<Option<RecentSelectionContext>>,
    last_transcript: Mutex<String>,
    last_assistant_response: Mutex<String>,
    local_stt_download_status: Mutex<LocalSttDownloadStatusResponse>,
    local_stt_runtime_loaded: Mutex<bool>,
}

impl AppState {
    fn new() -> Result<Self, String> {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(150))
            .pool_idle_timeout(Duration::from_secs(90))
            .pool_max_idle_per_host(8)
            .build()
            .map_err(|error| format!("Failed to create HTTP client: {error}"))?;

        Ok(Self {
            http,
            pending_selection_rewrite: Mutex::new(None),
            recent_selection_context: Mutex::new(None),
            last_transcript: Mutex::new(String::new()),
            last_assistant_response: Mutex::new(String::new()),
            local_stt_download_status: Mutex::new(LocalSttDownloadStatusResponse::default()),
            local_stt_runtime_loaded: Mutex::new(false),
        })
    }

    fn lock_pending_selection_rewrite(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, Option<PendingSelectionRewrite>>, String> {
        self.pending_selection_rewrite
            .lock()
            .map_err(|_| "Pending rewrite context lock poisoned.".to_string())
    }

    fn lock_recent_selection_context(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, Option<RecentSelectionContext>>, String> {
        self.recent_selection_context
            .lock()
            .map_err(|_| "Recent selection context lock poisoned.".to_string())
    }

    fn cleanup_expired_pending_selection_rewrite(
        slot: &mut Option<PendingSelectionRewrite>,
    ) -> bool {
        let expired = slot
            .as_ref()
            .map(|item| {
                item.created_at.elapsed() >= Duration::from_secs(PENDING_SELECTION_REWRITE_TTL_SECS)
            })
            .unwrap_or(false);
        if expired {
            *slot = None;
            return true;
        }
        false
    }

    fn set_pending_selection_rewrite(&self, rewrite_text: String) -> Result<(), String> {
        let mut slot = self.lock_pending_selection_rewrite()?;
        *slot = Some(PendingSelectionRewrite {
            rewrite_text,
            created_at: Instant::now(),
        });
        Ok(())
    }

    fn clear_pending_selection_rewrite(&self) -> Result<bool, String> {
        let mut slot = self.lock_pending_selection_rewrite()?;
        Self::cleanup_expired_pending_selection_rewrite(&mut slot);
        Ok(slot.take().is_some())
    }

    fn peek_pending_selection_rewrite(&self) -> Result<Option<String>, String> {
        let mut slot = self.lock_pending_selection_rewrite()?;
        Self::cleanup_expired_pending_selection_rewrite(&mut slot);
        Ok(slot.as_ref().map(|item| item.rewrite_text.clone()))
    }

    fn take_pending_selection_rewrite(&self) -> Result<Option<String>, String> {
        let mut slot = self.lock_pending_selection_rewrite()?;
        Self::cleanup_expired_pending_selection_rewrite(&mut slot);
        Ok(slot.take().map(|item| item.rewrite_text))
    }

    fn cleanup_expired_recent_selection_context(slot: &mut Option<RecentSelectionContext>) -> bool {
        let expired = slot
            .as_ref()
            .map(|item| {
                item.created_at.elapsed() >= Duration::from_secs(RECENT_SELECTION_CONTEXT_TTL_SECS)
            })
            .unwrap_or(false);
        if expired {
            *slot = None;
            return true;
        }
        false
    }

    fn set_recent_selection_context(&self, text: String) -> Result<(), String> {
        let mut slot = self.lock_recent_selection_context()?;
        *slot = Some(RecentSelectionContext {
            text,
            created_at: Instant::now(),
        });
        Ok(())
    }

    fn peek_recent_selection_context(&self) -> Result<Option<String>, String> {
        let mut slot = self.lock_recent_selection_context()?;
        Self::cleanup_expired_recent_selection_context(&mut slot);
        Ok(slot.as_ref().map(|item| item.text.clone()))
    }

    fn set_last_pipeline_output(
        &self,
        transcript: impl Into<String>,
        assistant_response: impl Into<String>,
    ) -> Result<(), String> {
        self.set_last_transcript(transcript)?;
        self.set_last_assistant_response(assistant_response)?;
        Ok(())
    }

    fn set_last_transcript(&self, transcript: impl Into<String>) -> Result<(), String> {
        let transcript = transcript.into();
        let mut transcript_slot = self
            .last_transcript
            .lock()
            .map_err(|_| "Last transcript state lock poisoned.".to_string())?;
        *transcript_slot = transcript;
        Ok(())
    }

    fn set_last_assistant_response(
        &self,
        assistant_response: impl Into<String>,
    ) -> Result<(), String> {
        let assistant_response = assistant_response.into();
        let mut response_slot = self
            .last_assistant_response
            .lock()
            .map_err(|_| "Last assistant response state lock poisoned.".to_string())?;
        *response_slot = assistant_response;
        Ok(())
    }

    fn last_transcript_snapshot(&self) -> Result<String, String> {
        self.last_transcript
            .lock()
            .map(|value| value.clone())
            .map_err(|_| "Last transcript state lock poisoned.".to_string())
    }

    fn last_assistant_response_snapshot(&self) -> Result<String, String> {
        self.last_assistant_response
            .lock()
            .map(|value| value.clone())
            .map_err(|_| "Last assistant response state lock poisoned.".to_string())
    }

    fn lock_local_stt_download_status(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, LocalSttDownloadStatusResponse>, String> {
        self.local_stt_download_status
            .lock()
            .map_err(|_| "Local STT download status lock poisoned.".to_string())
    }

    fn snapshot_local_stt_download_status(&self) -> Result<LocalSttDownloadStatusResponse, String> {
        self.local_stt_download_status
            .lock()
            .map(|value| value.clone())
            .map_err(|_| "Local STT download status lock poisoned.".to_string())
    }

    fn update_local_stt_download_status<F>(&self, mutator: F) -> Result<(), String>
    where
        F: FnOnce(&mut LocalSttDownloadStatusResponse),
    {
        let mut status = self.lock_local_stt_download_status()?;
        mutator(&mut status);
        status.progress_percent = calculate_local_stt_progress_percent(&status);
        status.updated_at_ms = now_unix_ms();
        Ok(())
    }

    fn local_stt_runtime_loaded_snapshot(&self) -> Result<bool, String> {
        self.local_stt_runtime_loaded
            .lock()
            .map(|value| *value)
            .map_err(|_| "Local STT runtime state lock poisoned.".to_string())
    }

    fn set_local_stt_runtime_loaded(&self, loaded: bool) -> Result<(), String> {
        let mut slot = self
            .local_stt_runtime_loaded
            .lock()
            .map_err(|_| "Local STT runtime state lock poisoned.".to_string())?;
        *slot = loaded;
        Ok(())
    }
}

#[derive(Debug)]
struct PendingSelectionRewrite {
    rewrite_text: String,
    created_at: Instant,
}

#[derive(Debug)]
struct RecentSelectionContext {
    text: String,
    created_at: Instant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SelectionEditAction {
    ReplaceNow,
    AskConfirm,
    NoEdit,
}

#[derive(Debug, Clone)]
struct SelectionEditDecision {
    action: SelectionEditAction,
    rewrite_text: String,
    message: String,
}

struct CoquiBridgeDaemon {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

struct LocalSttBridgeDaemon {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    last_used: Instant,
    model_loaded: bool,
}

struct NativeParakeetRuntime {
    model_key: String,
    engine: ParakeetEngine,
    last_used: Instant,
}

static COQUI_DAEMONS: OnceLock<Mutex<HashMap<String, CoquiBridgeDaemon>>> = OnceLock::new();
static LOCAL_STT_DAEMONS: OnceLock<Mutex<HashMap<String, LocalSttBridgeDaemon>>> =
    OnceLock::new();
static LOCAL_STT_RUNTIME_PYTHON_CACHE: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static LOCAL_STT_DAEMON_SWEEPER_STARTED: OnceLock<()> = OnceLock::new();
static LOCAL_STT_NATIVE_PARAKEET_RUNTIME: OnceLock<Mutex<Option<NativeParakeetRuntime>>> =
    OnceLock::new();
static PIPER_TUNING_SUPPORT: OnceLock<Mutex<Option<bool>>> = OnceLock::new();

fn coqui_daemons() -> &'static Mutex<HashMap<String, CoquiBridgeDaemon>> {
    COQUI_DAEMONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn piper_tuning_support() -> &'static Mutex<Option<bool>> {
    PIPER_TUNING_SUPPORT.get_or_init(|| Mutex::new(None))
}

fn local_stt_daemons() -> &'static Mutex<HashMap<String, LocalSttBridgeDaemon>> {
    LOCAL_STT_DAEMONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn local_stt_runtime_python_cache() -> &'static Mutex<Option<String>> {
    LOCAL_STT_RUNTIME_PYTHON_CACHE.get_or_init(|| Mutex::new(None))
}

fn local_stt_native_parakeet_runtime() -> &'static Mutex<Option<NativeParakeetRuntime>> {
    LOCAL_STT_NATIVE_PARAKEET_RUNTIME.get_or_init(|| Mutex::new(None))
}

fn coqui_daemon_key(python_path: &str, script_path: &Path) -> String {
    #[cfg(target_os = "windows")]
    let normalized_python = python_path.to_ascii_lowercase();
    #[cfg(not(target_os = "windows"))]
    let normalized_python = python_path.to_string();

    format!("{normalized_python}|{}", script_path.to_string_lossy())
}

fn local_stt_daemon_key(python_path: &str, script_path: &Path) -> String {
    #[cfg(target_os = "windows")]
    let normalized_python = python_path.to_ascii_lowercase();
    #[cfg(not(target_os = "windows"))]
    let normalized_python = python_path.to_string();

    format!("{normalized_python}|{}", script_path.to_string_lossy())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssistantPipelineRequest {
    api_key: String,
    api_base_url: Option<String>,
    stt_model: Option<String>,
    ai_model: Option<String>,
    local_mode: Option<bool>,
    stt_local_mode: Option<bool>,
    ai_local_mode: Option<bool>,
    local_ollama_base_url: Option<String>,
    local_ollama_model: Option<String>,
    local_stt_model: Option<String>,
    piper_path: Option<String>,
    audio_base64: String,
    audio_mime_type: String,
    language: Option<String>,
    allowed_languages: Option<Vec<String>>,
    system_prompt: Option<String>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    dictionary_entries: Option<Vec<DictionaryEntryRequest>>,
    snippet_entries: Option<Vec<SnippetEntryRequest>>,
    apply_backtrack: Option<bool>,
    remove_fillers: Option<bool>,
    auto_punctuation: Option<bool>,
    auto_numbered_lists: Option<bool>,
    command_mode: Option<bool>,
    wake_word_enabled: Option<bool>,
    assistant_name: Option<String>,
    selected_text: Option<String>,
    tts_engine: Option<String>,
    piper: Option<PiperPipelineRequest>,
    coqui: Option<CoquiPipelineRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiperPipelineRequest {
    speed: Option<f32>,
    quality: Option<String>,
    emotion: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoquiPipelineRequest {
    python_path: Option<String>,
    model_name: Option<String>,
    language: Option<String>,
    speaker_id: Option<String>,
    speed: Option<f32>,
    quality: Option<String>,
    emotion: Option<String>,
    use_gpu: Option<bool>,
    split_sentences: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DictionaryEntryRequest {
    source: String,
    target: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnippetEntryRequest {
    trigger: String,
    expansion: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssistantPipelineResponse {
    mode: String,
    selection_rewrite: bool,
    selection_pending: bool,
    selection_context_cleared: bool,
    selection_context_used: bool,
    transcript: String,
    assistant_response: String,
    audio_base64: String,
    stt_latency_ms: u64,
    ai_latency_ms: u64,
    tts_latency_ms: u64,
    total_latency_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VoiceInstallResponse {
    model_path: String,
    config_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiperValidationRequest {
    piper_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PiperValidationResponse {
    ok: bool,
    details: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSetupResponse {
    piper_path: String,
    voice_model_path: String,
    voice_config_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssistantInfoResponse {
    app_version: String,
    base_url: &'static str,
    stt_model: &'static str,
    ai_model: &'static str,
    piper_installed: bool,
    piper_path: String,
    voice_installed: bool,
    voice_model_path: String,
    voice_config_path: String,
    coqui_installed: bool,
    coqui_python_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderModelsRequest {
    api_key: String,
    api_base_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaModelsRequest {
    base_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaPullRequest {
    base_url: Option<String>,
    model: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaPullResponse {
    base_url: String,
    model: String,
    ok: bool,
    status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaStatusRequest {
    base_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaStatusResponse {
    installed: bool,
    running: bool,
    version: String,
    details: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalSttDownloadRequest {
    model: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalSttDeleteRequest {
    model: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalSttWarmupRequest {
    model: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalSttDeactivateRequest {
    model: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalSttHardwareAdviceRequest {
    selected_model: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalSttDownloadResponse {
    model: String,
    provider: String,
    method: String,
    local_path: String,
    details: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalSttDeleteResponse {
    model: String,
    repo_id: String,
    removed: bool,
    local_path: String,
    details: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalSttOpenPathResponse {
    model: String,
    repo_id: String,
    local_path: String,
    opened: bool,
    details: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalSttWarmupResponse {
    model: String,
    provider: String,
    warmed: bool,
    details: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalSttDeactivateResponse {
    model: String,
    provider: String,
    deactivated: bool,
    details: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalSttRuntimeStateResponse {
    loaded: bool,
    daemon_count: usize,
    loaded_daemon_count: usize,
    details: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalSttHardwareAdviceResponse {
    cpu_name: String,
    logical_cores: usize,
    total_ram_gb: f64,
    nvidia_gpu_detected: bool,
    gpu_name: String,
    gpu_vram_gb: f64,
    performance_tier: String,
    slasshy_suggestion_model: String,
    suggested_models: Vec<String>,
    caution_models: Vec<String>,
    selected_model_warning: String,
    details: String,
}

#[derive(Debug, Default)]
struct LocalSttHardwareProbe {
    cpu_name: String,
    logical_cores: usize,
    total_ram_bytes: u64,
    nvidia_gpu_detected: bool,
    gpu_name: String,
    gpu_vram_mb: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderModelsResponse {
    base_url: String,
    models: Vec<String>,
}

#[derive(Debug, Clone)]
struct LocalSttConfig {
    stt_model: String,
}

#[derive(Debug, Clone)]
enum SttModeConfig {
    Online {
        api_key: String,
        api_base_url: String,
        stt_model: String,
    },
    Local(LocalSttConfig),
}

#[derive(Debug, Clone)]
struct LocalAiConfig {
    ollama_base_url: String,
    ollama_model: Option<String>,
}

#[derive(Debug, Clone)]
enum AiModeConfig {
    Online {
        api_key: String,
        api_base_url: String,
        ai_model: String,
    },
    Local(LocalAiConfig),
}

#[derive(Debug, Clone)]
struct PipelineModeConfig {
    stt: SttModeConfig,
    ai: AiModeConfig,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ForegroundInputBlockStatus {
    blocked: bool,
    process_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoquiStatusRequest {
    python_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CoquiStatusResponse {
    available: bool,
    python_path: String,
    tts_version: String,
    cuda_available: bool,
    voice_dir: String,
    voices: Vec<String>,
    default_model: &'static str,
    error: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoquiSetupRequest {
    python_path: Option<String>,
    use_gpu: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CoquiSetupResponse {
    python_path: String,
    details: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoquiValidationRequest {
    python_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CoquiValidationResponse {
    ok: bool,
    details: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoquiVoiceCloneRequest {
    python_path: Option<String>,
    model_name: Option<String>,
    language: Option<String>,
    speaker_id: String,
    audio_base64: String,
    file_name: Option<String>,
    use_gpu: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CoquiVoiceCloneResponse {
    speaker_id: String,
    duration_seconds: f32,
    voice_dir: String,
    voices: Vec<String>,
    preview_audio_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoquiVoicesRequest {
    python_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CoquiVoicesResponse {
    voice_dir: String,
    voices: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoquiVoicePreviewRequest {
    python_path: Option<String>,
    model_name: Option<String>,
    language: Option<String>,
    speaker_id: Option<String>,
    text: Option<String>,
    speed: Option<f32>,
    quality: Option<String>,
    emotion: Option<String>,
    use_gpu: Option<bool>,
    split_sentences: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CoquiVoicePreviewResponse {
    audio_base64: String,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoquiModelsRequest {
    python_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CoquiModelsResponse {
    models: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdateCheckResponse {
    current_version: String,
    latest_version: String,
    available: bool,
    release_name: String,
    release_notes: String,
    published_at: String,
    release_url: String,
    installer_download_url: String,
    installer_asset_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallAppUpdateRequest {
    download_url: String,
    asset_name: Option<String>,
    silent: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Deserialize)]
struct GithubLatestReleaseResponse {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    draft: bool,
    prerelease: bool,
    published_at: Option<String>,
    html_url: Option<String>,
    assets: Vec<GithubReleaseAsset>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TtsSetupStartRequest {
    python_path: Option<String>,
    use_gpu: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TtsSetupStatusResponse {
    running: bool,
    completed: bool,
    success: bool,
    stage: String,
    logs: Vec<String>,
}

#[derive(Debug, Clone)]
struct TtsSetupProgress {
    running: bool,
    completed: bool,
    success: bool,
    stage: String,
    logs: Vec<String>,
}

impl Default for TtsSetupProgress {
    fn default() -> Self {
        Self {
            running: false,
            completed: false,
            success: false,
            stage: "Waiting for setup.".to_string(),
            logs: Vec::new(),
        }
    }
}

#[derive(Clone)]
struct TtsSetupState {
    inner: Arc<Mutex<TtsSetupProgress>>,
}

impl Default for TtsSetupState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(TtsSetupProgress::default())),
        }
    }
}

impl TtsSetupState {
    fn clone_handle(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }

    fn with_progress_mut<F>(&self, update: F)
    where
        F: FnOnce(&mut TtsSetupProgress),
    {
        let mut guard = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        update(&mut guard);
    }

    fn snapshot(&self) -> TtsSetupStatusResponse {
        let guard = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        TtsSetupStatusResponse {
            running: guard.running,
            completed: guard.completed,
            success: guard.success,
            stage: guard.stage.clone(),
            logs: guard.logs.clone(),
        }
    }

    fn reset_and_start(&self) {
        self.with_progress_mut(|progress| {
            progress.running = true;
            progress.completed = false;
            progress.success = false;
            progress.stage = "Preparing setup...".to_string();
            progress.logs.clear();
            progress
                .logs
                .push(if zero_python_mode_enabled() {
                    "Starting TTS bootstrap for Piper runtime (zero-Python mode).".to_string()
                } else {
                    "Starting TTS bootstrap for Piper + Coqui runtime.".to_string()
                });
        });
    }

    fn set_stage(&self, stage: impl Into<String>) {
        let stage_text = stage.into();
        self.with_progress_mut(|progress| {
            progress.stage = stage_text;
        });
    }

    fn append_log(&self, line: impl Into<String>) {
        let next_line = line.into();
        self.with_progress_mut(|progress| {
            progress.logs.push(next_line);
            if progress.logs.len() > 400 {
                let excess = progress.logs.len() - 400;
                progress.logs.drain(0..excess);
            }
        });
    }

    fn complete(&self, success: bool, final_stage: impl Into<String>) {
        let stage_text = final_stage.into();
        self.with_progress_mut(|progress| {
            progress.running = false;
            progress.completed = true;
            progress.success = success;
            progress.stage = stage_text;
        });
    }
}

#[tauri::command]
async fn log_client_event(message: String) -> Result<(), String> {
    let line = single_line(message.trim());
    if line.is_empty() {
        return Ok(());
    }

    info!("[client] {}", clip_text(&line, 1200));
    Ok(())
}

#[tauri::command]
async fn check_for_app_update(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AppUpdateCheckResponse, String> {
    let current_version = app.package_info().version.to_string();
    let (repository_owner, repository_name) = resolve_update_repository();
    let request_url = format!(
        "https://api.github.com/repos/{repository_owner}/{repository_name}/releases?per_page=30"
    );
    let mut request = state
        .http
        .get(&request_url)
        .header(USER_AGENT, UPDATE_HTTP_USER_AGENT);
    if let Some(token) = update_github_token() {
        request = request.bearer_auth(token);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("Failed to check for updates: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(format!(
                "Update repository '{repository_owner}/{repository_name}' is not accessible. \
Set {UPDATE_GITHUB_TOKEN_ENV} for private repositories, or verify {UPDATE_REPOSITORY_OWNER_ENV}/{UPDATE_REPOSITORY_NAME_ENV}."
            ));
        }
        return Err(format!(
            "Update check failed with status {}: {}",
            status,
            clip_text(&single_line(&body), 280)
        ));
    }

    let releases: Vec<GithubLatestReleaseResponse> = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse update response: {error}"))?;
    let Some(release) = select_latest_stable_release(&releases) else {
        info!(
            "[updater] no stable release available source={}/{}",
            repository_owner, repository_name
        );
        return Ok(AppUpdateCheckResponse {
            current_version: current_version.clone(),
            latest_version: current_version,
            available: false,
            release_name: String::new(),
            release_notes: String::new(),
            published_at: String::new(),
            release_url: String::new(),
            installer_download_url: String::new(),
            installer_asset_name: String::new(),
        });
    };
    let latest_version = normalize_release_version(&release.tag_name);

    let (installer_download_url, installer_asset_name) = select_windows_installer_asset(release)
        .map(|asset| (asset.browser_download_url.clone(), asset.name.clone()))
        .unwrap_or_else(|| (String::new(), String::new()));

    let available =
        !installer_download_url.is_empty() && is_newer_version(&current_version, &latest_version);

    info!(
        "[updater] checked source={}/{} current={} latest={} available={} asset={}",
        repository_owner,
        repository_name,
        current_version,
        latest_version,
        available,
        installer_asset_name
    );

    Ok(AppUpdateCheckResponse {
        current_version,
        latest_version,
        available,
        release_name: release.name.clone().unwrap_or_default(),
        release_notes: release.body.clone().unwrap_or_default(),
        published_at: release.published_at.clone().unwrap_or_default(),
        release_url: release.html_url.clone().unwrap_or_default(),
        installer_download_url,
        installer_asset_name,
    })
}

fn is_safe_update_url(url: &str) -> bool {
    let Ok(parsed_url) = Url::parse(url) else {
        return false;
    };

    if parsed_url.scheme() != "https" {
        return false;
    }

    if parsed_url.host_str() != Some("github.com") {
        return false;
    }

    let (owner, name) = resolve_update_repository();
    let expected_path_prefix = format!("/{owner}/{name}/releases/download/");
    let normalized = parsed_url
        .path_segments()
        .map(|segments| format!("/{}", segments.collect::<Vec<_>>().join("/")))
        .unwrap_or_default();

    normalized
        .to_ascii_lowercase()
        .starts_with(&expected_path_prefix.to_ascii_lowercase())
}

#[tauri::command]
async fn download_and_install_app_update(
    app: AppHandle,
    state: State<'_, AppState>,
    request: InstallAppUpdateRequest,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let download_url = request.download_url.trim();
        if download_url.is_empty() {
            return Err("Update download URL is empty.".to_string());
        }

        if !is_safe_update_url(download_url) {
            return Err(format!(
                "Update download URL is not from a trusted source: {}",
                clip_text(download_url, 120)
            ));
        }

        let response = state
            .http
            .get(download_url)
            .header(USER_AGENT, UPDATE_HTTP_USER_AGENT)
            .send()
            .await
            .map_err(|error| format!("Failed to download update installer: {error}"))?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "Installer download failed with status {}: {}",
                status,
                clip_text(&single_line(&body), 280)
            ));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("Failed to read installer bytes: {error}"))?;
        if bytes.is_empty() {
            return Err("Installer download returned an empty file.".to_string());
        }

        let updates_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Failed to resolve app data directory: {error}"))?
            .join("updates");
        fs::create_dir_all(&updates_dir)
            .map_err(|error| format!("Failed to create updates directory: {error}"))?;

        let installer_name = resolve_installer_file_name(
            request.asset_name.as_deref(),
            download_url,
            app.package_info().version.to_string().as_str(),
        );
        let installer_path = updates_dir.join(installer_name);
        fs::write(&installer_path, &bytes)
            .map_err(|error| format!("Failed to write installer file: {error}"))?;

        let installer_kind = installer_path
            .file_name()
            .and_then(|value| value.to_str())
            .and_then(windows_installer_kind_from_name)
            .ok_or_else(|| {
                format!(
                    "Downloaded update file '{}' is not a supported Windows installer (.exe/.msi).",
                    installer_path.display()
                )
            })?;

        let mut command = match installer_kind {
            WindowsInstallerKind::Exe => {
                let mut command = Command::new(&installer_path);
                if request.silent.unwrap_or(true) {
                    command.arg("/S");
                }
                command
            }
            WindowsInstallerKind::Msi => {
                let mut command = Command::new("msiexec");
                command.arg("/i").arg(&installer_path);
                if request.silent.unwrap_or(true) {
                    command.args(["/qn", "/norestart"]);
                } else {
                    command.args(["/passive", "/norestart"]);
                }
                command
            }
        };
        apply_no_window(&mut command);
        let installer_child = command.spawn().map_err(|error| {
            format!(
                "Failed to launch installer '{}': {error}",
                installer_path.display()
            )
        })?;
        let installer_pid = installer_child.id();
        let app_exe_path = std::env::current_exe()
            .map_err(|error| format!("Failed to resolve current app executable path: {error}"))?;

        info!(
            "[updater] installer launched path={} silent={} pid={}",
            installer_path.display(),
            request.silent.unwrap_or(true),
            installer_pid
        );
        match schedule_app_relaunch_after_installer(installer_pid, &app_exe_path) {
            Ok(()) => {
                info!(
                    "[updater] relaunch watcher scheduled installer_pid={} app_exe={}",
                    installer_pid,
                    clip_text(&single_line(&app_exe_path.to_string_lossy()), 260)
                );
            }
            Err(error) => {
                warn!(
                    "[updater] relaunch watcher scheduling failed installer_pid={} error={}",
                    installer_pid,
                    clip_text(&single_line(&error), 260)
                );
            }
        }

        let app_for_exit = app.clone();
        thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(220));
            app_for_exit.exit(0);
        });
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, state, request);
        Err("Auto-update installer is currently implemented for Windows only.".to_string())
    }
}

const KEYRING_SERVICE: &str = "SlasshyWispr";
const KEYRING_USER: &str = "api_key";
const KEYRING_SERVICE_ALIASES: [&str; 4] = [
    "SlasshyWispr Desktop Assistant",
    "Slasshy Desktop Assistant",
    "online.slasshy.desktop.assistant",
    "slasshy-desktop-assistant",
];
const KEYRING_USER_ALIASES: [&str; 3] = ["apiKey", "apikey", "default"];
const SETTINGS_API_KEY_ENCRYPTED_FIELD: &str = "apiKeyEncrypted";
const SETTINGS_API_KEY_FINGERPRINT_FIELD: &str = "apiKeyFingerprint";

fn normalize_api_key_secret(raw: &str) -> String {
    raw.chars()
        .filter(|character| !character.is_control())
        .collect::<String>()
        .trim()
        .to_string()
}

fn api_key_fingerprint(api_key: &str) -> String {
    let normalized = normalize_api_key_secret(api_key);
    if normalized.is_empty() {
        return String::new();
    }

    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in normalized.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn known_keyring_targets() -> Vec<(&'static str, &'static str)> {
    let mut targets =
        Vec::with_capacity((KEYRING_SERVICE_ALIASES.len() + 1) * (KEYRING_USER_ALIASES.len() + 1));
    let mut services = Vec::with_capacity(KEYRING_SERVICE_ALIASES.len() + 1);
    services.push(KEYRING_SERVICE);
    services.extend(KEYRING_SERVICE_ALIASES);

    let mut users = Vec::with_capacity(KEYRING_USER_ALIASES.len() + 1);
    users.push(KEYRING_USER);
    users.extend(KEYRING_USER_ALIASES);

    for service in services {
        for user in &users {
            targets.push((service, *user));
        }
    }
    targets
}

fn write_api_key_to_primary_keyring(api_key: &str) -> Result<(), String> {
    let normalized_api_key = normalize_api_key_secret(api_key);
    if normalized_api_key.is_empty() {
        return Err("failed to save API key to keyring: key is empty after normalization".to_string());
    }

    let entry = Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|error| format!("failed to initialize keyring entry: {error}"))?;
    entry
        .set_password(&normalized_api_key)
        .map_err(|error| format!("failed to save API key to keyring: {error}"))?;

    let roundtrip_raw = entry
        .get_password()
        .map_err(|error| format!("keyring save verification failed: {error}"))?;
    let roundtrip = normalize_api_key_secret(&roundtrip_raw);
    if roundtrip.trim().is_empty() {
        return Err("keyring save verification failed: stored value is empty".to_string());
    }
    if roundtrip != normalized_api_key {
        return Err("keyring save verification failed: stored value mismatch".to_string());
    }
    Ok(())
}

fn clear_api_key_from_known_keyring_entries() {
    for (service, user) in known_keyring_targets() {
        if let Ok(entry) = Entry::new(service, user) {
            let _ = entry.delete_credential();
        }
    }
}

fn read_api_key_from_known_keyring_entries() -> Option<(String, String, String)> {
    for (service, user) in known_keyring_targets() {
        let Ok(entry) = Entry::new(service, user) else {
            continue;
        };
        let Ok(api_key) = entry.get_password() else {
            continue;
        };
        let normalized_api_key = normalize_api_key_secret(&api_key);
        if normalized_api_key.trim().is_empty() {
            continue;
        }
        return Some((normalized_api_key, service.to_string(), user.to_string()));
    }

    None
}

#[cfg(target_os = "windows")]
fn encrypt_api_key_fallback(api_key: &str) -> Result<String, String> {
    if api_key.is_empty() {
        return Ok(String::new());
    }

    let mut input_bytes = api_key.as_bytes().to_vec();
    let input_blob = CRYPT_INTEGER_BLOB {
        cbData: input_bytes.len() as u32,
        pbData: input_bytes.as_mut_ptr(),
    };
    let mut output_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    let ok = unsafe {
        CryptProtectData(
            &input_blob,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output_blob,
        )
    };

    if ok == 0 {
        return Err(format!(
            "DPAPI protect failed: {}",
            io::Error::last_os_error()
        ));
    }

    let encrypted = unsafe {
        std::slice::from_raw_parts(output_blob.pbData as *const u8, output_blob.cbData as usize)
            .to_vec()
    };
    unsafe {
        LocalFree(output_blob.pbData as _);
    }
    Ok(BASE64_STANDARD.encode(encrypted))
}

#[cfg(not(target_os = "windows"))]
fn encrypt_api_key_fallback(_api_key: &str) -> Result<String, String> {
    Err("Encrypted API key fallback is unavailable on this OS build.".to_string())
}

#[cfg(target_os = "windows")]
fn decrypt_api_key_fallback(encoded_value: &str) -> Result<String, String> {
    let trimmed = encoded_value.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }

    let mut encrypted = BASE64_STANDARD
        .decode(trimmed)
        .map_err(|error| format!("Invalid encrypted API key payload: {error}"))?;
    let input_blob = CRYPT_INTEGER_BLOB {
        cbData: encrypted.len() as u32,
        pbData: encrypted.as_mut_ptr(),
    };
    let mut output_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    let ok = unsafe {
        CryptUnprotectData(
            &input_blob,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output_blob,
        )
    };

    if ok == 0 {
        return Err(format!(
            "DPAPI unprotect failed: {}",
            io::Error::last_os_error()
        ));
    }

    let decrypted = unsafe {
        std::slice::from_raw_parts(output_blob.pbData as *const u8, output_blob.cbData as usize)
            .to_vec()
    };
    unsafe {
        LocalFree(output_blob.pbData as _);
    }
    String::from_utf8(decrypted)
        .map_err(|error| format!("Decrypted API key is not valid UTF-8: {error}"))
}

#[cfg(not(target_os = "windows"))]
fn decrypt_api_key_fallback(_encoded_value: &str) -> Result<String, String> {
    Err("Encrypted API key fallback is unavailable on this OS build.".to_string())
}

fn secure_settings_payload(payload: &str) -> Result<String, String> {
    let mut parsed: Value = serde_json::from_str(payload)
        .map_err(|error| format!("Failed to parse settings JSON: {error}"))?;

    if let Some(obj) = parsed.as_object_mut() {
        let mut remember_api_key = obj.get("rememberApiKey").and_then(Value::as_bool);
        let api_key =
            normalize_api_key_secret(obj.get("apiKey").and_then(Value::as_str).unwrap_or_default());
        let fingerprint = api_key_fingerprint(&api_key);

        if remember_api_key.is_none() && !api_key.is_empty() {
            remember_api_key = Some(true);
            obj.insert("rememberApiKey".to_string(), Value::Bool(true));
            info!(
                "[settings] migrated legacy payload to rememberApiKey=true because api key is present"
            );
        }

        if remember_api_key == Some(false) {
            obj.insert("apiKey".to_string(), Value::String(String::new()));
            obj.remove(SETTINGS_API_KEY_ENCRYPTED_FIELD);
            obj.remove(SETTINGS_API_KEY_FINGERPRINT_FIELD);
            clear_api_key_from_known_keyring_entries();
            info!(
                "[settings] rememberApiKey=false; cleared api key from keyring and encrypted fallback"
            );
        } else if remember_api_key == Some(true) && !api_key.is_empty() {
            if !fingerprint.is_empty() {
                obj.insert(
                    SETTINGS_API_KEY_FINGERPRINT_FIELD.to_string(),
                    Value::String(fingerprint),
                );
            }
            match write_api_key_to_primary_keyring(&api_key) {
                Ok(()) => {
                    obj.insert("apiKey".to_string(), Value::String(String::new()));
                    info!("[settings] api key persisted to keyring rememberApiKey=1");
                    match encrypt_api_key_fallback(&api_key) {
                        Ok(encrypted_value) => {
                            obj.insert(
                                SETTINGS_API_KEY_ENCRYPTED_FIELD.to_string(),
                                Value::String(encrypted_value),
                            );
                            info!("[settings] encrypted API key backup refreshed");
                        }
                        Err(error) => {
                            warn!(
                                "[settings] encrypted API key backup refresh skipped: {}",
                                error
                            );
                            // Keep existing encrypted fallback value if present.
                        }
                    }
                }
                Err(keyring_error) => match encrypt_api_key_fallback(&api_key) {
                    Ok(encrypted_value) => {
                        clear_api_key_from_known_keyring_entries();
                        obj.insert("apiKey".to_string(), Value::String(String::new()));
                        obj.insert(
                            SETTINGS_API_KEY_ENCRYPTED_FIELD.to_string(),
                            Value::String(encrypted_value),
                        );
                        warn!(
                            "[settings] keyring save failed; used encrypted file fallback instead: {}",
                            keyring_error
                        );
                    }
                    Err(encryption_error) => {
                        return Err(format!(
                            "Unable to securely save API key. Keyring error: {keyring_error}. Encryption fallback error: {encryption_error}"
                        ));
                    }
                },
            }
        } else {
            // Keep plain apiKey out of file even when no new key payload is provided.
            obj.insert("apiKey".to_string(), Value::String(String::new()));
        }
    }

    serde_json::to_string(&parsed)
        .map_err(|error| format!("Failed to serialize secure settings: {error}"))
}

fn restore_settings_payload(payload: &str) -> Result<String, String> {
    let mut parsed: Value = serde_json::from_str(payload)
        .map_err(|error| format!("Failed to parse settings JSON: {error}"))?;

    if let Some(obj) = parsed.as_object_mut() {
        let remember_field = obj.get("rememberApiKey").and_then(Value::as_bool);
        let file_api_key =
            normalize_api_key_secret(obj.get("apiKey").and_then(Value::as_str).unwrap_or_default());
        let file_api_present = !file_api_key.is_empty();
        let encrypted_api_key = obj
            .get(SETTINGS_API_KEY_ENCRYPTED_FIELD)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let encrypted_api_present = !encrypted_api_key.trim().is_empty();
        let expected_fingerprint = obj
            .get(SETTINGS_API_KEY_FINGERPRINT_FIELD)
            .and_then(Value::as_str)
            .map(|value| value.trim().to_ascii_lowercase())
            .unwrap_or_default();

        let keyring_entry = read_api_key_from_known_keyring_entries();
        let keyring_api_key = keyring_entry
            .as_ref()
            .map(|(api_key, _, _)| api_key.clone())
            .unwrap_or_default();
        let keyring_api_present = !keyring_api_key.is_empty();
        let keyring_source = keyring_entry
            .as_ref()
            .map(|(_, service, user)| format!("{service}:{user}"))
            .unwrap_or_else(|| "<missing>".to_string());

        if let Some((_, source_service, source_user)) = &keyring_entry {
            if source_service != KEYRING_SERVICE || source_user != KEYRING_USER {
                if write_api_key_to_primary_keyring(&keyring_api_key).is_ok() {
                    info!(
                        "[settings] migrated keyring credential source='{}:{}' -> '{}:{}'",
                        source_service, source_user, KEYRING_SERVICE, KEYRING_USER
                    );
                }
            }
        }

        let decrypted_fallback_api_key = if encrypted_api_present {
            match decrypt_api_key_fallback(&encrypted_api_key) {
                Ok(value) => normalize_api_key_secret(&value),
                Err(error) => {
                    warn!(
                        "[settings] encrypted fallback API key could not be decrypted: {}",
                        error
                    );
                    String::new()
                }
            }
        } else {
            String::new()
        };
        let encrypted_decrypted_present = !decrypted_fallback_api_key.is_empty();
        let keyring_fingerprint = api_key_fingerprint(&keyring_api_key);
        let encrypted_fingerprint = api_key_fingerprint(&decrypted_fallback_api_key);
        let file_fingerprint = api_key_fingerprint(&file_api_key);

        let remember_api_key = match remember_field {
            Some(value) => value,
            None if keyring_api_present || encrypted_decrypted_present || file_api_present => {
                obj.insert("rememberApiKey".to_string(), Value::Bool(true));
                info!(
                    "[settings] migrated restore payload to rememberApiKey=true using available credential"
                );
                true
            }
            None => false,
        };

        let mut resolved_api_key = String::new();
        let mut resolved_source = "none";
        let mut resolved_fingerprint_match = false;

        if remember_api_key {
            if !expected_fingerprint.is_empty() {
                if keyring_api_present && keyring_fingerprint == expected_fingerprint {
                    resolved_api_key = keyring_api_key.clone();
                    resolved_source = "keyring";
                    resolved_fingerprint_match = true;
                } else if encrypted_decrypted_present && encrypted_fingerprint == expected_fingerprint {
                    resolved_api_key = decrypted_fallback_api_key.clone();
                    resolved_source = "encrypted-file";
                    resolved_fingerprint_match = true;
                } else if file_api_present && file_fingerprint == expected_fingerprint {
                    resolved_api_key = file_api_key.clone();
                    resolved_source = "legacy-plaintext-file";
                    resolved_fingerprint_match = true;
                }
            }

            if resolved_api_key.is_empty() {
                if keyring_api_present
                    && encrypted_decrypted_present
                    && keyring_api_key != decrypted_fallback_api_key
                    && expected_fingerprint.is_empty()
                {
                    resolved_api_key = decrypted_fallback_api_key.clone();
                    resolved_source = "encrypted-file-mismatch";
                    warn!(
                        "[settings] keyring and encrypted API keys differ with no fingerprint; preferring encrypted fallback"
                    );
                } else if keyring_api_present {
                    resolved_api_key = keyring_api_key.clone();
                    resolved_source = "keyring";
                } else if encrypted_decrypted_present {
                    resolved_api_key = decrypted_fallback_api_key.clone();
                    resolved_source = "encrypted-file";
                } else if file_api_present {
                    resolved_api_key = file_api_key.clone();
                    resolved_source = "legacy-plaintext-file";
                }
            }

            if !resolved_api_key.is_empty() && resolved_source != "keyring" {
                match write_api_key_to_primary_keyring(&resolved_api_key) {
                    Ok(()) => {
                        info!(
                            "[settings] migrated API key source={} into keyring primary entry",
                            resolved_source
                        );
                    }
                    Err(error) => {
                        warn!(
                            "[settings] unable to migrate API key source={} into keyring: {}",
                            resolved_source, error
                        );
                    }
                }
            }

            let resolved_fingerprint = api_key_fingerprint(&resolved_api_key);
            if !resolved_fingerprint.is_empty() {
                if !expected_fingerprint.is_empty() && resolved_fingerprint == expected_fingerprint {
                    resolved_fingerprint_match = true;
                }
                obj.insert(
                    SETTINGS_API_KEY_FINGERPRINT_FIELD.to_string(),
                    Value::String(resolved_fingerprint),
                );
            } else {
                obj.remove(SETTINGS_API_KEY_FINGERPRINT_FIELD);
            }

            obj.insert("apiKey".to_string(), Value::String(resolved_api_key));
        } else {
            obj.insert("apiKey".to_string(), Value::String(String::new()));
            obj.remove(SETTINGS_API_KEY_ENCRYPTED_FIELD);
            obj.remove(SETTINGS_API_KEY_FINGERPRINT_FIELD);
        }

        info!(
            "[settings] restore rememberApiKey={} keyring_api_present={} encrypted_api_present={} file_api_present={} keyring_source={} resolved_source={} fingerprint_present={} fingerprint_match={}",
            remember_api_key,
            keyring_api_present,
            encrypted_api_present,
            file_api_present,
            keyring_source,
            resolved_source,
            !expected_fingerprint.is_empty(),
            resolved_fingerprint_match
        );
    }

    serde_json::to_string(&parsed)
        .map_err(|error| format!("Failed to serialize restored settings: {error}"))
}

#[tauri::command]
async fn load_persisted_local_settings(app: AppHandle) -> Result<String, String> {
    let settings_path = persisted_settings_path(&app)?;
    if !settings_path.exists() {
        info!("[settings] load skipped because settings file is missing");
        return Ok(String::new());
    }

    let raw = fs::read_to_string(&settings_path).map_err(|error| {
        format!(
            "Failed to read persisted settings '{}': {error}",
            settings_path.display()
        )
    })?;
    info!(
        "[settings] load path='{}' bytes={}",
        settings_path.display(),
        raw.len()
    );

    restore_settings_payload(&raw)
}

#[tauri::command]
async fn save_persisted_local_settings(app: AppHandle, payload: String) -> Result<(), String> {
    let trimmed = payload.trim();
    if trimmed.is_empty() {
        return Err("Settings payload is empty.".to_string());
    }

    let parsed = serde_json::from_str::<Value>(trimmed)
        .map_err(|error| format!("Settings payload is not valid JSON: {error}"))?;
    if !parsed.is_object() {
        return Err("Settings payload must be a JSON object.".to_string());
    }

    info!("[settings] save requested bytes={}", trimmed.len());
    let secured_payload = secure_settings_payload(trimmed)?;

    let settings_path = persisted_settings_path(&app)?;
    fs::write(&settings_path, secured_payload.as_bytes()).map_err(|error| {
        format!(
            "Failed to write persisted settings '{}': {error}",
            settings_path.display()
        )
    })?;
    info!(
        "[settings] save path='{}' bytes={}",
        settings_path.display(),
        secured_payload.len()
    );
    Ok(())
}

enum StartupLocalSttWarmupTarget {
    DisabledByRuntimeMode,
    MissingModel,
    Model(String),
}

fn load_startup_local_stt_warmup_target(app: &AppHandle) -> StartupLocalSttWarmupTarget {
    let settings_path = match persisted_settings_path(app) {
        Ok(path) => path,
        Err(_) => return StartupLocalSttWarmupTarget::MissingModel,
    };
    if !settings_path.exists() {
        return StartupLocalSttWarmupTarget::MissingModel;
    }
    let raw = match fs::read_to_string(&settings_path) {
        Ok(raw) => raw,
        Err(_) => return StartupLocalSttWarmupTarget::MissingModel,
    };
    let payload = match serde_json::from_str::<Value>(&raw) {
        Ok(payload) => payload,
        Err(_) => return StartupLocalSttWarmupTarget::MissingModel,
    };

    let runtime_mode_local = payload
        .get("sttRuntimeMode")
        .and_then(Value::as_str)
        .map(str::trim)
        .map(|value| value.eq_ignore_ascii_case("local"))
        .or_else(|| {
            payload
                .get("runtimeMode")
                .and_then(Value::as_str)
                .map(str::trim)
                .map(|value| value.eq_ignore_ascii_case("local"))
        })
        .unwrap_or_else(|| {
            payload
                .get("localMode")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        });
    if !runtime_mode_local {
        return StartupLocalSttWarmupTarget::DisabledByRuntimeMode;
    }

    let model = payload
        .get("localSttModel")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    match model {
        Some(model) => StartupLocalSttWarmupTarget::Model(canonical_local_stt_model_id(model)),
        None => StartupLocalSttWarmupTarget::MissingModel,
    }
}

fn start_local_stt_boot_warmup(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let model = match load_startup_local_stt_warmup_target(&app) {
            StartupLocalSttWarmupTarget::DisabledByRuntimeMode => {
                info!("[local.stt.startup] warmup skipped (STT runtime mode is online)");
                let _ = app.state::<AppState>().set_local_stt_runtime_loaded(false);
                return;
            }
            StartupLocalSttWarmupTarget::MissingModel => {
                info!("[local.stt.startup] warmup skipped (no persisted local STT model)");
                let _ = app.state::<AppState>().set_local_stt_runtime_loaded(false);
                return;
            }
            StartupLocalSttWarmupTarget::Model(model) => model,
        };

        let provider = infer_local_stt_provider_from_model(&model);
        let (repo_id, model_dir) = match resolve_local_stt_repo_and_dir(&app, &provider, &model) {
            Ok(result) => result,
            Err(error) => {
                warn!(
                    "[local.stt.startup] warmup skipped model={} reason={}",
                    clip_text(&model, 140),
                    clip_text(&single_line(&error), 260)
                );
                let _ = app.state::<AppState>().set_local_stt_runtime_loaded(false);
                return;
            }
        };
        if !model_dir.exists() {
            info!(
                "[local.stt.startup] warmup skipped model={} repo={} reason=not-downloaded",
                clip_text(&model, 140),
                clip_text(&repo_id, 140)
            );
            let _ = app.state::<AppState>().set_local_stt_runtime_loaded(false);
            return;
        }

        info!(
            "[local.stt.startup] warmup begin model={} provider={} repo={}",
            clip_text(&model, 140),
            clip_text(&provider, 40),
            clip_text(&repo_id, 140)
        );

        let app_for_worker = app.clone();
        let model_for_worker = model.clone();
        let provider_for_worker = provider.clone();
        let warmup_result = tauri::async_runtime::spawn_blocking(move || {
            match provider_for_worker.as_str() {
                "parakeet" => {
                    warmup_local_stt_parakeet_model_blocking(&app_for_worker, "", &model_for_worker)
                }
                "whisper" | "moonshine" | "sensevoice" => {
                    if zero_python_mode_enabled() {
                        return Err(ZERO_PYTHON_STT_NOTICE.to_string());
                    }
                    let python_path = setup_local_stt_runtime_blocking(&app_for_worker, "python")?;
                    warmup_local_stt_hf_model_blocking(&app_for_worker, &python_path, &model_for_worker)
                }
                _ => Ok("Warmup skipped (unsupported provider).".to_string()),
            }
        })
        .await
        .map_err(|error| format!("Local STT startup warmup worker failed: {error}"))
        .and_then(|result| result);

        match warmup_result {
            Ok(details) => {
                let _ = app.state::<AppState>().set_local_stt_runtime_loaded(true);
                info!(
                    "[local.stt.startup] warmup complete model={} details={}",
                    clip_text(&model, 140),
                    clip_text(&single_line(&details), 240)
                );
            }
            Err(error) => {
                let _ = app.state::<AppState>().set_local_stt_runtime_loaded(false);
                warn!(
                    "[local.stt.startup] warmup failed model={} error={}",
                    clip_text(&model, 140),
                    clip_text(&single_line(&error), 260)
                );
            }
        }
    });
}

#[tauri::command]
async fn capture_selected_text() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let text = capture_selected_text_windows()?;
        info!(
            "[client] captured selected text chars={}",
            text.chars().count()
        );
        return Ok(text);
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Selected-text capture is currently implemented for Windows builds only.".to_string())
    }
}

#[cfg(target_os = "windows")]
fn capture_selected_text_windows() -> Result<String, String> {
    let marker_stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Failed to compute marker timestamp: {error}"))?
        .as_millis();
    let marker = format!("SLASSHY_SEL_MARKER_{marker_stamp}");
    let script = format!(
        "$ErrorActionPreference='SilentlyContinue'; \
        $terminalFocus=$false; \
        try {{ \
          Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class SlasshyWin32 {{ [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId); }}' -ErrorAction SilentlyContinue | Out-Null; \
          $hwnd=[SlasshyWin32]::GetForegroundWindow(); \
          if ($hwnd -ne [IntPtr]::Zero) {{ \
            [uint32]$pid=0; \
            [void][SlasshyWin32]::GetWindowThreadProcessId($hwnd, [ref]$pid); \
            $proc=''; $title=''; \
            try {{ $p=Get-Process -Id $pid -ErrorAction Stop; $proc=([string]$p.ProcessName).ToLowerInvariant(); $title=([string]$p.MainWindowTitle).ToLowerInvariant(); }} catch {{}}; \
            $isTerminalProc=($proc -match 'windowsterminal|wt|pwsh|powershell|cmd|conemu|alacritty|wezterm|mintty|tabby'); \
            $isIdeProc=($proc -match 'code|cursor|windsurf|devenv|idea64|pycharm64|webstorm64|rider64|clion64'); \
            $hasTerminalTitle=($title -match 'terminal|powershell|pwsh|cmd|bash|zsh|fish'); \
            if ($isTerminalProc -or ($isIdeProc -and $hasTerminalTitle)) {{ $terminalFocus=$true }}; \
          }} \
        }} catch {{}}; \
        if ($terminalFocus) {{ [Console]::Error.Write('__SLASSHY_TERMINAL_FOCUS__'); [Console]::Out.Write(''); return }}; \
        $prev=$null; $hadPrev=$false; \
        try {{ $prev = Get-Clipboard -Raw; $hadPrev = $true }} catch {{}}; \
        $marker='{marker}'; \
        try {{ Set-Clipboard -Value $marker }} catch {{}}; \
        $ws = New-Object -ComObject WScript.Shell; \
        $sel=''; \
        for ($i=0; $i -lt 4; $i++) {{ \
          Start-Sleep -Milliseconds 70; \
          $ws.SendKeys('^c'); \
          Start-Sleep -Milliseconds 160; \
          try {{ \
            $cur = Get-Clipboard -Raw; \
            if ($null -ne $cur -and $cur -ne $marker -and $cur.Trim().Length -gt 0) {{ \
              $sel = $cur; \
              break; \
            }} \
          }} catch {{}}; \
        }}; \
        if ($hadPrev) {{ \
          try {{ Set-Clipboard -Value $prev }} catch {{}} \
        }}; \
        [Console]::Out.Write($sel)"
    );
    let output = run_powershell_script(&script, None)?;
    let stderr_text = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr_text.contains("__SLASSHY_TERMINAL_FOCUS__") {
        info!("[client] selection capture skipped while terminal window is focused");
        return Ok(String::new());
    }
    if !output.status.success() {
        let merged = merge_process_output(&output.stdout, &output.stderr);
        return Err(format!(
            "Failed to capture selected text: {}",
            clip_text(&single_line(&merged), 280)
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .replace("\r\n", "\n")
        .trim_end_matches(['\r', '\n'])
        .to_string())
}

#[cfg(target_os = "windows")]
mod win_registry {
    pub type HKEY = isize;
    pub const HKEY_CURRENT_USER: HKEY = -2147483647isize;
    pub const KEY_SET_VALUE: u32 = 0x0002;
    pub const REG_SZ: u32 = 1;
    pub const ERROR_SUCCESS: i32 = 0;

    #[link(name = "advapi32")]
    extern "system" {
        pub fn RegCreateKeyExW(
            hkey: HKEY,
            lp_sub_key: *const u16,
            reserved: u32,
            lp_class: *const u16,
            dw_options: u32,
            sam_desired: u32,
            lp_security_attributes: *const std::ffi::c_void,
            phk_result: *mut HKEY,
            lpdw_disposition: *mut u32,
        ) -> i32;

        pub fn RegSetValueExW(
            hkey: HKEY,
            lp_value_name: *const u16,
            reserved: u32,
            dw_type: u32,
            lp_data: *const u8,
            cb_data: u32,
        ) -> i32;

        pub fn RegDeleteValueW(
            hkey: HKEY,
            lp_value_name: *const u16,
        ) -> i32;

        pub fn RegCloseKey(hkey: HKEY) -> i32;
    }
}

#[cfg(target_os = "windows")]
fn run_powershell_script(
    script: &str,
    stdin_text: Option<&str>,
) -> Result<std::process::Output, String> {
    let mut command = Command::new("powershell");
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command.creation_flags(CREATE_NO_WINDOW);

    if stdin_text.is_some() {
        command.stdin(Stdio::piped());
    } else {
        command.stdin(Stdio::null());
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start PowerShell helper: {error}"))?;

    if let Some(text) = stdin_text {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "Failed to open PowerShell stdin.".to_string())?;
        stdin
            .write_all(text.as_bytes())
            .map_err(|error| format!("Failed to write PowerShell stdin: {error}"))?;
    }

    child
        .wait_with_output()
        .map_err(|error| format!("Failed waiting for PowerShell helper: {error}"))
}

#[cfg(target_os = "windows")]
fn spawn_powershell_detached(script: &str) -> Result<(), String> {
    let mut command = Command::new("powershell");
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command.creation_flags(CREATE_NO_WINDOW);

    command
        .spawn()
        .map_err(|error| format!("Failed to start detached PowerShell helper: {error}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn escape_powershell_single_quoted(value: &str) -> String {
    if value.contains('\'') {
        value.replace('\'', "''")
    } else {
        value.to_string()
    }
}

#[cfg(target_os = "windows")]
fn schedule_app_relaunch_after_installer(
    installer_pid: u32,
    app_exe_path: &Path,
) -> Result<(), String> {
    let exe_text = app_exe_path.to_string_lossy().to_string();
    if exe_text.trim().is_empty() {
        return Err("App executable path is empty; cannot schedule relaunch.".to_string());
    }

    let escaped_exe = escape_powershell_single_quoted(&exe_text);
    let script = format!(
        "$ErrorActionPreference='SilentlyContinue'; \
         $installerPid={installer_pid}; \
         while (Get-Process -Id $installerPid -ErrorAction SilentlyContinue) {{ Start-Sleep -Milliseconds 500 }}; \
         $exe='{escaped_exe}'; \
         for ($i=0; $i -lt 180; $i++) {{ \
             if (Test-Path $exe) {{ try {{ Start-Process -FilePath $exe; break }} catch {{ }} }}; \
             Start-Sleep -Milliseconds 500; \
         }};"
    );
    spawn_powershell_detached(&script)
}

#[cfg(target_os = "windows")]
fn apply_no_window(command: &mut Command) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn apply_no_window(_command: &mut Command) {}

#[cfg(target_os = "windows")]
fn set_clipboard_text_windows(text: &str) -> Result<(), String> {
    let output = run_powershell_script(
        "$ErrorActionPreference='Stop'; $text=[Console]::In.ReadToEnd(); Set-Clipboard -Value $text",
        Some(text),
    )?;
    if !output.status.success() {
        let merged = merge_process_output(&output.stdout, &output.stderr);
        return Err(format!(
            "Clipboard write failed: {}",
            clip_text(&single_line(&merged), 280)
        ));
    }

    Ok(())
}

#[tauri::command]
async fn set_clipboard_text(text: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        set_clipboard_text_windows(&text)?;
        info!("[client] clipboard updated chars={}", text.chars().count());
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = text;
        Err("Clipboard write helper is currently implemented for Windows builds only.".to_string())
    }
}

#[tauri::command]
async fn configure_launch_at_login(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;

        let run_key_path = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
        let mut subkey_wide: Vec<u16> = std::ffi::OsStr::new(run_key_path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut value_name_wide: Vec<u16> = std::ffi::OsStr::new(STARTUP_RUN_VALUE_NAME)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        if enabled {
            let exe_path = std::env::current_exe()
                .map_err(|error| format!("Failed to resolve executable path: {error}"))?;
            let exe_text = exe_path.to_string_lossy().to_string();
            if exe_text.trim().is_empty() {
                return Err("Executable path is empty.".to_string());
            }

            let value = format!("\"{}\" {}", exe_text.replace('\"', "\"\""), STARTUP_ARG_START_IN_TRAY);
            let mut value_wide: Vec<u16> = std::ffi::OsStr::new(&value)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();

            let mut hkey: win_registry::HKEY = 0;
            unsafe {
                let create_result = win_registry::RegCreateKeyExW(
                    win_registry::HKEY_CURRENT_USER,
                    subkey_wide.as_ptr(),
                    0,
                    std::ptr::null(),
                    0,
                    win_registry::KEY_SET_VALUE,
                    std::ptr::null(),
                    &mut hkey,
                    std::ptr::null_mut(),
                );
                if create_result != win_registry::ERROR_SUCCESS {
                    return Err(format!("Unable to enable launch at login (RegCreateKeyExW failed: {})", create_result));
                }

                let set_result = win_registry::RegSetValueExW(
                    hkey,
                    value_name_wide.as_ptr(),
                    0,
                    win_registry::REG_SZ,
                    value_wide.as_ptr() as *const u8,
                    (value_wide.len() * 2) as u32,
                );

                win_registry::RegCloseKey(hkey);

                if set_result != win_registry::ERROR_SUCCESS {
                    return Err(format!("Unable to enable launch at login (RegSetValueExW failed: {})", set_result));
                }
            }

            info!(
                "[startup] launch at login enabled with start-in-tray flag path={}",
                clip_text(&single_line(&exe_text), 240)
            );
            return Ok(());
        }

        let mut hkey: win_registry::HKEY = 0;
        unsafe {
            let create_result = win_registry::RegCreateKeyExW(
                win_registry::HKEY_CURRENT_USER,
                subkey_wide.as_ptr(),
                0,
                std::ptr::null(),
                0,
                win_registry::KEY_SET_VALUE,
                std::ptr::null(),
                &mut hkey,
                std::ptr::null_mut(),
            );

            if create_result == win_registry::ERROR_SUCCESS {
                win_registry::RegDeleteValueW(hkey, value_name_wide.as_ptr());
                win_registry::RegCloseKey(hkey);
            }
        }

        info!("[startup] launch at login disabled");
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
        Err("Launch at login helper is currently implemented for Windows builds only.".to_string())
    }
}

#[tauri::command]
async fn paste_clipboard_text() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let output = run_powershell_script(
            "$ErrorActionPreference='Stop'; $ws = New-Object -ComObject WScript.Shell; Start-Sleep -Milliseconds 70; $ws.SendKeys('^v')",
            None,
        )?;
        if !output.status.success() {
            let merged = merge_process_output(&output.stdout, &output.stderr);
            return Err(format!(
                "Auto-paste failed: {}",
                clip_text(&single_line(&merged), 280)
            ));
        }
        info!("[client] auto-paste triggered");
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Auto-paste is currently implemented for Windows builds only.".to_string())
    }
}

#[tauri::command]
async fn paste_text_via_clipboard(text: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let output = run_powershell_script(
            "$ErrorActionPreference='Stop'; $text=[Console]::In.ReadToEnd(); Set-Clipboard -Value $text; $ws = New-Object -ComObject WScript.Shell; Start-Sleep -Milliseconds 90; $ws.SendKeys('^v')",
            Some(&text),
        )?;
        if !output.status.success() {
            let merged = merge_process_output(&output.stdout, &output.stderr);
            return Err(format!(
                "Dictation paste failed: {}",
                clip_text(&single_line(&merged), 280)
            ));
        }
        info!(
            "[client] dictation clipboard+paste triggered chars={}",
            text.chars().count()
        );
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = text;
        Err("Dictation paste helper is currently implemented for Windows builds only.".to_string())
    }
}

#[tauri::command]
async fn type_text_direct(text: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if text.is_empty() {
            return Ok(());
        }

        let script = r#"$ErrorActionPreference='Stop';
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class SlasshyInput {
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public InputUnion U;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion {
    [FieldOffset(0)]
    public KEYBDINPUT ki;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [DllImport("user32.dll", SetLastError=true)]
  public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
}
"@;

$text=[Console]::In.ReadToEnd();
if ([string]::IsNullOrEmpty($text)) { exit 0 }

$INPUT_KEYBOARD = 1;
$KEYEVENTF_KEYUP = 0x0002;
$KEYEVENTF_UNICODE = 0x0004;
$VK_RETURN = 0x0D;
$inputSize = [System.Runtime.InteropServices.Marshal]::SizeOf([type]([SlasshyInput+INPUT]));

function Send-UnicodeChar([char]$char) {
  $code = [int]$char;
  $down = New-Object SlasshyInput+INPUT;
  $down.type = $INPUT_KEYBOARD;
  $down.U.ki.wVk = 0;
  $down.U.ki.wScan = [uint16]$code;
  $down.U.ki.dwFlags = $KEYEVENTF_UNICODE;

  $up = New-Object SlasshyInput+INPUT;
  $up.type = $INPUT_KEYBOARD;
  $up.U.ki.wVk = 0;
  $up.U.ki.wScan = [uint16]$code;
  $up.U.ki.dwFlags = ($KEYEVENTF_UNICODE -bor $KEYEVENTF_KEYUP);

  $sent = [SlasshyInput]::SendInput(2, @($down, $up), $inputSize);
  if ($sent -ne 2) {
    throw "SendInput unicode failed.";
  }
}

function Send-Enter {
  $down = New-Object SlasshyInput+INPUT;
  $down.type = $INPUT_KEYBOARD;
  $down.U.ki.wVk = [uint16]$VK_RETURN;
  $down.U.ki.wScan = 0;
  $down.U.ki.dwFlags = 0;

  $up = New-Object SlasshyInput+INPUT;
  $up.type = $INPUT_KEYBOARD;
  $up.U.ki.wVk = [uint16]$VK_RETURN;
  $up.U.ki.wScan = 0;
  $up.U.ki.dwFlags = $KEYEVENTF_KEYUP;

  $sent = [SlasshyInput]::SendInput(2, @($down, $up), $inputSize);
  if ($sent -ne 2) {
    throw "SendInput enter failed.";
  }
}

Start-Sleep -Milliseconds 45;

foreach ($char in $text.ToCharArray()) {
  if ($char -eq "`r") {
    continue;
  }
  if ($char -eq "`n") {
    Send-Enter;
    continue;
  }
  Send-UnicodeChar $char;
}"#;

        let output = run_powershell_script(script, Some(&text))?;
        if !output.status.success() {
            let merged = merge_process_output(&output.stdout, &output.stderr);
            return Err(format!(
                "Direct text insertion failed: {}",
                clip_text(&single_line(&merged), 280)
            ));
        }

        info!(
            "[client] direct text insertion triggered chars={}",
            text.chars().count()
        );
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = text;
        Err("Direct text insertion is currently implemented for Windows builds only.".to_string())
    }
}

#[tauri::command]
async fn control_media_playback(action: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let normalized = action.trim().to_ascii_lowercase();
        let app_command = match normalized.as_str() {
            "play" => 46u32,
            "pause" => 47u32,
            _ => {
                return Err("Invalid media action. Expected \"play\" or \"pause\".".to_string());
            }
        };

        let script = format!(
            r#"$ErrorActionPreference='Stop';
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Win32MediaControl {{
    [DllImport("user32.dll", SetLastError=true)]
    public static extern IntPtr SendMessageTimeout(
        IntPtr hWnd,
        uint Msg,
        IntPtr wParam,
        IntPtr lParam,
        uint fuFlags,
        uint uTimeout,
        out IntPtr lpdwResult
    );
}}
"@;
$HWND_BROADCAST=[IntPtr]0xffff;
$WM_APPCOMMAND=0x0319;
$SMTO_ABORTIFHUNG=0x0002;
$result=[IntPtr]::Zero;
$lParam=[IntPtr](({app_command}) -shl 16);
[void][Win32MediaControl]::SendMessageTimeout($HWND_BROADCAST, $WM_APPCOMMAND, [IntPtr]::Zero, $lParam, $SMTO_ABORTIFHUNG, 250, [ref]$result)"#
        );

        let output = run_powershell_script(&script, None)?;
        if !output.status.success() {
            let merged = merge_process_output(&output.stdout, &output.stderr);
            return Err(format!(
                "Media playback control failed: {}",
                clip_text(&single_line(&merged), 280)
            ));
        }

        info!("[client] media playback action={}", normalized);
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = action;
        Err("Media playback control is currently implemented for Windows builds only.".to_string())
    }
}

fn is_blocked_game_process_name(process_name: &str) -> bool {
    let normalized = process_name.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }

    let base = normalized.trim_end_matches(".exe");

    const BLOCKED_EXACT: [&str; 18] = [
        "valorant",
        "valorant-win64-shipping",
        "cs2",
        "hl2",
        "dota2",
        "r5apex",
        "fortniteclient-win64-shipping",
        "overwatch",
        "rainbowsix",
        "rocketleague",
        "gta5",
        "eldenring",
        "leagueclientux",
        "leagueclientuxrender",
        "leagueoflegends",
        "destiny2",
        "pubg",
        "rustclient",
    ];

    if BLOCKED_EXACT.contains(&base) {
        return true;
    }

    const BLOCKED_PREFIXES: [&str; 11] = [
        "valorant",
        "fortniteclient",
        "r5apex",
        "leagueclient",
        "leagueoflegends",
        "rainbowsix",
        "rocketleague",
        "overwatch",
        "destiny2",
        "pubg",
        "rustclient",
    ];

    BLOCKED_PREFIXES
        .iter()
        .any(|prefix| base.starts_with(prefix))
}

fn is_blocked_terminal_process_name(process_name: &str) -> bool {
    let normalized = process_name.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }

    let base = normalized.trim_end_matches(".exe");
    const BLOCKED_TERMINAL_EXACT: [&str; 11] = [
        "cmd",
        "conhost",
        "powershell",
        "pwsh",
        "windowsterminal",
        "wt",
        "bash",
        "zsh",
        "fish",
        "mintty",
        "tabby",
    ];
    if BLOCKED_TERMINAL_EXACT.contains(&base) {
        return true;
    }

    const BLOCKED_TERMINAL_PREFIXES: [&str; 5] = [
        "windows terminal",
        "wezterm",
        "alacritty",
        "cmder",
        "git-bash",
    ];
    if BLOCKED_TERMINAL_PREFIXES
        .iter()
        .any(|prefix| base.starts_with(prefix))
    {
        return true;
    }

    base.contains("terminal")
}

fn is_ide_terminal_window(process_name: &str, window_title: &str) -> bool {
    let normalized_process = process_name.trim().to_ascii_lowercase();
    let normalized_title = window_title.trim().to_ascii_lowercase();
    if normalized_process.is_empty() || normalized_title.is_empty() {
        return false;
    }

    let is_ide = normalized_process == "code"
        || normalized_process == "cursor"
        || normalized_process == "code - insiders"
        || normalized_process == "windsurf";
    if !is_ide {
        return false;
    }

    normalized_title.contains("terminal")
        || normalized_title.contains("powershell")
        || normalized_title.contains("pwsh")
        || normalized_title.contains("cmd")
        || normalized_title.contains("bash")
        || normalized_title.contains("zsh")
        || normalized_title.contains("fish")
}

fn should_block_foreground_input(process_name: &str, window_title: &str) -> bool {
    is_blocked_game_process_name(process_name)
        || is_blocked_terminal_process_name(process_name)
        || is_ide_terminal_window(process_name, window_title)
}

#[tauri::command]
async fn get_foreground_input_block_status() -> Result<ForegroundInputBlockStatus, String> {
    #[cfg(target_os = "windows")]
    {
        let script = r#"$ErrorActionPreference='Stop';
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ForegroundWindowProbe {
    [DllImport("user32.dll", SetLastError=true)]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", SetLastError=true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@;
$hwnd=[ForegroundWindowProbe]::GetForegroundWindow();
if ($hwnd -eq [IntPtr]::Zero) { [Console]::Out.Write(''); exit 0 }
$pid = 0;
[void][ForegroundWindowProbe]::GetWindowThreadProcessId($hwnd, [ref]$pid);
if ($pid -le 0) { [Console]::Out.Write(''); exit 0 }
$title = '';
try {
  $title = [System.Diagnostics.Process]::GetProcessById([int]$pid).MainWindowTitle
} catch {
  $title = ''
}
if ($null -eq $title) { $title = '' }
try {
  $proc = Get-Process -Id $pid -ErrorAction Stop;
  [Console]::Out.Write(($proc.ProcessName.ToLowerInvariant()) + '||' + $title.ToLowerInvariant());
} catch {
  [Console]::Out.Write('');
}"#;

        let output = run_powershell_script(script, None)?;
        if !output.status.success() {
            let merged = merge_process_output(&output.stdout, &output.stderr);
            return Err(format!(
                "Foreground app detection failed: {}",
                clip_text(&single_line(&merged), 280)
            ));
        }

        let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let (process_name, window_title) = if raw.is_empty() {
            (String::new(), String::new())
        } else if let Some((proc, title)) = raw.split_once("||") {
            (
                proc.trim().to_ascii_lowercase(),
                title.trim().to_ascii_lowercase(),
            )
        } else {
            (raw.to_ascii_lowercase(), String::new())
        };
        let blocked = should_block_foreground_input(&process_name, &window_title);
        return Ok(ForegroundInputBlockStatus {
            blocked,
            process_name,
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(ForegroundInputBlockStatus {
            blocked: false,
            process_name: String::new(),
        })
    }
}

#[tauri::command]
async fn get_assistant_info(app: AppHandle) -> Result<AssistantInfoResponse, String> {
    let (model_path, config_path) = voice_paths(&app)?;
    let piper_path = discover_installed_piper_path(&app)?;
    let (coqui_installed, coqui_python_path) = if zero_python_mode_enabled() {
        (false, String::new())
    } else {
        let path = coqui_venv_python_path(&app)?;
        (
            file_exists_with_content(&path),
            path.to_string_lossy().into_owned(),
        )
    };

    Ok(AssistantInfoResponse {
        app_version: app.package_info().version.to_string(),
        base_url: DEFAULT_BASE_URL,
        stt_model: DEFAULT_STT_MODEL,
        ai_model: DEFAULT_AI_MODEL,
        piper_installed: piper_path.is_some(),
        piper_path: piper_path
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default(),
        voice_installed: file_exists_with_content(&model_path)
            && file_exists_with_content(&config_path),
        voice_model_path: model_path.to_string_lossy().into_owned(),
        voice_config_path: config_path.to_string_lossy().into_owned(),
        coqui_installed,
        coqui_python_path,
    })
}

// ⚡ Bolt Optimization: Use string slices (&str) inside the BTreeSet
// instead of owned Strings to avoid unnecessary heap allocations
// during the duplicate filtering phase.
fn collect_model_ids_from_array<'a>(items: &'a [Value], output: &mut BTreeSet<&'a str>) {
    for item in items {
        if let Some(text) = item.as_str() {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                output.insert(trimmed);
            }
            continue;
        }

        if let Some(model) = item
            .get("id")
            .and_then(Value::as_str)
            .or_else(|| item.get("model").and_then(Value::as_str))
            .or_else(|| item.get("name").and_then(Value::as_str))
        {
            let trimmed = model.trim();
            if !trimmed.is_empty() {
                output.insert(trimmed);
            }
        }
    }
}

fn extract_model_ids_from_payload(payload: &Value) -> Vec<String> {
    let mut models = BTreeSet::new();

    if let Some(items) = payload.get("data").and_then(Value::as_array) {
        collect_model_ids_from_array(items, &mut models);
    }
    if let Some(items) = payload.get("models").and_then(Value::as_array) {
        collect_model_ids_from_array(items, &mut models);
    }
    if models.is_empty() {
        if let Some(items) = payload.as_array() {
            collect_model_ids_from_array(items, &mut models);
        }
    }

    // ⚡ Bolt Optimization: Convert unique references to owned Strings
    // only after duplicates have been eliminated.
    models.into_iter().map(String::from).collect()
}

#[tauri::command]
async fn fetch_provider_models(
    state: State<'_, AppState>,
    request: ProviderModelsRequest,
) -> Result<ProviderModelsResponse, String> {
    let api_key = normalize_api_key_secret(&request.api_key);
    if api_key.is_empty() {
        return Err("API key is required to fetch models.".to_string());
    }

    let base_url = normalize_api_base_url(request.api_base_url.as_deref());
    if base_url.is_empty() {
        return Err("API base URL is required to fetch models.".to_string());
    }
    let request_builder = state.http.get(format!("{base_url}/models"));
    let response = apply_optional_bearer_auth(request_builder, Some(api_key.as_str()))
        .send()
        .await
        .map_err(|error| format!("Failed to call models endpoint: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to parse models response body: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "Model fetch failed ({status}): {}",
            clip_text(&single_line(&body), 420)
        ));
    }

    let payload: Value = serde_json::from_str(&body)
        .map_err(|error| format!("Invalid model catalog JSON response: {error}"))?;
    let models = extract_model_ids_from_payload(&payload);

    info!(
        "[provider.models] fetched count={} base_url={}",
        models.len(),
        clip_text(&base_url, 180)
    );

    Ok(ProviderModelsResponse { base_url, models })
}

#[tauri::command]
async fn fetch_ollama_models(
    state: State<'_, AppState>,
    request: OllamaModelsRequest,
) -> Result<ProviderModelsResponse, String> {
    let base_url = normalize_local_ollama_base_url(request.base_url.as_deref());
    let response = state
        .http
        .get(format!("{base_url}/api/tags"))
        .send()
        .await
        .map_err(|error| format!("Failed to call Ollama tags endpoint: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to parse Ollama tags response body: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "Ollama model fetch failed ({status}): {}",
            clip_text(&single_line(&body), 420)
        ));
    }

    let payload: Value = serde_json::from_str(&body)
        .map_err(|error| format!("Invalid Ollama model catalog JSON response: {error}"))?;
    let models = extract_model_ids_from_payload(&payload);

    info!(
        "[ollama.models] fetched count={} base_url={}",
        models.len(),
        clip_text(&base_url, 180)
    );

    Ok(ProviderModelsResponse { base_url, models })
}

#[tauri::command]
async fn pull_ollama_model(
    state: State<'_, AppState>,
    request: OllamaPullRequest,
) -> Result<OllamaPullResponse, String> {
    let model = normalize_model_name(Some(&request.model));
    if model.is_empty() {
        return Err("Model name is required to pull from Ollama.".to_string());
    }

    let base_url = normalize_local_ollama_base_url(request.base_url.as_deref());
    let response = state
        .http
        .post(format!("{base_url}/api/pull"))
        .json(&json!({
            "name": model,
            "stream": false,
        }))
        .send()
        .await
        .map_err(|error| format!("Failed to call Ollama pull endpoint: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to parse Ollama pull response body: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "Ollama pull failed ({status}): {}",
            clip_text(&single_line(&body), 420)
        ));
    }

    let payload = serde_json::from_str::<Value>(&body).unwrap_or_else(|_| {
        json!({
            "status": body.trim(),
        })
    });
    let status_text = payload
        .get("status")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("completed")
        .to_string();

    info!(
        "[ollama.pull] model={} status={} base_url={}",
        clip_text(&model, 120),
        clip_text(&status_text, 120),
        clip_text(&base_url, 180)
    );

    Ok(OllamaPullResponse {
        base_url,
        model,
        ok: true,
        status: status_text,
    })
}

#[tauri::command]
async fn get_ollama_status(
    state: State<'_, AppState>,
    request: OllamaStatusRequest,
) -> Result<OllamaStatusResponse, String> {
    let base_url = normalize_local_ollama_base_url(request.base_url.as_deref());
    let version = match query_ollama_version().await {
        Ok(value) => value,
        Err(error) => {
            return Ok(OllamaStatusResponse {
                installed: false,
                running: false,
                version: String::new(),
                details: error,
            });
        }
    };

    let running = is_ollama_service_running(&state.http, &base_url).await;
    let details = if running {
        "Ollama CLI and local service are ready.".to_string()
    } else {
        format!("Ollama CLI is installed ({version}), but service at {base_url} is not responding.")
    };

    Ok(OllamaStatusResponse {
        installed: true,
        running,
        version,
        details,
    })
}

#[tauri::command]
async fn install_ollama(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<OllamaStatusResponse, String> {
    #[cfg(target_os = "windows")]
    {
        let installer_path = ollama_installer_path(&app)?;
        if !file_exists_with_content(&installer_path) {
            download_file(&state.http, OLLAMA_WINDOWS_INSTALLER_URL, &installer_path).await?;
        }

        let installer_for_worker = installer_path.clone();
        tauri::async_runtime::spawn_blocking(move || {
            run_ollama_installer_windows(&installer_for_worker)
        })
        .await
        .map_err(|error| format!("Ollama installer task failed: {error}"))??;

        let base_url = normalize_local_ollama_base_url(None);
        let version = query_ollama_version().await.unwrap_or_default();
        let running = is_ollama_service_running(&state.http, &base_url).await;
        let details = if running {
            "Ollama installation finished and service is reachable.".to_string()
        } else {
            "Ollama installer finished. Start Ollama once so the local service becomes reachable."
                .to_string()
        };

        return Ok(OllamaStatusResponse {
            installed: !version.trim().is_empty(),
            running,
            version,
            details,
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = state;
        Err("In-app Ollama installer is currently implemented for Windows only.".to_string())
    }
}

#[tauri::command]
async fn fetch_local_stt_models() -> Result<ProviderModelsResponse, String> {
    let models = built_in_local_stt_model_catalog();
    info!("[local.stt.models] source=builtin count={}", models.len());

    Ok(ProviderModelsResponse {
        base_url: "builtin://local-stt-model-catalog".to_string(),
        models,
    })
}

#[tauri::command]
async fn download_local_stt_model(
    app: AppHandle,
    state: State<'_, AppState>,
    request: LocalSttDownloadRequest,
) -> Result<LocalSttDownloadResponse, String> {
    let model = canonical_local_stt_model_id(&normalize_model_name(Some(&request.model)));
    if model.is_empty() {
        return Err("STT model name is required.".to_string());
    }
    let allowed_models = built_in_local_stt_model_catalog();
    if !allowed_models.iter().any(|item| item == &model) {
        return Err("Unsupported local STT model. Select one from the built-in catalog.".to_string());
    }
    let status_snapshot = state.snapshot_local_stt_download_status()?;
    if status_snapshot.active {
        return Err(format!(
            "Local STT download already running for '{}'.",
            status_snapshot.model
        ));
    }

    let provider = infer_local_stt_provider_from_model(&model);
    if zero_python_mode_enabled() && !local_stt_provider_supported_in_zero_python_mode(&provider) {
        return Err(ZERO_PYTHON_STT_NOTICE.to_string());
    }
    let repo_id = resolve_huggingface_repo_id(&provider, &model);
    let repo_id_for_status = repo_id.clone();
    state.update_local_stt_download_status(|status| {
        *status = LocalSttDownloadStatusResponse {
            active: true,
            completed: false,
            success: false,
            model: model.clone(),
            repo_id: repo_id_for_status,
            stage: "Preparing download...".to_string(),
            message: "Starting local STT model download.".to_string(),
            current_file: String::new(),
            downloaded_bytes: 0,
            total_bytes: 0,
            files_completed: 0,
            files_total: 0,
            progress_percent: 0.0,
            updated_at_ms: now_unix_ms(),
        };
    })?;

    let target_dir = stt_models_dir(&app)?.join(sanitize_model_cache_dir_name(&repo_id));
    let app_for_task = app.clone();
    let model_for_task = model.clone();
    let provider_for_task = provider.clone();
    let repo_id_for_task = repo_id.clone();
    let target_dir_for_task = target_dir.clone();
    tauri::async_runtime::spawn(async move {
        let state_for_task = app_for_task.state::<AppState>();
        let download_result = download_huggingface_stt_model(
            &state_for_task.http,
            &repo_id_for_task,
            &target_dir_for_task,
            None,
            &state_for_task,
        )
        .await;

        match download_result {
            Ok(download_details) => {
                let runtime_setup_required = matches!(
                    provider_for_task.as_str(),
                    "whisper" | "moonshine" | "sensevoice"
                );
                if runtime_setup_required {
                    let _ = state_for_task.update_local_stt_download_status(|status| {
                        status.model = model_for_task.clone();
                        status.repo_id = repo_id_for_task.clone();
                        status.stage = "Preparing local STT runtime...".to_string();
                        status.message = "Installing local STT runtime dependencies. This can take several minutes."
                            .to_string();
                        status.current_file.clear();
                    });

                    let app_for_runtime = app_for_task.clone();
                    let runtime_setup_result = tauri::async_runtime::spawn_blocking(move || {
                        setup_local_stt_runtime_blocking(&app_for_runtime, "python")
                    })
                    .await
                    .map_err(|error| format!("Local STT runtime worker failed: {error}"))
                    .and_then(|result| result);

                    match runtime_setup_result {
                        Ok(python_path) => {
                            let warmup_required = matches!(
                                provider_for_task.as_str(),
                                "parakeet" | "whisper" | "moonshine" | "sensevoice"
                            );
                            let warmup_result = if warmup_required {
                                let warmup_message = if provider_for_task == "parakeet" {
                                    "Loading Parakeet model once so first dictation is fast."
                                } else {
                                    "Loading local STT model once so first dictation is fast."
                                };
                                let _ = state_for_task.update_local_stt_download_status(|status| {
                                    status.model = model_for_task.clone();
                                    status.repo_id = repo_id_for_task.clone();
                                    status.stage = "Warming up local STT model...".to_string();
                                    status.message = warmup_message.to_string();
                                    status.current_file.clear();
                                    if status.total_bytes > 0 {
                                        status.downloaded_bytes = status.total_bytes;
                                    }
                                    if status.files_total > 0 {
                                        status.files_completed = status.files_total;
                                    }
                                });

                                let app_for_warmup = app_for_task.clone();
                                let model_for_warmup = model_for_task.clone();
                                let provider_for_warmup = provider_for_task.clone();
                                let python_for_warmup = python_path.clone();
                                tauri::async_runtime::spawn_blocking(move || {
                                    if provider_for_warmup == "parakeet" {
                                        warmup_local_stt_parakeet_model_blocking(
                                            &app_for_warmup,
                                            &python_for_warmup,
                                            &model_for_warmup,
                                        )
                                    } else {
                                        warmup_local_stt_hf_model_blocking(
                                            &app_for_warmup,
                                            &python_for_warmup,
                                            &model_for_warmup,
                                        )
                                    }
                                })
                                .await
                                .map_err(|error| format!("Local STT warmup worker failed: {error}"))
                                .and_then(|result| result)
                            } else {
                                Ok("Warmup skipped.".to_string())
                            };

                            match warmup_result {
                                Ok(warmup_details) => {
                                    let _ = state_for_task.update_local_stt_download_status(
                                        |status| {
                                            status.active = false;
                                            status.completed = true;
                                            status.success = true;
                                            status.model = model_for_task.clone();
                                            status.repo_id = repo_id_for_task.clone();
                                            status.stage = "Download complete.".to_string();
                                            status.message = format!(
                                                "{download_details} Local STT runtime ready ({python_path}). {warmup_details}"
                                            );
                                            status.current_file.clear();
                                            if status.total_bytes > 0 {
                                                status.downloaded_bytes = status.total_bytes;
                                            }
                                            if status.files_total > 0 {
                                                status.files_completed = status.files_total;
                                            }
                                        },
                                    );
                                }
                                Err(warmup_error) => {
                                    let _ = state_for_task.update_local_stt_download_status(
                                        |status| {
                                            status.active = false;
                                            status.completed = true;
                                            status.success = true;
                                            status.model = model_for_task.clone();
                                            status.repo_id = repo_id_for_task.clone();
                                            status.stage = "Download complete (warmup warning)."
                                                .to_string();
                                            status.message = format!(
                                                "{download_details} Local STT runtime ready ({python_path}). Warmup skipped: {}",
                                                clip_text(&single_line(&warmup_error), 360)
                                            );
                                            status.current_file.clear();
                                            if status.total_bytes > 0 {
                                                status.downloaded_bytes = status.total_bytes;
                                            }
                                            if status.files_total > 0 {
                                                status.files_completed = status.files_total;
                                            }
                                        },
                                    );
                                }
                            }
                        }
                        Err(runtime_error) => {
                            let _ = state_for_task.update_local_stt_download_status(|status| {
                                status.active = false;
                                status.completed = true;
                                status.success = false;
                                status.model = model_for_task.clone();
                                status.repo_id = repo_id_for_task.clone();
                                status.stage = "Runtime setup failed.".to_string();
                                status.message = format!(
                                    "{download_details} Runtime setup failed: {}",
                                    clip_text(&single_line(&runtime_error), 420)
                                );
                                status.current_file.clear();
                            });
                        }
                    }
                } else {
                    let native_parakeet_warmup_required = provider_for_task == "parakeet";
                    if native_parakeet_warmup_required {
                        let _ = state_for_task.update_local_stt_download_status(|status| {
                            status.model = model_for_task.clone();
                            status.repo_id = repo_id_for_task.clone();
                            status.stage = "Warming up local STT model...".to_string();
                            status.message =
                                "Loading native Parakeet int8 model so first dictation is fast."
                                    .to_string();
                            status.current_file.clear();
                            if status.total_bytes > 0 {
                                status.downloaded_bytes = status.total_bytes;
                            }
                            if status.files_total > 0 {
                                status.files_completed = status.files_total;
                            }
                        });

                        let app_for_warmup = app_for_task.clone();
                        let model_for_warmup = model_for_task.clone();
                        let warmup_result = tauri::async_runtime::spawn_blocking(move || {
                            warmup_local_stt_parakeet_model_blocking(
                                &app_for_warmup,
                                "",
                                &model_for_warmup,
                            )
                        })
                        .await
                        .map_err(|error| format!("Local STT warmup worker failed: {error}"))
                        .and_then(|result| result);

                        match warmup_result {
                            Ok(warmup_details) => {
                                let _ = state_for_task.update_local_stt_download_status(
                                    |status| {
                                        status.active = false;
                                        status.completed = true;
                                        status.success = true;
                                        status.model = model_for_task.clone();
                                        status.repo_id = repo_id_for_task.clone();
                                        status.stage = "Download complete.".to_string();
                                        status.message = format!(
                                            "{download_details} Native Parakeet runtime ready. {warmup_details}"
                                        );
                                        status.current_file.clear();
                                        if status.total_bytes > 0 {
                                            status.downloaded_bytes = status.total_bytes;
                                        }
                                        if status.files_total > 0 {
                                            status.files_completed = status.files_total;
                                        }
                                    },
                                );
                            }
                            Err(warmup_error) => {
                                let _ = state_for_task.update_local_stt_download_status(
                                    |status| {
                                        status.active = false;
                                        status.completed = true;
                                        status.success = true;
                                        status.model = model_for_task.clone();
                                        status.repo_id = repo_id_for_task.clone();
                                        status.stage = "Download complete (warmup warning)."
                                            .to_string();
                                        status.message = format!(
                                            "{download_details} Native Parakeet warmup skipped: {}",
                                            clip_text(&single_line(&warmup_error), 360)
                                        );
                                        status.current_file.clear();
                                        if status.total_bytes > 0 {
                                            status.downloaded_bytes = status.total_bytes;
                                        }
                                        if status.files_total > 0 {
                                            status.files_completed = status.files_total;
                                        }
                                    },
                                );
                            }
                        }
                    } else {
                        let _ = state_for_task.update_local_stt_download_status(|status| {
                            status.active = false;
                            status.completed = true;
                            status.success = true;
                            status.model = model_for_task.clone();
                            status.repo_id = repo_id_for_task.clone();
                            status.stage = "Download complete.".to_string();
                            status.message = download_details;
                            status.current_file.clear();
                            if status.total_bytes > 0 {
                                status.downloaded_bytes = status.total_bytes;
                            }
                            if status.files_total > 0 {
                                status.files_completed = status.files_total;
                            }
                        });
                    }
                }
            }
            Err(download_error) => {
                let error_text = format!(
                    "Unable to download local STT model '{}' from configured source: {}",
                    clip_text(&repo_id_for_task, 180),
                    clip_text(&single_line(&download_error), 320)
                );
                let _ = state_for_task.update_local_stt_download_status(|status| {
                    status.active = false;
                    status.completed = true;
                    status.success = false;
                    status.model = model_for_task;
                    status.repo_id = repo_id_for_task;
                    status.stage = "Download failed.".to_string();
                    status.message = error_text;
                    status.current_file.clear();
                });
            }
        }
    });

    let provider_runs_runtime_setup = local_stt_provider_requires_python(&provider);
    let provider_runs_native_warmup = provider == "parakeet";
    Ok(LocalSttDownloadResponse {
        model,
        provider,
        method: "background_huggingface_snapshot".to_string(),
        local_path: target_dir.to_string_lossy().into_owned(),
        details: if provider_runs_runtime_setup {
            format!(
                "Started local STT model download for '{repo_id}'. Runtime setup and model warmup will run automatically after download."
            )
        } else if provider_runs_native_warmup {
            format!(
                "Started local STT model download for '{repo_id}'. Native Parakeet int8 warmup will run automatically after download."
            )
        } else {
            format!("Started local STT model download for '{repo_id}'.")
        },
    })
}

#[tauri::command]
async fn get_local_stt_download_status(
    state: State<'_, AppState>,
) -> Result<LocalSttDownloadStatusResponse, String> {
    state.snapshot_local_stt_download_status()
}

#[tauri::command]
async fn delete_local_stt_model(
    app: AppHandle,
    state: State<'_, AppState>,
    request: LocalSttDeleteRequest,
) -> Result<LocalSttDeleteResponse, String> {
    let model = canonical_local_stt_model_id(&normalize_model_name(Some(&request.model)));
    if model.is_empty() {
        return Err("STT model name is required.".to_string());
    }
    let allowed_models = built_in_local_stt_model_catalog();
    if !allowed_models.iter().any(|item| item == &model) {
        return Err("Unsupported local STT model. Select one from the built-in catalog.".to_string());
    }
    let active_status = state.snapshot_local_stt_download_status()?;
    if active_status.active && active_status.model == model {
        return Err("This model is currently downloading. Wait for it to finish before deleting.".to_string());
    }

    let provider = infer_local_stt_provider_from_model(&model);
    let repo_id = resolve_huggingface_repo_id(&provider, &model);
    if provider.eq_ignore_ascii_case("parakeet") {
        let _ = unload_native_parakeet_runtime("delete-model");
        stop_all_local_stt_bridge_daemons();
    }
    let models_dir = stt_models_dir(&app)?;
    let target_dir = models_dir.join(sanitize_model_cache_dir_name(&repo_id));
    let mut paths_to_remove: Vec<PathBuf> = vec![target_dir.clone()];
    if let Some(legacy_repo_id) = legacy_huggingface_repo_id_for_model(&provider, &model) {
        let legacy_dir = models_dir.join(sanitize_model_cache_dir_name(&legacy_repo_id));
        if legacy_dir != target_dir {
            paths_to_remove.push(legacy_dir);
        }
    }
    if model.eq_ignore_ascii_case("nvidia/parakeet-tdt_ctc-110m") {
        let legacy_repo_id = "nvidia/parakeet-tdt-0.6b-v2";
        let legacy_dir = models_dir.join(sanitize_model_cache_dir_name(legacy_repo_id));
        if legacy_dir != target_dir {
            paths_to_remove.push(legacy_dir);
        }
    }
    let mut removed_any = false;
    let mut removed_legacy = false;
    for remove_path in paths_to_remove {
        if !remove_path.exists() {
            continue;
        }
        if remove_path.is_dir() {
            fs::remove_dir_all(&remove_path).map_err(|error| {
                format!(
                    "Failed to delete local STT model directory '{}': {error}",
                    remove_path.display()
                )
            })?;
        } else {
            fs::remove_file(&remove_path).map_err(|error| {
                format!(
                    "Failed to delete local STT model file '{}': {error}",
                    remove_path.display()
                )
            })?;
        }
        removed_any = true;
        if remove_path != target_dir {
            removed_legacy = true;
        }
    }

    if !removed_any {
        return Ok(LocalSttDeleteResponse {
            model,
            repo_id,
            removed: false,
            local_path: target_dir.to_string_lossy().into_owned(),
            details: "Model files were not found in local cache.".to_string(),
        });
    }

    let details = if removed_legacy {
        "Local STT model files deleted (including legacy Parakeet v2 cache).".to_string()
    } else {
        "Local STT model files deleted.".to_string()
    };

    Ok(LocalSttDeleteResponse {
        model,
        repo_id,
        removed: true,
        local_path: target_dir.to_string_lossy().into_owned(),
        details,
    })
}

#[tauri::command]
async fn open_local_stt_model_path(
    app: AppHandle,
    request: LocalSttDeleteRequest,
) -> Result<LocalSttOpenPathResponse, String> {
    let model = canonical_local_stt_model_id(&normalize_model_name(Some(&request.model)));
    if model.is_empty() {
        return Err("STT model name is required.".to_string());
    }
    let allowed_models = built_in_local_stt_model_catalog();
    if !allowed_models.iter().any(|item| item == &model) {
        return Err("Unsupported local STT model. Select one from the built-in catalog.".to_string());
    }

    let provider = infer_local_stt_provider_from_model(&model);
    let (repo_id, target_dir) = resolve_local_stt_repo_and_dir(&app, &provider, &model)?;
    if !target_dir.exists() {
        return Ok(LocalSttOpenPathResponse {
            model,
            repo_id,
            local_path: target_dir.to_string_lossy().into_owned(),
            opened: false,
            details: "Model files are not downloaded yet.".to_string(),
        });
    }

    open_path_in_file_explorer(&target_dir)?;
    Ok(LocalSttOpenPathResponse {
        model,
        repo_id,
        local_path: target_dir.to_string_lossy().into_owned(),
        opened: true,
        details: "Opened local model directory in file explorer.".to_string(),
    })
}

#[tauri::command]
async fn warmup_local_stt_model(
    app: AppHandle,
    state: State<'_, AppState>,
    request: LocalSttWarmupRequest,
) -> Result<LocalSttWarmupResponse, String> {
    let model = canonical_local_stt_model_id(&normalize_model_name(Some(&request.model)));
    if model.is_empty() {
        return Err("STT model name is required.".to_string());
    }
    let allowed_models = built_in_local_stt_model_catalog();
    if !allowed_models.iter().any(|item| item == &model) {
        return Err("Unsupported local STT model. Select one from the built-in catalog.".to_string());
    }

    let provider = infer_local_stt_provider_from_model(&model);
    let (_repo_id, model_dir) = resolve_local_stt_repo_and_dir(&app, &provider, &model)?;
    if !model_dir.exists() {
        return Ok(LocalSttWarmupResponse {
            model,
            provider,
            warmed: false,
            details: "Model files are not downloaded yet.".to_string(),
        });
    }

    let app_for_worker = app.clone();
    let model_for_worker = model.clone();
    let provider_for_worker = provider.clone();
    let warmup_result = tauri::async_runtime::spawn_blocking(move || {
        match provider_for_worker.as_str() {
            "parakeet" => {
                warmup_local_stt_parakeet_model_blocking(&app_for_worker, "", &model_for_worker)
            }
            "whisper" | "moonshine" | "sensevoice" => {
                if zero_python_mode_enabled() {
                    return Err(ZERO_PYTHON_STT_NOTICE.to_string());
                }
                let python_path = setup_local_stt_runtime_blocking(&app_for_worker, "python")?;
                warmup_local_stt_hf_model_blocking(&app_for_worker, &python_path, &model_for_worker)
            }
            _ => Ok("Warmup skipped (unsupported provider).".to_string()),
        }
    })
    .await
    .map_err(|error| format!("Local STT warmup task failed: {error}"));

    match warmup_result {
        Ok(Ok(details)) => {
            let _ = state.set_local_stt_runtime_loaded(true);
            Ok(LocalSttWarmupResponse {
                model,
                provider,
                warmed: true,
                details,
            })
        }
        Ok(Err(error)) => Ok(LocalSttWarmupResponse {
            model,
            provider,
            warmed: false,
            details: format!("Warmup failed: {}", clip_text(&single_line(&error), 360)),
        }),
        Err(worker_error) => Ok(LocalSttWarmupResponse {
            model,
            provider,
            warmed: false,
            details: format!(
                "Warmup failed: {}",
                clip_text(&single_line(&worker_error), 360)
            ),
        }),
    }
}

#[tauri::command]
async fn deactivate_local_stt_model(
    state: State<'_, AppState>,
    request: LocalSttDeactivateRequest,
) -> Result<LocalSttDeactivateResponse, String> {
    let model = canonical_local_stt_model_id(&normalize_model_name(request.model.as_deref()));
    let (model_for_response, provider_for_response) = if model.is_empty() {
        (String::new(), "unknown".to_string())
    } else {
        let allowed_models = built_in_local_stt_model_catalog();
        if !allowed_models.iter().any(|item| item == &model) {
            return Err("Unsupported local STT model. Select one from the built-in catalog.".to_string());
        }
        let provider = infer_local_stt_provider_from_model(&model);
        (model, provider)
    };

    let worker_result = tauri::async_runtime::spawn_blocking(move || {
        let (trimmed_count, stopped_during_trim) = trim_all_local_stt_bridge_daemon_model_caches()?;
        let fully_stopped = stop_all_local_stt_bridge_daemons_with_count();
        let native_unloaded = unload_native_parakeet_runtime("manual-deactivate").unwrap_or(false);
        Ok::<(usize, usize, usize, bool), String>((
            trimmed_count,
            stopped_during_trim,
            fully_stopped,
            native_unloaded,
        ))
    })
    .await
    .map_err(|error| format!("Local STT deactivate task failed: {error}"))??;
    let (trimmed_count, stopped_during_trim, fully_stopped, native_unloaded) = worker_result;
    let deactivated = trimmed_count > 0 || stopped_during_trim > 0 || fully_stopped > 0 || native_unloaded;

    let details = if deactivated {
        if model_for_response.is_empty() {
            format!(
                "Deactivated local STT runtime (native_unloaded={}, trimmed {} cache daemon(s), restarted {}, fully stopped {}).",
                native_unloaded, trimmed_count, stopped_during_trim, fully_stopped
            )
        } else {
            format!(
                "Deactivated local STT runtime for '{}' (native_unloaded={}, trimmed {} cache daemon(s), restarted {}, fully stopped {}).",
                model_for_response, native_unloaded, trimmed_count, stopped_during_trim, fully_stopped
            )
        }
    } else {
        if model_for_response.is_empty() {
            "Local STT runtime was already inactive in memory.".to_string()
        } else {
            format!(
                "Local STT model '{}' was already inactive in memory.",
                model_for_response
            )
        }
    };
    let _ = state.set_local_stt_runtime_loaded(false);

    Ok(LocalSttDeactivateResponse {
        model: model_for_response,
        provider: provider_for_response,
        deactivated,
        details,
    })
}

#[tauri::command]
async fn get_local_stt_runtime_state(
    state: State<'_, AppState>,
) -> Result<LocalSttRuntimeStateResponse, String> {
    let (daemon_count, loaded_daemon_count) = {
        let registry = local_stt_daemons();
        let guard = registry
            .lock()
            .map_err(|_| "Failed to lock local STT daemon registry.".to_string())?;
        let daemon_count = guard.len();
        let loaded_daemon_count = guard.values().filter(|daemon| daemon.model_loaded).count();
        (daemon_count, loaded_daemon_count)
    };

    let native_loaded = native_parakeet_runtime_loaded();
    let loaded = state.local_stt_runtime_loaded_snapshot()?;
    let details = if loaded {
        format!(
            "Local STT is loaded (native_parakeet_loaded={}, {} active model cache daemon(s), {} daemon(s) total).",
            native_loaded,
            loaded_daemon_count,
            daemon_count
        )
    } else if daemon_count > 0 || native_loaded {
        format!(
            "Local STT is unloaded (native_parakeet_loaded={}, {} warm daemon(s) remain ready).",
            native_loaded, daemon_count
        )
    } else {
        "Local STT is unloaded.".to_string()
    };

    Ok(LocalSttRuntimeStateResponse {
        loaded,
        daemon_count,
        loaded_daemon_count,
        details,
    })
}

#[tauri::command]
async fn get_local_stt_hardware_advice(
    request: LocalSttHardwareAdviceRequest,
) -> Result<LocalSttHardwareAdviceResponse, String> {
    let selected_model = request.selected_model;
    let advice = tauri::async_runtime::spawn_blocking(move || {
        build_local_stt_hardware_advice(selected_model)
    })
    .await
    .map_err(|error| format!("Local STT hardware probe task failed: {error}"))?;

    info!(
        "[local.stt.hardware] tier={} ram_gb={:.1} logical_cores={} nvidia_gpu={} gpu={} gpu_vram_gb={:.1} suggestion={}",
        advice.performance_tier,
        advice.total_ram_gb,
        advice.logical_cores,
        advice.nvidia_gpu_detected,
        if advice.gpu_name.trim().is_empty() {
            "none"
        } else {
            advice.gpu_name.as_str()
        },
        advice.gpu_vram_gb,
        advice.slasshy_suggestion_model
    );

    Ok(advice)
}

#[tauri::command]
async fn setup_assistant_runtime(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RuntimeSetupResponse, String> {
    let piper_path = ensure_piper_binary(&app, &state.http).await?;
    let (voice_model_path, voice_config_path) = ensure_voice_files(&app, &state.http).await?;

    Ok(RuntimeSetupResponse {
        piper_path: piper_path.to_string_lossy().into_owned(),
        voice_model_path: voice_model_path.to_string_lossy().into_owned(),
        voice_config_path: voice_config_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
async fn ensure_voice_model(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<VoiceInstallResponse, String> {
    let (model_path, config_path) = ensure_voice_files(&app, &state.http).await?;

    Ok(VoiceInstallResponse {
        model_path: model_path.to_string_lossy().into_owned(),
        config_path: config_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
async fn validate_piper(
    app: AppHandle,
    request: PiperValidationRequest,
) -> Result<PiperValidationResponse, String> {
    let piper_path = resolve_piper_path(&app, request.piper_path.as_deref())?;

    let output = tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new(&piper_path);
        apply_no_window(&mut command);
        command
            .arg("--help")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command
            .output()
            .map_err(|error| format!("Failed to execute Piper at '{piper_path}': {error}"))
    })
    .await
    .map_err(|error| format!("Piper validation task failed: {error}"))??;

    let status_ok = output.status.success();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let merged = if stdout.trim().is_empty() {
        stderr.as_ref()
    } else {
        stdout.as_ref()
    };

    Ok(PiperValidationResponse {
        ok: status_ok,
        details: clip_text(merged.trim(), 400),
    })
}

#[tauri::command]
async fn get_coqui_status(
    app: AppHandle,
    request: CoquiStatusRequest,
) -> Result<CoquiStatusResponse, String> {
    if zero_python_mode_enabled() {
        let voice_dir = coqui_voices_dir(&app)?;
        return Ok(CoquiStatusResponse {
            available: false,
            python_path: String::new(),
            tts_version: String::new(),
            cuda_available: false,
            voice_dir: voice_dir.to_string_lossy().into_owned(),
            voices: Vec::new(),
            default_model: COQUI_DEFAULT_MODEL,
            error: ZERO_PYTHON_COQUI_NOTICE.to_string(),
        });
    }

    let python_path = resolve_coqui_python_path(&app, request.python_path.as_deref())?;
    let voice_dir = coqui_voices_dir(&app)?;

    let app_for_worker = app.clone();
    let python_for_worker = python_path.clone();
    let voice_dir_for_worker = voice_dir.clone();
    let payload = json!({
      "action": "status",
      "voiceDir": voice_dir_for_worker.to_string_lossy().to_string(),
    });

    let result = tauri::async_runtime::spawn_blocking(move || {
        run_coqui_bridge(&app_for_worker, &python_for_worker, payload)
    })
    .await
    .map_err(|error| format!("Coqui status worker failed: {error}"))??;

    let available = result
        .get("available")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let tts_version = result
        .get("ttsVersion")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let cuda_available = result
        .get("cudaAvailable")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let bridge_python = result
        .get("pythonPath")
        .and_then(Value::as_str)
        .unwrap_or(&python_path)
        .to_string();
    let bridge_voice_dir = result
        .get("voiceDir")
        .and_then(Value::as_str)
        .unwrap_or_else(|| voice_dir.to_str().unwrap_or_default())
        .to_string();
    let voices = value_string_array(result.get("voices"));
    let error = result
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    if available {
        info!(
            "[coqui.status] ready version={} cuda={} voices={}",
            tts_version,
            cuda_available,
            voices.len()
        );
    } else if !error.trim().is_empty() {
        warn!(
            "[coqui.status] unavailable error={}",
            clip_text(&single_line(&error), 420)
        );
    } else {
        warn!("[coqui.status] unavailable without explicit error");
    }

    Ok(CoquiStatusResponse {
        available,
        python_path: bridge_python,
        tts_version,
        cuda_available,
        voice_dir: bridge_voice_dir,
        voices,
        default_model: COQUI_DEFAULT_MODEL,
        error,
    })
}

#[tauri::command]
async fn setup_coqui_runtime(
    app: AppHandle,
    request: CoquiSetupRequest,
) -> Result<CoquiSetupResponse, String> {
    if zero_python_mode_enabled() {
        let _ = app;
        let _ = request;
        return Err(ZERO_PYTHON_COQUI_NOTICE.to_string());
    }

    let bootstrap_python = request
        .python_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("python")
        .to_string();
    validate_python_binary_path(&bootstrap_python)?;
    let use_gpu = request.use_gpu.unwrap_or(false);

    let app_for_worker = app.clone();
    let setup_result = tauri::async_runtime::spawn_blocking(move || {
        setup_coqui_runtime_blocking(&app_for_worker, &bootstrap_python, use_gpu)
    })
    .await
    .map_err(|error| format!("Coqui setup worker failed: {error}"))??;

    Ok(CoquiSetupResponse {
        python_path: setup_result.0,
        details: setup_result.1,
    })
}

#[tauri::command]
async fn validate_coqui(
    app: AppHandle,
    request: CoquiValidationRequest,
) -> Result<CoquiValidationResponse, String> {
    if zero_python_mode_enabled() {
        let _ = app;
        let _ = request;
        return Ok(CoquiValidationResponse {
            ok: false,
            details: ZERO_PYTHON_COQUI_NOTICE.to_string(),
        });
    }

    let status = get_coqui_status(
        app,
        CoquiStatusRequest {
            python_path: request.python_path,
        },
    )
    .await?;

    if status.available {
        let version = if status.tts_version.trim().is_empty() {
            "unknown".to_string()
        } else {
            status.tts_version
        };
        let details = format!(
            "Coqui is ready (version {version}). CUDA available: {}.",
            if status.cuda_available { "yes" } else { "no" }
        );
        return Ok(CoquiValidationResponse { ok: true, details });
    }

    let details = if status.error.trim().is_empty() {
        "Coqui runtime is not ready.".to_string()
    } else {
        status.error
    };

    Ok(CoquiValidationResponse { ok: false, details })
}

#[tauri::command]
async fn list_coqui_voices(
    app: AppHandle,
    request: CoquiVoicesRequest,
) -> Result<CoquiVoicesResponse, String> {
    if zero_python_mode_enabled() {
        let _ = request;
        let voice_dir = coqui_voices_dir(&app)?;
        return Ok(CoquiVoicesResponse {
            voice_dir: voice_dir.to_string_lossy().into_owned(),
            voices: Vec::new(),
        });
    }

    let _python_hint = request.python_path;
    let voice_dir = coqui_voices_dir(&app)?;
    let voices = list_coqui_voice_ids(&voice_dir)?;

    Ok(CoquiVoicesResponse {
        voice_dir: voice_dir.to_string_lossy().into_owned(),
        voices,
    })
}

#[tauri::command]
async fn list_coqui_models(
    app: AppHandle,
    request: CoquiModelsRequest,
) -> Result<CoquiModelsResponse, String> {
    if zero_python_mode_enabled() {
        let _ = app;
        let _ = request;
        return Ok(CoquiModelsResponse {
            models: vec![COQUI_DEFAULT_MODEL.to_string()],
        });
    }

    let python_path = resolve_coqui_python_path(&app, request.python_path.as_deref())?;
    let voice_dir = coqui_voices_dir(&app)?;
    let app_for_worker = app.clone();
    let python_for_worker = python_path.clone();
    let payload = json!({
      "action": "list_models",
      "voiceDir": voice_dir.to_string_lossy().to_string(),
      "defaultModel": COQUI_DEFAULT_MODEL,
    });

    let result = tauri::async_runtime::spawn_blocking(move || {
        run_coqui_bridge(&app_for_worker, &python_for_worker, payload)
    })
    .await
    .map_err(|error| format!("Coqui model listing worker failed: {error}"))??;

    let models = value_string_array(result.get("models"));
    info!("[coqui.models] loaded {} models", models.len());
    Ok(CoquiModelsResponse { models })
}

#[tauri::command]
async fn clone_coqui_voice(
    app: AppHandle,
    request: CoquiVoiceCloneRequest,
) -> Result<CoquiVoiceCloneResponse, String> {
    if zero_python_mode_enabled() {
        let _ = app;
        let _ = request;
        return Err(ZERO_PYTHON_COQUI_NOTICE.to_string());
    }

    let speaker_id = sanitize_coqui_speaker_id(&request.speaker_id)?;
    let requested_file = request.file_name.as_deref().unwrap_or_default().to_string();
    info!(
        "[coqui.clone] request speaker={} model_hint={} file={} gpu={}",
        speaker_id,
        request.model_name.as_deref().unwrap_or_default(),
        requested_file,
        request.use_gpu.unwrap_or(false)
    );
    let audio_bytes = BASE64_STANDARD
        .decode(request.audio_base64.as_bytes())
        .map_err(|error| format!("Failed to decode uploaded voice sample: {error}"))?;

    if audio_bytes.is_empty() {
        warn!(
            "[coqui.clone] rejected empty sample for speaker={}",
            speaker_id
        );
        return Err("Uploaded voice sample is empty".to_string());
    }

    let model_name = request
        .model_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(COQUI_DEFAULT_MODEL)
        .to_string();
    let language = request
        .language
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(COQUI_DEFAULT_LANGUAGE)
        .to_string();
    let python_path = resolve_coqui_python_path(&app, request.python_path.as_deref())?;
    let use_gpu = request.use_gpu.unwrap_or(false);

    let uploads_dir = coqui_uploads_dir(&app)?;
    let previews_dir = coqui_previews_dir(&app)?;
    let voice_dir = coqui_voices_dir(&app)?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Failed to compute timestamp: {error}"))?
        .as_millis();
    let extension =
        extension_from_file_name(request.file_name.as_deref()).unwrap_or_else(|| "wav".to_string());
    let upload_path = uploads_dir.join(format!("sample-{stamp}.{extension}"));
    let preview_path = previews_dir.join(format!("preview-{speaker_id}-{stamp}.wav"));

    fs::write(&upload_path, &audio_bytes)
        .map_err(|error| format!("Failed to store uploaded voice sample: {error}"))?;
    info!(
        "[coqui.clone] stored sample speaker={} bytes={} upload={} preview={}",
        speaker_id,
        audio_bytes.len(),
        upload_path.to_string_lossy(),
        preview_path.to_string_lossy()
    );

    let app_for_worker = app.clone();
    let python_for_worker = python_path.clone();
    let upload_path_for_worker = upload_path.clone();
    let preview_path_for_worker = preview_path.clone();
    let voice_dir_for_worker = voice_dir.clone();
    let payload = json!({
      "action": "clone_voice",
      "modelName": model_name,
      "language": language,
      "speakerId": speaker_id,
      "referenceAudioPath": upload_path_for_worker.to_string_lossy().to_string(),
      "voiceDir": voice_dir_for_worker.to_string_lossy().to_string(),
      "previewOutputPath": preview_path_for_worker.to_string_lossy().to_string(),
      "useGpu": use_gpu,
      "maxReferenceSeconds": COQUI_MAX_REFERENCE_SECONDS,
    });

    info!("[coqui.clone] invoking bridge");
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_coqui_bridge(&app_for_worker, &python_for_worker, payload)
    })
    .await
    .map_err(|error| format!("Coqui clone worker failed: {error}"))??;

    let duration_seconds = result
        .get("durationSeconds")
        .and_then(Value::as_f64)
        .unwrap_or(0.0) as f32;
    let device = result
        .get("device")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let model_cached = result
        .get("modelCached")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let speaker_id = result
        .get("speakerId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let voices = {
        let from_result = value_string_array(result.get("voices"));
        if from_result.is_empty() {
            list_coqui_voice_ids(&voice_dir)?
        } else {
            from_result
        }
    };
    let preview_audio_base64 = if file_exists_with_content(&preview_path) {
        let bytes = fs::read(&preview_path)
            .map_err(|error| format!("Failed to read generated voice preview: {error}"))?;
        BASE64_STANDARD.encode(bytes)
    } else {
        String::new()
    };

    let _ = fs::remove_file(&upload_path);
    info!(
        "[coqui.clone] success speaker={} duration={} device={} model_cached={} voices={} preview={}",
        speaker_id,
        duration_seconds,
        device,
        model_cached,
        voices.len(),
        if preview_audio_base64.is_empty() {
            "missing"
        } else {
            "present"
        }
    );

    Ok(CoquiVoiceCloneResponse {
        speaker_id,
        duration_seconds,
        voice_dir: voice_dir.to_string_lossy().into_owned(),
        voices,
        preview_audio_base64,
    })
}

#[tauri::command]
async fn preview_coqui_voice(
    app: AppHandle,
    request: CoquiVoicePreviewRequest,
) -> Result<CoquiVoicePreviewResponse, String> {
    if zero_python_mode_enabled() {
        let _ = app;
        let _ = request;
        return Err(ZERO_PYTHON_COQUI_NOTICE.to_string());
    }

    let speaker_id = request
        .speaker_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Select a Coqui voice profile before testing.".to_string())?
        .to_string();
    let text = request
        .text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("This is a preview of your selected cloned voice.")
        .to_string();

    let coqui = CoquiPipelineRequest {
        python_path: request.python_path,
        model_name: request.model_name,
        language: request.language,
        speaker_id: Some(speaker_id.clone()),
        speed: request.speed,
        quality: request.quality,
        emotion: request.emotion,
        use_gpu: request.use_gpu,
        split_sentences: request.split_sentences,
    };

    info!(
        "[coqui.preview] start speaker={} model={}",
        speaker_id,
        coqui.model_name.as_deref().unwrap_or(COQUI_DEFAULT_MODEL)
    );
    let wav_bytes = synthesize_with_coqui(&app, &coqui, text.clone()).await?;
    info!(
        "[coqui.preview] success speaker={} bytes={}",
        speaker_id,
        wav_bytes.len()
    );

    Ok(CoquiVoicePreviewResponse {
        audio_base64: BASE64_STANDARD.encode(wav_bytes),
        text,
    })
}

#[tauri::command]
async fn start_tts_runtime_setup(
    app: AppHandle,
    state: State<'_, AppState>,
    setup_state: State<'_, TtsSetupState>,
    request: TtsSetupStartRequest,
) -> Result<TtsSetupStatusResponse, String> {
    let setup = setup_state.clone_handle();
    let snapshot = setup.snapshot();
    if snapshot.running {
        return Ok(snapshot);
    }

    let http = state.http.clone();
    let app_for_task = app.clone();
    let setup_for_task = setup.clone_handle();
    let bootstrap_python = request
        .python_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("python")
        .to_string();
    if let Err(error) = validate_python_binary_path(&bootstrap_python) {
        return Err(error);
    }
    let use_gpu = request.use_gpu.unwrap_or(false);

    setup.reset_and_start();
    setup.append_log(format!(
        "Bootstrap config -> python: '{bootstrap_python}', gpu: {}",
        if use_gpu { "enabled" } else { "disabled" }
    ));

    tauri::async_runtime::spawn(async move {
        setup_for_task.set_stage("Setting up Piper runtime...");
        setup_for_task.append_log("Downloading/extracting Piper runtime if missing...");
        let piper_path = match ensure_piper_binary(&app_for_task, &http).await {
            Ok(path) => path,
            Err(error) => {
                setup_for_task.append_log(format!("Piper setup failed: {error}"));
                setup_for_task.complete(false, "Piper setup failed.");
                return;
            }
        };
        setup_for_task.append_log(format!(
            "Piper runtime ready at {}",
            piper_path.to_string_lossy()
        ));

        setup_for_task.set_stage("Downloading Piper voice model...");
        setup_for_task.append_log("Ensuring Piper voice files are installed...");
        let (voice_model_path, _) = match ensure_voice_files(&app_for_task, &http).await {
            Ok(paths) => paths,
            Err(error) => {
                setup_for_task.append_log(format!("Piper voice setup failed: {error}"));
                setup_for_task.complete(false, "Piper voice setup failed.");
                return;
            }
        };
        setup_for_task.append_log(format!(
            "Piper voice ready at {}",
            voice_model_path.to_string_lossy()
        ));

        if zero_python_mode_enabled() {
            setup_for_task.append_log("Skipping Coqui setup (zero-Python mode).".to_string());
            setup_for_task.complete(true, "TTS setup complete (Piper only).");
            return;
        }

        setup_for_task.set_stage("Setting up Coqui runtime...");
        setup_for_task.append_log("Creating Coqui environment and installing packages...");
        let coqui_setup = tauri::async_runtime::spawn_blocking({
            let app_for_blocking = app_for_task.clone();
            let python = bootstrap_python.clone();
            move || setup_coqui_runtime_blocking(&app_for_blocking, &python, use_gpu)
        })
        .await;

        let (coqui_python, coqui_details) = match coqui_setup {
            Ok(Ok(result)) => result,
            Ok(Err(error)) => {
                setup_for_task.append_log(format!("Coqui setup failed: {error}"));
                setup_for_task.complete(false, "Coqui setup failed.");
                return;
            }
            Err(error) => {
                setup_for_task.append_log(format!("Coqui setup worker failed: {error}"));
                setup_for_task.complete(false, "Coqui setup worker failed.");
                return;
            }
        };
        setup_for_task.append_log(format!("Coqui runtime ready with python: {coqui_python}"));
        if !coqui_details.trim().is_empty() {
            setup_for_task.append_log(format!(
                "Coqui install log: {}",
                clip_text(&single_line(&coqui_details), 420)
            ));
        }

        setup_for_task.set_stage("Validating Coqui runtime...");
        let coqui_status = tauri::async_runtime::spawn_blocking({
            let app_for_blocking = app_for_task.clone();
            let python_for_blocking = coqui_python.clone();
            move || {
                let voice_dir = coqui_voices_dir(&app_for_blocking)?;
                let payload = json!({
                  "action": "status",
                  "voiceDir": voice_dir.to_string_lossy().to_string(),
                });
                run_coqui_bridge(&app_for_blocking, &python_for_blocking, payload)
            }
        })
        .await;

        let (coqui_available, coqui_error) = match coqui_status {
            Ok(Ok(result)) => (
                result
                    .get("available")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                result
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            ),
            Ok(Err(error)) => {
                setup_for_task.append_log(format!("Coqui status check failed: {error}"));
                setup_for_task.complete(false, "Coqui validation failed.");
                return;
            }
            Err(error) => {
                setup_for_task.append_log(format!("Coqui status worker failed: {error}"));
                setup_for_task.complete(false, "Coqui validation worker failed.");
                return;
            }
        };

        if !coqui_available {
            let error_text = if coqui_error.trim().is_empty() {
                "unknown Coqui status error".to_string()
            } else {
                coqui_error
            };
            setup_for_task.append_log(format!(
                "Coqui reported unavailable after setup: {}",
                clip_text(&single_line(&error_text), 420)
            ));
            setup_for_task.complete(false, "Coqui unavailable after setup.");
            return;
        }

        setup_for_task.append_log("Coqui validation succeeded.".to_string());
        setup_for_task.complete(true, "TTS setup complete.");
    });

    Ok(setup.snapshot())
}

#[tauri::command]
async fn get_tts_runtime_setup_status(
    setup_state: State<'_, TtsSetupState>,
) -> Result<TtsSetupStatusResponse, String> {
    Ok(setup_state.snapshot())
}

fn wake_name_tokens(raw_name: &str) -> Vec<String> {
    raw_name
        .split(|character: char| !character.is_ascii_alphanumeric())
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(|token| token.to_ascii_lowercase())
        .collect()
}

fn skip_non_alphanumeric(input: &str, mut index: usize) -> usize {
    while index < input.len() {
        let mut iterator = input[index..].chars();
        let Some(character) = iterator.next() else {
            break;
        };
        if character.is_ascii_alphanumeric() {
            break;
        }
        index += character.len_utf8();
    }
    index
}

fn consume_next_ascii_token(input: &str, index: usize) -> Option<(String, usize)> {
    let mut cursor = skip_non_alphanumeric(input, index);
    if cursor >= input.len() {
        return None;
    }

    let mut token = String::new();
    while cursor < input.len() {
        let mut iterator = input[cursor..].chars();
        let current = iterator.next()?;
        if !current.is_ascii_alphanumeric() {
            break;
        }
        token.push(current.to_ascii_lowercase());
        cursor += current.len_utf8();
    }

    if token.is_empty() {
        return None;
    }

    Some((token, cursor))
}

fn within_one_edit_ascii(a: &str, b: &str) -> bool {
    if a.eq_ignore_ascii_case(b) {
        return true;
    }

    let a = a.to_ascii_lowercase();
    let b = b.to_ascii_lowercase();
    let a_bytes = a.as_bytes();
    let b_bytes = b.as_bytes();
    let a_len = a_bytes.len();
    let b_len = b_bytes.len();

    if a_len.abs_diff(b_len) > 1 {
        return false;
    }

    if a_len == b_len {
        let mut mismatches = 0usize;
        for index in 0..a_len {
            if a_bytes[index] != b_bytes[index] {
                mismatches += 1;
                if mismatches > 1 {
                    return false;
                }
            }
        }
        return mismatches <= 1;
    }

    let (shorter, longer) = if a_len < b_len {
        (a_bytes, b_bytes)
    } else {
        (b_bytes, a_bytes)
    };

    let mut short_index = 0usize;
    let mut long_index = 0usize;
    let mut skipped = false;
    while short_index < shorter.len() && long_index < longer.len() {
        if shorter[short_index] == longer[long_index] {
            short_index += 1;
            long_index += 1;
            continue;
        }
        if skipped {
            return false;
        }
        skipped = true;
        long_index += 1;
    }

    true
}

fn within_n_edits_ascii(a: &str, b: &str, max_edits: usize) -> bool {
    if a.eq_ignore_ascii_case(b) {
        return true;
    }

    let a = a.to_ascii_lowercase();
    let b = b.to_ascii_lowercase();
    let a_bytes = a.as_bytes();
    let b_bytes = b.as_bytes();
    let a_len = a_bytes.len();
    let b_len = b_bytes.len();
    if a_len.abs_diff(b_len) > max_edits {
        return false;
    }

    let mut previous: Vec<usize> = (0..=b_len).collect();
    let mut current: Vec<usize> = vec![0; b_len + 1];

    for (row_index, a_byte) in a_bytes.iter().enumerate() {
        current[0] = row_index + 1;
        let mut row_min = current[0];
        for (col_index, b_byte) in b_bytes.iter().enumerate() {
            let substitution_cost = if a_byte == b_byte { 0 } else { 1 };
            let deletion = previous[col_index + 1] + 1;
            let insertion = current[col_index] + 1;
            let substitution = previous[col_index] + substitution_cost;
            let next = deletion.min(insertion).min(substitution);
            current[col_index + 1] = next;
            row_min = row_min.min(next);
        }
        if row_min > max_edits {
            return false;
        }
        std::mem::swap(&mut previous, &mut current);
    }

    previous[b_len] <= max_edits
}

fn ascii_consonant_signature(raw: &str) -> String {
    let mut output = String::new();
    let mut last: Option<char> = None;
    for character in raw.chars() {
        if !character.is_ascii_alphabetic() {
            continue;
        }
        let lowered = character.to_ascii_lowercase();
        if matches!(lowered, 'a' | 'e' | 'i' | 'o' | 'u') {
            continue;
        }
        if Some(lowered) == last {
            continue;
        }
        output.push(lowered);
        last = Some(lowered);
    }
    output
}

fn assistant_name_token_matches(expected: &str, actual: &str) -> bool {
    if expected.eq_ignore_ascii_case(actual) {
        return true;
    }

    if expected.len() < 3 || actual.len() < 3 {
        return false;
    }

    if within_one_edit_ascii(expected, actual) {
        return true;
    }

    let expected_normalized = expected.to_ascii_lowercase();
    let actual_normalized = actual.to_ascii_lowercase();
    if expected_normalized.len() <= 5 && within_n_edits_ascii(&expected_normalized, &actual_normalized, 2)
    {
        return true;
    }

    if let Some(tail) = actual_normalized.strip_prefix('h') {
        if !tail.is_empty() && within_n_edits_ascii(&expected_normalized, tail, 2) {
            return true;
        }

        let expected_signature = ascii_consonant_signature(&expected_normalized);
        let tail_signature = ascii_consonant_signature(tail);
        if !expected_signature.is_empty() && !tail_signature.is_empty() {
            let starts_alike = expected_signature
                .chars()
                .next()
                .zip(tail_signature.chars().next())
                .map(|(left, right)| left == right)
                .unwrap_or(false);
            if starts_alike && within_n_edits_ascii(&expected_signature, &tail_signature, 1) {
                return true;
            }
        }
    }

    false
}

fn consume_assistant_name_token(input: &str, index: usize, expected: &str) -> Option<usize> {
    let (actual, next_cursor) = consume_next_ascii_token(input, index)?;
    if assistant_name_token_matches(expected, &actual) {
        Some(next_cursor)
    } else {
        None
    }
}

fn wake_prefix_token_matches(expected: &str, actual: &str) -> bool {
    if expected.eq_ignore_ascii_case(actual) {
        return true;
    }

    let expected_normalized = expected.to_ascii_lowercase();
    let actual_normalized = actual.to_ascii_lowercase();
    if (expected_normalized == "ok" && actual_normalized == "okay")
        || (expected_normalized == "okay" && actual_normalized == "ok")
    {
        return true;
    }

    if expected_normalized.len() >= 3
        && within_one_edit_ascii(&expected_normalized, &actual_normalized)
    {
        return true;
    }

    false
}

fn is_optional_wake_leading_filler(token: &str) -> bool {
    matches!(
        token,
        "um" | "uh" | "umm" | "hmm" | "hm" | "ah" | "so" | "well" | "please"
    )
}

fn extract_wake_command(transcript: &str, assistant_name: &str) -> Option<String> {
    let mut name_tokens = wake_name_tokens(assistant_name);
    if name_tokens.is_empty() {
        name_tokens.push("lily".to_string());
    }
    let wake_prefixes: [&[&str]; 5] = [&["hey"], &["hi"], &["hello"], &["ok"], &["okay"]];

    let trimmed = transcript.trim_start();
    let start_cursor = transcript.len().saturating_sub(trimmed.len());
    let mut candidate_cursors = vec![start_cursor];
    let mut filler_cursor = start_cursor;
    for _ in 0..3 {
        let Some((token, next_cursor)) = consume_next_ascii_token(transcript, filler_cursor) else {
            break;
        };
        if !is_optional_wake_leading_filler(&token) {
            break;
        }
        candidate_cursors.push(next_cursor);
        filler_cursor = next_cursor;
    }

    for prefix in wake_prefixes {
        for prefix_start in &candidate_cursors {
            let mut cursor = *prefix_start;
            let mut matched = true;

            for token in prefix {
                let Some((actual, next_cursor)) = consume_next_ascii_token(transcript, cursor)
                else {
                    matched = false;
                    break;
                };
                if !wake_prefix_token_matches(token, &actual) {
                    matched = false;
                    break;
                }
                cursor = next_cursor;
            }

            if !matched {
                continue;
            }

            for token in &name_tokens {
                let Some(next_cursor) = consume_assistant_name_token(transcript, cursor, token)
                else {
                    matched = false;
                    break;
                };
                cursor = next_cursor;
            }

            if !matched {
                continue;
            }

            let remainder = transcript[cursor..]
                .trim_start_matches(|character: char| {
                    character.is_whitespace() || matches!(character, ',' | ':' | ';' | '-' | '.')
                })
                .trim()
                .to_string();
            return Some(remainder);
        }
    }

    None
}

fn resolve_pipeline_mode(request: &AssistantPipelineRequest) -> Result<PipelineModeConfig, String> {
    let legacy_local_mode = request.local_mode.unwrap_or(false);
    let stt_local_mode = request.stt_local_mode.unwrap_or(legacy_local_mode);
    let ai_local_mode = request.ai_local_mode.unwrap_or(legacy_local_mode);
    let requires_online_provider = !stt_local_mode || !ai_local_mode;

    let (api_key, api_base_url) = if requires_online_provider {
        let api_key = normalize_api_key_secret(&request.api_key);
        if api_key.is_empty() {
            return Err("API key is required for online STT/AI mode.".to_string());
        }
        let api_base_url = normalize_api_base_url(request.api_base_url.as_deref());
        if api_base_url.is_empty() {
            return Err(
                "API base URL is required for online STT/AI mode. Open Settings > Models."
                    .to_string(),
            );
        }
        (api_key, api_base_url)
    } else {
        (String::new(), String::new())
    };

    let stt = if stt_local_mode {
        let stt_model = canonical_local_stt_model_id(&normalize_model_name(
            request.local_stt_model.as_deref(),
        ));
        if stt_model.is_empty() {
            return Err(
                "Local STT model is required when STT runtime is local. Open Settings > Models and select a model."
                    .to_string(),
            );
        }
        SttModeConfig::Local(LocalSttConfig { stt_model })
    } else {
        let stt_model = normalize_model_name(request.stt_model.as_deref());
        if stt_model.is_empty() {
            return Err(
                "Online STT model is required when STT runtime is online. Open Settings > Models."
                    .to_string(),
            );
        }
        SttModeConfig::Online {
            api_key: api_key.clone(),
            api_base_url: api_base_url.clone(),
            stt_model,
        }
    };

    let ai = if ai_local_mode {
        let ollama_base_url =
            normalize_local_ollama_base_url(request.local_ollama_base_url.as_deref());
        let ollama_model = normalize_model_name(request.local_ollama_model.as_deref());
        let ollama_model = if ollama_model.is_empty() {
            None
        } else {
            Some(ollama_model)
        };
        AiModeConfig::Local(LocalAiConfig {
            ollama_base_url,
            ollama_model,
        })
    } else {
        let ai_model = normalize_model_name(request.ai_model.as_deref());
        if ai_model.is_empty() {
            return Err(
                "Online AI model is required when AI runtime is online. Open Settings > Models."
                    .to_string(),
            );
        }
        AiModeConfig::Online {
            api_key,
            api_base_url,
            ai_model,
        }
    };

    Ok(PipelineModeConfig { stt, ai })
}

#[tauri::command]
async fn run_assistant_pipeline(
    app: AppHandle,
    state: State<'_, AppState>,
    request: AssistantPipelineRequest,
) -> Result<AssistantPipelineResponse, String> {
    let pipeline_mode = resolve_pipeline_mode(&request)?;

    let requested_engine = request
        .tts_engine
        .as_deref()
        .map(str::trim)
        .unwrap_or("piper")
        .to_ascii_lowercase();
    let coqui_requested = requested_engine == "coqui";
    let use_coqui = coqui_requested && !zero_python_mode_enabled();
    if coqui_requested && zero_python_mode_enabled() {
        warn!(
            "[pipeline] coqui requested but disabled in zero-python mode; falling back to piper"
        );
    }

    let piper_path = if use_coqui {
        None
    } else {
        Some(resolve_piper_path(&app, request.piper_path.as_deref())?)
    };

    let piper_model_path = if use_coqui {
        None
    } else {
        let (model_path, config_path) = voice_paths(&app)?;
        if !file_exists_with_content(&model_path) || !file_exists_with_content(&config_path) {
            return Err(
                "Voice model files are missing. Open Settings > TTS and run Piper setup first."
                    .to_string(),
            );
        }
        Some(model_path)
    };

    let audio_bytes = BASE64_STANDARD
        .decode(request.audio_base64.as_bytes())
        .map_err(|error| format!("Failed to decode recorded audio: {error}"))?;

    if audio_bytes.is_empty() {
        return Err("Recorded audio is empty".to_string());
    }

    let stt_mode_label = match &pipeline_mode.stt {
        SttModeConfig::Online { .. } => "online",
        SttModeConfig::Local(_) => "local",
    };
    let ai_mode_label = match &pipeline_mode.ai {
        AiModeConfig::Online { .. } => "online",
        AiModeConfig::Local(_) => "local",
    };
    let pipeline_label = if stt_mode_label == ai_mode_label {
        stt_mode_label.to_string()
    } else {
        format!("hybrid(stt={},ai={})", stt_mode_label, ai_mode_label)
    };
    let stt_base_url_for_log = match &pipeline_mode.stt {
        SttModeConfig::Online { api_base_url, .. } => api_base_url.clone(),
        SttModeConfig::Local(local) => {
            let stt_provider = infer_local_stt_provider_from_model(&local.stt_model);
            format!("builtin://local-{}", stt_provider)
        }
    };
    let stt_model_for_log = match &pipeline_mode.stt {
        SttModeConfig::Online { stt_model, .. } => stt_model.clone(),
        SttModeConfig::Local(local) => local.stt_model.clone(),
    };
    let ai_model_for_log = match &pipeline_mode.ai {
        AiModeConfig::Online { ai_model, .. } => ai_model.clone(),
        AiModeConfig::Local(local) => local
            .ollama_model
            .clone()
            .unwrap_or_else(|| "<unset>".to_string()),
    };

    info!(
        "[pipeline] start mode={} engine={} audio_bytes={} mime={} stt_base_url={} stt_model={} ai_model={}",
        pipeline_label,
        if use_coqui { "coqui" } else { "piper" },
        audio_bytes.len(),
        request.audio_mime_type,
        clip_text(&stt_base_url_for_log, 180),
        clip_text(&stt_model_for_log, 120),
        clip_text(&ai_model_for_log, 120)
    );

    let overall_start = Instant::now();

    let stt_start = Instant::now();
    let effective_language_hint = normalize_stt_language_hint(request.language.as_deref()).or_else(|| {
        normalize_stt_allowed_languages(request.allowed_languages.as_deref())
            .first()
            .cloned()
    });
    let transcript_raw = match &pipeline_mode.stt {
        SttModeConfig::Online {
            api_key,
            api_base_url,
            stt_model,
        } => {
            transcribe_audio(
                &state.http,
                api_key,
                api_base_url,
                stt_model,
                &audio_bytes,
                request.audio_mime_type.trim(),
                request.language.as_deref(),
                request.allowed_languages.as_deref(),
            )
            .await?
        }
        SttModeConfig::Local(local) => {
            transcribe_audio_local(
                &app,
                &state.http,
                local,
                &audio_bytes,
                request.audio_mime_type.trim(),
                request.language.as_deref(),
                request.allowed_languages.as_deref(),
            )
            .await?
        }
    };
    if let SttModeConfig::Local(local) = &pipeline_mode.stt {
        let provider = infer_local_stt_provider_from_model(&local.stt_model);
        let mime = request.audio_mime_type.trim().to_ascii_lowercase();
        if provider == "parakeet" && mime.contains("wav") {
            if let Some(duration_secs) = estimate_wav_duration_seconds(&audio_bytes) {
                let transcript_chars = transcript_raw.chars().count();
                let cps = transcript_chars as f64 / duration_secs.max(0.001);
                let likely_hallucination =
                    (transcript_chars >= 120 && cps > 55.0)
                        || (duration_secs <= 0.8 && transcript_chars >= 32 && cps > 80.0);
                if likely_hallucination {
                    warn!(
                        "[pipeline] rejected implausible local transcript provider={} chars={} duration_secs={:.3} cps={:.1}",
                        provider,
                        transcript_chars,
                        duration_secs,
                        cps
                    );
                    return Err(
                        "Detected noisy local transcript from very short audio. Hold push-to-talk while speaking and try again."
                            .to_string(),
                    );
                }
            }
        }
    }
    if looks_like_repetitive_transcript_noise(&transcript_raw, effective_language_hint.as_deref()) {
        warn!(
            "[pipeline] rejected noisy transcript chars={} language={}",
            transcript_raw.chars().count(),
            effective_language_hint.as_deref().unwrap_or("auto")
        );
        let message = match &pipeline_mode.stt {
            SttModeConfig::Local(local)
                if infer_local_stt_provider_from_model(&local.stt_model) == "moonshine"
                    && effective_language_hint.as_deref() == Some("en") =>
            {
                "Detected non-English/noisy Moonshine transcript while Dictation language is English. Switch Local STT model to Whisper Small/Medium in Settings > Models for reliable English wake phrase detection."
                    .to_string()
            }
            _ => {
                "Detected noisy transcript output. Set Dictation language in Settings > General and try again."
                    .to_string()
            }
        };
        return Err(message);
    }
    let transcript = refine_transcript(&transcript_raw, &request);
    let stt_latency_ms = elapsed_ms(stt_start);
    info!(
        "[pipeline] stt done latency_ms={} transcript_chars={}",
        stt_latency_ms,
        transcript.chars().count()
    );

    if transcript.trim().is_empty() {
        return Err("STT returned an empty transcript".to_string());
    }

    let wake_word_enabled = request.wake_word_enabled.unwrap_or(true);
    let assistant_name = request
        .assistant_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Lily");
    let wake_command = if wake_word_enabled {
        extract_wake_command(&transcript, assistant_name)
    } else {
        Some(transcript.clone())
    };
    if wake_word_enabled && wake_command.is_none() {
        let selection_context_cleared = state.clear_pending_selection_rewrite()?;
        info!(
            "[pipeline] dictation mode wake_phrase_missing name={} transcript_chars={} pending_context_cleared={}",
            assistant_name,
            transcript.chars().count(),
            selection_context_cleared
        );
        let total_latency_ms = elapsed_ms(overall_start);
        let assistant_response = transcript.clone();
        state.set_last_transcript(&transcript)?;
        return Ok(AssistantPipelineResponse {
            mode: "dictation".to_string(),
            selection_rewrite: false,
            selection_pending: false,
            selection_context_cleared,
            selection_context_used: false,
            transcript: transcript.clone(),
            assistant_response,
            audio_base64: String::new(),
            stt_latency_ms,
            ai_latency_ms: 0,
            tts_latency_ms: 0,
            total_latency_ms,
        });
    }

    let wake_command = wake_command.unwrap_or_default();
    let command_for_ai = wake_command.trim().to_string();
    let wake_only = wake_word_enabled && command_for_ai.is_empty();
    let command_mode = request.command_mode.unwrap_or(false);
    let selection_edit_intent = seems_like_selection_edit_instruction(&command_for_ai);
    let selection_context_query_intent = seems_like_selection_context_query(&command_for_ai);
    let selection_intent_active = selection_edit_intent || selection_context_query_intent;
    let pending_rewrite_present = state.peek_pending_selection_rewrite()?.is_some();
    let mut selected_text = request
        .selected_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let mut selected_text_source = if selected_text.is_some() {
        "frontend"
    } else {
        "none"
    };
    let should_try_backend_selection_capture = !wake_only
        && selected_text.is_none()
        && (selection_intent_active || command_mode || pending_rewrite_present);
    if should_try_backend_selection_capture {
        #[cfg(target_os = "windows")]
        {
            match capture_selected_text_windows() {
                Ok(captured) => {
                    let trimmed = captured.trim();
                    if !trimmed.is_empty() {
                        selected_text = Some(trimmed.to_string());
                        selected_text_source = "backend-fallback";
                    }
                }
                Err(error) => {
                    warn!(
                        "[pipeline] selection fallback capture failed: {}",
                        clip_text(&single_line(&error), 240)
                    );
                }
            }
        }
    }
    if command_mode && selected_text.is_none() && selection_intent_active {
        if let Some(recent) = state.peek_recent_selection_context()? {
            let recent_chars = recent.chars().count();
            selected_text = Some(recent);
            selected_text_source = "recent-context";
            info!(
                "[pipeline] selection context recovered from recent cache chars={}",
                recent_chars
            );
        }
    }
    if let Some(selected) = selected_text.as_ref() {
        state.set_recent_selection_context(selected.clone())?;
    }
    let selected_context_available = selected_text.is_some();
    let selection_control_mode =
        selected_context_available || command_mode || pending_rewrite_present || selection_intent_active;
    let selection_context_used = selected_context_available || pending_rewrite_present;
    let selected_chars = selected_text
        .as_ref()
        .map(|value| value.chars().count())
        .unwrap_or(0);
    info!(
        "[pipeline] selection context command_mode={} edit_intent={} context_query_intent={} pending={} control_mode={} source={} selected_chars={}",
        command_mode,
        selection_edit_intent,
        selection_context_query_intent,
        pending_rewrite_present,
        selection_control_mode,
        selected_text_source,
        selected_chars
    );
    let mut selection_rewrite = false;
    let mut selection_pending = false;
    let mut selection_context_cleared = false;
    let mut skip_tts = false;

    let ai_start = Instant::now();
    let system_prompt = request
        .system_prompt
        .as_deref()
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
        .unwrap_or(DEFAULT_SYSTEM_PROMPT);

    let temperature = request.temperature.unwrap_or(0.35).clamp(0.0, 1.2);
    let max_tokens = request.max_tokens.unwrap_or(320).clamp(64, 1024);

    let mut ai_latency_ms = 0_u64;
    let mut assistant_response = if wake_only {
        info!("[pipeline] wake phrase detected without trailing command");
        "I'm listening.".to_string()
    } else {
        if selection_control_mode {
            if let Some(selected) = selected_text.as_deref() {
                let instruction = if command_for_ai.trim().is_empty() {
                    "Improve this text while keeping the original meaning and tone."
                } else {
                    command_for_ai.as_str()
                };
                let mut decision = generate_selection_edit_decision(
                    &state.http,
                    &pipeline_mode.ai,
                    instruction,
                    selected,
                    temperature,
                )
                .await?;
                if decision.action == SelectionEditAction::ReplaceNow
                    && is_rewrite_suspicious(instruction, selected, &decision.rewrite_text)
                {
                    decision.action = SelectionEditAction::AskConfirm;
                    if decision.message.trim().is_empty() {
                        decision.message =
                            "I drafted an edit but want confirmation before replacing.".to_string();
                    }
                    info!(
                        "[pipeline] downgraded auto replace to ask_confirm due to suspicious rewrite shape"
                    );
                }
                ai_latency_ms = elapsed_ms(ai_start);
                info!(
                    "[pipeline] ai edit decision latency_ms={} action={} rewrite_chars={} message_chars={}",
                    ai_latency_ms,
                    selection_action_label(decision.action),
                    decision.rewrite_text.chars().count(),
                    decision.message.chars().count()
                );

                match decision.action {
                    SelectionEditAction::ReplaceNow => {
                        let rewrite = decision.rewrite_text;
                        state.set_recent_selection_context(rewrite.clone())?;
                        selection_rewrite = true;
                        selection_context_cleared =
                            state.clear_pending_selection_rewrite()? || selection_context_cleared;
                        skip_tts = true;
                        rewrite
                    }
                    SelectionEditAction::AskConfirm => {
                        if decision.rewrite_text.trim().is_empty() {
                            selection_context_cleared = state.clear_pending_selection_rewrite()?
                                || selection_context_cleared;
                            "I could not prepare a safe rewrite. Try a clearer edit instruction."
                                .to_string()
                        } else {
                            let rewrite = decision.rewrite_text;
                            state.set_recent_selection_context(rewrite.clone())?;
                            state.set_pending_selection_rewrite(rewrite)?;
                            selection_pending = true;
                            skip_tts = true;
                            if decision.message.trim().is_empty() {
                                format!(
                                    "I drafted an edit. Say \"hey {}, yes replace it\" to apply or \"hey {}, cancel\" to discard.",
                                    assistant_name, assistant_name
                                )
                            } else {
                                decision.message
                            }
                        }
                    }
                    SelectionEditAction::NoEdit => {
                        selection_context_cleared =
                            state.clear_pending_selection_rewrite()? || selection_context_cleared;
                        if decision.message.trim().is_empty()
                            || looks_like_missing_selection_prompt(&decision.message)
                        {
                            let response = generate_assistant_response(
                                &state.http,
                                &pipeline_mode.ai,
                                &build_selected_context_answer_prompt(&command_for_ai, selected),
                                system_prompt,
                                temperature,
                                max_tokens,
                            )
                            .await?;
                            ai_latency_ms = elapsed_ms(ai_start);
                            info!(
                                "[pipeline] ai selected-context answer latency_ms={} response_chars={}",
                                ai_latency_ms,
                                response.chars().count()
                            );
                            response
                        } else {
                            decision.message
                        }
                    }
                }
            } else if let Some(pending) = state.peek_pending_selection_rewrite()? {
                if is_negative_selection_confirmation(&command_for_ai) {
                    selection_context_cleared =
                        state.clear_pending_selection_rewrite()? || selection_context_cleared;
                    skip_tts = true;
                    info!("[pipeline] pending rewrite canceled by user");
                    "Pending rewrite canceled.".to_string()
                } else if is_affirmative_selection_confirmation(&command_for_ai) {
                    let rewrite = state.take_pending_selection_rewrite()?.unwrap_or(pending);
                    state.set_recent_selection_context(rewrite.clone())?;
                    selection_rewrite = true;
                    selection_context_cleared = true;
                    skip_tts = true;
                    info!(
                        "[pipeline] pending rewrite confirmed by user rewrite_chars={}",
                        rewrite.chars().count()
                    );
                    rewrite
                } else {
                    selection_pending = true;
                    skip_tts = true;
                    "I still have a pending rewrite. Say \"yes replace it\" to apply or \"cancel\" to discard."
                        .to_string()
                }
            } else {
                if selection_edit_intent || selection_context_query_intent {
                    skip_tts = true;
                    "No selected text detected. Select text first, then repeat your selection command."
                        .to_string()
                } else {
                    let transcript_for_ai = if command_for_ai.is_empty() {
                        "Command mode is active. Ask the user what to edit next.".to_string()
                    } else {
                        format!("Command mode request: {}", command_for_ai)
                    };
                    let assistant_response = generate_assistant_response(
                        &state.http,
                        &pipeline_mode.ai,
                        &transcript_for_ai,
                        system_prompt,
                        temperature,
                        max_tokens,
                    )
                    .await?;
                    ai_latency_ms = elapsed_ms(ai_start);
                    info!(
                        "[pipeline] ai done latency_ms={} response_chars={}",
                        ai_latency_ms,
                        assistant_response.chars().count()
                    );
                    assistant_response
                }
            }
        } else {
            selection_context_cleared =
                state.clear_pending_selection_rewrite()? || selection_context_cleared;
            let assistant_response = generate_assistant_response(
                &state.http,
                &pipeline_mode.ai,
                &command_for_ai,
                system_prompt,
                temperature,
                max_tokens,
            )
            .await?;
            ai_latency_ms = elapsed_ms(ai_start);
            info!(
                "[pipeline] ai done latency_ms={} response_chars={}",
                ai_latency_ms,
                assistant_response.chars().count()
            );
            assistant_response
        }
    };

    if !wake_only
        && looks_like_direct_question(&command_for_ai)
        && looks_like_question_echo(&command_for_ai, &assistant_response)
    {
        warn!(
            "[pipeline] detected question echo; retrying with strict direct-answer fallback command={}",
            clip_text(&command_for_ai, 220)
        );
        match generate_direct_answer_fallback(
            &state.http,
            &pipeline_mode.ai,
            &command_for_ai,
            temperature,
            max_tokens,
        )
        .await
        {
            Ok(recovered) if !recovered.trim().is_empty() => {
                assistant_response = recovered;
                ai_latency_ms = elapsed_ms(ai_start);
                info!(
                    "[pipeline] fallback answer success latency_ms={} response_chars={}",
                    ai_latency_ms,
                    assistant_response.chars().count()
                );
            }
            Ok(_) => {
                warn!("[pipeline] fallback answer returned empty response");
            }
            Err(error) => {
                warn!(
                    "[pipeline] fallback answer failed: {}",
                    clip_text(&single_line(&error), 320)
                );
            }
        }
    }

    if !wake_only
        && !selection_context_used
        && !selection_rewrite
        && !selection_pending
        && seems_like_draft_generation_instruction(&command_for_ai)
        && looks_like_incomplete_draft_output(&assistant_response)
    {
        warn!(
            "[pipeline] detected incomplete draft output; retrying with strict compose fallback command={}",
            clip_text(&command_for_ai, 220)
        );
        match generate_compose_draft_fallback(
            &state.http,
            &pipeline_mode.ai,
            &command_for_ai,
            temperature,
            max_tokens,
        )
        .await
        {
            Ok(recovered) if !recovered.trim().is_empty() => {
                assistant_response = recovered;
                ai_latency_ms = elapsed_ms(ai_start);
                info!(
                    "[pipeline] compose fallback success latency_ms={} response_chars={}",
                    ai_latency_ms,
                    assistant_response.chars().count()
                );
            }
            Ok(_) => {
                warn!("[pipeline] compose fallback returned empty response");
            }
            Err(error) => {
                warn!(
                    "[pipeline] compose fallback failed: {}",
                    clip_text(&single_line(&error), 320)
                );
            }
        }
    }

    if assistant_response.trim().is_empty() {
        return Err("AI model returned an empty response".to_string());
    }

    if wake_only {
        let total_latency_ms = elapsed_ms(overall_start);
        info!(
            "[pipeline] wake acknowledgement complete total_latency_ms={}",
            total_latency_ms
        );
        state.set_last_pipeline_output(&transcript, &assistant_response)?;
        return Ok(AssistantPipelineResponse {
            mode: "assistant".to_string(),
            selection_rewrite: false,
            selection_pending: false,
            selection_context_cleared: false,
            selection_context_used: false,
            transcript,
            assistant_response,
            audio_base64: String::new(),
            stt_latency_ms,
            ai_latency_ms,
            tts_latency_ms: 0,
            total_latency_ms,
        });
    }

    if skip_tts {
        let total_latency_ms = elapsed_ms(overall_start);
        info!(
            "[pipeline] complete (tts skipped) total_latency_ms={}",
            total_latency_ms
        );
        state.set_last_pipeline_output(&transcript, &assistant_response)?;
        return Ok(AssistantPipelineResponse {
            mode: "assistant".to_string(),
            selection_rewrite,
            selection_pending,
            selection_context_cleared,
            selection_context_used,
            transcript,
            assistant_response,
            audio_base64: String::new(),
            stt_latency_ms,
            ai_latency_ms,
            tts_latency_ms: 0,
            total_latency_ms,
        });
    }

    let tts_start = Instant::now();
    let tts_bytes = if use_coqui {
        let coqui = request.coqui.as_ref().ok_or_else(|| {
            "Coqui settings are required when TTS engine is set to Coqui.".to_string()
        })?;
        synthesize_with_coqui(&app, coqui, assistant_response.clone()).await?
    } else {
        let resolved_piper_path = piper_path
            .ok_or_else(|| "Piper path was not resolved for Piper synthesis.".to_string())?;
        let resolved_model_path = piper_model_path
            .ok_or_else(|| "Piper voice model path was not resolved.".to_string())?;
        synthesize_with_piper(
            resolved_piper_path,
            resolved_model_path,
            assistant_response.clone(),
            request.piper.as_ref(),
        )
        .await?
    };
    let tts_latency_ms = elapsed_ms(tts_start);
    info!(
        "[pipeline] tts done engine={} latency_ms={} audio_bytes={}",
        if use_coqui { "coqui" } else { "piper" },
        tts_latency_ms,
        tts_bytes.len()
    );

    if tts_bytes.is_empty() {
        return Err(if use_coqui {
            "Coqui returned empty audio output".to_string()
        } else {
            "Piper returned empty audio output".to_string()
        });
    }

    let total_latency_ms = elapsed_ms(overall_start);
    info!("[pipeline] complete total_latency_ms={}", total_latency_ms);
    state.set_last_pipeline_output(&transcript, &assistant_response)?;

    Ok(AssistantPipelineResponse {
        mode: "assistant".to_string(),
        selection_rewrite,
        selection_pending,
        selection_context_cleared,
        selection_context_used,
        transcript,
        assistant_response,
        audio_base64: BASE64_STANDARD.encode(tts_bytes),
        stt_latency_ms,
        ai_latency_ms,
        tts_latency_ms,
        total_latency_ms,
    })
}

async fn transcribe_audio(
    client: &Client,
    api_key: &str,
    api_base_url: &str,
    stt_model: &str,
    audio_bytes: &[u8],
    audio_mime_type: &str,
    language: Option<&str>,
    allowed_languages: Option<&[String]>,
) -> Result<String, String> {
    let normalized_allowed_languages = normalize_stt_allowed_languages(allowed_languages);
    let whisper_family = stt_model.trim().to_ascii_lowercase().contains("whisper");
    if whisper_family && normalized_allowed_languages.len() > 1 {
        let mut best_transcript = String::new();
        let mut best_score = 0usize;
        let mut last_error = String::new();

        for candidate_language in &normalized_allowed_languages {
            match transcribe_audio_openai_compatible(
                client,
                Some(api_key),
                api_base_url,
                stt_model,
                audio_bytes,
                audio_mime_type,
                Some(candidate_language.as_str()),
                "online",
            )
            .await
            {
                Ok(transcript) => {
                    if transcript.trim().is_empty() {
                        continue;
                    }
                    if looks_like_repetitive_transcript_noise(
                        &transcript,
                        Some(candidate_language.as_str()),
                    ) {
                        continue;
                    }
                    let score = transcript_candidate_score(&transcript);
                    if score > best_score {
                        best_score = score;
                        best_transcript = transcript;
                    }
                }
                Err(error) => {
                    last_error = error;
                }
            }
        }

        if !best_transcript.trim().is_empty() {
            return Ok(best_transcript.trim().to_string());
        }
        if !last_error.is_empty() {
            return Err(last_error);
        }
    }

    let effective_language = normalize_stt_language_hint(language)
        .or_else(|| normalized_allowed_languages.first().cloned());
    transcribe_audio_openai_compatible(
        client,
        Some(api_key),
        api_base_url,
        stt_model,
        audio_bytes,
        audio_mime_type,
        effective_language.as_deref(),
        "online",
    )
    .await
}

async fn transcribe_audio_local(
    app: &AppHandle,
    _client: &Client,
    local: &LocalSttConfig,
    audio_bytes: &[u8],
    audio_mime_type: &str,
    language: Option<&str>,
    allowed_languages: Option<&[String]>,
) -> Result<String, String> {
    let state = app.state::<AppState>();
    if !state.local_stt_runtime_loaded_snapshot()? {
        return Err(
            "Local STT runtime is unloaded. Use 'Load STT' in the left sidebar to enable local dictation."
                .to_string(),
        );
    }

    let provider = infer_local_stt_provider_from_model(&local.stt_model);
    if provider == "parakeet" {
        return transcribe_audio_local_parakeet(app, local, audio_bytes, audio_mime_type, language)
            .await;
    }
    if provider == "whisper" || provider == "moonshine" || provider == "sensevoice" {
        if zero_python_mode_enabled() {
            return Err(ZERO_PYTHON_STT_NOTICE.to_string());
        }
        return transcribe_audio_local_hf_asr(
            app,
            local,
            audio_bytes,
            audio_mime_type,
            language,
            allowed_languages,
        )
        .await;
    }
    Err("Unsupported local STT model/provider.".to_string())
}

async fn transcribe_audio_local_parakeet(
    app: &AppHandle,
    local: &LocalSttConfig,
    audio_bytes: &[u8],
    audio_mime_type: &str,
    _language: Option<&str>,
) -> Result<String, String> {
    let model = canonical_local_stt_model_id(&local.stt_model);
    let provider = infer_local_stt_provider_from_model(&model);
    let repo_id = resolve_huggingface_repo_id(&provider, &model);
    let model_dir = stt_models_dir(app)?.join(sanitize_model_cache_dir_name(&repo_id));
    if !model_dir.exists() {
        return Err(format!(
            "Local Parakeet model is not downloaded yet. Download '{model}' first."
        ));
    }
    let model_root = find_local_parakeet_model_root(&model_dir)?;
    info!(
        "[local.stt.parakeet] model={} repo={} model_root={} bytes={}",
        clip_text(&model, 140),
        clip_text(&repo_id, 140),
        clip_text(&model_root.to_string_lossy(), 220),
        audio_bytes.len()
    );

    let model_root_for_worker = model_root.clone();
    let audio_bytes_for_worker = audio_bytes.to_vec();
    let audio_mime_type_for_worker = audio_mime_type.to_string();
    let native_result = tauri::async_runtime::spawn_blocking(move || {
        let (transcript, model_cached, unloaded_after_transcribe) =
            transcribe_local_stt_parakeet_native(
                &model_root_for_worker,
                &audio_bytes_for_worker,
                &audio_mime_type_for_worker,
            )?;
        info!(
            "[local.stt.parakeet.native] success transcript_chars={} model_cached={} device=cpu precision=int8 unloaded_after_transcribe={}",
            transcript.chars().count(),
            model_cached,
            unloaded_after_transcribe
        );
        Ok(transcript)
    })
    .await
    .map_err(|error| format!("Local STT worker failed: {error}"))?;

    native_result
}

async fn transcribe_audio_local_hf_asr(
    app: &AppHandle,
    local: &LocalSttConfig,
    audio_bytes: &[u8],
    audio_mime_type: &str,
    language: Option<&str>,
    allowed_languages: Option<&[String]>,
) -> Result<String, String> {
    let model = canonical_local_stt_model_id(&local.stt_model);
    let provider = infer_local_stt_provider_from_model(&model);
    let allowed_language_hints = normalize_stt_allowed_languages(allowed_languages);
    let language_hint = normalize_stt_language_hint(language)
        .or_else(|| allowed_language_hints.first().cloned());
    let (repo_id, model_dir) = resolve_local_stt_repo_and_dir(app, &provider, &model)?;
    if !model_dir.exists() {
        return Err(format!(
            "Local STT model is not downloaded yet. Download '{model}' first."
        ));
    }
    info!(
        "[local.stt.hf] model={} provider={} repo={} model_dir={} bytes={}",
        clip_text(&model, 140),
        clip_text(&provider, 40),
        clip_text(&repo_id, 140),
        clip_text(&model_dir.to_string_lossy(), 220),
        audio_bytes.len()
    );

    let runtime_dir = stt_runtime_dir(app)?;
    let stamp = now_unix_ms();
    let extension = mime_to_extension(audio_mime_type);
    let audio_path = runtime_dir.join(format!("local-stt-audio-{stamp}.{extension}"));
    fs::write(&audio_path, audio_bytes)
        .map_err(|error| format!("Failed to write local STT audio file: {error}"))?;

    let app_for_worker = app.clone();
    let provider_for_worker = provider.clone();
    let model_for_worker = model.clone();
    let model_dir_for_worker = model_dir.clone();
    let audio_path_for_worker = audio_path.clone();
    let language_hint_for_worker = language_hint.clone();
    let allowed_language_hints_for_worker = allowed_language_hints.clone();
    let bridge_result = tauri::async_runtime::spawn_blocking(move || {
        let python_path = setup_local_stt_runtime_blocking(&app_for_worker, "python")?;
        let script_path = ensure_local_stt_bridge_script(&app_for_worker)?;
        let cache_dir = stt_cache_dir(&app_for_worker)?;
        let payload = json!({
            "action": "transcribe_hf_asr",
            "provider": provider_for_worker,
            "modelId": model_for_worker,
            "language": language_hint_for_worker,
            "allowedLanguages": allowed_language_hints_for_worker,
            "modelPath": model_dir_for_worker.to_string_lossy().to_string(),
            "audioPath": audio_path_for_worker.to_string_lossy().to_string(),
        });
        let response = run_local_stt_bridge_via_daemon(
            &python_path,
            &script_path,
            &cache_dir,
            "transcribe_hf_asr",
            &payload,
        )?;
        let transcript = response
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        if transcript.is_empty() {
            return Err("Local STT model returned an empty transcript.".to_string());
        }
        let model_cached = response
            .get("modelCached")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let device = response
            .get("device")
            .and_then(Value::as_str)
            .unwrap_or("cpu");
        info!(
            "[local.stt.hf] daemon success transcript_chars={} model_cached={} device={}",
            transcript.chars().count(),
            model_cached,
            clip_text(device, 40)
        );

        Ok(transcript)
    })
    .await
    .map_err(|error| format!("Local STT worker failed: {error}"))?;

    let _ = fs::remove_file(&audio_path);

    bridge_result
}

async fn transcribe_audio_openai_compatible(
    client: &Client,
    api_key: Option<&str>,
    api_base_url: &str,
    stt_model: &str,
    audio_bytes: &[u8],
    audio_mime_type: &str,
    language: Option<&str>,
    source_label: &str,
) -> Result<String, String> {
    let extension = mime_to_extension(audio_mime_type);
    let file_name = format!("recording.{extension}");

    let file_part = if audio_mime_type.is_empty() {
        multipart::Part::bytes(audio_bytes.to_vec()).file_name(file_name.clone())
    } else {
        multipart::Part::bytes(audio_bytes.to_vec())
            .file_name(file_name.clone())
            .mime_str(audio_mime_type)
            .unwrap_or_else(|_| multipart::Part::bytes(audio_bytes.to_vec()).file_name(file_name))
    };

    let mut form = multipart::Form::new()
        .text("model", stt_model.to_string())
        .part("file", file_part)
        .text("response_format", "json");

    if let Some(language) = language.map(str::trim).filter(|value| !value.is_empty()) {
        form = form.text("language", language.to_string());
    }

    let request_builder = client
        .post(format!("{api_base_url}/audio/transcriptions"))
        .multipart(form);
    let response = apply_optional_bearer_auth(request_builder, api_key)
        .send()
        .await
        .map_err(|error| format!("Failed to call {source_label} STT endpoint: {error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to parse {source_label} STT response body: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "{source_label} STT request failed ({status}): {}",
            clip_text(&single_line(&body), 420)
        ));
    }

    let payload: Value = serde_json::from_str(&body)
        .map_err(|error| format!("Invalid {source_label} STT JSON response: {error}"))?;

    let transcript = payload
        .get("text")
        .and_then(Value::as_str)
        .or_else(|| payload.get("transcript").and_then(Value::as_str))
        .unwrap_or_default()
        .trim()
        .to_string();

    Ok(transcript)
}

async fn generate_assistant_response(
    client: &Client,
    ai_mode: &AiModeConfig,
    transcript: &str,
    system_prompt: &str,
    temperature: f32,
    max_tokens: u32,
) -> Result<String, String> {
    match ai_mode {
        AiModeConfig::Online {
            api_key,
            api_base_url,
            ai_model,
        } => {
            generate_assistant_response_online(
                client,
                api_key,
                api_base_url,
                ai_model,
                transcript,
                system_prompt,
                temperature,
                max_tokens,
            )
            .await
        }
        AiModeConfig::Local(local) => {
            generate_assistant_response_ollama(
                client,
                local,
                transcript,
                system_prompt,
                temperature,
                max_tokens,
            )
            .await
        }
    }
}

async fn generate_assistant_response_online(
    client: &Client,
    api_key: &str,
    api_base_url: &str,
    ai_model: &str,
    transcript: &str,
    system_prompt: &str,
    temperature: f32,
    max_tokens: u32,
) -> Result<String, String> {
    let payload = json!({
      "model": ai_model,
      "temperature": temperature,
      "max_tokens": max_tokens,
      "stream": false,
      "messages": [
        {
          "role": "system",
          "content": system_prompt
        },
        {
          "role": "user",
          "content": transcript
        }
      ]
    });

    let mut last_error = String::new();
    for attempt in 0..2 {
        let response = match client
            .post(format!("{api_base_url}/chat/completions"))
            .bearer_auth(api_key)
            .json(&payload)
            .timeout(Duration::from_secs(35))
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                last_error = format!("Failed to call AI endpoint: {error}");
                if attempt == 0 {
                    warn!(
                        "[pipeline] online ai transport error; retrying: {}",
                        clip_text(&single_line(&last_error), 280)
                    );
                    std::thread::sleep(Duration::from_millis(350));
                    continue;
                }
                warn!(
                    "[pipeline] online ai request failed after retry: {}",
                    clip_text(&single_line(&last_error), 320)
                );
                return Err(last_error);
            }
        };

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| format!("Failed to parse AI response body: {error}"))?;

        if !status.is_success() {
            let message = format!(
                "AI request failed ({status}): {}",
                clip_text(&single_line(&body), 420)
            );
            if attempt == 0 && matches!(status.as_u16(), 429 | 500 | 502 | 503 | 504) {
                warn!(
                    "[pipeline] online ai temporary failure; retrying status={} body={}",
                    status,
                    clip_text(&single_line(&body), 220)
                );
                last_error = message;
                std::thread::sleep(Duration::from_millis(450));
                continue;
            }
            warn!(
                "[pipeline] online ai request failed status={} body={}",
                status,
                clip_text(&single_line(&body), 320)
            );
            return Err(message);
        }

        let payload: Value = serde_json::from_str(&body)
            .map_err(|error| format!("Invalid AI JSON response: {error}"))?;
        let content = extract_chat_content(&payload)
            .map(|text| text.trim().to_string())
            .filter(|text| !text.is_empty());
        if let Some(value) = content {
            return Ok(value);
        }
        let missing_content_error = "AI response is missing usable text content.".to_string();
        let top_level_keys = payload
            .as_object()
            .map(|object| object.keys().cloned().collect::<Vec<_>>().join(","))
            .unwrap_or_else(|| "<non-object>".to_string());
        let message_keys = payload
            .pointer("/choices/0/message")
            .and_then(Value::as_object)
            .map(|object| object.keys().cloned().collect::<Vec<_>>().join(","))
            .unwrap_or_else(|| "<none>".to_string());
        if attempt == 0 {
            warn!(
                "[pipeline] online ai missing text content; retrying top_keys={} message_keys={} body_preview={}",
                top_level_keys,
                message_keys,
                clip_text(&single_line(&body), 360)
            );
            last_error = missing_content_error;
            std::thread::sleep(Duration::from_millis(350));
            continue;
        }
        warn!(
            "[pipeline] online ai response missing message content top_keys={} message_keys={} body_preview={}",
            top_level_keys,
            message_keys,
            clip_text(&single_line(&body), 360)
        );
        return Err(missing_content_error);
    }

    if last_error.is_empty() {
        Err("AI request failed unexpectedly.".to_string())
    } else {
        Err(last_error)
    }
}

async fn generate_assistant_response_ollama(
    client: &Client,
    local: &LocalAiConfig,
    transcript: &str,
    system_prompt: &str,
    temperature: f32,
    max_tokens: u32,
) -> Result<String, String> {
    let ollama_model = local
        .ollama_model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "Local Ollama model is required for assistant responses. Open Settings > Models and select an Ollama model."
                .to_string()
        })?;
    let endpoint = format!("{}/api/chat", local.ollama_base_url);

    let payload = json!({
      "model": ollama_model,
      "stream": false,
      "options": {
        "temperature": temperature,
        "num_predict": max_tokens,
      },
      "messages": [
        {
          "role": "system",
          "content": system_prompt
        },
        {
          "role": "user",
          "content": transcript
        }
      ]
    });

    let mut last_error = String::new();
    for attempt in 0..2 {
        let response = match client.post(&endpoint).json(&payload).send().await {
            Ok(response) => response,
            Err(error) => {
                last_error = format!("Failed to call local Ollama endpoint: {error}");
                if attempt == 0 {
                    warn!(
                        "[pipeline] local ollama request transport error; retrying: {}",
                        clip_text(&single_line(&last_error), 280)
                    );
                    std::thread::sleep(Duration::from_millis(350));
                    continue;
                }
                return Err(last_error);
            }
        };

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| format!("Failed to parse local Ollama response body: {error}"))?;

        if !status.is_success() {
            let message = format!(
                "Local Ollama request failed ({status}): {}",
                clip_text(&single_line(&body), 420)
            );
            if attempt == 0 && matches!(status.as_u16(), 429 | 500 | 502 | 503 | 504) {
                warn!(
                    "[pipeline] local ollama temporary failure; retrying status={} body={}",
                    status,
                    clip_text(&single_line(&body), 220)
                );
                last_error = message;
                std::thread::sleep(Duration::from_millis(450));
                continue;
            }
            return Err(message);
        }

        let payload: Value = serde_json::from_str(&body)
            .map_err(|error| format!("Invalid local Ollama JSON response: {error}"))?;
        let content = payload
            .pointer("/message/content")
            .and_then(Value::as_str)
            .or_else(|| payload.get("response").and_then(Value::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        return content.ok_or_else(|| "Local Ollama response is missing message.content".to_string());
    }

    if last_error.is_empty() {
        Err("Local Ollama request failed unexpectedly.".to_string())
    } else {
        Err(last_error)
    }
}

async fn generate_direct_answer_fallback(
    client: &Client,
    ai_mode: &AiModeConfig,
    question: &str,
    temperature: f32,
    max_tokens: u32,
) -> Result<String, String> {
    let strict_prompt = "You are a direct-answer assistant.
- The user message is a question/command from voice input.
- Return the actual answer/result, not a paraphrase of the question.
- Do not prefix with labels or filler text.
- If the question asks for a number/calculation, return the computed result clearly.";
    generate_assistant_response(
        client,
        ai_mode,
        question,
        strict_prompt,
        temperature.clamp(0.0, 0.35),
        max_tokens.clamp(64, 320),
    )
    .await
}

async fn generate_compose_draft_fallback(
    client: &Client,
    ai_mode: &AiModeConfig,
    request: &str,
    temperature: f32,
    max_tokens: u32,
) -> Result<String, String> {
    let strict_prompt = "You are a professional writing assistant for email and document drafting.
- Return a complete, ready-to-send draft.
- Never output bracket placeholders such as [Name], [Boss's Name], [Date], or [Your Name].
- If a specific recipient name is unknown, use a neutral salutation like 'Dear Manager,'.
- Finish every sentence; do not stop mid-sentence.
- For email requests, include a clear Subject line, concise body, and closing.
- Return only the final draft text.";

    let draft_max_tokens = std::cmp::max(max_tokens, 420).clamp(180, 900);
    generate_assistant_response(
        client,
        ai_mode,
        request,
        strict_prompt,
        temperature.clamp(0.0, 0.5),
        draft_max_tokens,
    )
    .await
}

async fn generate_selection_edit_decision(
    client: &Client,
    ai_mode: &AiModeConfig,
    instruction: &str,
    selected_text: &str,
    temperature: f32,
) -> Result<SelectionEditDecision, String> {
    let decision_system_prompt = "You are a strict selected-text editing controller.
Return valid JSON only with this exact schema:
{\"action\":\"replace_now|ask_confirm|no_edit\",\"rewrite\":\"...\",\"message\":\"...\"}

Rules:
- Use replace_now when the user instruction clearly asks for direct editing of the selected text.
- Treat style/tone/length transformations as direct edits (for example: \"make it gentle\", \"longer\", \"200 words\", \"professional tone\").
- Use ask_confirm when instruction is ambiguous/high-risk before replacing user-selected text.
- Use no_edit when the spoken request is informational about the selected text (explain/summarize/tell me about it).
- rewrite must be the full rewritten selected text when action is replace_now or ask_confirm.
- message requirements:
  - For no_edit: provide the final assistant answer to the user request using the selected text context.
  - For ask_confirm: provide a short confirmation prompt.
  - For replace_now: message may be empty.
- Never ask the user to share or paste the text again; selected text is already provided.
- Never use markdown/code fences/placeholders.";
    let decision_request = format!(
        "Instruction:\n{}\n\nSelected text:\n<<<BEGIN_SELECTED_TEXT>>>\n{}\n<<<END_SELECTED_TEXT>>>",
        instruction.trim(),
        selected_text
    );
    let decision_temperature = temperature.clamp(0.0, 0.45);
    let raw = generate_assistant_response(
        client,
        ai_mode,
        &decision_request,
        decision_system_prompt,
        decision_temperature,
        900,
    )
    .await?;

    parse_selection_edit_decision(&raw)
}

fn parse_selection_edit_decision(raw: &str) -> Result<SelectionEditDecision, String> {
    let parsed = match serde_json::from_str::<Value>(raw) {
        Ok(value) => value,
        Err(_) => extract_json_value_from_output(raw).ok_or_else(|| {
            format!(
                "Invalid edit-decision JSON from AI: {}",
                clip_text(&single_line(raw), 420)
            )
        })?,
    };

    let action_raw = parsed
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("ask_confirm")
        .trim()
        .to_ascii_lowercase();
    let action = match action_raw.as_str() {
        "replace_now" | "replace" | "rewrite" | "apply" => SelectionEditAction::ReplaceNow,
        "ask_confirm" | "confirm" | "needs_confirmation" => SelectionEditAction::AskConfirm,
        "no_edit" | "none" | "answer" => SelectionEditAction::NoEdit,
        _ => SelectionEditAction::AskConfirm,
    };

    let rewrite_text = parsed
        .get("rewrite")
        .or_else(|| parsed.get("rewritten_text"))
        .or_else(|| parsed.get("text"))
        .and_then(Value::as_str)
        .map(strip_wrapped_markdown_block)
        .unwrap_or_default()
        .trim()
        .to_string();
    let message = parsed
        .get("message")
        .or_else(|| parsed.get("reason"))
        .or_else(|| parsed.get("note"))
        .and_then(Value::as_str)
        .map(strip_wrapped_markdown_block)
        .unwrap_or_default()
        .trim()
        .to_string();

    if matches!(
        action,
        SelectionEditAction::ReplaceNow | SelectionEditAction::AskConfirm
    ) && rewrite_text.is_empty()
    {
        return Ok(SelectionEditDecision {
            action: SelectionEditAction::NoEdit,
            rewrite_text: String::new(),
            message: "I could not produce a usable rewrite from that request.".to_string(),
        });
    }

    Ok(SelectionEditDecision {
        action,
        rewrite_text,
        message,
    })
}

fn selection_action_label(action: SelectionEditAction) -> &'static str {
    match action {
        SelectionEditAction::ReplaceNow => "replace_now",
        SelectionEditAction::AskConfirm => "ask_confirm",
        SelectionEditAction::NoEdit => "no_edit",
    }
}

fn rough_word_count(input: &str) -> usize {
    input
        .split_whitespace()
        .filter(|chunk| !chunk.trim().is_empty())
        .count()
}

fn instruction_allows_short_rewrite(instruction: &str) -> bool {
    let normalized = normalize_ascii_words(instruction);
    [
        "summarize",
        "summary",
        "shorten",
        "brief",
        "title",
        "headline",
        "bullet",
        "keywords",
        "one line",
        "one sentence",
        "tldr",
    ]
    .iter()
    .any(|phrase| normalized.contains(phrase))
}

fn is_rewrite_suspicious(instruction: &str, selected_text: &str, rewrite_text: &str) -> bool {
    let selected_trimmed = selected_text.trim();
    let rewrite_trimmed = rewrite_text.trim();
    if selected_trimmed.is_empty() || rewrite_trimmed.is_empty() {
        return true;
    }

    if rewrite_trimmed.contains("<<<") || rewrite_trimmed.contains(">>>") {
        return true;
    }

    if rewrite_trimmed.contains("[insert") || rewrite_trimmed.contains("[replace") {
        return true;
    }

    if instruction_allows_short_rewrite(instruction) {
        return false;
    }

    let selected_words = rough_word_count(selected_trimmed);
    let rewrite_words = rough_word_count(rewrite_trimmed);

    if selected_words >= 16 && rewrite_words <= 5 {
        return true;
    }

    if selected_trimmed.chars().count() >= 220 && rewrite_trimmed.chars().count() <= 60 {
        return true;
    }

    false
}

fn strip_wrapped_markdown_block(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.starts_with("```") && trimmed.ends_with("```") && trimmed.len() >= 6 {
        let mut inner = &trimmed[3..trimmed.len() - 3];
        inner = inner.trim_start_matches(|ch: char| ch.is_ascii_alphabetic());
        inner = inner.strip_prefix('\n').unwrap_or(inner);
        return inner.trim().to_string();
    }
    trimmed.to_string()
}

fn normalize_ascii_words(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_space = true;
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_space = false;
            continue;
        }
        if !last_space {
            out.push(' ');
            last_space = true;
        }
    }
    out.trim().to_string()
}

fn contains_phrase(haystack: &str, phrase: &str) -> bool {
    if haystack.is_empty() || phrase.is_empty() {
        return false;
    }
    let padded_haystack = format!(" {} ", haystack);
    let padded_phrase = format!(" {} ", phrase);
    padded_haystack.contains(&padded_phrase)
}

fn is_negative_selection_confirmation(command: &str) -> bool {
    let normalized = normalize_ascii_words(command);
    if normalized.is_empty() {
        return false;
    }

    [
        "no", "nope", "cancel", "stop", "discard", "skip", "not now", "leave it", "do not", "don t",
    ]
    .iter()
    .any(|phrase| contains_phrase(&normalized, phrase))
}

fn is_affirmative_selection_confirmation(command: &str) -> bool {
    if is_negative_selection_confirmation(command) {
        return false;
    }

    let normalized = normalize_ascii_words(command);
    if normalized.is_empty() {
        return false;
    }

    [
        "yes",
        "yeah",
        "yep",
        "sure",
        "confirm",
        "apply",
        "go ahead",
        "do it",
        "replace",
        "replace it",
        "use it",
        "paste it",
        "proceed",
    ]
    .iter()
    .any(|phrase| contains_phrase(&normalized, phrase))
}

fn seems_like_selection_context_query(command: &str) -> bool {
    let normalized = normalize_ascii_words(command);
    if normalized.is_empty() {
        return false;
    }
    [
        "tell me about it",
        "tell me about this",
        "about it",
        "about this",
        "explain it",
        "explain this",
        "what does this mean",
        "summarize this",
        "summarise this",
        "review this",
        "analyze this",
        "analyse this",
        "is this good",
        "what do you think about this",
    ]
    .iter()
    .any(|phrase| contains_phrase(&normalized, phrase))
}

fn seems_like_selection_edit_instruction(command: &str) -> bool {
    let normalized = normalize_ascii_words(command);
    if normalized.is_empty() {
        return false;
    }
    let edit_verbs = ["improve", "rewrite", "edit", "rephrase", "fix", "correct", "polish", "refine"];
    if edit_verbs
        .iter()
        .any(|phrase| contains_phrase(&normalized, phrase))
    {
        return true;
    }

    let style_rewrite_cues = ["shorten", "expand", "formal", "professional", "grammar", "typo"];
    if style_rewrite_cues
        .iter()
        .any(|phrase| contains_phrase(&normalized, phrase))
    {
        return true;
    }

    let requests_better = contains_phrase(&normalized, "better");
    if requests_better {
        let asks_make = contains_phrase(&normalized, "make");
        let has_edit_verb = edit_verbs
            .iter()
            .any(|phrase| contains_phrase(&normalized, phrase));
        if asks_make || has_edit_verb {
            return true;
        }
    }

    false
}

fn seems_like_draft_generation_instruction(command: &str) -> bool {
    let normalized = normalize_ascii_words(command);
    if normalized.is_empty() {
        return false;
    }

    let draft_verbs = [
        "write", "draft", "compose", "create", "generate", "make", "prepare", "send",
    ];
    let draft_targets = [
        "email",
        "mail",
        "letter",
        "message",
        "application",
        "review",
        "proposal",
        "summary",
        "description",
        "cover letter",
        "follow up",
    ];

    let has_verb = draft_verbs
        .iter()
        .any(|phrase| contains_phrase(&normalized, phrase));
    let has_target = draft_targets
        .iter()
        .any(|phrase| contains_phrase(&normalized, phrase));
    if has_verb && has_target {
        return true;
    }

    if contains_phrase(&normalized, "make this")
        && [
            "better",
            "professional",
            "formal",
            "longer",
            "shorter",
            "clearer",
            "improve",
        ]
        .iter()
        .any(|phrase| contains_phrase(&normalized, phrase))
    {
        return true;
    }

    false
}

fn looks_like_incomplete_draft_output(response: &str) -> bool {
    let trimmed = response.trim();
    if trimmed.is_empty() {
        return true;
    }

    let normalized = normalize_ascii_words(trimmed);
    if normalized.is_empty() {
        return true;
    }

    if trimmed.contains('[') && trimmed.contains(']') {
        return true;
    }

    if [
        "boss s name",
        "your name",
        "recipient name",
        "insert name",
        "insert date",
        "date here",
    ]
    .iter()
    .any(|phrase| contains_phrase(&normalized, phrase))
    {
        return true;
    }

    let lower_trimmed = trimmed.to_ascii_lowercase();
    if lower_trimmed.ends_with(" i am")
        || lower_trimmed.ends_with(" i will")
        || lower_trimmed.ends_with(" i have")
        || lower_trimmed.ends_with(" thanks")
    {
        return true;
    }

    let non_empty_lines = trimmed
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count();
    if contains_phrase(&normalized, "subject") && non_empty_lines < 4 {
        return true;
    }

    false
}

fn looks_like_missing_selection_prompt(message: &str) -> bool {
    let normalized = normalize_ascii_words(message);
    if normalized.is_empty() {
        return false;
    }
    [
        "share the review",
        "share your review",
        "share the text",
        "share the content",
        "please share",
        "could you share",
        "provide the text",
        "paste the text",
        "send the text",
    ]
    .iter()
    .any(|phrase| normalized.contains(phrase))
}

fn normalize_text_for_echo_check(input: &str) -> String {
    input
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character.is_ascii_whitespace() {
                character.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn strip_command_prefix(input: &str) -> String {
    let normalized = normalize_text_for_echo_check(input);
    let mut value = normalized.as_str();
    for prefix in [
        "tell me ",
        "can you ",
        "could you ",
        "please ",
        "hey ",
        "hi ",
        "hello ",
    ] {
        if let Some(rest) = value.strip_prefix(prefix) {
            value = rest;
        }
    }
    value.trim().to_string()
}

fn looks_like_direct_question(input: &str) -> bool {
    let raw = input.trim();
    if raw.is_empty() {
        return false;
    }
    let normalized = normalize_text_for_echo_check(input);
    raw.contains('?')
        || [
            "what ", "who ", "when ", "where ", "why ", "how ", "is ", "are ", "do ", "does ",
            "did ", "can ", "could ", "would ", "tell me ",
        ]
        .iter()
        .any(|prefix| normalized.starts_with(prefix))
}

fn looks_like_question_echo(command: &str, response: &str) -> bool {
    let command_normalized = normalize_text_for_echo_check(command);
    let response_normalized = normalize_text_for_echo_check(response);
    if command_normalized.is_empty() || response_normalized.is_empty() {
        return false;
    }
    if response_normalized == command_normalized {
        return true;
    }
    let command_stripped = strip_command_prefix(&command_normalized);
    let response_stripped = strip_command_prefix(&response_normalized);
    if !command_stripped.is_empty()
        && !response_stripped.is_empty()
        && response_stripped == command_stripped
    {
        return true;
    }
    if response_stripped.ends_with(&command_stripped)
        || command_stripped.ends_with(&response_stripped)
    {
        return true;
    }
    false
}

fn build_selected_context_answer_prompt(command: &str, selected_text: &str) -> String {
    let user_request = if command.trim().is_empty() {
        "Explain this selected text."
    } else {
        command.trim()
    };
    format!(
        "The user has selected text in another app and already provided it below.\nUser request: {user_request}\n\nSelected text:\n<<<BEGIN_SELECTED_TEXT>>>\n{selected_text}\n<<<END_SELECTED_TEXT>>>\n\nAnswer the user request using this selected text context.\nDo not ask the user to provide or paste the text again."
    )
}

fn refine_transcript(input: &str, request: &AssistantPipelineRequest) -> String {
    let mut transcript = input.trim().to_string();

    if let Some(snippet_entries) = request.snippet_entries.as_ref() {
        transcript = apply_snippet_expansions(&transcript, snippet_entries);
    }

    if let Some(dictionary_entries) = request.dictionary_entries.as_ref() {
        transcript = apply_dictionary_terms(&transcript, dictionary_entries);
    }

    if request.apply_backtrack.unwrap_or(false) {
        transcript = apply_backtrack_correction(&transcript);
    }

    if request.remove_fillers.unwrap_or(false) {
        transcript = remove_filler_words(&transcript);
    }

    if request.auto_numbered_lists.unwrap_or(false) {
        transcript = apply_numbered_list_formatting(&transcript);
    }

    if request.auto_punctuation.unwrap_or(false) {
        transcript = apply_auto_punctuation(&transcript);
    }

    normalize_spacing(&transcript)
}

fn apply_snippet_expansions(input: &str, snippets: &[SnippetEntryRequest]) -> String {
    let mut current = input.to_string();
    for snippet in snippets {
        let trigger = snippet.trigger.trim();
        let expansion = snippet.expansion.trim();
        if trigger.is_empty() || expansion.is_empty() {
            continue;
        }
        current = replace_case_insensitive_ascii(&current, trigger, expansion);
    }
    current
}

fn apply_dictionary_terms(input: &str, entries: &[DictionaryEntryRequest]) -> String {
    let mut current = input.to_string();
    for entry in entries {
        let source = entry.source.trim();
        let target = entry.target.trim();
        if source.is_empty() || target.is_empty() {
            continue;
        }
        current = replace_case_insensitive_ascii(&current, source, target);
    }
    current
}

fn apply_backtrack_correction(input: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let markers = ["scratch that", "delete that", "undo that", "backtrack"];
    let last_marker = markers
        .iter()
        .filter_map(|marker| lower.rfind(marker).map(|index| (index, *marker)))
        .max_by_key(|(index, _)| *index);

    if let Some((index, _)) = last_marker {
        return input[..index].trim().to_string();
    }

    input.to_string()
}

fn remove_filler_words(input: &str) -> String {
    let phrase_fillers = ["you know", "i mean", "sort of", "kind of"];
    let mut current = input.to_string();
    for phrase in phrase_fillers {
        current = replace_case_insensitive_ascii(&current, phrase, " ");
    }

    let single_fillers = ["um", "uh", "erm", "hmm", "basically"];

    let mut out = String::with_capacity(current.len());
    let mut first = true;
    for token in current.split_whitespace() {
        let trimmed = token
            .trim_matches(|ch: char| !ch.is_alphanumeric())
            .to_ascii_lowercase();
        if single_fillers.contains(&trimmed.as_str()) {
            continue;
        }
        if !first {
            out.push(' ');
        }
        out.push_str(token);
        first = false;
    }

    out
}

fn apply_numbered_list_formatting(input: &str) -> String {
    let lower = input.to_ascii_lowercase();
    if !lower.contains("numbered list") {
        return input.to_string();
    }

    let without_label = replace_case_insensitive_ascii(input, "numbered list", " ");
    let separated = replace_case_insensitive_ascii(&without_label, "next item", "\n");
    let items: Vec<String> = separated
        .split('\n')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect();

    if items.len() < 2 {
        return without_label.trim().to_string();
    }

    items
        .iter()
        .enumerate()
        .map(|(index, item)| format!("{}. {}", index + 1, item))
        .collect::<Vec<_>>()
        .join("\n")
}

fn apply_auto_punctuation(input: &str) -> String {
    let replacements = [
        ("new paragraph", "\n\n"),
        ("new line", "\n"),
        ("question mark", "?"),
        ("exclamation mark", "!"),
        ("semicolon", ";"),
        ("colon", ":"),
        ("comma", ","),
        ("period", "."),
    ];

    let mut current = input.to_string();
    for (spoken, symbol) in replacements {
        current = replace_case_insensitive_ascii(&current, spoken, symbol);
    }

    for (spaced, symbol) in [
        (" ,", ","),
        (" .", "."),
        (" ?", "?"),
        (" !", "!"),
        (" ;", ";"),
        (" :", ":"),
    ] {
        if current.contains(spaced) {
            current = current.replace(spaced, symbol);
        }
    }

    let normalized = normalize_spacing(&current);
    if normalized.is_empty() {
        return normalized;
    }

    if normalized.ends_with('.') || normalized.ends_with('!') || normalized.ends_with('?') {
        return normalized;
    }

    format!("{normalized}.")
}

fn normalize_spacing(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut first_line = true;
    for line in input.lines() {
        let trimmed_line = single_line(line);
        if !first_line {
            out.push('\n');
        }
        out.push_str(&trimmed_line);
        first_line = false;
    }
    out.trim().to_string()
}

fn replace_case_insensitive_ascii(input: &str, needle: &str, replacement: &str) -> String {
    if needle.is_empty() {
        return input.to_string();
    }

    let input_lower = input.to_ascii_lowercase();
    let needle_lower = needle.to_ascii_lowercase();
    let mut cursor = 0usize;
    let mut out = String::with_capacity(input.len());

    while let Some(relative_index) = input_lower[cursor..].find(&needle_lower) {
        let start = cursor + relative_index;
        let end = start + needle_lower.len();
        out.push_str(&input[cursor..start]);
        out.push_str(replacement);
        cursor = end;
    }

    out.push_str(&input[cursor..]);
    out
}

fn piper_digit_word(digit: char) -> Option<&'static str> {
    match digit {
        '0' => Some("zero"),
        '1' => Some("one"),
        '2' => Some("two"),
        '3' => Some("three"),
        '4' => Some("four"),
        '5' => Some("five"),
        '6' => Some("six"),
        '7' => Some("seven"),
        '8' => Some("eight"),
        '9' => Some("nine"),
        _ => None,
    }
}

fn piper_hundreds_to_words(value: u16) -> String {
    let units = [
        "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    ];
    let teens = [
        "ten",
        "eleven",
        "twelve",
        "thirteen",
        "fourteen",
        "fifteen",
        "sixteen",
        "seventeen",
        "eighteen",
        "nineteen",
    ];
    let tens = [
        "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
    ];

    let mut parts = Vec::new();
    let hundreds = value / 100;
    let remainder = value % 100;

    if hundreds > 0 {
        parts.push(format!("{} hundred", units[usize::from(hundreds)]));
    }

    if remainder >= 20 {
        if hundreds > 0 {
            parts.push("and".to_string());
        }
        let ten_index = usize::from(remainder / 10);
        let unit_index = usize::from(remainder % 10);
        if unit_index == 0 {
            parts.push(tens[ten_index].to_string());
        } else {
            parts.push(format!("{} {}", tens[ten_index], units[unit_index]));
        }
    } else if remainder >= 10 {
        if hundreds > 0 {
            parts.push("and".to_string());
        }
        parts.push(teens[usize::from(remainder - 10)].to_string());
    } else if remainder > 0 || parts.is_empty() {
        if hundreds > 0 && remainder > 0 {
            parts.push("and".to_string());
        }
        parts.push(units[usize::from(remainder)].to_string());
    }

    parts.join(" ")
}

fn piper_integer_to_words(value: u64) -> String {
    if value == 0 {
        return "zero".to_string();
    }

    let scales = [
        "",
        "thousand",
        "million",
        "billion",
        "trillion",
        "quadrillion",
        "quintillion",
    ];

    let mut remaining = value;
    let mut chunks = Vec::new();
    let mut scale_index = 0usize;

    while remaining > 0 {
        let chunk = (remaining % 1000) as u16;
        if chunk > 0 {
            let mut words = piper_hundreds_to_words(chunk);
            let scale = scales.get(scale_index).copied().unwrap_or("");
            if !scale.is_empty() {
                words.push(' ');
                words.push_str(scale);
            }
            chunks.push(words);
        }
        remaining /= 1000;
        scale_index += 1;
    }

    chunks.reverse();
    chunks.join(", ")
}

fn piper_digits_to_words(digits: &str) -> Option<String> {
    if digits.is_empty() {
        return None;
    }

    let mut out = Vec::new();
    for digit in digits.chars() {
        let word = piper_digit_word(digit)?;
        out.push(word);
    }

    Some(out.join(" "))
}

fn normalize_piper_numeric_token(token: &str) -> String {
    if token.is_empty() {
        return token.to_string();
    }

    let negative = token.starts_with('-');
    let raw = if negative { &token[1..] } else { token };

    if raw.is_empty() {
        return token.to_string();
    }

    let mut split = raw.split('.');
    let integer_raw = split.next().unwrap_or_default();
    let fractional_raw = split.next();
    if split.next().is_some() {
        return token.to_string();
    }

    let integer_digits = integer_raw.replace(',', "");
    if integer_digits.is_empty() || !integer_digits.chars().all(|ch| ch.is_ascii_digit()) {
        return token.to_string();
    }

    let mut words = if let Ok(parsed) = integer_digits.parse::<u64>() {
        piper_integer_to_words(parsed)
    } else if let Some(digit_words) = piper_digits_to_words(&integer_digits) {
        digit_words
    } else {
        return token.to_string();
    };

    if let Some(fractional) = fractional_raw {
        if !fractional.is_empty() {
            if !fractional.chars().all(|ch| ch.is_ascii_digit()) {
                return token.to_string();
            }
            if let Some(fraction_words) = piper_digits_to_words(fractional) {
                words.push_str(" point ");
                words.push_str(&fraction_words);
            }
        }
    }

    if negative {
        format!("minus {words}")
    } else {
        words
    }
}

fn previous_non_whitespace(chars: &[char], index: usize) -> Option<char> {
    if index == 0 {
        return None;
    }

    let mut cursor = index;
    while cursor > 0 {
        cursor -= 1;
        let candidate = chars[cursor];
        if !candidate.is_whitespace() {
            return Some(candidate);
        }
    }

    None
}

fn next_non_whitespace(chars: &[char], index: usize) -> Option<char> {
    let mut cursor = index + 1;
    while cursor < chars.len() {
        let candidate = chars[cursor];
        if !candidate.is_whitespace() {
            return Some(candidate);
        }
        cursor += 1;
    }
    None
}

fn is_math_operator_between_numbers(chars: &[char], index: usize) -> bool {
    let left = previous_non_whitespace(chars, index);
    let right = next_non_whitespace(chars, index);
    matches!(
        (left, right),
        (Some(l), Some(r)) if l.is_ascii_digit() && r.is_ascii_digit()
    )
}

fn normalize_piper_math_symbols(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut output = String::with_capacity(input.len() + 32);
    let mut index = 0usize;

    while index < chars.len() {
        let current = chars[index];
        let replacement = match current {
            '/' if is_math_operator_between_numbers(&chars, index) => Some(" divided by "),
            '=' if is_math_operator_between_numbers(&chars, index) => Some(" equals "),
            '+' if is_math_operator_between_numbers(&chars, index) => Some(" plus "),
            '-' if is_math_operator_between_numbers(&chars, index) => Some(" minus "),
            _ => None,
        };

        if let Some(replacement) = replacement {
            if !output.ends_with(' ') {
                output.push(' ');
            }
            output.push_str(replacement.trim());
            output.push(' ');
        } else {
            output.push(current);
        }

        index += 1;
    }

    output
}

fn is_numeric_token_start(chars: &[char], index: usize) -> bool {
    let current = chars[index];
    if current.is_ascii_digit() {
        return true;
    }

    if current != '-' || index + 1 >= chars.len() || !chars[index + 1].is_ascii_digit() {
        return false;
    }

    match previous_non_whitespace(chars, index) {
        Some(previous) => !previous.is_ascii_alphanumeric(),
        None => true,
    }
}

fn validate_tts_input_length(text: &str) -> Result<(), String> {
    let count = text.chars().count();
    if count > MAX_TTS_INPUT_LENGTH {
        return Err(format!(
            "TTS input text is too long ({count} characters). Maximum is {MAX_TTS_INPUT_LENGTH}."
        ));
    }
    Ok(())
}

fn normalize_piper_text_for_tts(input: &str) -> String {
    let symbol_normalized = normalize_piper_math_symbols(input);
    let chars: Vec<char> = symbol_normalized.chars().collect();
    let mut output = String::with_capacity(symbol_normalized.len() * 2);
    let mut index = 0usize;

    while index < chars.len() {
        if is_numeric_token_start(&chars, index) {
            let start = index;
            index += 1;

            while index < chars.len() {
                let current = chars[index];
                if current.is_ascii_digit() {
                    index += 1;
                    continue;
                }
                if (current == ',' || current == '.')
                    && index > start
                    && chars[index - 1].is_ascii_digit()
                    && index + 1 < chars.len()
                    && chars[index + 1].is_ascii_digit()
                {
                    index += 1;
                    continue;
                }
                break;
            }

            let token: String = chars[start..index].iter().collect();
            output.push_str(&normalize_piper_numeric_token(&token));
            continue;
        }

        output.push(chars[index]);
        index += 1;
    }

    normalize_spacing(&output)
}

async fn synthesize_with_piper(
    piper_path: String,
    model_path: PathBuf,
    text: String,
    piper: Option<&PiperPipelineRequest>,
) -> Result<Vec<u8>, String> {
    validate_piper_binary_path(&piper_path)?;
    let synth_start = Instant::now();
    let clean_text = text.replace('\r', " ").trim().to_string();

    if clean_text.is_empty() {
        return Err("No text provided for TTS".to_string());
    }
    validate_tts_input_length(&clean_text)?;

    let numeric_stability_mode = clean_text
        .chars()
        .any(|character| character.is_ascii_digit());
    let normalized_text = normalize_piper_text_for_tts(&clean_text);
    if normalized_text.is_empty() {
        return Err("No text provided for Piper TTS after normalization".to_string());
    }

    let base_speed = piper
        .and_then(|config| config.speed)
        .unwrap_or(PIPER_DEFAULT_SPEED)
        .clamp(0.5, 2.0);
    let quality = piper
        .and_then(|config| config.quality.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(PIPER_DEFAULT_QUALITY)
        .to_ascii_lowercase();
    let emotion = piper
        .and_then(|config| config.emotion.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(PIPER_DEFAULT_EMOTION)
        .to_ascii_lowercase();

    let (quality_noise_scale, quality_noise_w) = match quality.as_str() {
        "fast" => (0.60_f32, 0.68_f32),
        "high" => (0.88_f32, 0.94_f32),
        _ => (0.74_f32, 0.82_f32),
    };
    let (emotion_speed_factor, emotion_noise_delta, emotion_noise_w_delta) = match emotion.as_str()
    {
        "calm" => (0.92_f32, -0.08_f32, -0.08_f32),
        "happy" => (1.06_f32, 0.04_f32, 0.05_f32),
        "excited" => (1.14_f32, 0.10_f32, 0.11_f32),
        "serious" => (0.96_f32, -0.03_f32, -0.02_f32),
        "sad" => (0.89_f32, -0.11_f32, -0.10_f32),
        _ => (1.0_f32, 0.0_f32, 0.0_f32),
    };
    let final_speed = (base_speed * emotion_speed_factor).clamp(0.5, 2.0);
    let length_scale = (1.0 / final_speed).clamp(0.5, 2.2);
    let noise_scale = (quality_noise_scale + emotion_noise_delta).clamp(0.35, 1.35);
    let noise_w = (quality_noise_w + emotion_noise_w_delta).clamp(0.45, 1.35);
    let length_scale_arg = format!("{length_scale:.3}");
    let noise_scale_arg = format!("{noise_scale:.3}");
    let noise_w_arg = format!("{noise_w:.3}");

    info!(
        "[piper.synthesize] request speed={} quality={} emotion={} length_scale={} noise_scale={} noise_w={}",
        final_speed,
        quality,
        emotion,
        length_scale_arg,
        noise_scale_arg,
        noise_w_arg
    );
    if normalized_text != clean_text {
        info!(
            "[piper.synthesize] normalized text chars={} source_chars={}",
            normalized_text.chars().count(),
            clean_text.chars().count()
        );
        info!(
            "[piper.synthesize] normalized preview={}",
            clip_text(&normalized_text, 240)
        );
    }
    if numeric_stability_mode {
        info!(
            "[piper.synthesize] numeric stability mode enabled (using Piper defaults for cleaner number speech)"
        );
    }

    tauri::async_runtime::spawn_blocking(move || {
        if !Path::new(&piper_path).exists() {
            return Err(format!("Piper executable was not found at: {piper_path}"));
        }

        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("Failed to compute timestamp: {error}"))?
            .as_millis();

        let output_path = std::env::temp_dir().join(format!("slasshy-tts-{stamp}.wav"));

        let run_once = |with_tuning: bool| -> Result<std::process::Output, String> {
            let mut command = Command::new(&piper_path);
            apply_no_window(&mut command);
            command
                .arg("--model")
                .arg(&model_path)
                .arg("--output_file")
                .arg(&output_path);
            if with_tuning {
                command
                    .arg("--length_scale")
                    .arg(&length_scale_arg)
                    .arg("--noise_scale")
                    .arg(&noise_scale_arg)
                    .arg("--noise_w")
                    .arg(&noise_w_arg);
            }

            let mut child = command
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|error| format!("Failed to start Piper process: {error}"))?;

            {
                let stdin = child
                    .stdin
                    .as_mut()
                    .ok_or_else(|| "Unable to access Piper stdin".to_string())?;

                stdin
                    .write_all(normalized_text.as_bytes())
                    .map_err(|error| format!("Failed writing text to Piper stdin: {error}"))?;
                stdin
                    .write_all(b"\n")
                    .map_err(|error| format!("Failed finalizing Piper stdin: {error}"))?;
            }

            child
                .wait_with_output()
                .map_err(|error| format!("Piper process failed to finish: {error}"))
        };

        let cached_tuning_support = {
            let guard = piper_tuning_support()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *guard
        };
        let should_try_tuning = !numeric_stability_mode && cached_tuning_support.unwrap_or(true);
        if !should_try_tuning && cached_tuning_support == Some(false) {
            info!(
                "[piper.synthesize] tuning args previously marked unsupported; using defaults"
            );
        }

        let output = if should_try_tuning {
            let first_output = run_once(true)?;
            if first_output.status.success() {
                let mut guard = piper_tuning_support()
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                if *guard != Some(true) {
                    *guard = Some(true);
                }
                first_output
            } else {
                let merged = merge_process_output(&first_output.stdout, &first_output.stderr);
                let lower = merged.to_ascii_lowercase();
                let unsupported_flag = lower.contains("unrecognized arguments")
                    || lower.contains("unknown option")
                    || lower.contains("unexpected argument")
                    || lower.contains("invalid choice");
                if unsupported_flag {
                    warn!(
                        "[piper.synthesize] piper runtime does not support tuning args; retrying with defaults"
                    );
                    let mut guard = piper_tuning_support()
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    *guard = Some(false);
                    run_once(false)?
                } else {
                    first_output
                }
            }
        } else {
            run_once(false)?
        };

        if !output.status.success() {
            let merged = merge_process_output(&output.stdout, &output.stderr);
            return Err(format!(
                "Piper synthesis failed: {}",
                clip_text(merged.trim(), 420)
            ));
        }

        let wav_bytes = fs::read(&output_path)
            .map_err(|error| format!("Failed to read generated WAV file: {error}"))?;

        let _ = fs::remove_file(&output_path);

        Ok(wav_bytes)
    })
    .await
    .map_err(|error| format!("Piper synthesis worker failed: {error}"))
    .map(|result| {
        if let Ok(ref wav_bytes) = result {
            info!(
                "[piper.synthesize] success bytes={} latency_ms={}",
                wav_bytes.len(),
                elapsed_ms(synth_start)
            );
        }
        result
    })?
}

async fn synthesize_with_coqui(
    app: &AppHandle,
    coqui: &CoquiPipelineRequest,
    text: String,
) -> Result<Vec<u8>, String> {
    if zero_python_mode_enabled() {
        return Err(ZERO_PYTHON_COQUI_NOTICE.to_string());
    }
    let synth_start = Instant::now();
    let clean_text = text.replace('\r', " ").trim().to_string();
    if clean_text.is_empty() {
        return Err("No text provided for TTS".to_string());
    }
    validate_tts_input_length(&clean_text)?;

    let model_name = coqui
        .model_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(COQUI_DEFAULT_MODEL)
        .to_string();
    let language = coqui
        .language
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(COQUI_DEFAULT_LANGUAGE)
        .to_string();
    let speaker_id = coqui
        .speaker_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Select or clone a Coqui voice before using Coqui TTS.".to_string())?
        .to_string();
    let speed = coqui.speed.unwrap_or(1.0).clamp(0.5, 2.0);
    let quality = coqui
        .quality
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(COQUI_DEFAULT_QUALITY)
        .to_string();
    let emotion = coqui
        .emotion
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(COQUI_DEFAULT_EMOTION)
        .to_string();
    let use_gpu = coqui.use_gpu.unwrap_or(false);
    let split_sentences = coqui.split_sentences.unwrap_or(false);
    let python_path = resolve_coqui_python_path(app, coqui.python_path.as_deref())?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Failed to compute timestamp: {error}"))?
        .as_millis();
    let output_path = std::env::temp_dir().join(format!("slasshy-coqui-tts-{stamp}.wav"));
    let voice_dir = coqui_voices_dir(app)?;

    let app_for_worker = app.clone();
    let python_for_worker = python_path;
    let output_path_for_worker = output_path.clone();
    let voice_dir_for_worker = voice_dir.clone();
    let payload = json!({
      "action": "synthesize",
      "text": clean_text,
      "modelName": model_name,
      "language": language,
      "speakerId": speaker_id,
      "speed": speed,
      "quality": quality,
      "emotion": emotion,
      "useGpu": use_gpu,
      "splitSentences": split_sentences,
      "outputPath": output_path_for_worker.to_string_lossy().to_string(),
      "voiceDir": voice_dir_for_worker.to_string_lossy().to_string(),
    });

    info!(
        "[coqui.synthesize] request speaker={} model={} language={} gpu={} quality={} emotion={} split={}",
        speaker_id,
        payload.get("modelName").and_then(Value::as_str).unwrap_or(COQUI_DEFAULT_MODEL),
        language,
        use_gpu,
        quality,
        emotion,
        split_sentences
    );
    tauri::async_runtime::spawn_blocking(move || {
        run_coqui_bridge(&app_for_worker, &python_for_worker, payload)
    })
    .await
    .map_err(|error| format!("Coqui synthesis worker failed: {error}"))?
    .map(|result| {
        let device = result
            .get("device")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let model_cached = result
            .get("modelCached")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        info!(
            "[coqui.synthesize] bridge done device={} model_cached={}",
            device, model_cached
        );
        result
    })?;

    let wav_bytes = fs::read(&output_path)
        .map_err(|error| format!("Failed to read Coqui output WAV: {error}"))?;
    let _ = fs::remove_file(&output_path);

    info!(
        "[coqui.synthesize] success bytes={} latency_ms={}",
        wav_bytes.len(),
        elapsed_ms(synth_start)
    );

    Ok(wav_bytes)
}

fn extract_text_from_chat_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Array(items) => {
            let mut combined = Vec::new();
            for item in items {
                if let Some(text) = extract_text_from_chat_value(item) {
                    if !text.trim().is_empty() {
                        combined.push(text);
                    }
                }
            }
            if combined.is_empty() {
                None
            } else {
                Some(combined.join("\n"))
            }
        }
        Value::Object(object) => {
            for key in ["text", "content", "output_text", "value", "refusal", "message", "delta"] {
                if let Some(candidate) = object.get(key) {
                    if let Some(text) = extract_text_from_chat_value(candidate) {
                        return Some(text);
                    }
                }
            }
            None
        }
        _ => None,
    }
}

fn extract_chat_content(payload: &Value) -> Option<String> {
    let candidate_paths = [
        "/choices/0/message/content",
        "/choices/0/message",
        "/choices/0/text",
        "/choices/0/delta/content",
        "/output_text",
        "/output/0/content",
        "/response/output_text",
    ];

    for path in candidate_paths {
        if let Some(candidate) = payload.pointer(path) {
            if let Some(text) = extract_text_from_chat_value(candidate) {
                return Some(text);
            }
        }
    }

    None
}

async fn ensure_voice_files(
    app: &AppHandle,
    client: &Client,
) -> Result<(PathBuf, PathBuf), String> {
    let (model_path, config_path) = voice_paths(app)?;

    if !file_exists_with_content(&model_path) {
        download_file(client, VOICE_MODEL_URL, &model_path).await?;
    }

    if !file_exists_with_content(&config_path) {
        download_file(client, VOICE_CONFIG_URL, &config_path).await?;
    }

    Ok((model_path, config_path))
}

async fn ensure_piper_binary(app: &AppHandle, client: &Client) -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let runtime_dir = piper_runtime_dir(app)?;

        if let Some(existing_path) = find_file_by_name(&runtime_dir, PIPER_BINARY_NAME)? {
            return Ok(existing_path);
        }

        let archive_path = runtime_dir.join(PIPER_ARCHIVE_FILE);
        download_file(client, PIPER_ARCHIVE_URL, &archive_path).await?;
        extract_zip_archive(&archive_path, &runtime_dir)?;
        let _ = fs::remove_file(&archive_path);

        return find_file_by_name(&runtime_dir, PIPER_BINARY_NAME)?
            .ok_or_else(|| "Piper archive was extracted but piper.exe was not found".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, client);
        Err(
            "Automatic Piper download is currently implemented for Windows in this build."
                .to_string(),
        )
    }
}

fn validate_piper_binary_path(path: &str) -> Result<(), String> {
    let path_str = path.trim();
    if path_str.is_empty() {
        return Err("Piper binary path is empty.".to_string());
    }

    if path_str.contains(|c: char| matches!(c, '\0' | '\n' | '\r')) {
        return Err("Piper binary path contains invalid characters.".to_string());
    }

    let path_buf = Path::new(path_str);
    let file_name = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid piper binary path.".to_string())?;
    let file_name_lower = file_name.to_ascii_lowercase();

    let allowed_names = ["piper", "piper.exe"];

    if !allowed_names.contains(&file_name_lower.as_str()) {
        return Err(format!(
            "Invalid piper binary name '{}'. Expected one of: {:?}",
            file_name, allowed_names
        ));
    }

    Ok(())
}

fn resolve_piper_path(app: &AppHandle, requested_path: Option<&str>) -> Result<String, String> {
    if let Some(path) = requested_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        validate_piper_binary_path(path)?;
        return Ok(path.to_string());
    }

    if let Some(installed_path) = discover_installed_piper_path(app)? {
        let installed = installed_path.to_string_lossy().into_owned();
        validate_piper_binary_path(&installed)?;
        return Ok(installed);
    }

    Err("Piper is not configured. Click 'Auto Setup Runtime' inside the app first.".to_string())
}

fn resolve_user_home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(value) = std::env::var("USERPROFILE") {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(PathBuf::from(trimmed));
            }
        }

        let drive = std::env::var("HOMEDRIVE").unwrap_or_default();
        let path = std::env::var("HOMEPATH").unwrap_or_default();
        let combined = format!("{drive}{path}");
        let trimmed = combined.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(value) = std::env::var("HOME") {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(PathBuf::from(trimmed));
            }
        }
    }

    None
}

fn legacy_persisted_settings_paths(app: &AppHandle) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(install_dir) = exe_path.parent() {
            if let Some(install_parent) = install_dir.parent() {
                paths.push(
                    install_parent
                        .join(PERSISTED_SETTINGS_DIR_NAME)
                        .join(PERSISTED_SETTINGS_FILE_NAME),
                );
            }
        }
    }

    if let Ok(app_data_dir) = app.path().app_data_dir() {
        paths.push(
            app_data_dir
                .join("persistent")
                .join(PERSISTED_SETTINGS_FILE_NAME),
        );
    }

    let mut deduped = Vec::new();
    let mut seen = BTreeSet::new();
    for path in paths {
        let key = path.to_string_lossy().to_ascii_lowercase();
        if seen.insert(key) {
            deduped.push(path);
        }
    }
    deduped
}

fn resolve_primary_persisted_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidate_dirs: Vec<PathBuf> = Vec::new();

    if let Some(home_dir) = resolve_user_home_dir() {
        candidate_dirs.push(home_dir.join(PERSISTED_SETTINGS_DIR_NAME));
    }

    if let Ok(app_data_dir) = app.path().app_data_dir() {
        candidate_dirs.push(app_data_dir.join("persistent"));
    }

    if candidate_dirs.is_empty() {
        return Err("Unable to resolve a writable settings directory.".to_string());
    }

    let mut last_error: Option<String> = None;
    for candidate_dir in candidate_dirs {
        match fs::create_dir_all(&candidate_dir) {
            Ok(_) => {
                return Ok(candidate_dir.join(PERSISTED_SETTINGS_FILE_NAME));
            }
            Err(error) => {
                let message = format!(
                    "Failed to create settings directory '{}': {error}",
                    candidate_dir.display()
                );
                warn!("[settings] {}", message);
                last_error = Some(message);
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "Unable to create settings directory.".to_string()))
}

fn persisted_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let primary_path = resolve_primary_persisted_settings_path(app)?;
    if primary_path.exists() {
        return Ok(primary_path);
    }

    for legacy_path in legacy_persisted_settings_paths(app) {
        if legacy_path == primary_path || !legacy_path.exists() {
            continue;
        }

        if let Some(parent) = primary_path.parent() {
            if let Err(error) = fs::create_dir_all(parent) {
                warn!(
                    "[settings] failed to create settings migration directory '{}': {}",
                    parent.display(),
                    error
                );
                return Ok(legacy_path);
            }
        }

        match fs::copy(&legacy_path, &primary_path) {
            Ok(_) => {
                info!(
                    "[settings] migrated persisted settings from '{}' to '{}'",
                    legacy_path.display(),
                    primary_path.display()
                );
                return Ok(primary_path);
            }
            Err(error) => {
                warn!(
                    "[settings] failed to migrate persisted settings from '{}' to '{}': {}",
                    legacy_path.display(),
                    primary_path.display(),
                    error
                );
                return Ok(legacy_path);
            }
        }
    }

    Ok(primary_path)
}

fn discover_installed_piper_path(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let runtime_dir = piper_runtime_dir(app)?;
    find_file_by_name(&runtime_dir, PIPER_BINARY_NAME)
}

fn piper_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;

    let runtime_dir = app_data.join("piper").join("runtime");
    fs::create_dir_all(&runtime_dir)
        .map_err(|error| format!("Failed to create Piper runtime directory: {error}"))?;

    Ok(runtime_dir)
}

fn voice_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;

    let voice_dir = app_data.join("piper").join("en_US_hfc_female_medium");
    fs::create_dir_all(&voice_dir)
        .map_err(|error| format!("Failed to create voice directory: {error}"))?;

    Ok((
        voice_dir.join(VOICE_MODEL_FILE),
        voice_dir.join(VOICE_CONFIG_FILE),
    ))
}

fn coqui_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    let root = app_data.join("coqui");
    fs::create_dir_all(&root)
        .map_err(|error| format!("Failed to create Coqui root directory: {error}"))?;
    Ok(root)
}

fn coqui_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let runtime_dir = coqui_root_dir(app)?.join("runtime");
    fs::create_dir_all(&runtime_dir)
        .map_err(|error| format!("Failed to create Coqui runtime directory: {error}"))?;
    Ok(runtime_dir)
}

fn coqui_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let cache_dir = coqui_root_dir(app)?.join("cache");
    fs::create_dir_all(&cache_dir)
        .map_err(|error| format!("Failed to create Coqui cache directory: {error}"))?;
    Ok(cache_dir)
}

fn coqui_voices_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let voice_dir = coqui_root_dir(app)?.join("voices");
    fs::create_dir_all(&voice_dir)
        .map_err(|error| format!("Failed to create Coqui voices directory: {error}"))?;
    Ok(voice_dir)
}

fn coqui_uploads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let uploads_dir = coqui_root_dir(app)?.join("uploads");
    fs::create_dir_all(&uploads_dir)
        .map_err(|error| format!("Failed to create Coqui uploads directory: {error}"))?;
    Ok(uploads_dir)
}

fn coqui_previews_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let previews_dir = coqui_root_dir(app)?.join("previews");
    fs::create_dir_all(&previews_dir)
        .map_err(|error| format!("Failed to create Coqui previews directory: {error}"))?;
    Ok(previews_dir)
}

fn coqui_venv_python_path(app: &AppHandle) -> Result<PathBuf, String> {
    let runtime_dir = coqui_runtime_dir(app)?;
    #[cfg(target_os = "windows")]
    {
        Ok(runtime_dir.join("venv").join("Scripts").join("python.exe"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(runtime_dir.join("venv").join("bin").join("python"))
    }
}

fn ensure_coqui_bridge_script(app: &AppHandle) -> Result<PathBuf, String> {
    let runtime_dir = coqui_runtime_dir(app)?;
    let script_path = runtime_dir.join("coqui_bridge.py");
    let should_write = fs::read_to_string(&script_path)
        .map(|existing| existing != COQUI_BRIDGE_SCRIPT)
        .unwrap_or(true);

    if should_write {
        stop_all_coqui_bridge_daemons();
        fs::write(&script_path, COQUI_BRIDGE_SCRIPT)
            .map_err(|error| format!("Failed to write Coqui bridge script: {error}"))?;
    }

    Ok(script_path)
}

fn validate_python_binary_path(path: &str) -> Result<(), String> {
    let path_str = path.trim();
    if path_str.is_empty() {
        return Err("Python binary path is empty.".to_string());
    }

    if path_str.contains(|c: char| matches!(c, '\0' | '\n' | '\r')) {
        return Err("Python binary path contains invalid characters.".to_string());
    }

    let path_buf = Path::new(path_str);
    let file_name = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid python binary path.".to_string())?;
    let file_name_lower = file_name.to_ascii_lowercase();

    let normalized = file_name_lower
        .strip_suffix(".exe")
        .unwrap_or(file_name_lower.as_str());
    let is_python3_with_version = normalized
        .strip_prefix("python3.")
        .map(|suffix| {
            !suffix.is_empty()
                && suffix
                    .chars()
                    .all(|character| character.is_ascii_digit() || character == '.')
        })
        .unwrap_or(false);

    if !matches!(normalized, "python" | "python3" | "pythonw" | "py") && !is_python3_with_version
    {
        return Err(format!(
            "Invalid python binary name '{}'. Expected a python executable name.",
            file_name
        ));
    }

    Ok(())
}

fn resolve_coqui_python_path(
    app: &AppHandle,
    requested_path: Option<&str>,
) -> Result<String, String> {
    if let Some(path) = requested_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        validate_python_binary_path(path)?;
        return Ok(path.to_string());
    }

    let venv_python = coqui_venv_python_path(app)?;
    if file_exists_with_content(&venv_python) {
        let resolved = venv_python.to_string_lossy().into_owned();
        validate_python_binary_path(&resolved)?;
        return Ok(resolved);
    }

    validate_python_binary_path("python")?;
    Ok("python".to_string())
}

fn detect_nvidia_gpu() -> bool {
    let output = {
        let mut command = Command::new("nvidia-smi");
        apply_no_window(&mut command);
        command
            .arg("-L")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
    };
    let Ok(output) = output else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let text = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
    text.contains("gpu")
}

fn setup_coqui_runtime_blocking(
    app: &AppHandle,
    bootstrap_python: &str,
    use_gpu: bool,
) -> Result<(String, String), String> {
    validate_python_binary_path(bootstrap_python)?;
    let runtime_dir = coqui_runtime_dir(app)?;
    let venv_dir = runtime_dir.join("venv");
    let venv_python_path = coqui_venv_python_path(app)?;
    let tts_home = coqui_cache_dir(app)?;
    let mut details = Vec::new();
    stop_all_coqui_bridge_daemons();
    details.push("Stopped active Coqui bridge daemons before runtime update.".to_string());
    let nvidia_detected = detect_nvidia_gpu();
    let prefer_gpu_runtime = use_gpu || nvidia_detected;

    if prefer_gpu_runtime {
        if use_gpu {
            details.push("GPU runtime preference: enabled by user.".to_string());
        } else {
            details.push(
                "GPU runtime preference: auto-enabled because NVIDIA GPU was detected.".to_string(),
            );
        }
    } else {
        details.push("GPU runtime preference: CPU-only mode.".to_string());
    }

    if !file_exists_with_content(&venv_python_path) {
        let mut create_venv = Command::new(bootstrap_python);
        apply_no_window(&mut create_venv);
        create_venv
            .arg("-m")
            .arg("venv")
            .arg(&venv_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let output = create_venv
            .output()
            .map_err(|error| format!("Failed to create Coqui virtualenv: {error}"))?;
        if !output.status.success() {
            let merged = merge_process_output(&output.stdout, &output.stderr);
            return Err(format!(
                "Coqui virtualenv creation failed: {}",
                clip_text(merged.trim(), 420)
            ));
        }
        details.push(format!(
            "Created virtualenv at {}.",
            venv_dir.to_string_lossy()
        ));
    }

    let venv_python = venv_python_path.to_string_lossy().to_string();
    let pip_upgrade_output = run_python_command(
        &venv_python,
        &["-m", "pip", "install", "--upgrade", "pip"],
        &tts_home,
    )?;
    if !pip_upgrade_output.trim().is_empty() {
        details.push(format!(
            "pip: {}",
            clip_text(&single_line(&pip_upgrade_output), 220)
        ));
    }

    let package_candidates: Vec<&str> = if prefer_gpu_runtime {
        vec!["coqui-tts[codec]", "coqui-tts", "TTS"]
    } else {
        vec![
            "coqui-tts[cpu,codec]",
            "coqui-tts[cpu]",
            "coqui-tts[codec]",
            "coqui-tts",
            "TTS",
        ]
    };
    let mut install_errors = Vec::new();
    let mut installed_package = "";
    let mut install_output = String::new();

    for candidate in package_candidates {
        match run_python_command(
            &venv_python,
            &["-m", "pip", "install", "--upgrade", candidate],
            &tts_home,
        ) {
            Ok(output) => {
                installed_package = candidate;
                install_output = output;
                break;
            }
            Err(error) => install_errors.push(format!("{candidate}: {error}")),
        }
    }

    if installed_package.is_empty() {
        return Err(format!(
            "Failed to install Coqui packages. {}",
            clip_text(&install_errors.join(" | "), 520)
        ));
    }

    details.push(format!("Installed {installed_package}."));
    if !install_output.trim().is_empty() {
        details.push(format!(
            "install: {}",
            clip_text(&single_line(&install_output), 260)
        ));
    }

    // Pin torch/torchaudio to the 2.8 line to avoid torchcodec/FFmpeg hard dependency
    // that breaks voice-clone audio loading in newer releases.
    let torch_candidates: Vec<(&str, Vec<&str>)> = if prefer_gpu_runtime {
        vec![
            (
                "CUDA (cu128) torch==2.8.0 + torchaudio==2.8.0",
                vec![
                    "-m",
                    "pip",
                    "install",
                    "--upgrade",
                    "--force-reinstall",
                    "torch==2.8.0",
                    "torchaudio==2.8.0",
                    "--index-url",
                    "https://download.pytorch.org/whl/cu128",
                ],
            ),
            (
                "CUDA (cu124) torch==2.8.0 + torchaudio==2.8.0",
                vec![
                    "-m",
                    "pip",
                    "install",
                    "--upgrade",
                    "--force-reinstall",
                    "torch==2.8.0",
                    "torchaudio==2.8.0",
                    "--index-url",
                    "https://download.pytorch.org/whl/cu124",
                ],
            ),
            (
                "CPU torch==2.8.0 + torchaudio==2.8.0 fallback",
                vec![
                    "-m",
                    "pip",
                    "install",
                    "--upgrade",
                    "--force-reinstall",
                    "torch==2.8.0",
                    "torchaudio==2.8.0",
                ],
            ),
        ]
    } else {
        vec![(
            "CPU torch==2.8.0 + torchaudio==2.8.0",
            vec![
                "-m",
                "pip",
                "install",
                "--upgrade",
                "--force-reinstall",
                "torch==2.8.0",
                "torchaudio==2.8.0",
            ],
        )]
    };

    let mut torch_install_output = String::new();
    let mut torch_install_label = "";
    let mut torch_install_errors = Vec::new();
    for (label, args) in torch_candidates {
        match run_python_command(&venv_python, &args, &tts_home) {
            Ok(output) => {
                torch_install_label = label;
                torch_install_output = output;
                break;
            }
            Err(error) => torch_install_errors.push(format!("{label}: {error}")),
        }
    }

    if torch_install_label.is_empty() {
        return Err(format!(
            "Failed to install PyTorch runtime for Coqui. {}",
            clip_text(&torch_install_errors.join(" | "), 520)
        ));
    }

    details.push(format!("Installed {torch_install_label}."));
    if !torch_install_output.trim().is_empty() {
        details.push(format!(
            "torch: {}",
            clip_text(&single_line(&torch_install_output), 260)
        ));
    }

    // torchcodec is not needed on the pinned torch 2.8 line; remove stale installs if present.
    match run_python_command(
        &venv_python,
        &["-m", "pip", "uninstall", "-y", "torchcodec"],
        &tts_home,
    ) {
        Ok(remove_output) => {
            details.push("Removed torchcodec for stable Coqui audio I/O.".to_string());
            if !remove_output.trim().is_empty() {
                details.push(format!(
                    "torchcodec: {}",
                    clip_text(&single_line(&remove_output), 260)
                ));
            }
        }
        Err(error) => {
            details.push(format!(
                "torchcodec cleanup warning: {}",
                clip_text(&single_line(&error), 260)
            ));
        }
    }

    // Coqui currently breaks with transformers 5.x, and older 4.x builds can miss symbols too.
    // Pin to a known-compatible window.
    let transformer_pin_output = run_python_command(
        &venv_python,
        &["-m", "pip", "install", "--upgrade", "transformers>=4.57,<5"],
        &tts_home,
    )?;
    details.push("Pinned transformers>=4.57,<5 for Coqui compatibility.".to_string());
    if !transformer_pin_output.trim().is_empty() {
        details.push(format!(
            "transformers: {}",
            clip_text(&single_line(&transformer_pin_output), 260)
        ));
    }

    stop_all_coqui_bridge_daemons();
    details.push("Cleared Coqui bridge daemon cache after runtime setup.".to_string());

    Ok((venv_python, details.join(" ")))
}

fn run_python_command(python_path: &str, args: &[&str], tts_home: &Path) -> Result<String, String> {
    let mut command = Command::new(python_path);
    apply_no_window(&mut command);
    command.args(args);
    command
        .env("TTS_HOME", tts_home)
        .env("COQUI_TOS_AGREED", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = command
        .output()
        .map_err(|error| format!("Failed to run Python command: {error}"))?;
    if !output.status.success() {
        let merged = merge_process_output(&output.stdout, &output.stderr);
        return Err(format!(
            "Python command failed: {}",
            clip_text(merged.trim(), 420)
        ));
    }
    Ok(merge_process_output(&output.stdout, &output.stderr))
}

fn stop_all_coqui_bridge_daemons() {
    let registry = coqui_daemons();
    let mut guard = match registry.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };

    for (_, mut daemon) in guard.drain() {
        let _ = daemon.child.kill();
        let _ = daemon.child.wait();
    }
}

fn stop_all_local_stt_bridge_daemons_with_count() -> usize {
    let registry = local_stt_daemons();
    let mut guard = match registry.lock() {
        Ok(guard) => guard,
        Err(_) => return 0,
    };

    let count = guard.len();
    for (_, mut daemon) in guard.drain() {
        let _ = daemon.child.kill();
        let _ = daemon.child.wait();
    }
    count
}

fn stop_all_local_stt_bridge_daemons() {
    let _ = stop_all_local_stt_bridge_daemons_with_count();
}

fn trim_all_local_stt_bridge_daemon_model_caches() -> Result<(usize, usize), String> {
    let registry = local_stt_daemons();
    let mut guard = registry
        .lock()
        .map_err(|_| "Failed to lock local STT daemon registry.".to_string())?;

    if guard.is_empty() {
        return Ok((0, 0));
    }

    let trim_payload = json!({ "action": "trim_cache" });
    let keys = guard.keys().cloned().collect::<Vec<_>>();
    let mut trimmed = 0usize;
    let mut failed_keys: Vec<String> = Vec::new();

    for key in keys {
        let Some(daemon) = guard.get_mut(&key) else {
            continue;
        };
        daemon.last_used = Instant::now();
        match send_local_stt_daemon_request(daemon, "trim_cache", &trim_payload) {
            Ok(_) => {
                daemon.model_loaded = false;
                trimmed += 1;
                info!(
                    "[local.stt.daemon] model cache trimmed key={}",
                    clip_text(&key, 180)
                );
            }
            Err(error) => {
                warn!(
                    "[local.stt.daemon] trim_cache failed key={} error={}",
                    clip_text(&key, 180),
                    clip_text(&single_line(&error), 320)
                );
                failed_keys.push(key);
            }
        }
    }

    let mut stopped = 0usize;
    for key in failed_keys {
        if let Some(mut daemon) = guard.remove(&key) {
            let _ = daemon.child.kill();
            let _ = daemon.child.wait();
            stopped += 1;
            info!(
                "[local.stt.daemon] stopped daemon after trim failure key={}",
                clip_text(&key, 180)
            );
        }
    }

    Ok((trimmed, stopped))
}

fn local_stt_daemon_action_loads_model(action: &str) -> bool {
    matches!(
        action,
        "warmup_parakeet" | "transcribe_parakeet" | "warmup_hf_asr" | "transcribe_hf_asr"
    )
}

fn local_stt_daemon_action_trims_model(action: &str) -> bool {
    action == "trim_cache"
}

fn stop_idle_local_stt_bridge_daemons() {
    let registry = local_stt_daemons();
    let mut guard = match registry.try_lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };

    let now = Instant::now();
    let unload_timeout_secs = local_stt_model_unload_idle_timeout_secs();
    let idle_timeout_secs = local_stt_daemon_idle_timeout_secs();
    let unload_timeout = Duration::from_secs(unload_timeout_secs);
    let idle_timeout = Duration::from_secs(idle_timeout_secs);
    let mut stale_keys: Vec<String> = Vec::new();
    for (key, daemon) in guard.iter_mut() {
        let idle_for = now.duration_since(daemon.last_used);
        if idle_for >= idle_timeout {
            stale_keys.push(key.clone());
            continue;
        }
        if idle_for >= unload_timeout && daemon.model_loaded {
            let trim_payload = json!({ "action": "trim_cache" });
            match send_local_stt_daemon_request(daemon, "trim_cache", &trim_payload) {
                Ok(_) => {
                    daemon.model_loaded = false;
                    info!(
                        "[local.stt.daemon] trimmed idle model cache key={} idle_secs={} unload_after_secs={}",
                        clip_text(key, 180),
                        idle_for.as_secs(),
                        unload_timeout_secs
                    );
                }
                Err(error) => {
                    warn!(
                        "[local.stt.daemon] trim_cache failed key={} error={}",
                        clip_text(key, 180),
                        clip_text(&single_line(&error), 320)
                    );
                    stale_keys.push(key.clone());
                }
            }
        }
    }

    for key in stale_keys {
        if let Some(mut daemon) = guard.remove(&key) {
            let _ = daemon.child.kill();
            let _ = daemon.child.wait();
            info!(
                "[local.stt.daemon] stopped idle daemon key={} timeout_secs={}",
                clip_text(&key, 180),
                idle_timeout_secs
            );
        }
    }
}

fn stop_idle_local_stt_native_parakeet_runtime() {
    let unload_timeout_secs = local_stt_model_unload_idle_timeout_secs();
    let unload_timeout = Duration::from_secs(unload_timeout_secs);
    let runtime = local_stt_native_parakeet_runtime();
    let mut guard = match runtime.try_lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };

    let should_unload = guard
        .as_ref()
        .map(|active| active.last_used.elapsed() >= unload_timeout)
        .unwrap_or(false);
    if !should_unload {
        return;
    }

    if let Some(mut active) = guard.take() {
        let _ = active.engine.unload_model();
        info!(
            "[local.stt.parakeet.native] trimmed idle model cache key={} unload_after_secs={}",
            clip_text(&active.model_key, 220),
            unload_timeout_secs
        );
    }
}

fn ensure_local_stt_daemon_idle_sweeper() {
    if LOCAL_STT_DAEMON_SWEEPER_STARTED.set(()).is_err() {
        return;
    }

    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(local_stt_daemon_sweep_interval_secs()));
        stop_idle_local_stt_bridge_daemons();
        stop_idle_local_stt_native_parakeet_runtime();
    });
}

fn spawn_local_stt_bridge_daemon(
    python_path: &str,
    script_path: &Path,
    cache_dir: &Path,
) -> Result<LocalSttBridgeDaemon, String> {
    validate_python_binary_path(python_path)?;
    let parakeet_cpu_int8 = if env_flag(LOCAL_STT_PARAKEET_CPU_INT8_ENV, true) {
        "1"
    } else {
        "0"
    };
    let parakeet_force_cpu = if env_flag(LOCAL_STT_PARAKEET_FORCE_CPU_ENV, false) {
        "1"
    } else {
        "0"
    };

    let mut command = Command::new(python_path);
    apply_no_window(&mut command);
    command
        .arg(script_path)
        .arg("--daemon")
        .env("HF_HOME", cache_dir)
        .env("TRANSFORMERS_CACHE", cache_dir)
        .env("NEMO_CACHE_DIR", cache_dir)
        .env("SLASSHY_STT_PARAKEET_CPU_INT8", parakeet_cpu_int8)
        .env("SLASSHY_STT_PARAKEET_FORCE_CPU", parakeet_force_cpu)
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start local STT bridge daemon: {error}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open stdin for local STT daemon.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open stdout for local STT daemon.".to_string())?;

    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        let compact = clip_text(&single_line(&text), 420);
                        if !compact.trim().is_empty() {
                            info!("[local.stt.daemon][stderr] {}", compact);
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    Ok(LocalSttBridgeDaemon {
        child,
        stdin,
        stdout: BufReader::new(stdout),
        last_used: Instant::now(),
        model_loaded: false,
    })
}

fn send_local_stt_daemon_request(
    daemon: &mut LocalSttBridgeDaemon,
    action: &str,
    payload: &Value,
) -> Result<Value, String> {
    let request_json = serde_json::to_string(payload)
        .map_err(|error| format!("Failed to serialize local STT daemon request: {error}"))?;
    daemon
        .stdin
        .write_all(request_json.as_bytes())
        .map_err(|error| format!("Failed to write local STT daemon request body: {error}"))?;
    daemon
        .stdin
        .write_all(b"\n")
        .map_err(|error| format!("Failed to finalize local STT daemon request line: {error}"))?;
    daemon
        .stdin
        .flush()
        .map_err(|error| format!("Failed to flush local STT daemon stdin: {error}"))?;

    let mut noisy_output = String::new();
    loop {
        let mut line = String::new();
        let bytes = daemon
            .stdout
            .read_line(&mut line)
            .map_err(|error| format!("Failed to read local STT daemon response: {error}"))?;
        if bytes == 0 {
            let status = daemon
                .child
                .try_wait()
                .ok()
                .flatten()
                .map(|exit| exit.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let details = if noisy_output.trim().is_empty() {
                status
            } else {
                format!(
                    "{status}; output={}",
                    clip_text(&single_line(&noisy_output), 420)
                )
            };
            return Err(format!(
                "Local STT daemon stream closed during action '{action}': {details}"
            ));
        }

        let candidate = line.trim();
        if candidate.is_empty() {
            continue;
        }

        let parsed = match serde_json::from_str::<Value>(candidate) {
            Ok(parsed) => Some(parsed),
            Err(_) => extract_json_value_from_output(candidate),
        };

        if let Some(parsed) = parsed {
            let ok = parsed.get("ok").and_then(Value::as_bool).unwrap_or(false);
            if !ok {
                let bridge_error = parsed
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let error_text = if bridge_error.trim().is_empty() {
                    candidate.to_string()
                } else {
                    bridge_error.to_string()
                };
                return Err(format!(
                    "Local STT bridge failed: {}",
                    clip_text(error_text.trim(), 420)
                ));
            }
            return Ok(parsed.get("result").cloned().unwrap_or(Value::Null));
        }

        if !noisy_output.is_empty() {
            noisy_output.push(' ');
        }
        noisy_output.push_str(candidate);
        if noisy_output.chars().count() > 1600 {
            noisy_output = clip_text(&noisy_output, 1600);
        }
    }
}

fn run_local_stt_bridge_via_daemon(
    python_path: &str,
    script_path: &Path,
    cache_dir: &Path,
    action: &str,
    payload: &Value,
) -> Result<Value, String> {
    let key = local_stt_daemon_key(python_path, script_path);
    let registry = local_stt_daemons();
    let mut guard = registry
        .lock()
        .map_err(|_| "Failed to lock local STT daemon registry.".to_string())?;

    if !guard.contains_key(&key) {
        info!(
            "[local.stt.daemon] starting python={} script={}",
            python_path,
            script_path.to_string_lossy()
        );
        let daemon = spawn_local_stt_bridge_daemon(python_path, script_path, cache_dir)?;
        guard.insert(key.clone(), daemon);
    }

    let first_attempt = {
        let daemon = guard
            .get_mut(&key)
            .ok_or_else(|| "Local STT daemon instance is unavailable.".to_string())?;
        daemon.last_used = Instant::now();
        send_local_stt_daemon_request(daemon, action, payload)
    };

    match first_attempt {
        Ok(result) => {
            if let Some(daemon) = guard.get_mut(&key) {
                daemon.last_used = Instant::now();
                let unloaded_after_transcribe = action == "transcribe_parakeet"
                    && result
                        .get("unloadedAfterTranscribe")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                if local_stt_daemon_action_loads_model(action) {
                    daemon.model_loaded = !unloaded_after_transcribe;
                }
                if local_stt_daemon_action_trims_model(action) {
                    daemon.model_loaded = false;
                }
            }
            info!("[local.stt.daemon] success action={}", action);
            Ok(result)
        }
        Err(first_error) => {
            warn!(
                "[local.stt.daemon] request failed action={} error={}",
                action,
                clip_text(&single_line(&first_error), 420)
            );
            if let Some(mut stale) = guard.remove(&key) {
                let _ = stale.child.kill();
                let _ = stale.child.wait();
            }

            info!("[local.stt.daemon] restarting after failure action={}", action);
            let mut daemon = spawn_local_stt_bridge_daemon(python_path, script_path, cache_dir)?;
            let retry = send_local_stt_daemon_request(&mut daemon, action, payload);
            match retry {
                Ok(result) => {
                    daemon.last_used = Instant::now();
                    let unloaded_after_transcribe = action == "transcribe_parakeet"
                        && result
                            .get("unloadedAfterTranscribe")
                            .and_then(Value::as_bool)
                            .unwrap_or(false);
                    if local_stt_daemon_action_loads_model(action) {
                        daemon.model_loaded = !unloaded_after_transcribe;
                    }
                    if local_stt_daemon_action_trims_model(action) {
                        daemon.model_loaded = false;
                    }
                    guard.insert(key, daemon);
                    info!("[local.stt.daemon] success action={} retry=true", action);
                    Ok(result)
                }
                Err(retry_error) => Err(format!(
                    "Local STT daemon request failed: {} | retry: {}",
                    clip_text(&single_line(&first_error), 420),
                    clip_text(&single_line(&retry_error), 420)
                )),
            }
        }
    }
}

fn spawn_coqui_bridge_daemon(
    python_path: &str,
    script_path: &Path,
    cache_dir: &Path,
) -> Result<CoquiBridgeDaemon, String> {
    validate_python_binary_path(python_path)?;
    let mut command = Command::new(python_path);
    apply_no_window(&mut command);
    command
        .arg(script_path)
        .arg("--daemon")
        .env("TTS_HOME", cache_dir)
        .env("COQUI_TOS_AGREED", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start Coqui bridge daemon: {error}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open stdin for Coqui daemon.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open stdout for Coqui daemon.".to_string())?;

    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        let compact = clip_text(&single_line(&text), 420);
                        if !compact.trim().is_empty() {
                            info!("[coqui.daemon][stderr] {}", compact);
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    Ok(CoquiBridgeDaemon {
        child,
        stdin,
        stdout: BufReader::new(stdout),
    })
}

fn send_coqui_daemon_request(
    daemon: &mut CoquiBridgeDaemon,
    action: &str,
    payload: &Value,
) -> Result<Value, String> {
    let request_json = serde_json::to_string(payload)
        .map_err(|error| format!("Failed to serialize Coqui daemon request: {error}"))?;
    daemon
        .stdin
        .write_all(request_json.as_bytes())
        .map_err(|error| format!("Failed to write Coqui daemon request body: {error}"))?;
    daemon
        .stdin
        .write_all(b"\n")
        .map_err(|error| format!("Failed to finalize Coqui daemon request line: {error}"))?;
    daemon
        .stdin
        .flush()
        .map_err(|error| format!("Failed to flush Coqui daemon stdin: {error}"))?;

    let mut noisy_output = String::new();
    loop {
        let mut line = String::new();
        let bytes = daemon
            .stdout
            .read_line(&mut line)
            .map_err(|error| format!("Failed to read Coqui daemon response: {error}"))?;
        if bytes == 0 {
            let status = daemon
                .child
                .try_wait()
                .ok()
                .flatten()
                .map(|exit| exit.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let details = if noisy_output.trim().is_empty() {
                status
            } else {
                format!(
                    "{status}; output={}",
                    clip_text(&single_line(&noisy_output), 420)
                )
            };
            return Err(format!(
                "Coqui daemon stream closed during action '{action}': {details}"
            ));
        }

        let candidate = line.trim();
        if candidate.is_empty() {
            continue;
        }

        let parsed = match serde_json::from_str::<Value>(candidate) {
            Ok(parsed) => Some(parsed),
            Err(_) => extract_json_value_from_output(candidate),
        };

        if let Some(parsed) = parsed {
            let ok = parsed.get("ok").and_then(Value::as_bool).unwrap_or(false);
            if !ok {
                let bridge_error = parsed
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let error_text = if bridge_error.trim().is_empty() {
                    candidate.to_string()
                } else {
                    bridge_error.to_string()
                };
                return Err(format!(
                    "Coqui bridge failed: {}",
                    clip_text(error_text.trim(), 420)
                ));
            }
            return Ok(parsed.get("result").cloned().unwrap_or(Value::Null));
        }

        if !noisy_output.is_empty() {
            noisy_output.push(' ');
        }
        noisy_output.push_str(candidate);
        if noisy_output.chars().count() > 1600 {
            noisy_output = clip_text(&noisy_output, 1600);
        }
    }
}

fn run_coqui_bridge_via_daemon(
    python_path: &str,
    script_path: &Path,
    cache_dir: &Path,
    action: &str,
    payload: &Value,
) -> Result<Value, String> {
    let key = coqui_daemon_key(python_path, script_path);
    let registry = coqui_daemons();
    let mut guard = registry
        .lock()
        .map_err(|_| "Failed to lock Coqui daemon registry.".to_string())?;

    if !guard.contains_key(&key) {
        info!(
            "[coqui.daemon] starting python={} script={}",
            python_path,
            script_path.to_string_lossy()
        );
        let daemon = spawn_coqui_bridge_daemon(python_path, script_path, cache_dir)?;
        guard.insert(key.clone(), daemon);
    }

    let first_attempt = {
        let daemon = guard
            .get_mut(&key)
            .ok_or_else(|| "Coqui daemon instance is unavailable.".to_string())?;
        send_coqui_daemon_request(daemon, action, payload)
    };

    match first_attempt {
        Ok(result) => {
            info!("[coqui.daemon] success action={}", action);
            Ok(result)
        }
        Err(first_error) => {
            warn!(
                "[coqui.daemon] request failed action={} error={}",
                action,
                clip_text(&single_line(&first_error), 420)
            );
            if let Some(mut stale) = guard.remove(&key) {
                let _ = stale.child.kill();
                let _ = stale.child.wait();
            }

            info!("[coqui.daemon] restarting after failure action={}", action);
            let mut daemon = spawn_coqui_bridge_daemon(python_path, script_path, cache_dir)?;
            let retry = send_coqui_daemon_request(&mut daemon, action, payload);
            match retry {
                Ok(result) => {
                    guard.insert(key, daemon);
                    info!("[coqui.daemon] success action={} retry=true", action);
                    Ok(result)
                }
                Err(retry_error) => Err(format!(
                    "Coqui daemon request failed: {} | retry: {}",
                    clip_text(&single_line(&first_error), 420),
                    clip_text(&single_line(&retry_error), 420)
                )),
            }
        }
    }
}

fn parse_coqui_bridge_response(
    action: &str,
    status_ok: bool,
    stdout_text: &str,
    stderr_text: &str,
) -> Result<Value, String> {
    let parsed: Value = match serde_json::from_str(stdout_text) {
        Ok(parsed) => parsed,
        Err(error) => {
            if let Some(recovered) = extract_json_value_from_output(stdout_text) {
                warn!(
                    "[coqui.bridge] recovered json after noisy stdout action={} output={}",
                    action,
                    clip_text(&single_line(stdout_text), 420)
                );
                recovered
            } else {
                let merged = if stderr_text.is_empty() {
                    stdout_text.to_string()
                } else {
                    format!("{stdout_text} {stderr_text}")
                };
                error!(
                    "[coqui.bridge] invalid json action={} error={} output={}",
                    action,
                    error,
                    clip_text(&single_line(&merged), 420)
                );
                return Err(format!(
                    "Invalid Coqui bridge response: {error}. Output: {}",
                    clip_text(merged.trim(), 420)
                ));
            }
        }
    };

    let ok = parsed.get("ok").and_then(Value::as_bool).unwrap_or(false);
    if !status_ok || !ok {
        let bridge_error = parsed
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let merged = if bridge_error.trim().is_empty() {
            if stderr_text.is_empty() {
                stdout_text.to_string()
            } else {
                stderr_text.to_string()
            }
        } else {
            bridge_error.to_string()
        };
        error!(
            "[coqui.bridge] failed action={} error={}",
            action,
            clip_text(&single_line(&merged), 420)
        );
        return Err(format!(
            "Coqui bridge failed: {}",
            clip_text(merged.trim(), 420)
        ));
    }

    Ok(parsed.get("result").cloned().unwrap_or(Value::Null))
}

fn run_coqui_bridge(app: &AppHandle, python_path: &str, payload: Value) -> Result<Value, String> {
    validate_python_binary_path(python_path)?;
    let runtime_dir = coqui_runtime_dir(app)?;
    let cache_dir = coqui_cache_dir(app)?;
    let script_path = ensure_coqui_bridge_script(app)?;
    let action = payload
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();

    info!(
        "[coqui.bridge] start action={} python={} script={}",
        action,
        python_path,
        script_path.to_string_lossy()
    );

    let use_daemon_transport = matches!(action.as_str(), "synthesize" | "clone_voice");
    if use_daemon_transport {
        return run_coqui_bridge_via_daemon(
            python_path,
            &script_path,
            &cache_dir,
            &action,
            &payload,
        );
    }

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Failed to compute timestamp: {error}"))?
        .as_millis();
    let request_path = runtime_dir.join(format!("coqui-request-{stamp}.json"));
    let request_json = serde_json::to_vec(&payload)
        .map_err(|error| format!("Failed to serialize Coqui request: {error}"))?;
    fs::write(&request_path, request_json)
        .map_err(|error| format!("Failed to write Coqui request file: {error}"))?;

    let mut command = Command::new(python_path);
    apply_no_window(&mut command);
    command
        .arg(&script_path)
        .arg("--request")
        .arg(&request_path)
        .env("TTS_HOME", &cache_dir)
        .env("COQUI_TOS_AGREED", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = command
        .output()
        .map_err(|error| format!("Failed to execute Coqui bridge: {error}"))?;
    let _ = fs::remove_file(&request_path);

    let stdout_text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr_text = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        warn!(
            "[coqui.bridge] non-zero exit action={} status={} stderr={}",
            action,
            output.status,
            clip_text(&single_line(&stderr_text), 420)
        );
    }
    let result =
        parse_coqui_bridge_response(&action, output.status.success(), &stdout_text, &stderr_text)?;
    info!("[coqui.bridge] success action={}", action);
    Ok(result)
}

fn normalize_release_version(tag: &str) -> String {
    tag.trim().trim_start_matches('v').trim().to_string()
}

fn non_empty_env_var(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn env_flag(name: &str, default: bool) -> bool {
    match non_empty_env_var(name)
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "1" | "true" | "yes" | "y" | "on" => true,
        "0" | "false" | "no" | "n" | "off" => false,
        _ => default,
    }
}

fn env_u64(name: &str, default: u64, min: u64, max: u64) -> u64 {
    non_empty_env_var(name)
        .and_then(|raw| raw.parse::<u64>().ok())
        .map(|value| value.clamp(min, max))
        .unwrap_or(default)
}

fn local_stt_model_unload_idle_timeout_secs() -> u64 {
    env_u64(
        LOCAL_STT_MODEL_UNLOAD_IDLE_TIMEOUT_ENV,
        LOCAL_STT_MODEL_UNLOAD_IDLE_TIMEOUT_SECS,
        5,
        3600,
    )
}

fn local_stt_daemon_idle_timeout_secs() -> u64 {
    env_u64(
        LOCAL_STT_DAEMON_IDLE_TIMEOUT_ENV,
        LOCAL_STT_DAEMON_IDLE_TIMEOUT_SECS,
        30,
        12 * 3600,
    )
}

fn local_stt_daemon_sweep_interval_secs() -> u64 {
    env_u64(
        LOCAL_STT_DAEMON_SWEEP_INTERVAL_ENV,
        LOCAL_STT_DAEMON_SWEEP_INTERVAL_SECS,
        3,
        300,
    )
}

fn local_stt_parakeet_unload_after_transcribe() -> bool {
    env_flag(LOCAL_STT_PARAKEET_UNLOAD_AFTER_TRANSCRIBE_ENV, false)
}

fn resolve_update_repository() -> (String, String) {
    let owner = non_empty_env_var(UPDATE_REPOSITORY_OWNER_ENV)
        .unwrap_or_else(|| UPDATE_REPOSITORY_OWNER.to_string());
    let name = non_empty_env_var(UPDATE_REPOSITORY_NAME_ENV)
        .unwrap_or_else(|| UPDATE_REPOSITORY_NAME.to_string());
    (owner, name)
}

fn update_github_token() -> Option<String> {
    non_empty_env_var(UPDATE_GITHUB_TOKEN_ENV)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WindowsInstallerKind {
    Exe,
    Msi,
}

fn windows_installer_kind_from_name(name: &str) -> Option<WindowsInstallerKind> {
    let lower = name.trim().to_ascii_lowercase();
    if lower.ends_with(".exe") && !lower.ends_with(".exe.sig") {
        return Some(WindowsInstallerKind::Exe);
    }
    if lower.ends_with(".msi") {
        return Some(WindowsInstallerKind::Msi);
    }
    None
}

fn select_latest_stable_release<'a>(
    releases: &'a [GithubLatestReleaseResponse],
) -> Option<&'a GithubLatestReleaseResponse> {
    releases
        .iter()
        .find(|release| !release.draft && !release.prerelease)
}

fn is_windows_installer_asset(name: &str) -> bool {
    windows_installer_kind_from_name(name).is_some()
}

fn windows_installer_score(name: &str) -> u8 {
    let lower = name.to_ascii_lowercase();
    let mut score = 0_u8;
    match windows_installer_kind_from_name(name) {
        Some(WindowsInstallerKind::Exe) => score += 8,
        Some(WindowsInstallerKind::Msi) => score += 5,
        None => {}
    }
    if lower.contains("setup") {
        score += 6;
    }
    if lower.contains("installer") {
        score += 4;
    }
    if lower.contains("nsis") {
        score += 3;
    }
    if lower.contains("msi") {
        score += 1;
    }
    if lower.contains("x64") || lower.contains("amd64") {
        score += 1;
    }
    score
}

fn select_windows_installer_asset<'a>(
    release: &'a GithubLatestReleaseResponse,
) -> Option<&'a GithubReleaseAsset> {
    release
        .assets
        .iter()
        .filter(|asset| is_windows_installer_asset(&asset.name))
        .max_by_key(|asset| (windows_installer_score(&asset.name), asset.name.len()))
}

fn parse_version_triplet(version: &str) -> Option<(u64, u64, u64)> {
    let normalized = normalize_release_version(version);
    let core = normalized
        .split(['-', '+'])
        .next()
        .unwrap_or_default()
        .trim();
    let mut parts = core.split('.');
    let major = parts.next()?.trim().parse::<u64>().ok()?;
    let minor = parts.next()?.trim().parse::<u64>().ok()?;
    let patch = parts.next()?.trim().parse::<u64>().ok()?;
    Some((major, minor, patch))
}

fn is_newer_version(current: &str, latest: &str) -> bool {
    match (
        parse_version_triplet(current),
        parse_version_triplet(latest),
    ) {
        (Some(current_parts), Some(latest_parts)) => latest_parts > current_parts,
        _ => normalize_release_version(latest) != normalize_release_version(current),
    }
}

fn sanitize_installer_file_name(name: &str) -> Option<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut sanitized = String::with_capacity(trimmed.len() + 4);
    for character in trimmed.chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
            sanitized.push(character);
        } else {
            sanitized.push('_');
        }
    }

    if sanitized.is_empty() {
        return None;
    }

    if windows_installer_kind_from_name(&sanitized).is_none() {
        return None;
    }

    Some(sanitized)
}

fn resolve_installer_file_name(
    asset_name: Option<&str>,
    download_url: &str,
    current_version: &str,
) -> String {
    if let Some(from_asset) = asset_name.and_then(sanitize_installer_file_name) {
        return from_asset;
    }

    if let Some(last_segment) = download_url.rsplit('/').next() {
        if let Some(from_url) = sanitize_installer_file_name(last_segment) {
            return from_url;
        }
    }

    let normalized_version = normalize_release_version(current_version);
    format!("SlasshyWispr-{normalized_version}-update.exe")
}

fn merge_process_output(stdout: &[u8], stderr: &[u8]) -> String {
    let stdout_text = String::from_utf8_lossy(stdout);
    let stderr_text = String::from_utf8_lossy(stderr);
    let merged = if stderr_text.trim().is_empty() {
        stdout_text.as_ref()
    } else if stdout_text.trim().is_empty() {
        stderr_text.as_ref()
    } else {
        return format!("{} {}", stdout_text.trim(), stderr_text.trim());
    };
    merged.trim().to_string()
}

fn extract_json_value_from_output(output: &str) -> Option<Value> {
    for line in output.lines().rev() {
        let candidate = line.trim();
        if candidate.is_empty() {
            continue;
        }

        if let Ok(value) = serde_json::from_str::<Value>(candidate) {
            return Some(value);
        }

        if let Some(index) = candidate.find('{') {
            let maybe_json = &candidate[index..];
            if let Ok(value) = serde_json::from_str::<Value>(maybe_json) {
                return Some(value);
            }
        }
    }

    None
}

fn list_coqui_voice_ids(voice_dir: &Path) -> Result<Vec<String>, String> {
    if !voice_dir.exists() {
        return Ok(Vec::new());
    }

    let mut voice_ids = BTreeSet::new();
    let entries = fs::read_dir(voice_dir)
        .map_err(|error| format!("Failed to read Coqui voice directory: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Failed to read voice entry: {error}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if extension != "pth" && extension != "pt" && extension != "json" {
            continue;
        }
        if let Some(stem) = path.file_stem().and_then(|value| value.to_str()) {
            if !stem.trim().is_empty() {
                voice_ids.insert(stem.trim().to_string());
            }
        }
    }

    Ok(voice_ids.into_iter().collect())
}

fn sanitize_coqui_speaker_id(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Speaker ID is required.".to_string());
    }

    let mut out = String::with_capacity(trimmed.len());
    for character in trimmed.chars() {
        if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
            out.push(character);
            continue;
        }
        if character.is_whitespace() && !out.ends_with('-') {
            out.push('-');
        }
    }

    let normalized = out.trim_matches('-').to_string();
    if normalized.is_empty() {
        return Err("Speaker ID must include letters or numbers.".to_string());
    }

    Ok(normalized.chars().take(64).collect())
}

fn extension_from_file_name(file_name: Option<&str>) -> Option<String> {
    let raw_name = file_name?.trim();
    if raw_name.is_empty() {
        return None;
    }

    let extension = Path::new(raw_name)
        .extension()
        .and_then(|value| value.to_str())?
        .to_ascii_lowercase();
    if extension.is_empty() || extension.len() > 8 {
        return None;
    }
    if extension.chars().all(|ch| ch.is_ascii_alphanumeric()) {
        Some(extension)
    } else {
        None
    }
}

fn value_string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn find_file_by_name(root: &Path, target_name: &str) -> Result<Option<PathBuf>, String> {
    if !root.exists() {
        return Ok(None);
    }

    let mut stack = vec![root.to_path_buf()];

    while let Some(current_dir) = stack.pop() {
        let entries = fs::read_dir(&current_dir).map_err(|error| {
            format!(
                "Failed to read directory '{}': {error}",
                current_dir.display()
            )
        })?;

        for entry in entries {
            let entry =
                entry.map_err(|error| format!("Failed to read directory entry: {error}"))?;
            let path = entry.path();

            if path.is_dir() {
                stack.push(path);
                continue;
            }

            let matches = path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.eq_ignore_ascii_case(target_name))
                .unwrap_or(false);

            if matches {
                return Ok(Some(path));
            }
        }
    }

    Ok(None)
}

#[cfg(target_os = "windows")]
fn extract_zip_archive(archive_path: &Path, destination: &Path) -> Result<(), String> {
    let archive_file = fs::File::open(archive_path)
        .map_err(|error| format!("Failed to open Piper archive: {error}"))?;

    let mut archive = ZipArchive::new(archive_file)
        .map_err(|error| format!("Invalid Piper ZIP archive: {error}"))?;

    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| format!("Failed reading ZIP entry {index}: {error}"))?;

        let Some(safe_name) = file.enclosed_name().map(|path| path.to_owned()) else {
            continue;
        };

        let output_path = destination.join(safe_name);

        if file.is_dir() {
            fs::create_dir_all(&output_path)
                .map_err(|error| format!("Failed creating extracted directory: {error}"))?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Failed preparing extracted path: {error}"))?;
        }

        let mut output_file = fs::File::create(&output_path)
            .map_err(|error| format!("Failed creating extracted file: {error}"))?;

        io::copy(&mut file, &mut output_file)
            .map_err(|error| format!("Failed writing extracted file: {error}"))?;
    }

    Ok(())
}

fn extract_tar_gz_archive(archive_path: &Path, destination: &Path) -> Result<(), String> {
    let archive_file = fs::File::open(archive_path).map_err(|error| {
        format!(
            "Failed to open local STT archive '{}': {error}",
            archive_path.display()
        )
    })?;
    let decoder = GzDecoder::new(archive_file);
    let mut archive = Archive::new(decoder);
    let entries = archive
        .entries()
        .map_err(|error| format!("Invalid tar.gz archive '{}': {error}", archive_path.display()))?;

    for (index, entry_result) in entries.enumerate() {
        let mut entry = entry_result.map_err(|error| {
            format!(
                "Failed reading tar entry {} from '{}': {error}",
                index,
                archive_path.display()
            )
        })?;
        let unpacked = entry.unpack_in(destination).map_err(|error| {
            format!(
                "Failed extracting tar entry {} into '{}': {error}",
                index,
                destination.display()
            )
        })?;
        if !unpacked {
            return Err(format!(
                "Unsafe tar entry {} blocked while extracting '{}'.",
                index,
                archive_path.display()
            ));
        }
    }

    Ok(())
}

fn file_exists_with_content(path: &Path) -> bool {
    fs::metadata(path)
        .map(|meta| meta.is_file() && meta.len() > 0)
        .unwrap_or(false)
}

async fn download_file(client: &Client, url: &str, destination: &Path) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to prepare destination folder: {error}"))?;
    }

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Failed to download {url}: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "unable to read body".to_string());

        return Err(format!(
            "Download failed ({status}) for {url}: {}",
            clip_text(&single_line(&body), 400)
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Failed reading downloaded bytes from {url}: {error}"))?;

    let temp_path = destination.with_extension("downloading");
    fs::write(&temp_path, &bytes)
        .map_err(|error| format!("Failed writing temporary file: {error}"))?;

    fs::rename(&temp_path, destination)
        .map_err(|error| format!("Failed finalizing downloaded file: {error}"))?;

    Ok(())
}

fn single_line(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut first = true;
    for token in input.split_whitespace() {
        if !first {
            out.push(' ');
        }
        out.push_str(token);
        first = false;
    }
    out
}

fn clip_text(input: &str, max_chars: usize) -> String {
    if input.chars().count() <= max_chars {
        return input.to_string();
    }

    let clipped: String = input.chars().take(max_chars).collect();
    format!("{clipped}...")
}

fn normalize_api_base_url(raw: Option<&str>) -> String {
    raw.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.trim_end_matches('/').to_string())
        .unwrap_or_default()
}

fn normalize_model_name(raw: Option<&str>) -> String {
    raw.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_default()
}

fn normalize_stt_language_hint(raw: Option<&str>) -> Option<String> {
    let normalized = raw.map(str::trim).filter(|value| !value.is_empty())?;
    let mut value = normalized.to_ascii_lowercase().replace('_', "-");
    if matches!(
        value.as_str(),
        "auto" | "auto-detect" | "auto-detection" | "none" | "null"
    ) {
        return None;
    }

    value = match value.as_str() {
        "english" => "en".to_string(),
        "spanish" => "es".to_string(),
        "french" => "fr".to_string(),
        "german" => "de".to_string(),
        "italian" => "it".to_string(),
        "portuguese" => "pt".to_string(),
        "hindi" => "hi".to_string(),
        "bengali" => "bn".to_string(),
        "japanese" => "ja".to_string(),
        "korean" => "ko".to_string(),
        "chinese" => "zh".to_string(),
        "arabic" => "ar".to_string(),
        "russian" => "ru".to_string(),
        _ => value,
    };

    if let Some((iso2, _)) = value.split_once('-') {
        if iso2.len() == 2 {
            value = iso2.to_string();
        }
    }
    if value.is_empty() { None } else { Some(value) }
}

fn normalize_stt_allowed_languages(raw: Option<&[String]>) -> Vec<String> {
    let Some(values) = raw else {
        return Vec::new();
    };

    let mut normalized = Vec::new();
    let mut seen = BTreeSet::new();
    for value in values {
        let Some(language) = normalize_stt_language_hint(Some(value.as_str())) else {
            continue;
        };
        if seen.insert(language.clone()) {
            normalized.push(language);
        }
    }
    normalized
}

fn language_prefers_latin_script(language: &str) -> bool {
    matches!(language, "en" | "es" | "fr" | "de" | "it" | "pt")
}

fn is_latin_script_letter(character: char) -> bool {
    let codepoint = character as u32;
    matches!(
        codepoint,
        0x0041..=0x005A
            | 0x0061..=0x007A
            | 0x00C0..=0x00FF
            | 0x0100..=0x017F
            | 0x0180..=0x024F
            | 0x1E00..=0x1EFF
    )
}

fn looks_like_repetitive_transcript_noise(input: &str, language_hint: Option<&str>) -> bool {
    let compact: Vec<char> = input.chars().filter(|ch| ch.is_alphanumeric()).collect();
    if compact.len() >= 18 {
        let mut longest_run = 1usize;
        let mut current_run = 1usize;
        for index in 1..compact.len() {
            if compact[index] == compact[index - 1] {
                current_run += 1;
                longest_run = longest_run.max(current_run);
            } else {
                current_run = 1;
            }
        }

        if longest_run >= 10 {
            return true;
        }

        let mut counts: HashMap<char, usize> = HashMap::new();
        for character in &compact {
            *counts.entry(*character).or_insert(0) += 1;
        }
        let unique_chars = counts.len();
        let dominant_ratio = counts
            .values()
            .copied()
            .max()
            .map(|max_count| max_count as f64 / compact.len() as f64)
            .unwrap_or(0.0);

        if unique_chars <= 2 && compact.len() >= 18 {
            return true;
        }
        if unique_chars <= 3 && dominant_ratio >= 0.70 {
            return true;
        }
    }

    let language = normalize_stt_language_hint(language_hint);
    if let Some(language) = language.as_deref() {
        if language_prefers_latin_script(language) {
            let mut letters = 0usize;
            let mut latin_letters = 0usize;
            for character in input.chars() {
                if character.is_alphabetic() {
                    letters += 1;
                    if is_latin_script_letter(character) {
                        latin_letters += 1;
                    }
                }
            }
            if letters >= 6 {
                let latin_ratio = latin_letters as f64 / letters as f64;
                if letters >= 10 && latin_ratio < 0.45 {
                    return true;
                }
                if latin_ratio < 0.12 {
                    return true;
                }
            }
        }
    }

    false
}

fn estimate_wav_duration_seconds(audio_bytes: &[u8]) -> Option<f64> {
    if audio_bytes.len() < 44 {
        return None;
    }
    if &audio_bytes[0..4] != b"RIFF" || &audio_bytes[8..12] != b"WAVE" {
        return None;
    }

    let mut cursor = 12usize;
    let mut sample_rate: Option<f64> = None;
    let mut channels: Option<f64> = None;
    let mut bits_per_sample: Option<f64> = None;
    let mut data_size_bytes: Option<f64> = None;

    while cursor + 8 <= audio_bytes.len() {
        let chunk_id = &audio_bytes[cursor..cursor + 4];
        let chunk_size = u32::from_le_bytes([
            audio_bytes[cursor + 4],
            audio_bytes[cursor + 5],
            audio_bytes[cursor + 6],
            audio_bytes[cursor + 7],
        ]) as usize;
        cursor += 8;

        if cursor + chunk_size > audio_bytes.len() {
            break;
        }

        if chunk_id == b"fmt " && chunk_size >= 16 {
            channels = Some(u16::from_le_bytes([audio_bytes[cursor + 2], audio_bytes[cursor + 3]]) as f64);
            sample_rate = Some(u32::from_le_bytes([
                audio_bytes[cursor + 4],
                audio_bytes[cursor + 5],
                audio_bytes[cursor + 6],
                audio_bytes[cursor + 7],
            ]) as f64);
            bits_per_sample = Some(u16::from_le_bytes([
                audio_bytes[cursor + 14],
                audio_bytes[cursor + 15],
            ]) as f64);
        } else if chunk_id == b"data" {
            data_size_bytes = Some(chunk_size as f64);
        }

        let padded_chunk_size = chunk_size + (chunk_size % 2);
        cursor += padded_chunk_size;
    }

    let (Some(sr), Some(ch), Some(bits), Some(data)) =
        (sample_rate, channels, bits_per_sample, data_size_bytes)
    else {
        return None;
    };
    let bytes_per_second = sr * ch * (bits / 8.0);
    if !bytes_per_second.is_finite() || bytes_per_second <= 0.0 {
        return None;
    }
    let seconds = data / bytes_per_second;
    if seconds.is_finite() && seconds > 0.0 {
        Some(seconds)
    } else {
        None
    }
}

fn transcript_candidate_score(input: &str) -> usize {
    input.chars().filter(|ch| ch.is_alphanumeric()).count()
}

fn normalize_local_ollama_base_url(raw: Option<&str>) -> String {
    raw.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.trim_end_matches('/').to_string())
        .unwrap_or_else(|| DEFAULT_LOCAL_OLLAMA_BASE_URL.to_string())
}

fn zero_python_mode_enabled() -> bool {
    env_flag(ZERO_PYTHON_MODE_ENV, true)
}

fn local_stt_provider_requires_python(provider: &str) -> bool {
    matches!(provider, "whisper" | "moonshine" | "sensevoice")
}

fn local_stt_provider_supported_in_zero_python_mode(provider: &str) -> bool {
    provider == "parakeet"
}

fn normalize_local_stt_provider(raw: Option<&str>) -> String {
    let normalized = raw
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase());

    match normalized.as_deref() {
        Some("parakeet") => "parakeet".to_string(),
        Some("whisper") => "whisper".to_string(),
        _ => DEFAULT_LOCAL_STT_PROVIDER.to_string(),
    }
}

fn infer_local_stt_provider_from_model(model: &str) -> String {
    let normalized = model.trim().to_ascii_lowercase();
    if normalized.starts_with("nvidia/") || normalized.contains("parakeet") {
        return "parakeet".to_string();
    }
    if normalized.contains("sensevoice") {
        return "sensevoice".to_string();
    }
    if normalized.contains("moonshine") {
        return "moonshine".to_string();
    }
    "whisper".to_string()
}

fn canonical_local_stt_model_id(model: &str) -> String {
    let normalized = model.trim();
    if normalized.eq_ignore_ascii_case("nvidia/parakeet-tdt-0.6b-v2") {
        // Legacy alias used by earlier builds.
        return "nvidia/parakeet-tdt_ctc-110m".to_string();
    }
    normalized.to_string()
}

fn built_in_local_stt_model_catalog() -> Vec<String> {
    vec![
        "nvidia/parakeet-tdt-0.6b-v3".to_string(),
        "nvidia/parakeet-tdt_ctc-110m".to_string(),
    ]
}

fn local_stt_model_display_label(model: &str) -> String {
    let canonical = canonical_local_stt_model_id(model);
    match canonical.as_str() {
        "nvidia/parakeet-tdt-0.6b-v3" => "Parakeet v3 (478 MB)".to_string(),
        "nvidia/parakeet-tdt_ctc-110m" => "Parakeet v2 (473 MB)".to_string(),
        "openai/whisper-large-v3" => "Whisper Large (1.1 GB)".to_string(),
        "openai/whisper-medium" => "Whisper Medium (492 MB)".to_string(),
        "openai/whisper-small" => "Whisper Small (487 MB)".to_string(),
        "UsefulSensors/moonshine-base" => "Moonshine Base (58 MB)".to_string(),
        "openai/whisper-large-v3-turbo" => "Whisper Turbo (1.6 GB)".to_string(),
        "FunAudioLLM/SenseVoiceSmall" => "SenseVoice (160 MB)".to_string(),
        _ => canonical,
    }
}

fn local_stt_model_size_gb(model: &str) -> f64 {
    let canonical = canonical_local_stt_model_id(model);
    match canonical.as_str() {
        "nvidia/parakeet-tdt-0.6b-v3" => 0.478,
        "nvidia/parakeet-tdt_ctc-110m" => 0.473,
        "openai/whisper-large-v3" => 1.1,
        "openai/whisper-medium" => 0.492,
        "openai/whisper-small" => 0.487,
        "UsefulSensors/moonshine-base" => 0.058,
        "openai/whisper-large-v3-turbo" => 1.6,
        "FunAudioLLM/SenseVoiceSmall" => 0.160,
        _ => 0.0,
    }
}

fn round_to_single_decimal(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn parse_u64_token(raw: &str) -> Option<u64> {
    let token = raw.trim().split_whitespace().next().unwrap_or_default();
    if token.is_empty() {
        return None;
    }
    let compact = token.replace(',', "");
    compact.parse::<u64>().ok()
}

fn probe_local_stt_hardware() -> LocalSttHardwareProbe {
    let mut probe = LocalSttHardwareProbe::default();
    probe.logical_cores = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(0);

    #[cfg(target_os = "windows")]
    probe_windows_local_stt_hardware(&mut probe);

    #[cfg(target_os = "linux")]
    probe_linux_local_stt_hardware(&mut probe);

    #[cfg(target_os = "macos")]
    probe_macos_local_stt_hardware(&mut probe);

    probe_nvidia_gpu_for_local_stt(&mut probe);
    probe
}

#[cfg(target_os = "windows")]
fn probe_windows_local_stt_hardware(probe: &mut LocalSttHardwareProbe) {
    let script = r#"$ErrorActionPreference='SilentlyContinue';
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 Name,NumberOfLogicalProcessors;
$sys = Get-CimInstance Win32_ComputerSystem | Select-Object -First 1 TotalPhysicalMemory;
$name = if ($null -ne $cpu -and $cpu.Name) { $cpu.Name } else { '' };
$logical = if ($null -ne $cpu -and $cpu.NumberOfLogicalProcessors) { [int]$cpu.NumberOfLogicalProcessors } else { 0 };
$ram = if ($null -ne $sys -and $sys.TotalPhysicalMemory) { [uint64]$sys.TotalPhysicalMemory } else { 0 };
Write-Output ($name + '||' + $logical + '||' + $ram)"#;
    let output = run_powershell_script(script, None);
    let Ok(output) = output else {
        return;
    };
    if !output.status.success() {
        return;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout
        .lines()
        .find(|value| !value.trim().is_empty())
        .unwrap_or_default();
    if line.trim().is_empty() {
        return;
    }

    let mut segments = line.split("||").map(str::trim);
    if let Some(cpu_name) = segments.next() {
        if !cpu_name.is_empty() {
            probe.cpu_name = cpu_name.to_string();
        }
    }
    if let Some(logical) = segments.next().and_then(parse_u64_token) {
        if let Ok(parsed) = usize::try_from(logical) {
            probe.logical_cores = parsed;
        }
    }
    if let Some(ram_bytes) = segments.next().and_then(parse_u64_token) {
        probe.total_ram_bytes = ram_bytes;
    }
}

#[cfg(target_os = "linux")]
fn probe_linux_local_stt_hardware(probe: &mut LocalSttHardwareProbe) {
    if let Ok(cpuinfo) = fs::read_to_string("/proc/cpuinfo") {
        if let Some(line) = cpuinfo.lines().find(|line| line.starts_with("model name")) {
            if let Some((_, value)) = line.split_once(':') {
                let trimmed = value.trim();
                if !trimmed.is_empty() {
                    probe.cpu_name = trimmed.to_string();
                }
            }
        }
    }

    if let Ok(meminfo) = fs::read_to_string("/proc/meminfo") {
        if let Some(line) = meminfo.lines().find(|line| line.starts_with("MemTotal:")) {
            let kib = line
                .split_whitespace()
                .nth(1)
                .and_then(|token| token.parse::<u64>().ok())
                .unwrap_or(0);
            if kib > 0 {
                probe.total_ram_bytes = kib.saturating_mul(1024);
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn probe_macos_local_stt_hardware(probe: &mut LocalSttHardwareProbe) {
    let capture = |command_name: &str, args: &[&str]| -> Option<String> {
        let mut command = Command::new(command_name);
        apply_no_window(&mut command);
        command.args(args).stdout(Stdio::piped()).stderr(Stdio::null());
        let output = command.output().ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if text.is_empty() {
            return None;
        }
        Some(text)
    };

    if let Some(cpu_name) = capture("sysctl", &["-n", "machdep.cpu.brand_string"]) {
        probe.cpu_name = cpu_name;
    }
    if let Some(memsize_raw) = capture("sysctl", &["-n", "hw.memsize"]) {
        if let Some(memsize) = parse_u64_token(&memsize_raw) {
            probe.total_ram_bytes = memsize;
        }
    }
}

fn probe_nvidia_gpu_for_local_stt(probe: &mut LocalSttHardwareProbe) {
    let mut command = Command::new("nvidia-smi");
    apply_no_window(&mut command);
    command
        .args(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    if let Ok(output) = command.output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut best_name = String::new();
            let mut best_vram_mb = 0_u64;
            for line in stdout.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let mut segments = trimmed.splitn(2, ',').map(str::trim);
                let name = segments.next().unwrap_or_default();
                let memory_text = segments.next().unwrap_or_default();
                let vram_mb = parse_u64_token(memory_text).unwrap_or(0);
                if vram_mb >= best_vram_mb {
                    best_vram_mb = vram_mb;
                    best_name = name.to_string();
                }
            }

            if !best_name.is_empty() || best_vram_mb > 0 {
                probe.nvidia_gpu_detected = true;
                probe.gpu_name = best_name;
                probe.gpu_vram_mb = best_vram_mb;
                return;
            }
        }
    }

    if !detect_nvidia_gpu_available() {
        return;
    }

    probe.nvidia_gpu_detected = true;
    let mut list_command = Command::new("nvidia-smi");
    apply_no_window(&mut list_command);
    list_command
        .arg("-L")
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Ok(output) = list_command.output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(first_line) = stdout.lines().find(|line| !line.trim().is_empty()) {
                if let Some((_, name_tail)) = first_line.split_once(':') {
                    let cleaned = name_tail.split('(').next().unwrap_or(name_tail).trim();
                    if !cleaned.is_empty() {
                        probe.gpu_name = cleaned.to_string();
                    }
                }
            }
        }
    }
}

fn local_stt_performance_tier(probe: &LocalSttHardwareProbe, ram_gb: f64, gpu_vram_gb: f64) -> &'static str {
    let strong_cpu = probe.logical_cores >= 8;
    let low_cpu = probe.logical_cores > 0 && probe.logical_cores <= 4;
    let ample_ram = ram_gb >= 16.0;
    let low_ram = ram_gb > 0.0 && ram_gb <= 8.0;
    let strong_gpu = probe.nvidia_gpu_detected && gpu_vram_gb >= 8.0;
    let mid_gpu = probe.nvidia_gpu_detected && gpu_vram_gb >= 4.0;

    if strong_gpu && ample_ram {
        return "performance";
    }
    if (mid_gpu && ram_gb >= 12.0) || (ample_ram && strong_cpu) {
        return "balanced";
    }
    if low_ram || low_cpu {
        return "basic";
    }
    if ram_gb >= 10.0 && probe.logical_cores >= 6 {
        return "balanced";
    }
    "basic"
}

fn local_stt_models_for_tier(
    tier: &str,
    _nvidia_gpu_detected: bool,
) -> (&'static str, Vec<&'static str>, Vec<&'static str>) {
    match tier {
        "performance" => (
            "nvidia/parakeet-tdt_ctc-110m",
            vec![
                "nvidia/parakeet-tdt_ctc-110m",
            ],
            vec![
                "nvidia/parakeet-tdt-0.6b-v3",
            ],
        ),
        "balanced" => (
            "nvidia/parakeet-tdt_ctc-110m",
            vec![
                "nvidia/parakeet-tdt_ctc-110m",
            ],
            vec![
                "nvidia/parakeet-tdt-0.6b-v3",
            ],
        ),
        _ => (
            "nvidia/parakeet-tdt_ctc-110m",
            vec![
                "nvidia/parakeet-tdt_ctc-110m",
            ],
            vec![
                "nvidia/parakeet-tdt-0.6b-v3",
            ],
        ),
    }
}

fn build_local_stt_hardware_advice(selected_model: Option<String>) -> LocalSttHardwareAdviceResponse {
    let probe = probe_local_stt_hardware();
    let ram_gb_raw = if probe.total_ram_bytes > 0 {
        probe.total_ram_bytes as f64 / (1024.0 * 1024.0 * 1024.0)
    } else {
        0.0
    };
    let gpu_vram_gb_raw = if probe.gpu_vram_mb > 0 {
        probe.gpu_vram_mb as f64 / 1024.0
    } else {
        0.0
    };
    let ram_gb = round_to_single_decimal(ram_gb_raw);
    let gpu_vram_gb = round_to_single_decimal(gpu_vram_gb_raw);
    let tier = local_stt_performance_tier(&probe, ram_gb_raw, gpu_vram_gb_raw);
    let (suggested_model, suggested_candidates, caution_candidates) =
        local_stt_models_for_tier(tier, probe.nvidia_gpu_detected);
    let catalog = built_in_local_stt_model_catalog();

    let mut suggested_models = Vec::<String>::new();
    for candidate in suggested_candidates {
        if catalog.iter().any(|item| item == candidate)
            && !suggested_models.iter().any(|item| item == candidate)
        {
            suggested_models.push(candidate.to_string());
        }
    }
    if suggested_models.is_empty() {
        suggested_models.push(suggested_model.to_string());
    }

    let mut caution_models = Vec::<String>::new();
    for candidate in caution_candidates {
        if catalog.iter().any(|item| item == candidate)
            && !caution_models.iter().any(|item| item == candidate)
        {
            caution_models.push(candidate.to_string());
        }
    }

    let selected_model = selected_model
        .as_deref()
        .map(|value| canonical_local_stt_model_id(&normalize_model_name(Some(value))))
        .unwrap_or_default();

    let selected_model_warning = if !selected_model.is_empty()
        && caution_models.iter().any(|item| item == &selected_model)
    {
        let selected_label = local_stt_model_display_label(&selected_model);
        let size_gb = local_stt_model_size_gb(&selected_model);
        if size_gb > 0.0 {
            format!(
                "Warning: {selected_label} (~{size_gb:.1} GB) is hardware-hungry on this device and can be very slow."
            )
        } else {
            format!(
                "Warning: {selected_label} is hardware-hungry on this device and can be very slow."
            )
        }
    } else {
        String::new()
    };

    let cpu_name = if probe.cpu_name.trim().is_empty() {
        "Unknown CPU".to_string()
    } else {
        probe.cpu_name.trim().to_string()
    };
    let gpu_name = if probe.nvidia_gpu_detected {
        if probe.gpu_name.trim().is_empty() {
            "NVIDIA GPU".to_string()
        } else {
            probe.gpu_name.trim().to_string()
        }
    } else {
        String::new()
    };

    let caution_labels = caution_models
        .iter()
        .map(|model| local_stt_model_display_label(model))
        .collect::<Vec<String>>();
    let caution_suffix = if caution_labels.is_empty() {
        String::new()
    } else {
        format!(" Heavy models on this hardware: {}.", caution_labels.join(", "))
    };
    let gpu_summary = if probe.nvidia_gpu_detected {
        if gpu_vram_gb > 0.0 {
            format!("{gpu_name} ({gpu_vram_gb:.1} GB VRAM)")
        } else {
            gpu_name.clone()
        }
    } else {
        "No NVIDIA GPU detected".to_string()
    };
    let details = format!(
        "Hardware profile detected: {} logical cores, {:.1} GB RAM, {}. Higher models use much more RAM/VRAM and can be slower. Start with {}.{}",
        probe.logical_cores,
        ram_gb,
        gpu_summary,
        local_stt_model_display_label(suggested_model),
        caution_suffix
    );

    LocalSttHardwareAdviceResponse {
        cpu_name,
        logical_cores: probe.logical_cores,
        total_ram_gb: ram_gb,
        nvidia_gpu_detected: probe.nvidia_gpu_detected,
        gpu_name,
        gpu_vram_gb,
        performance_tier: tier.to_string(),
        slasshy_suggestion_model: suggested_model.to_string(),
        suggested_models,
        caution_models,
        selected_model_warning,
        details,
    }
}

fn apply_optional_bearer_auth(
    builder: reqwest::RequestBuilder,
    api_key: Option<&str>,
) -> reqwest::RequestBuilder {
    if let Some(token) = api_key.map(str::trim).filter(|value| !value.is_empty()) {
        builder.bearer_auth(token)
    } else {
        builder
    }
}

async fn query_ollama_version() -> Result<String, String> {
    let output = tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new("ollama");
        apply_no_window(&mut command);
        command
            .arg("--version")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command
            .output()
            .map_err(|error| format!("Failed to execute 'ollama --version': {error}"))
    })
    .await
    .map_err(|error| format!("Ollama version check task failed: {error}"))??;

    if !output.status.success() {
        let merged = merge_process_output(&output.stdout, &output.stderr);
        return Err(format!(
            "Ollama CLI is not available: {}",
            clip_text(&single_line(&merged), 260)
        ));
    }

    let raw = merge_process_output(&output.stdout, &output.stderr);
    let version = raw.trim().to_string();
    if version.is_empty() {
        return Err("Ollama CLI returned an empty version string.".to_string());
    }

    Ok(version)
}

async fn is_ollama_service_running(client: &Client, base_url: &str) -> bool {
    client
        .get(format!("{base_url}/api/tags"))
        .timeout(Duration::from_secs(4))
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn ollama_installer_path(app: &AppHandle) -> Result<PathBuf, String> {
    let installer_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?
        .join("ollama")
        .join("installer");
    fs::create_dir_all(&installer_dir)
        .map_err(|error| format!("Failed to create Ollama installer directory: {error}"))?;
    Ok(installer_dir.join(OLLAMA_WINDOWS_INSTALLER_FILE))
}

#[cfg(target_os = "windows")]
fn run_ollama_installer_windows(installer_path: &Path) -> Result<(), String> {
    if !file_exists_with_content(installer_path) {
        return Err(format!(
            "Ollama installer is missing at '{}'.",
            installer_path.display()
        ));
    }

    let mut silent_command = Command::new(installer_path);
    apply_no_window(&mut silent_command);
    silent_command
        .arg("/S")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    let silent_output = silent_command.output().map_err(|error| {
        format!(
            "Failed to launch Ollama installer '{}': {error}",
            installer_path.display()
        )
    })?;
    if silent_output.status.success() {
        return Ok(());
    }

    let merged = merge_process_output(&silent_output.stdout, &silent_output.stderr);
    warn!(
        "[ollama.install] silent install failed; falling back to interactive launch: {}",
        clip_text(&single_line(&merged), 220)
    );

    let mut interactive_command = Command::new(installer_path);
    interactive_command
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null());
    interactive_command.spawn().map_err(|error| {
        format!(
            "Failed to start interactive Ollama installer '{}': {error}",
            installer_path.display()
        )
    })?;

    Ok(())
}

fn stt_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?
        .join("stt");
    fs::create_dir_all(&root)
        .map_err(|error| format!("Failed to create STT root directory: {error}"))?;
    Ok(root)
}

fn stt_models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let models_dir = stt_root_dir(app)?.join("models");
    fs::create_dir_all(&models_dir)
        .map_err(|error| format!("Failed to create STT models directory: {error}"))?;
    Ok(models_dir)
}

fn stt_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let runtime_dir = stt_root_dir(app)?.join("runtime");
    fs::create_dir_all(&runtime_dir)
        .map_err(|error| format!("Failed to create STT runtime directory: {error}"))?;
    Ok(runtime_dir)
}

fn stt_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let cache_dir = stt_root_dir(app)?.join("cache");
    fs::create_dir_all(&cache_dir)
        .map_err(|error| format!("Failed to create STT cache directory: {error}"))?;
    Ok(cache_dir)
}

fn stt_venv_python_path(app: &AppHandle) -> Result<PathBuf, String> {
    let runtime_dir = stt_runtime_dir(app)?;
    #[cfg(target_os = "windows")]
    {
        Ok(runtime_dir.join("venv").join("Scripts").join("python.exe"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(runtime_dir.join("venv").join("bin").join("python"))
    }
}

fn ensure_local_stt_bridge_script(app: &AppHandle) -> Result<PathBuf, String> {
    let runtime_dir = stt_runtime_dir(app)?;
    let script_path = runtime_dir.join("local_stt_bridge.py");
    let should_write = fs::read_to_string(&script_path)
        .map(|existing| existing != LOCAL_STT_BRIDGE_SCRIPT)
        .unwrap_or(true);
    if should_write {
        fs::write(&script_path, LOCAL_STT_BRIDGE_SCRIPT)
            .map_err(|error| format!("Failed to write local STT bridge script: {error}"))?;
        stop_all_local_stt_bridge_daemons();
    }
    Ok(script_path)
}

fn is_parakeet_model_directory(path: &Path) -> bool {
    let encoder_fp32 = path.join("encoder-model.onnx");
    let encoder_int8 = path.join("encoder-model.int8.onnx");
    let decoder_fp32 = path.join("decoder_joint-model.onnx");
    let decoder_int8 = path.join("decoder_joint-model.int8.onnx");
    let nemo128 = path.join("nemo128.onnx");
    let vocab = path.join("vocab.txt");
    let config = path.join("config.json");

    (file_exists_with_content(&encoder_fp32) || file_exists_with_content(&encoder_int8))
        && (file_exists_with_content(&decoder_fp32) || file_exists_with_content(&decoder_int8))
        && file_exists_with_content(&nemo128)
        && file_exists_with_content(&vocab)
        && file_exists_with_content(&config)
}

fn find_local_parakeet_model_root(root: &Path) -> Result<PathBuf, String> {
    if !root.exists() {
        return Err(format!(
            "Local STT model directory does not exist: {}",
            root.display()
        ));
    }

    let mut stack = vec![root.to_path_buf()];
    let mut best: Option<(PathBuf, u64)> = None;
    let mut saw_legacy_nemo_file = false;
    while let Some(current) = stack.pop() {
        if is_parakeet_model_directory(&current) {
            let score = [
                "encoder-model.int8.onnx",
                "encoder-model.onnx",
                "decoder_joint-model.int8.onnx",
                "decoder_joint-model.onnx",
                "nemo128.onnx",
                "vocab.txt",
                "config.json",
            ]
            .iter()
            .map(|name| {
                fs::metadata(current.join(name))
                    .map(|meta| meta.len())
                    .unwrap_or(0)
            })
            .fold(0_u64, |acc, value| acc.saturating_add(value));

            match &best {
                Some((_, best_size)) if *best_size >= score => {}
                _ => best = Some((current.clone(), score)),
            }
        }

        let entries = fs::read_dir(&current).map_err(|error| {
            format!(
                "Failed to inspect local STT directory '{}': {error}",
                current.display()
            )
        })?;

        for entry in entries {
            let entry = entry.map_err(|error| {
                format!(
                    "Failed to inspect local STT directory entry in '{}': {error}",
                    current.display()
                )
            })?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let is_nemo = path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case("nemo"))
                .unwrap_or(false);
            if is_nemo {
                saw_legacy_nemo_file = true;
            }
        }
    }

    if let Some((path, _)) = best {
        return Ok(path);
    }

    if saw_legacy_nemo_file {
        return Err(format!(
            "Found legacy Parakeet *.nemo artifact in '{}', but native int8 runtime expects ONNX model directories. Re-download the selected Parakeet model from Settings > Models.",
            root.display()
        ));
    }

    Err(format!(
        "No compatible local Parakeet model directory found in '{}'.",
        root.display()
    ))
}

fn run_local_stt_python_command(
    python_path: &str,
    args: &[&str],
    cache_dir: &Path,
) -> Result<String, String> {
    validate_python_binary_path(python_path)?;
    let mut command = Command::new(python_path);
    apply_no_window(&mut command);
    command.args(args);
    command
        .env("HF_HOME", cache_dir)
        .env("NEMO_CACHE_DIR", cache_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = command
        .output()
        .map_err(|error| format!("Failed to run local STT Python command: {error}"))?;
    if !output.status.success() {
        let merged = merge_process_output(&output.stdout, &output.stderr);
        return Err(format!(
            "Local STT Python command failed: {}",
            clip_text(merged.trim(), 460)
        ));
    }
    Ok(merge_process_output(&output.stdout, &output.stderr))
}

fn detect_nvidia_gpu_available() -> bool {
    let mut command = Command::new("nvidia-smi");
    apply_no_window(&mut command);
    command
        .arg("-L")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    match command.output() {
        Ok(output) if output.status.success() => !String::from_utf8_lossy(&output.stdout)
            .trim()
            .is_empty(),
        _ => false,
    }
}

fn local_stt_torch_cuda_available(python_path: &str, cache_dir: &Path) -> Result<bool, String> {
    let output = run_local_stt_python_command(
        python_path,
        &[
            "-c",
            "import torch; print('CUDA_AVAILABLE=' + ('1' if torch.cuda.is_available() else '0'))",
        ],
        cache_dir,
    )?;
    let available = output
        .lines()
        .any(|line| line.trim().eq_ignore_ascii_case("CUDA_AVAILABLE=1"));
    Ok(available)
}

fn try_install_local_stt_cuda_torch(
    python_path: &str,
    cache_dir: &Path,
    runtime_dir: &Path,
    reason_label: &str,
) -> Result<bool, String> {
    if !detect_nvidia_gpu_available() {
        return Ok(false);
    }

    if local_stt_torch_cuda_available(python_path, cache_dir).unwrap_or(false) {
        return Ok(true);
    }

    let failed_marker = runtime_dir.join("cuda-torch-install.failed");
    if failed_marker.exists() {
        return Ok(false);
    }

    info!(
        "[local.stt.runtime] nvidia gpu detected but torch cuda unavailable; installing cuda torch ({})",
        reason_label
    );
    let install_result = run_local_stt_python_command(
        python_path,
        &[
            "-m",
            "pip",
            "install",
            "--upgrade",
            "--index-url",
            "https://download.pytorch.org/whl/cu128",
            "torch==2.8.0+cu128",
            "torchaudio==2.8.0+cu128",
        ],
        cache_dir,
    );
    match install_result {
        Ok(output) => {
            if !output.trim().is_empty() {
                info!(
                    "[local.stt.runtime] cuda torch install output={}",
                    clip_text(&single_line(&output), 260)
                );
            }
        }
        Err(error) => {
            warn!(
                "[local.stt.runtime] cuda torch install failed ({}): {}",
                reason_label,
                clip_text(&single_line(&error), 320)
            );
            let _ = fs::write(&failed_marker, now_unix_ms().to_string());
            return Ok(false);
        }
    }

    let available = local_stt_torch_cuda_available(python_path, cache_dir).unwrap_or(false);
    if available {
        let _ = fs::remove_file(&failed_marker);
        stop_all_local_stt_bridge_daemons();
        info!("[local.stt.runtime] cuda torch enabled");
        return Ok(true);
    }

    warn!(
        "[local.stt.runtime] cuda torch install completed but torch.cuda.is_available() is still false"
    );
    let _ = fs::write(&failed_marker, now_unix_ms().to_string());
    Ok(false)
}

fn local_stt_runtime_ready_marker_path(runtime_dir: &Path) -> PathBuf {
    runtime_dir.join(LOCAL_STT_RUNTIME_READY_MARKER_FILE)
}

fn write_local_stt_runtime_ready_marker(runtime_dir: &Path) -> Result<(), String> {
    let marker_path = local_stt_runtime_ready_marker_path(runtime_dir);
    fs::write(&marker_path, LOCAL_STT_RUNTIME_READY_MARKER_CONTENT).map_err(|error| {
        format!(
            "Failed to write local STT runtime ready marker '{}': {error}",
            marker_path.display()
        )
    })
}

fn clear_local_stt_runtime_ready_marker(runtime_dir: &Path) {
    let marker_path = local_stt_runtime_ready_marker_path(runtime_dir);
    let _ = fs::remove_file(marker_path);
}

fn setup_local_stt_runtime_blocking(
    app: &AppHandle,
    bootstrap_python: &str,
) -> Result<String, String> {
    validate_python_binary_path(bootstrap_python)?;
    let runtime_dir = stt_runtime_dir(app)?;
    let cache_dir = stt_cache_dir(app)?;
    let venv_dir = runtime_dir.join("venv");
    let venv_python_path = stt_venv_python_path(app)?;
    let venv_python = venv_python_path.to_string_lossy().to_string();
    let runtime_ready_marker_path = local_stt_runtime_ready_marker_path(&runtime_dir);
    let marker_ready = file_exists_with_content(&runtime_ready_marker_path);

    if let Ok(guard) = local_stt_runtime_python_cache().lock() {
        if let Some(cached_python) = guard.as_ref() {
            let same_path = {
                #[cfg(target_os = "windows")]
                {
                    cached_python.eq_ignore_ascii_case(&venv_python)
                }
                #[cfg(not(target_os = "windows"))]
                {
                    cached_python == &venv_python
                }
            };
            if same_path && file_exists_with_content(&venv_python_path) && marker_ready {
                info!(
                    "[local.stt.runtime] ready python={} cached=true marker=true",
                    clip_text(cached_python, 220)
                );
                return Ok(cached_python.clone());
            }
        }
    }

    if file_exists_with_content(&venv_python_path) && marker_ready {
        info!(
            "[local.stt.runtime] ready python={} marker=true",
            clip_text(&venv_python, 220)
        );
        if let Ok(mut guard) = local_stt_runtime_python_cache().lock() {
            *guard = Some(venv_python.clone());
        }
        return Ok(venv_python);
    }

    if !file_exists_with_content(&venv_python_path) {
        clear_local_stt_runtime_ready_marker(&runtime_dir);
        let mut create_venv = Command::new(bootstrap_python);
        apply_no_window(&mut create_venv);
        create_venv
            .arg("-m")
            .arg("venv")
            .arg(&venv_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let output = create_venv
            .output()
            .map_err(|error| format!("Failed to create local STT virtualenv: {error}"))?;
        if !output.status.success() {
            let merged = merge_process_output(&output.stdout, &output.stderr);
            return Err(format!(
                "Local STT virtualenv creation failed: {}",
                clip_text(merged.trim(), 460)
            ));
        }
    }

    let probe_nemo = run_local_stt_python_command(
        &venv_python,
        &["-c", "import nemo.collections.asr"],
        &cache_dir,
    );
    let probe_faster_whisper = run_local_stt_python_command(
        &venv_python,
        &["-c", "import faster_whisper"],
        &cache_dir,
    );
    if probe_nemo.is_ok() && probe_faster_whisper.is_ok() {
        let _ = try_install_local_stt_cuda_torch(
            &venv_python,
            &cache_dir,
            &runtime_dir,
            "runtime-ready",
        );
        let cuda_available = local_stt_torch_cuda_available(&venv_python, &cache_dir).unwrap_or(false);
        info!(
            "[local.stt.runtime] ready python={} cuda={}",
            clip_text(&venv_python, 220)
            ,
            cuda_available
        );
        if let Ok(mut guard) = local_stt_runtime_python_cache().lock() {
            *guard = Some(venv_python.clone());
        }
        if let Err(error) = write_local_stt_runtime_ready_marker(&runtime_dir) {
            warn!(
                "[local.stt.runtime] unable to persist runtime-ready marker: {}",
                clip_text(&single_line(&error), 260)
            );
        }
        return Ok(venv_python);
    }
    if probe_nemo.is_ok() && probe_faster_whisper.is_err() {
        info!(
            "[local.stt.runtime] installing faster-whisper acceleration packages for local Whisper models"
        );
        let install_output = run_local_stt_python_command(
            &venv_python,
            &[
                "-m",
                "pip",
                "install",
                "--upgrade",
                "ctranslate2>=4.5",
                "faster-whisper>=1.1.0",
            ],
            &cache_dir,
        )?;
        if !install_output.trim().is_empty() {
            info!(
                "[local.stt.runtime] faster-whisper install output={}",
                clip_text(&single_line(&install_output), 260)
            );
        }
        let recheck_faster_whisper = run_local_stt_python_command(
            &venv_python,
            &["-c", "import faster_whisper"],
            &cache_dir,
        );
        if recheck_faster_whisper.is_ok() {
            let _ = try_install_local_stt_cuda_torch(
                &venv_python,
                &cache_dir,
                &runtime_dir,
                "runtime-ready",
            );
            let cuda_available =
                local_stt_torch_cuda_available(&venv_python, &cache_dir).unwrap_or(false);
            info!(
                "[local.stt.runtime] ready python={} cuda={} faster_whisper=true",
                clip_text(&venv_python, 220),
                cuda_available
            );
            if let Ok(mut guard) = local_stt_runtime_python_cache().lock() {
                *guard = Some(venv_python.clone());
            }
            if let Err(error) = write_local_stt_runtime_ready_marker(&runtime_dir) {
                warn!(
                    "[local.stt.runtime] unable to persist runtime-ready marker: {}",
                    clip_text(&single_line(&error), 260)
                );
            }
            return Ok(venv_python);
        }
        warn!(
            "[local.stt.runtime] faster-whisper import still failing after install; continuing with full dependency bootstrap"
        );
    }
    info!(
        "[local.stt.runtime] installing runtime packages for Parakeet STT (first run may take several minutes)"
    );

    let _ = run_local_stt_python_command(
        &venv_python,
        &["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"],
        &cache_dir,
    )?;

    let cuda_torch_installed = try_install_local_stt_cuda_torch(
        &venv_python,
        &cache_dir,
        &runtime_dir,
        "first-install",
    )
    .unwrap_or(false);
    if !cuda_torch_installed {
        let torch_install_output = run_local_stt_python_command(
            &venv_python,
            &[
                "-m",
                "pip",
                "install",
                "--upgrade",
                "torch==2.8.0",
                "torchaudio==2.8.0",
            ],
            &cache_dir,
        )?;
        if !torch_install_output.trim().is_empty() {
            info!(
                "[local.stt.runtime] torch install output={}",
                clip_text(&single_line(&torch_install_output), 260)
            );
        }
    }

    let deps_install_output = run_local_stt_python_command(
        &venv_python,
        &[
            "-m",
            "pip",
            "install",
            "--upgrade",
            "nemo_toolkit[asr]>=2,<3",
            "soundfile",
            "transformers>=4.45",
            "accelerate",
            "ctranslate2>=4.5",
            "faster-whisper>=1.1.0",
        ],
        &cache_dir,
    )?;
    if !deps_install_output.trim().is_empty() {
        info!(
            "[local.stt.runtime] deps install output={}",
            clip_text(&single_line(&deps_install_output), 260)
        );
    }

    run_local_stt_python_command(
        &venv_python,
        &["-c", "import nemo.collections.asr"],
        &cache_dir,
    )
    .map_err(|error| format!("Local STT runtime validation failed: {error}"))?;
    let cuda_available = local_stt_torch_cuda_available(&venv_python, &cache_dir).unwrap_or(false);
    info!(
        "[local.stt.runtime] install complete python={} cuda={}",
        clip_text(&venv_python, 220),
        cuda_available
    );
    stop_all_local_stt_bridge_daemons();
    if let Ok(mut guard) = local_stt_runtime_python_cache().lock() {
        *guard = Some(venv_python.clone());
    }
    if let Err(error) = write_local_stt_runtime_ready_marker(&runtime_dir) {
        warn!(
            "[local.stt.runtime] unable to persist runtime-ready marker: {}",
            clip_text(&single_line(&error), 260)
        );
    }

    Ok(venv_python)
}

fn normalize_native_parakeet_model_key(model_root: &Path) -> String {
    #[cfg(target_os = "windows")]
    {
        model_root.to_string_lossy().to_ascii_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        model_root.to_string_lossy().to_string()
    }
}

fn resample_mono_linear(samples: &[f32], source_rate: u32, target_rate: u32) -> Vec<f32> {
    if samples.is_empty() || source_rate == target_rate {
        return samples.to_vec();
    }

    let ratio = target_rate as f64 / source_rate as f64;
    let output_len = ((samples.len() as f64) * ratio).round().max(1.0) as usize;
    let mut output = Vec::with_capacity(output_len);
    for index in 0..output_len {
        let source_pos = (index as f64) / ratio;
        let left = source_pos.floor() as usize;
        let right = (left + 1).min(samples.len().saturating_sub(1));
        let frac = (source_pos - left as f64) as f32;
        let left_value = samples[left];
        let right_value = samples[right];
        output.push(left_value + (right_value - left_value) * frac);
    }
    output
}

fn decode_wav_audio_to_mono_f32(audio_bytes: &[u8]) -> Result<(Vec<f32>, u32), String> {
    let cursor = std::io::Cursor::new(audio_bytes);
    let mut reader = hound::WavReader::new(cursor)
        .map_err(|error| format!("Failed to parse WAV audio: {error}"))?;
    let spec = reader.spec();
    let channels = usize::from(spec.channels.max(1));
    let sample_rate = spec.sample_rate;

    let interleaved: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .map(|sample| sample.map_err(|error| format!("Failed to read WAV float sample: {error}")))
            .collect::<Result<Vec<f32>, String>>()?,
        hound::SampleFormat::Int => {
            if spec.bits_per_sample <= 16 {
                let scale = i16::MAX as f32;
                reader
                    .samples::<i16>()
                    .map(|sample| {
                        sample
                            .map(|value| (value as f32 / scale).clamp(-1.0, 1.0))
                            .map_err(|error| format!("Failed to read WAV int16 sample: {error}"))
                    })
                    .collect::<Result<Vec<f32>, String>>()?
            } else {
                let max_value = ((1_i64 << (spec.bits_per_sample.saturating_sub(1))) - 1) as f32;
                reader
                    .samples::<i32>()
                    .map(|sample| {
                        sample
                            .map(|value| (value as f32 / max_value).clamp(-1.0, 1.0))
                            .map_err(|error| format!("Failed to read WAV int sample: {error}"))
                    })
                    .collect::<Result<Vec<f32>, String>>()?
            }
        }
    };

    if interleaved.is_empty() {
        return Ok((Vec::new(), sample_rate));
    }

    if channels == 1 {
        return Ok((interleaved, sample_rate));
    }

    let frames = interleaved.len() / channels;
    if frames == 0 {
        return Ok((Vec::new(), sample_rate));
    }
    let mut mono = Vec::with_capacity(frames);
    for frame in 0..frames {
        let start = frame * channels;
        let end = start + channels;
        let sum = interleaved[start..end].iter().copied().sum::<f32>();
        mono.push(sum / channels as f32);
    }
    Ok((mono, sample_rate))
}

fn decode_local_stt_audio_to_mono_f32(
    audio_bytes: &[u8],
    audio_mime_type: &str,
) -> Result<Vec<f32>, String> {
    if audio_bytes.is_empty() {
        return Err("Recorded audio is empty.".to_string());
    }

    let normalized_mime = audio_mime_type.trim().to_ascii_lowercase();
    if !normalized_mime.is_empty() && !normalized_mime.contains("wav") {
        return Err(format!(
            "Native local Parakeet currently expects WAV input. Received '{}'.",
            clip_text(&normalized_mime, 80)
        ));
    }

    let (samples, sample_rate) = decode_wav_audio_to_mono_f32(audio_bytes)?;
    if samples.is_empty() {
        return Err("Recorded WAV audio did not contain any samples.".to_string());
    }

    let normalized = if sample_rate != 16_000 {
        resample_mono_linear(&samples, sample_rate, 16_000)
    } else {
        samples
    };
    if normalized.is_empty() {
        return Err("Audio normalization produced no samples.".to_string());
    }
    Ok(normalized)
}

fn get_or_load_native_parakeet_runtime(model_root: &Path) -> Result<bool, String> {
    let model_key = normalize_native_parakeet_model_key(model_root);
    let runtime = local_stt_native_parakeet_runtime();
    let mut guard = runtime
        .lock()
        .map_err(|_| "Native Parakeet runtime lock poisoned.".to_string())?;

    if let Some(current) = guard.as_mut() {
        if current.model_key == model_key {
            current.last_used = Instant::now();
            return Ok(true);
        }
        let _ = current.engine.unload_model();
        *guard = None;
    }

    let mut engine = ParakeetEngine::new();
    engine
        .load_model_with_params(model_root, ParakeetModelParams::int8())
        .map_err(|error| {
            format!(
                "Failed to load native Parakeet model '{}' with int8 params: {}",
                model_root.display(),
                error
            )
        })?;

    *guard = Some(NativeParakeetRuntime {
        model_key,
        engine,
        last_used: Instant::now(),
    });
    Ok(false)
}

fn unload_native_parakeet_runtime(reason: &str) -> Result<bool, String> {
    let runtime = local_stt_native_parakeet_runtime();
    let mut guard = runtime
        .lock()
        .map_err(|_| "Native Parakeet runtime lock poisoned.".to_string())?;

    if let Some(mut active) = guard.take() {
        let _ = active.engine.unload_model();
        info!(
            "[local.stt.parakeet.native] runtime unloaded reason={} model_key={}",
            clip_text(reason, 80),
            clip_text(&active.model_key, 220)
        );
        return Ok(true);
    }
    Ok(false)
}

fn native_parakeet_runtime_loaded() -> bool {
    let runtime = local_stt_native_parakeet_runtime();
    let guard = match runtime.lock() {
        Ok(guard) => guard,
        Err(_) => return false,
    };
    guard.is_some()
}

fn transcribe_local_stt_parakeet_native(
    model_root: &Path,
    audio_bytes: &[u8],
    audio_mime_type: &str,
) -> Result<(String, bool, bool), String> {
    let model_cached = get_or_load_native_parakeet_runtime(model_root)?;
    let audio_samples = decode_local_stt_audio_to_mono_f32(audio_bytes, audio_mime_type)?;
    let unload_after_transcribe = local_stt_parakeet_unload_after_transcribe();

    let runtime = local_stt_native_parakeet_runtime();
    let mut guard = runtime
        .lock()
        .map_err(|_| "Native Parakeet runtime lock poisoned.".to_string())?;
    let active = guard
        .as_mut()
        .ok_or_else(|| "Native Parakeet runtime is not loaded.".to_string())?;
    active.last_used = Instant::now();

    let params = ParakeetInferenceParams {
        timestamp_granularity: TimestampGranularity::Segment,
        ..Default::default()
    };
    let result = active
        .engine
        .transcribe_samples(audio_samples, Some(params))
        .map_err(|error| format!("Native Parakeet transcription failed: {error}"))?;
    let transcript = result.text.trim().to_string();
    if transcript.is_empty() {
        return Err("Native Parakeet STT returned an empty transcript.".to_string());
    }

    if unload_after_transcribe {
        let _ = active.engine.unload_model();
        *guard = None;
    }
    Ok((transcript, model_cached, unload_after_transcribe))
}

fn warmup_local_stt_parakeet_model_blocking(
    app: &AppHandle,
    _python_path: &str,
    model: &str,
) -> Result<String, String> {
    let canonical_model = canonical_local_stt_model_id(model);
    let provider = infer_local_stt_provider_from_model(&canonical_model);
    if provider != "parakeet" {
        return Ok("Warmup skipped (non-Parakeet model).".to_string());
    }

    let repo_id = resolve_huggingface_repo_id(&provider, &canonical_model);
    let model_dir = stt_models_dir(app)?.join(sanitize_model_cache_dir_name(&repo_id));
    let model_root = find_local_parakeet_model_root(&model_dir)?;
    let model_cached = get_or_load_native_parakeet_runtime(&model_root)?;
    let device = "cpu";
    let precision = "int8";
    info!(
        "[local.stt.parakeet.native] warmup complete model={} repo={} cached={} device={} precision={}",
        clip_text(&canonical_model, 140),
        clip_text(&repo_id, 140),
        model_cached,
        clip_text(device, 40),
        clip_text(precision, 24)
    );

    Ok(format!(
        "Warmup ready (device={device}, precision={precision}, cached={model_cached})."
    ))
}

fn warmup_local_stt_hf_model_blocking(
    app: &AppHandle,
    python_path: &str,
    model: &str,
) -> Result<String, String> {
    let canonical_model = canonical_local_stt_model_id(model);
    let provider = infer_local_stt_provider_from_model(&canonical_model);
    if provider != "whisper" && provider != "moonshine" && provider != "sensevoice" {
        return Ok("Warmup skipped (non-HF-ASR model).".to_string());
    }

    let (repo_id, model_dir) = resolve_local_stt_repo_and_dir(app, &provider, &canonical_model)?;
    if !model_dir.exists() {
        return Err(format!(
            "Local STT model directory does not exist: {}",
            model_dir.display()
        ));
    }

    let script_path = ensure_local_stt_bridge_script(app)?;
    let cache_dir = stt_cache_dir(app)?;
    let payload = json!({
        "action": "warmup_hf_asr",
        "provider": provider.clone(),
        "modelId": canonical_model.clone(),
        "modelPath": model_dir.to_string_lossy().to_string(),
    });
    let result = run_local_stt_bridge_via_daemon(
        python_path,
        &script_path,
        &cache_dir,
        "warmup_hf_asr",
        &payload,
    )?;
    let model_cached = result
        .get("modelCached")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let device = result
        .get("device")
        .and_then(Value::as_str)
        .unwrap_or("cpu");
    info!(
        "[local.stt.hf] warmup complete model={} repo={} cached={} device={}",
        clip_text(&canonical_model, 140),
        clip_text(&repo_id, 140),
        model_cached,
        clip_text(device, 40)
    );

    Ok(format!(
        "Warmup ready (device={device}, cached={model_cached})."
    ))
}

fn open_path_in_file_explorer(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("explorer");
        apply_no_window(&mut command);
        command
            .arg(path)
            .spawn()
            .map_err(|error| format!("Failed to open '{}' in File Explorer: {error}", path.display()))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Failed to open '{}': {error}", path.display()))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Failed to open '{}': {error}", path.display()))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Opening local file explorer is not supported on this platform.".to_string())
}

fn sanitize_model_cache_dir_name(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return "model".to_string();
    }

    let mut output = String::new();
    for character in trimmed.chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
            output.push(character);
        } else if matches!(character, '/' | '\\') {
            output.push_str("__");
        } else {
            output.push('_');
        }
    }

    let normalized = output.trim_matches('_').to_string();
    if normalized.is_empty() {
        "model".to_string()
    } else {
        normalized
    }
}

fn faster_whisper_repo_alias_for_model(model: &str) -> Option<&'static str> {
    let normalized_model = model.trim().to_ascii_lowercase();
    match normalized_model.as_str() {
        "openai/whisper-large-v3" => Some("Systran/faster-whisper-large-v3"),
        "openai/whisper-large-v3-turbo" => Some("mobiuslabsgmbh/faster-whisper-large-v3-turbo"),
        "openai/whisper-medium" => Some("Systran/faster-whisper-medium"),
        "openai/whisper-small" => Some("Systran/faster-whisper-small"),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy)]
struct LocalParakeetArchiveSource {
    archive_url: &'static str,
    expected_root_dir: &'static str,
}

fn local_parakeet_archive_source(repo_id: &str) -> Option<LocalParakeetArchiveSource> {
    match repo_id {
        "nvidia/parakeet-tdt_ctc-110m" => Some(LocalParakeetArchiveSource {
            archive_url: PARAKEET_V2_INT8_ARCHIVE_URL,
            expected_root_dir: PARAKEET_V2_INT8_ROOT_DIR,
        }),
        "nvidia/parakeet-tdt-0.6b-v3" => Some(LocalParakeetArchiveSource {
            archive_url: PARAKEET_V3_INT8_ARCHIVE_URL,
            expected_root_dir: PARAKEET_V3_INT8_ROOT_DIR,
        }),
        _ => None,
    }
}

fn legacy_huggingface_repo_id_for_model(provider: &str, model: &str) -> Option<String> {
    let normalized_provider = normalize_local_stt_provider(Some(provider));
    if normalized_provider != "whisper" {
        return None;
    }
    let normalized_model = model.trim();
    if normalized_model.to_ascii_lowercase().starts_with("openai/whisper-") {
        Some(normalized_model.to_string())
    } else {
        None
    }
}

fn resolve_local_stt_repo_and_dir(
    app: &AppHandle,
    provider: &str,
    model: &str,
) -> Result<(String, PathBuf), String> {
    let models_dir = stt_models_dir(app)?;
    let repo_id = resolve_huggingface_repo_id(provider, model);
    let target_dir = models_dir.join(sanitize_model_cache_dir_name(&repo_id));
    if target_dir.exists() {
        return Ok((repo_id, target_dir));
    }

    if let Some(legacy_repo_id) = legacy_huggingface_repo_id_for_model(provider, model) {
        let legacy_dir = models_dir.join(sanitize_model_cache_dir_name(&legacy_repo_id));
        if legacy_dir.exists() {
            return Ok((legacy_repo_id, legacy_dir));
        }
    }

    Ok((repo_id, target_dir))
}

fn resolve_huggingface_repo_id(provider: &str, model: &str) -> String {
    let normalized_model = model.trim();
    if normalized_model.eq_ignore_ascii_case("nvidia/parakeet-tdt-0.6b-v2") {
        // Legacy alias: old "Parakeet v2" selection now resolves to the lightweight v2-class model.
        return "nvidia/parakeet-tdt_ctc-110m".to_string();
    }
    if let Some(mapped_repo) = faster_whisper_repo_alias_for_model(normalized_model) {
        return mapped_repo.to_string();
    }
    if normalized_model.contains('/') {
        return normalized_model.to_string();
    }

    let normalized_provider = normalize_local_stt_provider(Some(provider));
    let normalized_model_lower = normalized_model.to_ascii_lowercase();
    if normalized_provider == "parakeet" {
        return format!("nvidia/{normalized_model}");
    }

    let whisper_model = match normalized_model_lower.as_str() {
        "tiny" | "base" | "small" | "medium" | "large-v1" | "large-v2" | "large-v3"
        | "large-v3-turbo" => format!("whisper-{normalized_model_lower}"),
        _ => normalized_model.to_string(),
    };
    if whisper_model.starts_with("whisper-") {
        format!("openai/{whisper_model}")
    } else {
        format!("openai/{normalized_model}")
    }
}

fn normalize_huggingface_relative_path(raw: &str) -> Result<PathBuf, String> {
    let normalized = raw.trim().replace('\\', "/");
    if normalized.is_empty() {
        return Err("Model file path is empty.".to_string());
    }

    let candidate = Path::new(&normalized);
    if candidate.is_absolute() {
        return Err(format!("Absolute model file path is not allowed: {raw}"));
    }

    let mut safe_path = PathBuf::new();
    for component in candidate.components() {
        match component {
            std::path::Component::Normal(segment) => safe_path.push(segment),
            std::path::Component::CurDir => {}
            _ => return Err(format!("Unsafe model file path segment in '{raw}'")),
        }
    }

    if safe_path.as_os_str().is_empty() {
        return Err(format!("Model file path is invalid: {raw}"));
    }

    Ok(safe_path)
}

fn should_download_huggingface_stt_file(path: &str) -> bool {
    let normalized = path.trim().to_ascii_lowercase();
    if normalized.is_empty() || normalized == ".gitattributes" {
        return false;
    }

    let blocked_prefixes = [
        "plots/",
        "assets/",
        "images/",
        "docs/",
        "samples/",
        "sample/",
        "examples/",
        "example/",
    ];
    if blocked_prefixes
        .iter()
        .any(|prefix| normalized.starts_with(prefix))
    {
        return false;
    }

    let blocked_suffixes = [
        ".md", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf", ".mp4", ".mov", ".wav",
        ".flac", ".mp3",
    ];
    !blocked_suffixes
        .iter()
        .any(|suffix| normalized.ends_with(suffix))
}

fn file_name_equals(path: &Path, expected_name: &str) -> bool {
    path.file_name()
        .and_then(|segment| segment.to_str())
        .map(|name| name.eq_ignore_ascii_case(expected_name))
        .unwrap_or(false)
}

fn preferred_huggingface_primary_file_names(repo_id: &str) -> &'static [&'static str] {
    match repo_id {
        "nvidia/parakeet-tdt-0.6b-v3" => &["parakeet-tdt-0.6b-v3.nemo"],
        "nvidia/parakeet-tdt_ctc-110m" => &["parakeet-tdt_ctc-110m.nemo"],
        "Systran/faster-whisper-large-v3" => &["model.bin"],
        "mobiuslabsgmbh/faster-whisper-large-v3-turbo" => &["model.bin"],
        "Systran/faster-whisper-medium" => &["model.bin"],
        "Systran/faster-whisper-small" => &["model.bin"],
        "openai/whisper-large-v3" => &["model.safetensors"],
        "openai/whisper-medium" => &["model.safetensors"],
        "openai/whisper-small" => &["model.safetensors"],
        "openai/whisper-large-v3-turbo" => &["model.safetensors"],
        "UsefulSensors/moonshine-base" => &["model.safetensors"],
        "FunAudioLLM/SenseVoiceSmall" => {
            &["model.pt", "chn_jpn_yue_eng_ko_spectok.bpe.model"]
        }
        _ => &[],
    }
}

fn select_huggingface_stt_download_entries(
    repo_id: &str,
    entries: &[(PathBuf, Option<u64>)],
) -> Vec<(PathBuf, Option<u64>)> {
    if entries.is_empty() {
        return Vec::new();
    }

    let mut selected_indices: Vec<usize> = Vec::new();
    for preferred_file_name in preferred_huggingface_primary_file_names(repo_id) {
        if let Some((index, _)) = entries
            .iter()
            .enumerate()
            .find(|(_, (path, _))| file_name_equals(path, preferred_file_name))
        {
            if !selected_indices.iter().any(|existing| *existing == index) {
                selected_indices.push(index);
            }
        }
    }

    if selected_indices.is_empty() && repo_id.starts_with("nvidia/parakeet-") {
        if let Some((index, _)) = entries
            .iter()
            .enumerate()
            .filter(|(_, (path, _))| {
                path.extension()
                    .and_then(|value| value.to_str())
                    .map(|value| value.eq_ignore_ascii_case("nemo"))
                    .unwrap_or(false)
            })
            .max_by_key(|(_, (_, size))| size.unwrap_or(0))
        {
            if !selected_indices.iter().any(|existing| *existing == index) {
                selected_indices.push(index);
            }
        }
    } else if selected_indices.is_empty() && repo_id.eq_ignore_ascii_case("FunAudioLLM/SenseVoiceSmall") {
        for (index, (path, _)) in entries.iter().enumerate() {
            if file_name_equals(path, "model.pt")
                || file_name_equals(path, "chn_jpn_yue_eng_ko_spectok.bpe.model")
            {
                if !selected_indices.iter().any(|existing| *existing == index) {
                    selected_indices.push(index);
                }
            }
        }
    } else if selected_indices.is_empty() {
        let primary_file_names = [
            "model.safetensors",
            "pytorch_model.bin",
            "model.pt",
            "model.bin",
            "model.onnx",
            "model.tflite",
        ];
        for primary_name in primary_file_names {
            if let Some((index, _)) = entries
                .iter()
                .enumerate()
                .find(|(_, (path, _))| file_name_equals(path, primary_name))
            {
                if !selected_indices.iter().any(|existing| *existing == index) {
                    selected_indices.push(index);
                }
                break;
            }
        }

        if selected_indices.is_empty() {
            if let Some((index, _)) = entries
                .iter()
                .enumerate()
                .filter(|(_, (path, _))| {
                    let extension = path
                        .extension()
                        .and_then(|value| value.to_str())
                        .map(|value| value.to_ascii_lowercase())
                        .unwrap_or_default();
                    matches!(
                        extension.as_str(),
                        "safetensors" | "bin" | "pt" | "onnx" | "tflite" | "nemo"
                    )
                })
                .max_by_key(|(_, (_, size))| size.unwrap_or(0))
            {
                if !selected_indices.iter().any(|existing| *existing == index) {
                    selected_indices.push(index);
                }
            }
        }
    }

    let support_file_names = [
        "config.json",
        "generation_config.json",
        "model.bin",
        "tokenizer.json",
        "tokenizer_config.json",
        "preprocessor_config.json",
        "special_tokens_map.json",
        "vocabulary.json",
        "vocabulary.txt",
        "vocab.json",
        "merges.txt",
        "normalizer.json",
        "added_tokens.json",
        "chn_jpn_yue_eng_ko_spectok.bpe.model",
    ];
    for (index, (path, _)) in entries.iter().enumerate() {
        if support_file_names
            .iter()
            .any(|file_name| file_name_equals(path, file_name))
        {
            if !selected_indices.iter().any(|existing| *existing == index) {
                selected_indices.push(index);
            }
        }
    }

    if selected_indices.is_empty() {
        return entries.to_vec();
    }

    selected_indices
        .into_iter()
        .filter_map(|index| entries.get(index).cloned())
        .collect()
}

fn local_stt_archive_parallel_chunk_count(total_bytes: u64) -> usize {
    if total_bytes == 0 {
        return 1;
    }

    let configured = std::env::var(LOCAL_STT_ARCHIVE_PARALLEL_CHUNKS_ENV)
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(LOCAL_STT_ARCHIVE_PARALLEL_CHUNKS_DEFAULT)
        .clamp(1, LOCAL_STT_ARCHIVE_PARALLEL_CHUNKS_MAX);

    if total_bytes < LOCAL_STT_ARCHIVE_MIN_BYTES_PER_CHUNK.saturating_mul(2) {
        return 1;
    }

    let max_chunks_by_size = ((total_bytes + LOCAL_STT_ARCHIVE_MIN_BYTES_PER_CHUNK - 1)
        / LOCAL_STT_ARCHIVE_MIN_BYTES_PER_CHUNK)
        .max(1) as usize;
    configured.min(max_chunks_by_size).max(1)
}

async fn download_archive_range_chunk(
    client: Client,
    url: String,
    start: u64,
    end: u64,
    part_path: PathBuf,
    progress: Arc<AtomicU64>,
) -> Result<u64, String> {
    let range_header = format!("bytes={start}-{end}");
    let mut response = client
        .get(&url)
        .header(RANGE, range_header)
        .timeout(Duration::from_secs(60 * 60))
        .send()
        .await
        .map_err(|error| format!("Parallel range request failed: {error}"))?;
    if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!(
            "Server refused range request for '{}' (status {}).",
            clip_text(&url, 220),
            response.status()
        ));
    }

    let mut file = fs::File::create(&part_path).map_err(|error| {
        format!(
            "Failed to create archive part '{}': {error}",
            part_path.display()
        )
    })?;

    let mut downloaded = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Failed reading range stream: {error}"))?
    {
        file.write_all(&chunk).map_err(|error| {
            format!(
                "Failed writing archive part '{}': {error}",
                part_path.display()
            )
        })?;
        let chunk_size = u64::try_from(chunk.len()).unwrap_or(0);
        downloaded = downloaded.saturating_add(chunk_size);
        progress.fetch_add(chunk_size, Ordering::Relaxed);
    }

    if downloaded == 0 {
        return Err(format!(
            "Downloaded archive part '{}' was empty.",
            part_path.display()
        ));
    }

    Ok(downloaded)
}

fn concatenate_archive_parts(parts: &[PathBuf], destination: &Path) -> Result<(), String> {
    let mut output = fs::File::create(destination).map_err(|error| {
        format!(
            "Failed to create archive destination '{}': {error}",
            destination.display()
        )
    })?;

    for part in parts {
        let mut input = fs::File::open(part).map_err(|error| {
            format!(
                "Failed to open archive part '{}': {error}",
                part.display()
            )
        })?;
        std::io::copy(&mut input, &mut output).map_err(|error| {
            format!(
                "Failed merging archive part '{}' into '{}': {error}",
                part.display(),
                destination.display()
            )
        })?;
    }

    Ok(())
}

async fn download_archive_parallel_ranges(
    client: &Client,
    url: &str,
    temp_archive_path: &Path,
    total_bytes: u64,
    chunk_count: usize,
    state: &AppState,
) -> Result<u64, String> {
    if total_bytes == 0 || chunk_count <= 1 {
        return Err("Parallel range download requires known content length and >1 chunks.".to_string());
    }

    let chunk_size = ((total_bytes + chunk_count as u64 - 1) / chunk_count as u64).max(1);
    let mut part_paths: Vec<PathBuf> = Vec::new();
    let mut tasks = Vec::new();
    let progress = Arc::new(AtomicU64::new(0));

    for index in 0..chunk_count {
        let start = (index as u64).saturating_mul(chunk_size);
        if start >= total_bytes {
            break;
        }
        let end = start
            .saturating_add(chunk_size)
            .saturating_sub(1)
            .min(total_bytes.saturating_sub(1));
        let part_path = PathBuf::from(format!(
            "{}.part{}",
            temp_archive_path.to_string_lossy(),
            index
        ));
        if part_path.exists() {
            let _ = fs::remove_file(&part_path);
        }

        let task = tauri::async_runtime::spawn(download_archive_range_chunk(
            client.clone(),
            url.to_string(),
            start,
            end,
            part_path.clone(),
            progress.clone(),
        ));
        part_paths.push(part_path);
        tasks.push(task);
    }

    let mut first_error: Option<String> = None;
    for task in tasks {
        match task.await {
            Ok(Ok(_)) => {
                let downloaded_bytes = progress.load(Ordering::Relaxed);
                let _ = state.update_local_stt_download_status(|status| {
                    status.downloaded_bytes = downloaded_bytes;
                });
            }
            Ok(Err(error)) => {
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
            Err(error) => {
                if first_error.is_none() {
                    first_error = Some(format!("Parallel archive worker failed: {error}"));
                }
            }
        }
    }

    if let Some(error) = first_error {
        for path in &part_paths {
            let _ = fs::remove_file(path);
        }
        return Err(error);
    }

    concatenate_archive_parts(&part_paths, temp_archive_path)?;
    for path in &part_paths {
        let _ = fs::remove_file(path);
    }
    Ok(progress.load(Ordering::Relaxed))
}

async fn download_archive_single_stream(
    client: &Client,
    url: &str,
    temp_archive_path: &Path,
    state: &AppState,
    total_bytes_hint: u64,
) -> Result<u64, String> {
    let mut response = client
        .get(url)
        .timeout(Duration::from_secs(60 * 60))
        .send()
        .await
        .map_err(|error| format!("Failed to download archive '{}': {error}", clip_text(url, 220)))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Archive download failed ({status}): {}",
            clip_text(&single_line(&body), 320)
        ));
    }

    let total_bytes = response.content_length().unwrap_or(total_bytes_hint);
    if total_bytes > 0 {
        state.update_local_stt_download_status(|status| {
            status.total_bytes = total_bytes;
        })?;
    }

    let mut output_file = fs::File::create(temp_archive_path).map_err(|error| {
        format!(
            "Failed to create temporary archive '{}': {error}",
            temp_archive_path.display()
        )
    })?;
    let mut downloaded_bytes = 0u64;
    let mut last_status_update = Instant::now();

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Failed reading archive stream '{}': {error}", clip_text(url, 220)))?
    {
        output_file.write_all(&chunk).map_err(|error| {
            format!(
                "Failed writing archive chunk '{}': {error}",
                temp_archive_path.display()
            )
        })?;
        downloaded_bytes = downloaded_bytes.saturating_add(u64::try_from(chunk.len()).unwrap_or(0));

        if last_status_update.elapsed() >= Duration::from_millis(120) {
            state.update_local_stt_download_status(|status| {
                status.downloaded_bytes = downloaded_bytes;
            })?;
            last_status_update = Instant::now();
        }
    }
    drop(output_file);
    Ok(downloaded_bytes)
}

async fn download_prepacked_parakeet_model(
    client: &Client,
    repo_id: &str,
    target_dir: &Path,
    state: &AppState,
) -> Result<String, String> {
    let source = local_parakeet_archive_source(repo_id)
        .ok_or_else(|| format!("No prepacked Parakeet archive source configured for '{repo_id}'."))?;

    if let Ok(existing_root) = find_local_parakeet_model_root(target_dir) {
        return Ok(format!(
            "Model '{repo_id}' is already cached at '{}'.",
            existing_root.display()
        ));
    }

    fs::create_dir_all(target_dir)
        .map_err(|error| format!("Failed to create STT model target directory: {error}"))?;

    let archive_path = target_dir.join(format!("{}.tar.gz", source.expected_root_dir));
    let temp_archive_path = target_dir.join(format!("{}.tar.gz.partial", source.expected_root_dir));
    if temp_archive_path.exists() {
        let _ = fs::remove_file(&temp_archive_path);
    }

    state.update_local_stt_download_status(|status| {
        status.stage = "Downloading model archive...".to_string();
        status.message = format!("Downloading '{}'.", repo_id);
        status.files_total = 1;
        status.files_completed = 0;
        status.downloaded_bytes = 0;
        status.total_bytes = 0;
        status.current_file = archive_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("model.tar.gz")
            .to_string();
    })?;

    let head_probe = client
        .head(source.archive_url)
        .timeout(Duration::from_secs(35))
        .send()
        .await
        .ok();
    let total_bytes = head_probe
        .as_ref()
        .and_then(|response| response.content_length())
        .unwrap_or(0);
    let range_supported = head_probe
        .as_ref()
        .and_then(|response| response.headers().get(ACCEPT_RANGES))
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_ascii_lowercase().contains("bytes"))
        .unwrap_or(false);
    let parallel_chunks = if range_supported {
        local_stt_archive_parallel_chunk_count(total_bytes)
    } else {
        1
    };

    state.update_local_stt_download_status(|status| {
        status.total_bytes = total_bytes;
        if parallel_chunks > 1 {
            status.message = format!(
                "Downloading '{}' using {} parallel streams.",
                repo_id, parallel_chunks
            );
        }
    })?;

    let downloaded_bytes = if parallel_chunks > 1 && total_bytes > 0 {
        match download_archive_parallel_ranges(
            client,
            source.archive_url,
            &temp_archive_path,
            total_bytes,
            parallel_chunks,
            state,
        )
        .await
        {
            Ok(bytes) => bytes,
            Err(error) => {
                warn!(
                    "[local.stt.download] parallel archive download failed repo={} reason={} fallback=single-stream",
                    clip_text(repo_id, 160),
                    clip_text(&single_line(&error), 260)
                );
                state.update_local_stt_download_status(|status| {
                    status.message = format!(
                        "Parallel download fallback triggered. Retrying '{}' with single stream.",
                        repo_id
                    );
                    status.downloaded_bytes = 0;
                })?;
                download_archive_single_stream(
                    client,
                    source.archive_url,
                    &temp_archive_path,
                    state,
                    total_bytes,
                )
                .await?
            }
        }
    } else {
        download_archive_single_stream(
            client,
            source.archive_url,
            &temp_archive_path,
            state,
            total_bytes,
        )
        .await?
    };

    if downloaded_bytes == 0 {
        let _ = fs::remove_file(&temp_archive_path);
        return Err(format!(
            "Downloaded archive for '{repo_id}' was empty."
        ));
    }

    if archive_path.exists() {
        fs::remove_file(&archive_path).map_err(|error| {
            format!(
                "Failed to replace local archive '{}': {error}",
                archive_path.display()
            )
        })?;
    }
    fs::rename(&temp_archive_path, &archive_path).map_err(|error| {
        format!(
            "Failed to finalize archive '{}': {error}",
            archive_path.display()
        )
    })?;

    let expected_root = target_dir.join(source.expected_root_dir);
    if expected_root.exists() {
        fs::remove_dir_all(&expected_root).map_err(|error| {
            format!(
                "Failed to clear previous extracted model directory '{}': {error}",
                expected_root.display()
            )
        })?;
    }

    state.update_local_stt_download_status(|status| {
        status.stage = "Extracting model archive...".to_string();
        status.message = format!("Extracting '{}'.", repo_id);
        status.downloaded_bytes = downloaded_bytes;
        if status.total_bytes == 0 {
            status.total_bytes = downloaded_bytes;
        }
        status.current_file = archive_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("model.tar.gz")
            .to_string();
    })?;

    extract_tar_gz_archive(&archive_path, target_dir)?;
    let _ = fs::remove_file(&archive_path);

    let model_root = find_local_parakeet_model_root(target_dir)?;
    let size_mb = downloaded_bytes as f64 / (1024.0 * 1024.0);
    Ok(format!(
        "Downloaded and extracted Parakeet archive ({size_mb:.1} MiB) for '{repo_id}' into '{}'. Model root: '{}'.",
        target_dir.display(),
        model_root.display()
    ))
}

async fn download_huggingface_stt_model(
    client: &Client,
    repo_id: &str,
    target_dir: &Path,
    huggingface_token: Option<&str>,
    state: &AppState,
) -> Result<String, String> {
    if local_parakeet_archive_source(repo_id).is_some() {
        return download_prepacked_parakeet_model(client, repo_id, target_dir, state).await;
    }

    let token = huggingface_token
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let metadata_url = format!("https://huggingface.co/api/models/{repo_id}");
    let metadata_response = apply_optional_bearer_auth(client.get(&metadata_url), token)
        .send()
        .await
        .map_err(|error| format!("Failed to query HuggingFace model '{repo_id}': {error}"))?;
    let metadata_status = metadata_response.status();
    let metadata_body = metadata_response
        .text()
        .await
        .map_err(|error| format!("Failed to parse HuggingFace metadata body: {error}"))?;
    if !metadata_status.is_success() {
        return Err(format!(
            "HuggingFace model metadata request failed ({metadata_status}): {}",
            clip_text(&single_line(&metadata_body), 360)
        ));
    }

    let metadata: Value = serde_json::from_str(&metadata_body)
        .map_err(|error| format!("Invalid HuggingFace metadata JSON: {error}"))?;
    let siblings = metadata
        .get("siblings")
        .and_then(Value::as_array)
        .ok_or_else(|| "HuggingFace metadata does not include a file listing.".to_string())?;

    let candidate_entries = siblings
        .iter()
        .filter_map(|entry| {
            let relative_raw = entry
                .get("rfilename")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())?;
            if !should_download_huggingface_stt_file(relative_raw) {
                return None;
            }
            let relative_path = normalize_huggingface_relative_path(relative_raw).ok()?;
            let size_hint = entry.get("size").and_then(Value::as_u64);
            Some((relative_path, size_hint))
        })
        .collect::<Vec<_>>();
    if candidate_entries.is_empty() {
        return Err(format!(
            "No downloadable model artifacts found for HuggingFace model '{repo_id}'."
        ));
    }
    let file_entries = select_huggingface_stt_download_entries(repo_id, &candidate_entries);
    if file_entries.is_empty() {
        return Err(format!(
            "Unable to select required downloadable artifacts for '{repo_id}'."
        ));
    }
    let selected_estimated_bytes = file_entries
        .iter()
        .map(|(_, size)| size.unwrap_or(0))
        .fold(0_u64, |acc, value| acc.saturating_add(value));
    info!(
        "[local.stt.download] repo={} selected_files={} selected_estimated_mib={:.1}",
        clip_text(repo_id, 160),
        file_entries.len(),
        selected_estimated_bytes as f64 / (1024.0 * 1024.0)
    );

    fs::create_dir_all(target_dir)
        .map_err(|error| format!("Failed to create STT model target directory: {error}"))?;

    let mut to_download: Vec<(PathBuf, PathBuf, Option<u64>)> = Vec::new();
    let mut skipped_files = 0usize;
    let mut total_bytes = 0u64;
    for (relative_path, size_hint) in file_entries {
        let output_path = target_dir.join(&relative_path);
        if file_exists_with_content(&output_path) {
            skipped_files += 1;
            continue;
        }
        if let Some(size) = size_hint {
            total_bytes = total_bytes.saturating_add(size);
        }
        to_download.push((relative_path, output_path, size_hint));
    }

    state.update_local_stt_download_status(|status| {
        status.stage = "Downloading model files...".to_string();
        status.message = format!(
            "Downloading '{}' ({} files pending).",
            repo_id,
            to_download.len()
        );
        status.files_total = to_download.len();
        status.files_completed = 0;
        status.downloaded_bytes = 0;
        status.total_bytes = total_bytes;
        status.current_file.clear();
    })?;

    if to_download.is_empty() {
        return Ok(format!(
            "Model '{repo_id}' is already cached at '{}'.",
            target_dir.display()
        ));
    }

    let mut downloaded_files = 0usize;
    let mut downloaded_bytes = 0u64;

    for (relative_path, output_path, size_hint) in to_download {
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Failed to create model directory '{}': {error}",
                    parent.display()
                )
            })?;
        }

        let current_file = relative_path.display().to_string();
        state.update_local_stt_download_status(|status| {
            status.current_file = current_file.clone();
            status.stage = "Downloading file...".to_string();
            status.message = format!(
                "Downloading file {} of {}",
                status.files_completed + 1,
                status.files_total
            );
        })?;

        let mut download_url = Url::parse(&format!(
            "https://huggingface.co/{repo_id}/resolve/main/"
        ))
        .map_err(|error| format!("Invalid HuggingFace download URL for '{repo_id}': {error}"))?;
        {
            let mut segments = download_url
                .path_segments_mut()
                .map_err(|_| "Failed to build HuggingFace download path.".to_string())?;
            segments.pop_if_empty();
            for component in relative_path.components() {
                if let std::path::Component::Normal(segment) = component {
                    let value = segment.to_string_lossy();
                    segments.push(value.as_ref());
                }
            }
        }
        download_url
            .query_pairs_mut()
            .append_pair("download", "true");

        let mut response = apply_optional_bearer_auth(client.get(download_url.clone()), token)
            .timeout(Duration::from_secs(60 * 60))
            .send()
            .await
            .map_err(|error| {
                format!(
                    "Failed to download HuggingFace file '{}': {error}",
                    relative_path.display()
                )
            })?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "HuggingFace file download failed '{}' ({status}): {}",
                relative_path.display(),
                clip_text(&single_line(&body), 320)
            ));
        }

        if size_hint.is_none() {
            if let Some(content_length) = response.content_length() {
                total_bytes = total_bytes.saturating_add(content_length);
                state.update_local_stt_download_status(|status| {
                    status.total_bytes = total_bytes;
                })?;
            }
        }

        let temp_path = output_path.with_extension("partial");
        if temp_path.exists() {
            let _ = fs::remove_file(&temp_path);
        }

        let mut output_file = fs::File::create(&temp_path).map_err(|error| {
            format!(
                "Failed to create temporary model file '{}': {error}",
                temp_path.display()
            )
        })?;
        let mut bytes_for_file = 0u64;
        let mut last_status_update = Instant::now();
        while let Some(chunk) = response.chunk().await.map_err(|error| {
            format!(
                "Failed reading HuggingFace download stream '{}': {error}",
                relative_path.display()
            )
        })? {
            output_file.write_all(&chunk).map_err(|error| {
                format!(
                    "Failed writing HuggingFace file chunk '{}': {error}",
                    temp_path.display()
                )
            })?;
            let chunk_size = u64::try_from(chunk.len()).unwrap_or(u64::MAX);
            bytes_for_file = bytes_for_file.saturating_add(chunk_size);
            downloaded_bytes = downloaded_bytes.saturating_add(chunk_size);

            if last_status_update.elapsed() >= Duration::from_millis(160) {
                let current_file = relative_path.display().to_string();
                state.update_local_stt_download_status(|status| {
                    status.current_file = current_file;
                    status.downloaded_bytes = downloaded_bytes;
                })?;
                last_status_update = Instant::now();
            }
        }
        drop(output_file);

        if bytes_for_file == 0 {
            let _ = fs::remove_file(&temp_path);
            return Err(format!(
                "Downloaded file '{}' was empty.",
                relative_path.display()
            ));
        }

        if output_path.exists() {
            fs::remove_file(&output_path).map_err(|error| {
                format!(
                    "Failed to replace existing model file '{}': {error}",
                    output_path.display()
                )
            })?;
        }
        fs::rename(&temp_path, &output_path).map_err(|error| {
            format!(
                "Failed to finalize model file '{}': {error}",
                output_path.display()
            )
        })?;

        downloaded_files += 1;
        state.update_local_stt_download_status(|status| {
            status.downloaded_bytes = downloaded_bytes;
            status.files_completed = downloaded_files;
            status.current_file.clear();
            status.message = format!(
                "Downloaded {}/{} files.",
                status.files_completed,
                status.files_total
            );
        })?;
    }

    if downloaded_files == 0 && skipped_files == 0 {
        return Err(format!(
            "No files were downloaded for HuggingFace model '{repo_id}'."
        ));
    }

    if downloaded_files == 0 {
        return Ok(format!(
            "Model '{repo_id}' is already cached at '{}'.",
            target_dir.display()
        ));
    }

    let size_mb = downloaded_bytes as f64 / (1024.0 * 1024.0);
    let skipped_suffix = if skipped_files > 0 {
        format!(" Skipped {skipped_files} already-present files.")
    } else {
        String::new()
    };
    Ok(format!(
        "Downloaded {downloaded_files} files ({size_mb:.1} MiB) from '{repo_id}' into '{}'.{}",
        target_dir.display(),
        skipped_suffix
    ))
}

fn mime_to_extension(mime: &str) -> &'static str {
    let normalized = mime.to_ascii_lowercase();

    if normalized.contains("ogg") {
        return "ogg";
    }

    if normalized.contains("wav") {
        return "wav";
    }

    if normalized.contains("mp4") {
        return "m4a";
    }

    if normalized.contains("mpeg") || normalized.contains("mp3") {
        return "mp3";
    }

    "webm"
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| {
            let millis = duration.as_millis();
            if millis > u128::from(u64::MAX) {
                u64::MAX
            } else {
                millis as u64
            }
        })
        .unwrap_or(0)
}

fn calculate_local_stt_progress_percent(status: &LocalSttDownloadStatusResponse) -> f64 {
    if status.total_bytes > 0 {
        return ((status.downloaded_bytes as f64 / status.total_bytes as f64) * 100.0).clamp(0.0, 100.0);
    }

    if status.files_total > 0 {
        return ((status.files_completed as f64 / status.files_total as f64) * 100.0).clamp(0.0, 100.0);
    }

    if status.completed && status.success {
        100.0
    } else {
        0.0
    }
}

fn elapsed_ms(start: Instant) -> u64 {
    let elapsed = start.elapsed().as_millis();
    if elapsed > u128::from(u64::MAX) {
        u64::MAX
    } else {
        elapsed as u64
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn validates_tts_input_length() {
        let short = "Short text.";
        assert!(validate_tts_input_length(short).is_ok());

        let boundary = "a".repeat(MAX_TTS_INPUT_LENGTH);
        assert!(validate_tts_input_length(&boundary).is_ok());

        let long = "a".repeat(MAX_TTS_INPUT_LENGTH + 1);
        assert!(validate_tts_input_length(&long).is_err());
    }

    #[test]
    fn validates_safe_update_urls() {
        let (owner, name) = resolve_update_repository();
        let valid_prefix = format!("https://github.com/{owner}/{name}/");
        let valid_url = format!("{valid_prefix}releases/download/v1.0/app.exe");

        assert!(is_safe_update_url(&valid_url));
        assert!(is_safe_update_url(&valid_url.to_ascii_uppercase())); // Case insensitive check

        // Untrusted repositories on GitHub must be rejected
        assert!(!is_safe_update_url(
            "https://github.com/Attacker/MalwareRepo/releases/download/v1.0/app.exe"
        ));

        // Path traversal should be rejected
        assert!(!is_safe_update_url(
            "https://github.com/SlasshyOverhere/SlasshyWispr/../../Attacker/MalwareRepo/releases/download/v1.0/app.exe"
        ));

        // Arbitrary attachments in the trusted repo must be rejected
        assert!(!is_safe_update_url(
            "https://github.com/SlasshyOverhere/SlasshyWispr/issues/1/attachments/12345"
        ));

        // Direct objects links are now rejected to enforce repo trust
        assert!(!is_safe_update_url(
            "https://objects.githubusercontent.com/github-production-release-asset-2e65be/123"
        ));

        // Other domains and protocols
        assert!(!is_safe_update_url("https://evil.com/app.exe"));
        assert!(!is_safe_update_url("http://github.com/user/repo"));
        assert!(!is_safe_update_url("ftp://github.com/user/repo"));
    }
    use super::*;

    fn refinement_request(
        apply_backtrack: bool,
        remove_fillers: bool,
        auto_punctuation: bool,
        auto_numbered_lists: bool,
    ) -> AssistantPipelineRequest {
        AssistantPipelineRequest {
            api_key: String::new(),
            api_base_url: None,
            stt_model: None,
            ai_model: None,
            local_mode: None,
            stt_local_mode: None,
            ai_local_mode: None,
            local_ollama_base_url: None,
            local_ollama_model: None,
            local_stt_model: None,
            piper_path: None,
            audio_base64: String::new(),
            audio_mime_type: String::new(),
            language: None,
            allowed_languages: None,
            system_prompt: None,
            temperature: None,
            max_tokens: None,
            dictionary_entries: None,
            snippet_entries: None,
            apply_backtrack: Some(apply_backtrack),
            remove_fillers: Some(remove_fillers),
            auto_punctuation: Some(auto_punctuation),
            auto_numbered_lists: Some(auto_numbered_lists),
            command_mode: None,
            wake_word_enabled: None,
            assistant_name: None,
            selected_text: None,
            tts_engine: None,
            piper: None,
            coqui: None,
        }
    }

    fn pipeline_mode_request_template() -> AssistantPipelineRequest {
        AssistantPipelineRequest {
            api_key: "test-key".to_string(),
            api_base_url: Some("https://api.example.com/v1".to_string()),
            stt_model: Some("gpt-4o-mini-transcribe".to_string()),
            ai_model: Some("gpt-4o-mini".to_string()),
            local_mode: None,
            stt_local_mode: None,
            ai_local_mode: None,
            local_ollama_base_url: Some("http://127.0.0.1:11434".to_string()),
            local_ollama_model: Some("llama3.2:3b".to_string()),
            local_stt_model: Some("nvidia/parakeet-tdt-0.6b-v3".to_string()),
            piper_path: None,
            audio_base64: String::new(),
            audio_mime_type: "audio/wav".to_string(),
            language: None,
            allowed_languages: None,
            system_prompt: None,
            temperature: None,
            max_tokens: None,
            dictionary_entries: None,
            snippet_entries: None,
            apply_backtrack: None,
            remove_fillers: None,
            auto_punctuation: None,
            auto_numbered_lists: None,
            command_mode: None,
            wake_word_enabled: None,
            assistant_name: None,
            selected_text: None,
            tts_engine: None,
            piper: None,
            coqui: None,
        }
    }

    #[test]
    fn normalizes_math_heavy_piper_text() {
        let input = "5,000,000 - 200 = 4,999,800 and 200 / 30 = 6.67";
        let normalized = normalize_piper_text_for_tts(input);

        assert!(normalized.contains("five million"));
        assert!(normalized.contains("minus two hundred"));
        assert!(normalized.contains("equals"));
        assert!(normalized.contains("four million"));
        assert!(normalized.contains("nine hundred and ninety nine thousand"));
        assert!(normalized.contains("two hundred divided by thirty"));
        assert!(normalized.contains("six point six seven"));
    }

    #[test]
    fn keeps_punctuation_after_numeric_tokens() {
        let input = "Result: 4,999,800. Next: 6.67, then 30.";
        let normalized = normalize_piper_text_for_tts(input);

        assert!(normalized.contains("four million"));
        assert!(normalized.contains("eight hundred."));
        assert!(normalized.contains("six point six seven,"));
        assert!(normalized.ends_with("thirty."));
    }

    #[test]
    fn transcript_refinement_respects_disabled_toggles() {
        let request = refinement_request(false, false, false, false);
        let output = refine_transcript("um write this exactly", &request);
        assert_eq!(output, "um write this exactly");
    }

    #[test]
    fn transcript_refinement_keeps_meaningful_like() {
        let request = refinement_request(false, true, false, false);
        let output = refine_transcript("um I would like this approach", &request);
        assert_eq!(output, "I would like this approach");
    }

    #[test]
    fn transcript_refinement_applies_numbered_lists_when_enabled() {
        let request = refinement_request(false, false, false, true);
        let output = refine_transcript("numbered list apples next item oranges", &request);
        assert_eq!(output, "1. apples\n2. oranges");
    }

    #[test]
    fn transcript_refinement_auto_punctuation_toggle() {
        let disabled = refinement_request(false, false, false, false);
        let enabled = refinement_request(false, false, true, false);
        assert_eq!(
            refine_transcript("please send update", &disabled),
            "please send update"
        );
        assert_eq!(
            refine_transcript("please send update", &enabled),
            "please send update."
        );
    }

    #[test]
    fn detects_repetitive_transcript_noise() {
        let noisy = "ලලලලලලලලලලලලලලලලලලලලලලලලලලලල";
        assert!(looks_like_repetitive_transcript_noise(noisy, Some("en")));
    }

    #[test]
    fn rejects_script_mismatch_for_latin_language_hint() {
        let transcript = "සාරි සාරි සාරි සාරි සාරි";
        assert!(looks_like_repetitive_transcript_noise(transcript, Some("en")));
    }

    #[test]
    fn accepts_normal_english_transcript() {
        let transcript = "Hey Lily what do you think about India today";
        assert!(!looks_like_repetitive_transcript_noise(transcript, Some("en")));
    }

    #[test]
    fn detects_wake_phrase_and_extracts_command() {
        let command = extract_wake_command("Hey Lily, send this to AI", "Lily").unwrap_or_default();
        assert_eq!(command, "send this to AI");
    }

    #[test]
    fn supports_multiple_wake_prefix_variants() {
        let hi = extract_wake_command("Hi Lily summarize this", "Lily").unwrap_or_default();
        let okay = extract_wake_command("Okay Lily, summarize this", "Lily").unwrap_or_default();
        let bare_name = extract_wake_command("Lily summarize this", "Lily");

        assert_eq!(hi, "summarize this");
        assert_eq!(okay, "summarize this");
        assert!(bare_name.is_none());
    }

    #[test]
    fn uses_custom_assistant_name_from_settings() {
        let command = extract_wake_command("Hey Nova open settings", "Nova").unwrap_or_default();
        assert_eq!(command, "open settings");
    }

    #[test]
    fn tolerates_small_assistant_name_misspelling() {
        let command = extract_wake_command("Hey Lilly, summarize this", "Lily").unwrap_or_default();
        assert_eq!(command, "summarize this");
    }

    #[test]
    fn tolerates_single_edit_short_name_variant() {
        let command =
            extract_wake_command("Hi Lili improve this sentence", "Lily").unwrap_or_default();
        assert_eq!(command, "improve this sentence");
    }

    #[test]
    fn tolerates_fused_hey_lily_variant_token() {
        let command = extract_wake_command("Hey Haleily what do you think about India", "Lily")
            .unwrap_or_default();
        assert_eq!(command, "what do you think about India");
    }

    #[test]
    fn tolerates_phonetic_haleli_variant() {
        let command = extract_wake_command("Hey Haleli, open settings", "Lily").unwrap_or_default();
        assert_eq!(command, "open settings");
    }

    #[test]
    fn rejects_missing_wake_prefix_even_if_name_like_token_exists() {
        let command = extract_wake_command("Lily open settings", "Lily");
        assert!(command.is_none());
    }

    #[test]
    fn rejects_non_wake_prefix_as_dictation() {
        let command = extract_wake_command("Please tell Lily to summarize", "Lily");
        assert!(command.is_none());
    }

    #[test]
    fn does_not_match_distant_name_word() {
        let command = extract_wake_command("Hey really summarize this", "Lily");
        assert!(command.is_none());
    }

    #[test]
    fn accepts_ok_prefix_and_multiple_name_tokens() {
        let command = extract_wake_command("Ok   Slasshy Wispr improve this", "Slasshy Wispr")
            .unwrap_or_default();
        assert_eq!(command, "improve this");
    }

    #[test]
    fn tolerates_leading_filler_before_wake_phrase() {
        let command =
            extract_wake_command("Um hey Lily create an email for me", "Lily").unwrap_or_default();
        assert_eq!(command, "create an email for me");
    }

    #[test]
    fn tolerates_small_wake_prefix_misspelling() {
        let command = extract_wake_command("He Lily draft a follow up email", "Lily")
            .unwrap_or_default();
        assert_eq!(command, "draft a follow up email");
    }

    #[test]
    fn parses_selection_edit_decision_json() {
        let raw =
            r#"{"action":"replace_now","rewrite":"Improved sentence.","message":"Applying edit."}"#;
        let decision = parse_selection_edit_decision(raw).expect("decision should parse");
        assert_eq!(decision.action, SelectionEditAction::ReplaceNow);
        assert_eq!(decision.rewrite_text, "Improved sentence.");
        assert_eq!(decision.message, "Applying edit.");
    }

    #[test]
    fn detects_selection_confirmation_intents() {
        assert!(is_affirmative_selection_confirmation("yes replace it"));
        assert!(is_affirmative_selection_confirmation("go ahead and apply"));
        assert!(is_negative_selection_confirmation("no cancel that"));
        assert!(is_negative_selection_confirmation("don't do that"));
        assert!(!is_affirmative_selection_confirmation("don't replace it"));
    }

    #[test]
    fn flags_suspicious_short_rewrite_for_confirmation() {
        let selected = "This is a fairly detailed paragraph that should not be replaced with a tiny generic output because it would lose meaning for the user.";
        let suspicious = "Looks good.";
        assert!(is_rewrite_suspicious(
            "make this better",
            selected,
            suspicious
        ));
        assert!(!is_rewrite_suspicious(
            "summarize this",
            selected,
            "A concise summary."
        ));
    }

    #[test]
    fn detects_edit_intent_for_selection_guard() {
        assert!(seems_like_selection_edit_instruction(
            "make this review better"
        ));
        assert!(seems_like_selection_edit_instruction("rewrite this"));
        assert!(!seems_like_selection_edit_instruction(
            "which laptop is better"
        ));
        assert!(!seems_like_selection_edit_instruction(
            "what is the weather"
        ));
    }

    #[test]
    fn detects_draft_generation_instruction_for_compose_guard() {
        assert!(seems_like_draft_generation_instruction(
            "create an email for sick leave"
        ));
        assert!(seems_like_draft_generation_instruction(
            "write a follow up letter"
        ));
        assert!(!seems_like_draft_generation_instruction(
            "what is email marketing"
        ));
    }

    #[test]
    fn flags_incomplete_draft_outputs() {
        let incomplete = "Subject: Sick Leave - Unable to Attend Work Tomorrow\n\nDear [Boss's Name],\n\nI am";
        assert!(looks_like_incomplete_draft_output(incomplete));

        let complete = "Subject: Sick Leave Request for Tomorrow\n\nDear Manager,\n\nI am feeling unwell and will not be able to attend work tomorrow. I will monitor urgent messages and hand over critical items before the day starts.\n\nBest regards,\nSuman";
        assert!(!looks_like_incomplete_draft_output(complete));
    }

    #[test]
    fn extract_chat_content_supports_nested_text_value_parts() {
        let payload = serde_json::json!({
            "choices": [
                {
                    "message": {
                        "content": [
                            {
                                "type": "output_text",
                                "text": { "value": "Draft complete." }
                            }
                        ]
                    }
                }
            ]
        });
        assert_eq!(extract_chat_content(&payload).as_deref(), Some("Draft complete."));
    }

    #[test]
    fn extract_chat_content_supports_legacy_choices_text() {
        let payload = serde_json::json!({
            "choices": [
                {
                    "text": "Legacy completion output"
                }
            ]
        });
        assert_eq!(
            extract_chat_content(&payload).as_deref(),
            Some("Legacy completion output")
        );
    }

    #[test]
    fn extract_chat_content_supports_refusal_field() {
        let payload = serde_json::json!({
            "choices": [
                {
                    "message": {
                        "refusal": "I cannot help with that request."
                    }
                }
            ]
        });
        assert_eq!(
            extract_chat_content(&payload).as_deref(),
            Some("I cannot help with that request.")
        );
    }

    #[test]
    fn resolve_pipeline_mode_supports_local_stt_online_ai() {
        let mut request = pipeline_mode_request_template();
        request.stt_local_mode = Some(true);
        request.ai_local_mode = Some(false);

        let mode = resolve_pipeline_mode(&request).expect("pipeline mode should resolve");
        assert!(matches!(mode.stt, SttModeConfig::Local(_)));
        assert!(matches!(mode.ai, AiModeConfig::Online { .. }));
    }

    #[test]
    fn resolve_pipeline_mode_supports_online_stt_local_ai() {
        let mut request = pipeline_mode_request_template();
        request.stt_local_mode = Some(false);
        request.ai_local_mode = Some(true);

        let mode = resolve_pipeline_mode(&request).expect("pipeline mode should resolve");
        assert!(matches!(mode.stt, SttModeConfig::Online { .. }));
        assert!(matches!(mode.ai, AiModeConfig::Local(_)));
    }

    #[test]
    fn resolve_pipeline_mode_requires_api_key_if_any_online_mode_enabled() {
        let mut request = pipeline_mode_request_template();
        request.api_key = String::new();
        request.stt_local_mode = Some(true);
        request.ai_local_mode = Some(false);

        let error =
            resolve_pipeline_mode(&request).expect_err("expected missing api key validation");
        assert!(error.contains("API key is required"));
    }

    #[test]
    fn built_in_local_stt_catalog_is_parakeet_only() {
        let models = built_in_local_stt_model_catalog();
        assert_eq!(
            models,
            vec![
                "nvidia/parakeet-tdt-0.6b-v3".to_string(),
                "nvidia/parakeet-tdt_ctc-110m".to_string()
            ]
        );
    }

    #[test]
    fn local_stt_provider_python_requirement_flags() {
        assert!(local_stt_provider_requires_python("whisper"));
        assert!(local_stt_provider_requires_python("moonshine"));
        assert!(local_stt_provider_requires_python("sensevoice"));
        assert!(!local_stt_provider_requires_python("parakeet"));
    }

    #[test]
    fn zero_python_supported_local_stt_provider_flags() {
        assert!(local_stt_provider_supported_in_zero_python_mode("parakeet"));
        assert!(!local_stt_provider_supported_in_zero_python_mode("whisper"));
        assert!(!local_stt_provider_supported_in_zero_python_mode("moonshine"));
        assert!(!local_stt_provider_supported_in_zero_python_mode("sensevoice"));
    }

    #[test]
    fn windows_installer_asset_detection_supports_exe_and_msi() {
        assert!(is_windows_installer_asset(
            "SlasshyWispr_0.1.1_x64-setup.exe"
        ));
        assert!(is_windows_installer_asset("SlasshyWispr_0.1.1_x64.msi"));
        assert!(!is_windows_installer_asset("checksums.txt"));
        assert!(!is_windows_installer_asset(
            "SlasshyWispr_0.1.1_x64-setup.exe.sig"
        ));
    }

    #[test]
    fn select_windows_installer_asset_prefers_exe_setup_when_available() {
        let release = GithubLatestReleaseResponse {
            tag_name: "v0.1.1".to_string(),
            name: Some("v0.1.1".to_string()),
            body: None,
            draft: false,
            prerelease: false,
            published_at: None,
            html_url: None,
            assets: vec![
                GithubReleaseAsset {
                    name: "SlasshyWispr_0.1.1_x64.msi".to_string(),
                    browser_download_url: "https://example.com/SlasshyWispr_0.1.1_x64.msi"
                        .to_string(),
                },
                GithubReleaseAsset {
                    name: "SlasshyWispr_0.1.1_x64-setup.exe".to_string(),
                    browser_download_url:
                        "https://example.com/SlasshyWispr_0.1.1_x64-setup.exe".to_string(),
                },
            ],
        };

        let selected = select_windows_installer_asset(&release)
            .expect("expected installer asset to be selected");
        assert_eq!(selected.name, "SlasshyWispr_0.1.1_x64-setup.exe");
    }

    #[test]
    fn resolve_installer_file_name_keeps_supported_extension() {
        let from_asset = resolve_installer_file_name(
            Some("SlasshyWispr_0.1.2_x64.msi"),
            "https://example.com/download",
            "0.1.1",
        );
        assert_eq!(from_asset, "SlasshyWispr_0.1.2_x64.msi");

        let from_url = resolve_installer_file_name(
            None,
            "https://example.com/SlasshyWispr_0.1.2_x64-setup.exe",
            "0.1.1",
        );
        assert_eq!(from_url, "SlasshyWispr_0.1.2_x64-setup.exe");
    }

    #[test]
    fn validates_python_binary_path() {
        assert!(validate_python_binary_path("python").is_ok());
        assert!(validate_python_binary_path("python3").is_ok());
        assert!(validate_python_binary_path("python3.12").is_ok());
        assert!(validate_python_binary_path("python.exe").is_ok());
        assert!(validate_python_binary_path("python3.11.exe").is_ok());
        assert!(validate_python_binary_path("py.exe").is_ok());
        assert!(validate_python_binary_path("/usr/bin/python3").is_ok());
        #[cfg(target_os = "windows")]
        assert!(validate_python_binary_path("C:\\Python39\\python.exe").is_ok());
        #[cfg(not(target_os = "windows"))]
        assert!(validate_python_binary_path("C:/Python39/python.exe").is_ok());
        assert!(validate_python_binary_path("C:/Program Files (x86)/Python311/python.exe").is_ok());

        assert!(validate_python_binary_path("bash").is_err());
        assert!(validate_python_binary_path("cmd.exe").is_err());
        assert!(validate_python_binary_path("powershell").is_err());
        assert!(validate_python_binary_path("calc.exe").is_err());
        assert!(validate_python_binary_path("python\nbad").is_err());
        assert!(validate_python_binary_path("python\0bad").is_err());
        assert!(validate_python_binary_path("").is_err());
    }

    #[test]
    fn validates_piper_binary_path() {
        assert!(validate_piper_binary_path("piper").is_ok());
        assert!(validate_piper_binary_path("piper.exe").is_ok());
        assert!(validate_piper_binary_path("/usr/local/bin/piper").is_ok());
        assert!(validate_piper_binary_path("C:/Program Files (x86)/piper/piper.exe").is_ok());

        assert!(validate_piper_binary_path("bash").is_err());
        assert!(validate_piper_binary_path("piper\nbad").is_err());
    }
}

fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        warn!("[tray] dashboard window not found");
        return;
    };

    if let Err(error) = window.unminimize() {
        warn!("[tray] failed to unminimize main window: {error}");
    }
    if let Err(error) = window.show() {
        warn!("[tray] failed to show main window: {error}");
        return;
    }
    if let Err(error) = window.set_focus() {
        warn!("[tray] failed to focus main window: {error}");
    }
}

fn hide_main_window_to_tray(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };

    if let Err(error) = window.hide() {
        warn!("[tray] failed to hide main window to tray: {error}");
    }
}

fn copy_last_transcript_to_clipboard(app: &AppHandle) {
    let state = app.state::<AppState>();
    let transcript = match state.last_transcript_snapshot() {
        Ok(value) => value,
        Err(error) => {
            error!(
                "[tray] failed to read last transcript: {}",
                single_line(&error)
            );
            return;
        }
    };

    if transcript.trim().is_empty() {
        info!("[tray] last transcript copy requested but transcript is empty");
        return;
    }

    #[cfg(target_os = "windows")]
    {
        if let Err(error) = set_clipboard_text_windows(&transcript) {
            error!(
                "[tray] failed to copy last transcript to clipboard: {}",
                single_line(&error)
            );
        } else {
            info!(
                "[tray] copied last transcript chars={}",
                transcript.chars().count()
            );
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = transcript;
        warn!("[tray] clipboard copy from tray is implemented for Windows only");
    }
}

fn copy_last_response_to_clipboard(app: &AppHandle) {
    let state = app.state::<AppState>();
    let response = match state.last_assistant_response_snapshot() {
        Ok(value) => value,
        Err(error) => {
            error!(
                "[tray] failed to read last assistant response: {}",
                single_line(&error)
            );
            return;
        }
    };

    if response.trim().is_empty() {
        info!("[tray] last response copy requested but response is empty");
        return;
    }

    #[cfg(target_os = "windows")]
    {
        if let Err(error) = set_clipboard_text_windows(&response) {
            error!(
                "[tray] failed to copy last assistant response to clipboard: {}",
                single_line(&error)
            );
        } else {
            info!(
                "[tray] copied last assistant response chars={}",
                response.chars().count()
            );
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = response;
        warn!("[tray] clipboard copy from tray is implemented for Windows only");
    }
}

fn build_tray_icon(app: &AppHandle) -> tauri::Result<()> {
    let copy_last_transcription = MenuItem::with_id(
        app,
        TRAY_MENU_COPY_LAST_TRANSCRIPTION_ID,
        "Copy last transcription",
        true,
        None::<&str>,
    )?;
    let copy_last_response = MenuItem::with_id(
        app,
        TRAY_MENU_COPY_LAST_RESPONSE_ID,
        "Copy last AI response",
        true,
        None::<&str>,
    )?;
    let dashboard =
        MenuItem::with_id(app, TRAY_MENU_DASHBOARD_ID, "Dashboard", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, TRAY_MENU_QUIT_ID, "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &copy_last_transcription,
            &copy_last_response,
            &dashboard,
            &separator,
            &quit,
        ],
    )?;
    let app_handle_for_click = app.clone();

    let mut tray_builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("SlasshyWispr")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            TRAY_MENU_COPY_LAST_TRANSCRIPTION_ID => {
                copy_last_transcript_to_clipboard(app);
            }
            TRAY_MENU_COPY_LAST_RESPONSE_ID => {
                copy_last_response_to_clipboard(app);
            }
            TRAY_MENU_DASHBOARD_ID => {
                show_main_window(app);
            }
            TRAY_MENU_QUIT_ID => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(move |_tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(&app_handle_for_click);
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray_builder = tray_builder.icon(icon);
    } else {
        warn!("[tray] default window icon missing; tray icon may not be visible");
    }

    tray_builder.build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState::new().expect("failed to initialize app state");
    let tts_setup_state = TtsSetupState::default();
    let start_in_tray =
        std::env::args().any(|arg| arg.eq_ignore_ascii_case(STARTUP_ARG_START_IN_TRAY));

    tauri::Builder::default()
        .manage(app_state)
        .manage(tts_setup_state)
        .setup(move |app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
            }

            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            let app_handle = app.handle().clone();
            build_tray_icon(&app_handle)?;
            ensure_local_stt_daemon_idle_sweeper();
            start_local_stt_boot_warmup(app_handle.clone());

            if let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let app_handle_for_close = app_handle.clone();
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        hide_main_window_to_tray(&app_handle_for_close);
                    }
                });
            } else {
                warn!("[tray] main window not found for close-to-tray hook");
            }

            if start_in_tray {
                hide_main_window_to_tray(&app_handle);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            log_client_event,
            check_for_app_update,
            download_and_install_app_update,
            load_persisted_local_settings,
            save_persisted_local_settings,
            capture_selected_text,
            set_clipboard_text,
            configure_launch_at_login,
            paste_clipboard_text,
            paste_text_via_clipboard,
            type_text_direct,
            control_media_playback,
            get_foreground_input_block_status,
            get_assistant_info,
            fetch_provider_models,
            fetch_ollama_models,
            pull_ollama_model,
            get_ollama_status,
            install_ollama,
            fetch_local_stt_models,
            download_local_stt_model,
            get_local_stt_download_status,
            delete_local_stt_model,
            open_local_stt_model_path,
            warmup_local_stt_model,
            deactivate_local_stt_model,
            get_local_stt_runtime_state,
            get_local_stt_hardware_advice,
            setup_assistant_runtime,
            ensure_voice_model,
            validate_piper,
            get_coqui_status,
            setup_coqui_runtime,
            validate_coqui,
            list_coqui_voices,
            list_coqui_models,
            clone_coqui_voice,
            preview_coqui_voice,
            start_tts_runtime_setup,
            get_tts_runtime_setup_status,
            run_assistant_pipeline,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
