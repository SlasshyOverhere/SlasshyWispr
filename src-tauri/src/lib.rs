use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use log::{error, info, warn};
use reqwest::{multipart, Client};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap};
use std::fs;
#[cfg(target_os = "windows")]
use std::io;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State,
};
#[cfg(target_os = "windows")]
use zip::ZipArchive;

const DEFAULT_BASE_URL: &str = "";
const DEFAULT_STT_MODEL: &str = "";
const DEFAULT_AI_MODEL: &str = "";
const DEFAULT_SYSTEM_PROMPT: &str =
    "You are SlasshyWispr, an assistant in a speech-to-text app.
Default mode is cleanup of spoken text while preserving intent and tone.
Agent mode activates when directly addressed with a request.
If selected text context is provided, use it as primary context.
Output only final content with no meta-commentary or preamble.";

const VOICE_MODEL_URL: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx";
const VOICE_CONFIG_URL: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx.json";
const VOICE_MODEL_FILE: &str = "en_US-hfc_female-medium.onnx";
const VOICE_CONFIG_FILE: &str = "en_US-hfc_female-medium.onnx.json";
const PIPER_DEFAULT_SPEED: f32 = 1.0;
const PIPER_DEFAULT_QUALITY: &str = "balanced";
const PIPER_DEFAULT_EMOTION: &str = "neutral";
const COQUI_DEFAULT_MODEL: &str = "tts_models/multilingual/multi-dataset/xtts_v2";
const COQUI_DEFAULT_LANGUAGE: &str = "en";
const COQUI_DEFAULT_QUALITY: &str = "balanced";
const COQUI_DEFAULT_EMOTION: &str = "neutral";
const COQUI_MAX_REFERENCE_SECONDS: f32 = 30.0;
const PENDING_SELECTION_REWRITE_TTL_SECS: u64 = 90;
const RECENT_SELECTION_CONTEXT_TTL_SECS: u64 = 240;
const COQUI_BRIDGE_SCRIPT: &str = include_str!("../coqui_bridge.py");
const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "slasshywispr-tray";
const TRAY_MENU_COPY_LAST_TRANSCRIPTION_ID: &str = "copy-last-transcription";
const TRAY_MENU_COPY_LAST_RESPONSE_ID: &str = "copy-last-response";
const TRAY_MENU_DASHBOARD_ID: &str = "dashboard";
const TRAY_MENU_QUIT_ID: &str = "quit";
const STARTUP_ARG_START_IN_TRAY: &str = "--start-in-tray";
#[cfg(target_os = "windows")]
const STARTUP_RUN_VALUE_NAME: &str = "SlasshyWispr";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
const PIPER_ARCHIVE_URL: &str =
    "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip";
#[cfg(target_os = "windows")]
const PIPER_ARCHIVE_FILE: &str = "piper_windows_amd64.zip";
#[cfg(target_os = "windows")]
const PIPER_BINARY_NAME: &str = "piper.exe";
#[cfg(not(target_os = "windows"))]
const PIPER_BINARY_NAME: &str = "piper";

struct AppState {
    http: Client,
    pending_selection_rewrite: Mutex<Option<PendingSelectionRewrite>>,
    recent_selection_context: Mutex<Option<RecentSelectionContext>>,
    last_transcript: Mutex<String>,
    last_assistant_response: Mutex<String>,
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
            .map(|item| item.created_at.elapsed() >= Duration::from_secs(PENDING_SELECTION_REWRITE_TTL_SECS))
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

    fn cleanup_expired_recent_selection_context(
        slot: &mut Option<RecentSelectionContext>,
    ) -> bool {
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

    fn set_last_assistant_response(&self, assistant_response: impl Into<String>) -> Result<(), String> {
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

static COQUI_DAEMONS: OnceLock<Mutex<HashMap<String, CoquiBridgeDaemon>>> = OnceLock::new();

fn coqui_daemons() -> &'static Mutex<HashMap<String, CoquiBridgeDaemon>> {
    COQUI_DAEMONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn coqui_daemon_key(python_path: &str, script_path: &Path) -> String {
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
    piper_path: Option<String>,
    audio_base64: String,
    audio_mime_type: String,
    language: Option<String>,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderModelsResponse {
    base_url: String,
    models: Vec<String>,
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
                .push("Starting TTS bootstrap for Piper + Coqui runtime.".to_string());
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
async fn capture_selected_text() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let text = capture_selected_text_windows()?;
        info!("[client] captured selected text chars={}", text.chars().count());
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
    Ok(
        String::from_utf8_lossy(&output.stdout)
            .replace("\r\n", "\n")
            .trim_end_matches(['\r', '\n'])
            .to_string(),
    )
}

#[cfg(target_os = "windows")]
fn run_powershell_script(script: &str, stdin_text: Option<&str>) -> Result<std::process::Output, String> {
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
        let run_key = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
        let value_name = STARTUP_RUN_VALUE_NAME.replace('\'', "''");

        if enabled {
            let exe_path = std::env::current_exe()
                .map_err(|error| format!("Failed to resolve executable path: {error}"))?;
            let exe_text = exe_path.to_string_lossy().to_string();
            let script = format!(
                "$ErrorActionPreference='Stop'; \
                 $exe=[Console]::In.ReadToEnd().Trim(); \
                 if ([string]::IsNullOrWhiteSpace($exe)) {{ throw 'Executable path is empty.' }}; \
                 $runKey='{run_key}'; \
                 $name='{value_name}'; \
                 $value='\"' + $exe.Replace('\"','\"\"') + '\" {STARTUP_ARG_START_IN_TRAY}'; \
                 New-Item -Path $runKey -Force | Out-Null; \
                 Set-ItemProperty -Path $runKey -Name $name -Value $value -Type String;"
            );
            let output = run_powershell_script(&script, Some(&exe_text))?;
            if !output.status.success() {
                let merged = merge_process_output(&output.stdout, &output.stderr);
                return Err(format!(
                    "Unable to enable launch at login: {}",
                    clip_text(&single_line(&merged), 300)
                ));
            }
            info!(
                "[startup] launch at login enabled with start-in-tray flag path={}",
                clip_text(&single_line(&exe_text), 240)
            );
            return Ok(());
        }

        let script = format!(
            "$ErrorActionPreference='Stop'; \
             $runKey='{run_key}'; \
             $name='{value_name}'; \
             if (Test-Path $runKey) {{ Remove-ItemProperty -Path $runKey -Name $name -ErrorAction SilentlyContinue }};"
        );
        let output = run_powershell_script(&script, None)?;
        if !output.status.success() {
            let merged = merge_process_output(&output.stdout, &output.stderr);
            return Err(format!(
                "Unable to disable launch at login: {}",
                clip_text(&single_line(&merged), 300)
            ));
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

    BLOCKED_PREFIXES.iter().any(|prefix| base.starts_with(prefix))
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
try {
  $proc = Get-Process -Id $pid -ErrorAction Stop;
  [Console]::Out.Write($proc.ProcessName.ToLowerInvariant());
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

        let process_name = String::from_utf8_lossy(&output.stdout)
            .trim()
            .to_ascii_lowercase();
        let blocked = is_blocked_game_process_name(&process_name);
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
    let coqui_python_path = coqui_venv_python_path(&app)?;
    let coqui_installed = file_exists_with_content(&coqui_python_path);

    Ok(AssistantInfoResponse {
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
        coqui_python_path: coqui_python_path.to_string_lossy().into_owned(),
    })
}

fn collect_model_ids_from_array(items: &[Value], output: &mut BTreeSet<String>) {
    for item in items {
        if let Some(model) = item
            .get("id")
            .and_then(Value::as_str)
            .or_else(|| item.get("model").and_then(Value::as_str))
            .or_else(|| item.get("name").and_then(Value::as_str))
        {
            let trimmed = model.trim();
            if !trimmed.is_empty() {
                output.insert(trimmed.to_string());
            }
        }
    }
}

#[tauri::command]
async fn fetch_provider_models(
    state: State<'_, AppState>,
    request: ProviderModelsRequest,
) -> Result<ProviderModelsResponse, String> {
    let api_key = request.api_key.trim();
    if api_key.is_empty() {
        return Err("API key is required to fetch models.".to_string());
    }

    let base_url = normalize_api_base_url(request.api_base_url.as_deref());
    if base_url.is_empty() {
        return Err("API base URL is required to fetch models.".to_string());
    }
    let response = state
        .http
        .get(format!("{base_url}/models"))
        .bearer_auth(api_key)
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

    info!(
        "[provider.models] fetched count={} base_url={}",
        models.len(),
        clip_text(&base_url, 180)
    );

    Ok(ProviderModelsResponse {
        base_url,
        models: models.into_iter().collect(),
    })
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
        Command::new(&piper_path)
            .arg("--help")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
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
        warn!("[coqui.status] unavailable error={}", clip_text(&single_line(&error), 420));
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
    let bootstrap_python = request
        .python_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("python")
        .to_string();
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
    let speaker_id = sanitize_coqui_speaker_id(&request.speaker_id)?;
    let requested_file = request
        .file_name
        .as_deref()
        .unwrap_or_default()
        .to_string();
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
        warn!("[coqui.clone] rejected empty sample for speaker={}", speaker_id);
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
    let extension = extension_from_file_name(request.file_name.as_deref())
        .unwrap_or_else(|| "wav".to_string());
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
        coqui
            .model_name
            .as_deref()
            .unwrap_or(COQUI_DEFAULT_MODEL)
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

fn consume_ascii_token(input: &str, index: usize, token: &str) -> Option<usize> {
  if token.is_empty() {
      return Some(index);
  }

    let mut cursor = skip_non_alphanumeric(input, index);
    for expected in token.chars() {
        if cursor >= input.len() {
            return None;
        }
        let mut iterator = input[cursor..].chars();
        let current = iterator.next()?;
        if !current.eq_ignore_ascii_case(&expected) {
            return None;
        }
        cursor += current.len_utf8();
    }

    if cursor < input.len() {
        if let Some(next) = input[cursor..].chars().next() {
            if next.is_ascii_alphanumeric() {
                return None;
            }
        }
    }

  Some(cursor)
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

fn assistant_name_token_matches(expected: &str, actual: &str) -> bool {
    if expected.eq_ignore_ascii_case(actual) {
        return true;
    }

    if expected.len() < 3 || actual.len() < 3 {
        return false;
    }

    within_one_edit_ascii(expected, actual)
}

fn consume_assistant_name_token(input: &str, index: usize, expected: &str) -> Option<usize> {
    let (actual, next_cursor) = consume_next_ascii_token(input, index)?;
    if assistant_name_token_matches(expected, &actual) {
        Some(next_cursor)
    } else {
        None
    }
}

fn extract_wake_command(transcript: &str, assistant_name: &str) -> Option<String> {
    let mut name_tokens = wake_name_tokens(assistant_name);
    if name_tokens.is_empty() {
        name_tokens.push("lily".to_string());
    }
    let wake_prefixes: [&[&str]; 6] = [
        &["hey"],
        &["hi"],
        &["hello"],
        &["ok"],
        &["okay"],
        &[],
    ];

    let trimmed = transcript.trim_start();
    let start_cursor = transcript.len().saturating_sub(trimmed.len());

    for prefix in wake_prefixes {
        let mut cursor = start_cursor;
        let mut matched = true;

        for token in prefix {
            let Some(next_cursor) = consume_ascii_token(transcript, cursor, token) else {
                matched = false;
                break;
            };
            cursor = next_cursor;
        }

        if !matched {
            continue;
        }

        for token in &name_tokens {
            let Some(next_cursor) = consume_assistant_name_token(transcript, cursor, token) else {
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

    None
}

#[tauri::command]
async fn run_assistant_pipeline(
    app: AppHandle,
    state: State<'_, AppState>,
    request: AssistantPipelineRequest,
) -> Result<AssistantPipelineResponse, String> {
    let api_key = request.api_key.trim();
    if api_key.is_empty() {
        return Err("API key is required".to_string());
    }
    let api_base_url = normalize_api_base_url(request.api_base_url.as_deref());
    if api_base_url.is_empty() {
        return Err(
            "API base URL is required. Open Settings > System > Provider models.".to_string(),
        );
    }
    let stt_model = normalize_model_name(request.stt_model.as_deref());
    if stt_model.is_empty() {
        return Err("STT model is required. Open Settings > System > Provider models.".to_string());
    }
    let ai_model = normalize_model_name(request.ai_model.as_deref());
    if ai_model.is_empty() {
        return Err("AI model is required. Open Settings > System > Provider models.".to_string());
    }

    let requested_engine = request
        .tts_engine
        .as_deref()
        .map(str::trim)
        .unwrap_or("piper")
        .to_ascii_lowercase();
    let use_coqui = requested_engine == "coqui";

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

    info!(
        "[pipeline] start engine={} audio_bytes={} mime={} base_url={} stt_model={} ai_model={}",
        if use_coqui { "coqui" } else { "piper" },
        audio_bytes.len(),
        request.audio_mime_type,
        clip_text(&api_base_url, 180),
        clip_text(&stt_model, 120),
        clip_text(&ai_model, 120)
    );

    let overall_start = Instant::now();

    let stt_start = Instant::now();
    let transcript_raw = transcribe_audio(
        &state.http,
        api_key,
        &api_base_url,
        &stt_model,
        &audio_bytes,
        request.audio_mime_type.trim(),
        request.language.as_deref(),
    )
    .await?;
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
    if !wake_only
        && selected_text.is_none()
    {
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
    if selected_text.is_none() && (selection_edit_intent || selection_context_query_intent) {
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
        selected_context_available || command_mode || selection_edit_intent || selection_context_query_intent || pending_rewrite_present;
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
                    api_key,
                    &api_base_url,
                    &ai_model,
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
                        selection_context_cleared = state.clear_pending_selection_rewrite()?
                            || selection_context_cleared;
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
                        selection_context_cleared = state.clear_pending_selection_rewrite()?
                            || selection_context_cleared;
                        if decision.message.trim().is_empty()
                            || looks_like_missing_selection_prompt(&decision.message)
                        {
                            let response = generate_assistant_response(
                                &state.http,
                                api_key,
                                &api_base_url,
                                &ai_model,
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
                    let rewrite = state
                        .take_pending_selection_rewrite()?
                        .unwrap_or(pending);
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
                if seems_like_selection_edit_instruction(&command_for_ai) {
                    skip_tts = true;
                    "No selected text detected. Select text first, then repeat your edit command."
                        .to_string()
                } else {
                    let transcript_for_ai = if command_for_ai.is_empty() {
                        "Command mode is active. Ask the user what to edit next.".to_string()
                    } else {
                        format!("Command mode request: {}", command_for_ai)
                    };
                    let assistant_response = generate_assistant_response(
                        &state.http,
                        api_key,
                        &api_base_url,
                        &ai_model,
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
                api_key,
                &api_base_url,
                &ai_model,
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
            api_key,
            &api_base_url,
            &ai_model,
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
        info!("[pipeline] complete (tts skipped) total_latency_ms={}", total_latency_ms);
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

    let response = client
        .post(format!("{api_base_url}/audio/transcriptions"))
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("Failed to call STT endpoint: {error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to parse STT response body: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "STT request failed ({status}): {}",
            clip_text(&single_line(&body), 420)
        ));
    }

    let payload: Value = serde_json::from_str(&body)
        .map_err(|error| format!("Invalid STT JSON response: {error}"))?;

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

    let response = client
        .post(format!("{api_base_url}/chat/completions"))
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("Failed to call AI endpoint: {error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to parse AI response body: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "AI request failed ({status}): {}",
            clip_text(&single_line(&body), 420)
        ));
    }

    let payload: Value = serde_json::from_str(&body)
        .map_err(|error| format!("Invalid AI JSON response: {error}"))?;

    extract_chat_content(&payload)
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .ok_or_else(|| "AI response is missing choices[0].message.content".to_string())
}

async fn generate_direct_answer_fallback(
    client: &Client,
    api_key: &str,
    api_base_url: &str,
    ai_model: &str,
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
        api_key,
        api_base_url,
        ai_model,
        question,
        strict_prompt,
        temperature.clamp(0.0, 0.35),
        max_tokens.clamp(64, 320),
    )
    .await
}

async fn generate_selection_edit_decision(
    client: &Client,
    api_key: &str,
    api_base_url: &str,
    ai_model: &str,
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
        api_key,
        api_base_url,
        ai_model,
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
        "no",
        "nope",
        "cancel",
        "stop",
        "discard",
        "skip",
        "not now",
        "leave it",
        "do not",
        "don t",
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
    .any(|phrase| normalized.contains(phrase))
}

fn seems_like_selection_edit_instruction(command: &str) -> bool {
    let normalized = normalize_ascii_words(command);
    if normalized.is_empty() {
        return false;
    }
    [
        "improve",
        "rewrite",
        "edit",
        "rephrase",
        "make better",
        "better",
        "fix",
        "correct",
        "polish",
        "refine",
        "shorten",
        "expand",
        "formal",
        "professional",
        "grammar",
        "typo",
    ]
    .iter()
    .any(|phrase| normalized.contains(phrase))
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
            "what ",
            "who ",
            "when ",
            "where ",
            "why ",
            "how ",
            "is ",
            "are ",
            "do ",
            "does ",
            "did ",
            "can ",
            "could ",
            "would ",
            "tell me ",
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
    if response_stripped.ends_with(&command_stripped) || command_stripped.ends_with(&response_stripped) {
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

    let single_fillers = [
        "um",
        "uh",
        "erm",
        "hmm",
        "basically",
    ];

    let mut kept = Vec::new();
    for token in current.split_whitespace() {
        let trimmed = token
            .trim_matches(|ch: char| !ch.is_alphanumeric())
            .to_ascii_lowercase();
        if single_fillers.contains(&trimmed.as_str()) {
            continue;
        }
        kept.push(token);
    }

    kept.join(" ")
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

    for punctuation in [",", ".", "?", "!", ";", ":"] {
        current = current.replace(&format!(" {punctuation}"), punctuation);
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
    input
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
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
        "zero",
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
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
        "",
        "",
        "twenty",
        "thirty",
        "forty",
        "fifty",
        "sixty",
        "seventy",
        "eighty",
        "ninety",
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
    let synth_start = Instant::now();
    let clean_text = text.replace('\r', " ").trim().to_string();

    if clean_text.is_empty() {
        return Err("No text provided for TTS".to_string());
    }
    let numeric_stability_mode = clean_text.chars().any(|character| character.is_ascii_digit());
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
    let (emotion_speed_factor, emotion_noise_delta, emotion_noise_w_delta) = match emotion.as_str() {
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

        let output = if numeric_stability_mode {
            run_once(false)?
        } else {
            let first_output = run_once(true)?;
            if first_output.status.success() {
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
                    run_once(false)?
                } else {
                    first_output
                }
            }
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
    let synth_start = Instant::now();
    let clean_text = text.replace('\r', " ").trim().to_string();
    if clean_text.is_empty() {
        return Err("No text provided for TTS".to_string());
    }

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
            device,
            model_cached
        );
        result
    })?;

    let wav_bytes =
        fs::read(&output_path).map_err(|error| format!("Failed to read Coqui output WAV: {error}"))?;
    let _ = fs::remove_file(&output_path);

    info!(
        "[coqui.synthesize] success bytes={} latency_ms={}",
        wav_bytes.len(),
        elapsed_ms(synth_start)
    );

    Ok(wav_bytes)
}

fn extract_chat_content(payload: &Value) -> Option<String> {
    let content = payload.pointer("/choices/0/message/content")?;

    if let Some(as_text) = content.as_str() {
        return Some(as_text.to_string());
    }

    if let Some(parts) = content.as_array() {
        let mut combined = Vec::new();

        for part in parts {
            if let Some(text_part) = part.as_str() {
                combined.push(text_part.to_string());
                continue;
            }

            if let Some(text_part) = part.get("text").and_then(Value::as_str) {
                combined.push(text_part.to_string());
            }
        }

        if !combined.is_empty() {
            return Some(combined.join("\n"));
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

fn resolve_piper_path(app: &AppHandle, requested_path: Option<&str>) -> Result<String, String> {
    if let Some(path) = requested_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        return Ok(path.to_string());
    }

    if let Some(installed_path) = discover_installed_piper_path(app)? {
        return Ok(installed_path.to_string_lossy().into_owned());
    }

    Err("Piper is not configured. Click 'Auto Setup Runtime' inside the app first.".to_string())
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

fn resolve_coqui_python_path(app: &AppHandle, requested_path: Option<&str>) -> Result<String, String> {
    if let Some(path) = requested_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(path.to_string());
    }

    let venv_python = coqui_venv_python_path(app)?;
    if file_exists_with_content(&venv_python) {
        return Ok(venv_python.to_string_lossy().into_owned());
    }

    Ok("python".to_string())
}

fn detect_nvidia_gpu() -> bool {
    let output = Command::new("nvidia-smi")
        .arg("-L")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
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
                "GPU runtime preference: auto-enabled because NVIDIA GPU was detected."
                    .to_string(),
            );
        }
    } else {
        details.push("GPU runtime preference: CPU-only mode.".to_string());
    }

    if !file_exists_with_content(&venv_python_path) {
        let mut create_venv = Command::new(bootstrap_python);
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
        details.push(format!("Created virtualenv at {}.", venv_dir.to_string_lossy()));
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

fn run_python_command(
    python_path: &str,
    args: &[&str],
    tts_home: &Path,
) -> Result<String, String> {
    let mut command = Command::new(python_path);
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

fn spawn_coqui_bridge_daemon(
    python_path: &str,
    script_path: &Path,
    cache_dir: &Path,
) -> Result<CoquiBridgeDaemon, String> {
    let mut child = Command::new(python_path)
        .arg(script_path)
        .arg("--daemon")
        .env("TTS_HOME", cache_dir)
        .env("COQUI_TOS_AGREED", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
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
        return Err(format!("Coqui bridge failed: {}", clip_text(merged.trim(), 420)));
    }

    Ok(parsed.get("result").cloned().unwrap_or(Value::Null))
}

fn run_coqui_bridge(app: &AppHandle, python_path: &str, payload: Value) -> Result<Value, String> {
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

    let output = Command::new(python_path)
        .arg(&script_path)
        .arg("--request")
        .arg(&request_path)
        .env("TTS_HOME", &cache_dir)
        .env("COQUI_TOS_AGREED", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
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
    let result = parse_coqui_bridge_response(
        &action,
        output.status.success(),
        &stdout_text,
        &stderr_text,
    )?;
    info!("[coqui.bridge] success action={}", action);
    Ok(result)
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
    input.split_whitespace().collect::<Vec<_>>().join(" ")
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
            piper_path: None,
            audio_base64: String::new(),
            audio_mime_type: String::new(),
            language: None,
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
        assert_eq!(refine_transcript("please send update", &disabled), "please send update");
        assert_eq!(refine_transcript("please send update", &enabled), "please send update.");
    }

    #[test]
    fn detects_wake_phrase_and_extracts_command() {
        let command =
            extract_wake_command("Hey Lily, send this to AI", "Lily").unwrap_or_default();
        assert_eq!(command, "send this to AI");
    }

    #[test]
    fn supports_multiple_wake_prefix_variants() {
        let hi = extract_wake_command("Hi Lily summarize this", "Lily").unwrap_or_default();
        let okay = extract_wake_command("Okay Lily, summarize this", "Lily").unwrap_or_default();
        let bare_name = extract_wake_command("Lily summarize this", "Lily").unwrap_or_default();

        assert_eq!(hi, "summarize this");
        assert_eq!(okay, "summarize this");
        assert_eq!(bare_name, "summarize this");
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
        let command = extract_wake_command("Hi Lili improve this sentence", "Lily").unwrap_or_default();
        assert_eq!(command, "improve this sentence");
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
        let command =
            extract_wake_command("Ok   Slasshy Wispr improve this", "Slasshy Wispr")
                .unwrap_or_default();
        assert_eq!(command, "improve this");
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
        assert!(is_rewrite_suspicious("make this better", selected, suspicious));
        assert!(!is_rewrite_suspicious(
            "summarize this",
            selected,
            "A concise summary."
        ));
    }

    #[test]
    fn detects_edit_intent_for_selection_guard() {
        assert!(seems_like_selection_edit_instruction("make this review better"));
        assert!(seems_like_selection_edit_instruction("rewrite this"));
        assert!(!seems_like_selection_edit_instruction("what is the weather"));
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
            error!("[tray] failed to read last transcript: {}", single_line(&error));
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
    let dashboard = MenuItem::with_id(
        app,
        TRAY_MENU_DASHBOARD_ID,
        "Dashboard",
        true,
        None::<&str>,
    )?;
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
    let start_in_tray = std::env::args().any(|arg| arg.eq_ignore_ascii_case(STARTUP_ARG_START_IN_TRAY));

    tauri::Builder::default()
        .manage(app_state)
        .manage(tts_setup_state)
        .setup(move |app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new().build(),
                )?;
            }

            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            let app_handle = app.handle().clone();
            build_tray_icon(&app_handle)?;

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
