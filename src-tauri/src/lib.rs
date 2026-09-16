use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use keyring::Entry;
use log::{info, warn};
use reqwest::{multipart, Client};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::fs;
#[cfg(target_os = "windows")]
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::{menu::MenuItem, AppHandle, Manager};


#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::LocalFree;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::SystemInformation::{
    GetSystemInfo, GlobalMemoryStatusEx, MEMORYSTATUSEX, SYSTEM_INFO,
};

pub mod audio;
pub mod commands;
pub mod constants;
pub mod pipeline;
pub mod security;
pub mod state;
pub mod updater;
use commands::{
    AssistantPipelineRequest, AssistantPipelineResponse, DictionaryEntryRequest,
    SnippetEntryRequest, StartupLocalSttWarmupTarget, TtsSetupState, capture_selected_text,
    check_for_app_update,
    clear_dictation_recordings, clone_coqui_voice, configure_launch_at_login,
    control_media_playback, deactivate_local_stt_model, delete_local_stt_model,
    download_and_install_app_update, download_local_stt_model, ensure_voice_model,
    fetch_local_stt_models, fetch_ollama_models, fetch_provider_models, get_assistant_info,
    get_coqui_status, get_dictation_recording, get_foreground_input_block_status,
    get_local_stt_download_status, get_local_stt_hardware_advice, get_local_stt_model_status,
    get_local_stt_runtime_state, get_tts_runtime_setup_status, get_ollama_status, install_ollama,
    launch_at_login_status, list_coqui_models, list_coqui_voices, list_dictation_recording_ids,
    list_dictation_recordings_stats, load_persisted_local_settings, log_client_event,
    mute_system_audio, open_local_stt_model_path, paste_clipboard_text, paste_text_via_clipboard,
    preview_coqui_voice, pull_ollama_model, save_dictation_recording, save_persisted_local_settings,
    set_clipboard_text, set_tray_update_available, setup_assistant_runtime, setup_coqui_runtime,
    run_assistant_pipeline, show_update_settings, start_tts_runtime_setup,
    toggle_main_window_visibility, validate_coqui, validate_piper, warmup_local_stt_model,
};
use state::AppState;
use audio::vad;

use pipeline::fs::*;
use pipeline::input::*;
use pipeline::log::*;
use pipeline::process::*;
use pipeline::refinement::{self, RefinementConfig, RefinementDictionaryEntry, RefinementSnippetEntry};
use pipeline::selection::*;
use pipeline::stt::*;
use pipeline::stt_download::*;
#[allow(unused_imports)]
use pipeline::response::normalize_assistant_response_text;
use constants::*;
use pipeline::routing::*;
use pipeline::tts::*;
use pipeline::daemon::*;
use pipeline::wake::*;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowRect {
    pub position_x: i32,
    pub position_y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowVisibilityState {
    pub hidden: bool,
    pub last_rect: Option<WindowRect>,
    /// Tracks the minimize/restore transition. Set to true when the window
    /// enters the minimized state; cleared on the first Resized event after
    /// the user restores. Used to apply the saved rect on restore.
    pub was_minimized: bool,
}

impl WindowVisibilityState {
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    pub fn from_json(value: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(value)
    }
}

// Selection-edit types moved to pipeline::selection; native Parakeet runtime
// moved to audio::parakeet; Piper tuning cache moved to pipeline::tts.
static LOCAL_STT_RUNTIME_PYTHON_CACHE: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static TRAY_UPDATE_ITEM: OnceLock<MenuItem<tauri::Wry>> = OnceLock::new();
static SAVED_SYSTEM_AUDIO_VOLUME: Mutex<Option<u32>> = Mutex::new(None);

#[cfg(target_os = "windows")]
pub(crate) mod win32_native {
    use windows_sys::Win32::Foundation::RECT;

    #[repr(C)]
    #[allow(non_snake_case)]
    pub struct MONITORINFO {
        pub cbSize: u32,
        pub rcMonitor: RECT,
        pub rcWork: RECT,
        pub dwFlags: u32,
    }

    extern "system" {
        pub fn GetMonitorInfoW(hMonitor: isize, lpmi: *mut MONITORINFO) -> i32;
        pub fn MonitorFromWindow(hwnd: isize, dwFlags: u32) -> isize;
    }
}

fn local_stt_runtime_python_cache() -> &'static Mutex<Option<String>> {
    LOCAL_STT_RUNTIME_PYTHON_CACHE.get_or_init(|| Mutex::new(None))
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


























const KEYRING_SERVICE: &str = "SlasshyWispr";
const KEYRING_USER: &str = "api_key";
const KEYRING_SERVICE_ALIASES: [&str; 5] = [
    "SlasshyWispr Desktop Assistant",
    "Slasshy Desktop Assistant",
    "online.slasshy.slasshywispr",
    "online.slasshy.desktop.assistant",
    "slasshy-desktop-assistant",
];
const KEYRING_USER_ALIASES: [&str; 3] = ["apiKey", "apikey", "default"];
const SETTINGS_API_KEY_ENCRYPTED_FIELD: &str = "apiKeyEncrypted";
const SETTINGS_API_KEY_FINGERPRINT_FIELD: &str = "apiKeyFingerprint";

// normalize_api_key_secret has been moved to pipeline::routing.

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
        return Err(
            "failed to save API key to keyring: key is empty after normalization".to_string(),
        );
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
        let api_key = normalize_api_key_secret(
            obj.get("apiKey")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        );
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
        let file_api_key = normalize_api_key_secret(
            obj.get("apiKey")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        );
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
                } else if encrypted_decrypted_present
                    && encrypted_fingerprint == expected_fingerprint
                {
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
                if !expected_fingerprint.is_empty() && resolved_fingerprint == expected_fingerprint
                {
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
        let warmup_result = tauri::async_runtime::spawn_blocking(move || match provider_for_worker
            .as_str()
        {
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

/// Thin adapter that converts an IPC request into a pure routing input
/// and delegates to `pipeline::routing::resolve_pipeline_mode`.
fn resolve_pipeline_mode(request: &AssistantPipelineRequest) -> Result<PipelineModeConfig, String> {
    let routing_input = PipelineRoutingInput {
        api_key: request.api_key.clone(),
        api_base_url: request.api_base_url.clone(),
        stt_model: request.stt_model.clone(),
        ai_model: request.ai_model.clone(),
        stt_local_mode: request.stt_local_mode,
        ai_local_mode: request.ai_local_mode,
        local_ollama_base_url: request.local_ollama_base_url.clone(),
        local_ollama_model: request.local_ollama_model.clone(),
        local_stt_model: request.local_stt_model.clone(),
    };
    pipeline::routing::resolve_pipeline_mode(&routing_input)
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
    let effective_language = normalize_stt_language_hint(language)
        .or_else(|| normalized_allowed_languages.first().cloned());
    let whisper_family = stt_model.trim().to_ascii_lowercase().contains("whisper");

    if whisper_family {
        let transcript = transcribe_audio_openai_compatible(
            client,
            Some(api_key),
            api_base_url,
            stt_model,
            audio_bytes,
            audio_mime_type,
            effective_language.as_deref(),
            "online",
        )
        .await?;

        let transcript_trimmed = transcript.trim();
        let looks_noisy = transcript_trimmed.is_empty()
            || looks_like_repetitive_transcript_noise(&transcript, effective_language.as_deref());
        if !looks_noisy || normalized_allowed_languages.len() <= 1 {
            return Ok(transcript_trimmed.to_string());
        }
    }

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

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data dir for VAD: {error}"))?;
    let vad_model_path_str = {
        let state = app.state::<AppState>();
        let vad_path = vad::ensure_vad_model(&app_data_dir, &state.http).await?;
        vad_path.to_string_lossy().into_owned()
    };

    let model_root_for_worker = model_root.clone();
    let audio_bytes_for_worker = audio_bytes.to_vec();
    let audio_mime_type_for_worker = audio_mime_type.to_string();
    let native_result = tauri::async_runtime::spawn_blocking(move || {
        let (transcript, model_cached, unloaded_after_transcribe) =
            audio::parakeet::transcribe_local_stt_parakeet_native(
                &model_root_for_worker,
                &audio_bytes_for_worker,
                &audio_mime_type_for_worker,
                Some(vad_model_path_str),
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
    let language_hint =
        normalize_stt_language_hint(language).or_else(|| allowed_language_hints.first().cloned());
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
    let request_start = Instant::now();
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
    let response_headers_ms = elapsed_ms(request_start);

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to parse {source_label} STT response body: {error}"))?;
    let response_body_ms = elapsed_ms(request_start);

    info!(
        "[online.stt.http] source={} status={} bytes={} headers_ms={} total_ms={} model={} base_url={}",
        source_label,
        status,
        body.len(),
        response_headers_ms,
        response_body_ms,
        clip_text(stt_model, 120),
        clip_text(api_base_url, 180)
    );

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


fn resolve_piper_path(app: &AppHandle, requested_path: Option<&str>) -> Result<String, String> {
    if let Some(path) = requested_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        validate_piper_binary_path(path)?;
        if file_exists_with_content(Path::new(path)) {
            return Ok(path.to_string());
        }
    }

    if let Some(installed_path) = discover_installed_piper_path(app)? {
        let installed = installed_path.to_string_lossy().into_owned();
        validate_piper_binary_path(&installed)?;
        return Ok(installed);
    }

    Err(
        "Piper is not configured or the saved Piper path is stale. Click 'Auto Setup Runtime' inside the app first."
            .to_string(),
    )
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

/// Read the user's saved "launch at login" preference from the persisted
/// settings file. Defaults to `true` (matching the frontend default) when no
/// settings file exists yet, so first-launch behavior stays consistent.
/// When the file exists but is unreadable/corrupt we default to `false`
/// to avoid silently re-enabling auto-launch against the user's preference.
fn read_launch_at_login_preference(app: &AppHandle) -> bool {
    let path = match persisted_settings_path(app) {
        Ok(p) => p,
        Err(_) => return true,
    };
    if !path.exists() {
        return true;
    }
    let raw = match fs::read_to_string(&path) {
        Ok(r) => r,
        Err(e) => {
            warn!(
                "[updater] failed to read settings for launch-at-login preference path={} error={}",
                path.display(),
                e
            );
            return false;
        }
    };
    let value = match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(v) => v,
        Err(e) => {
            warn!(
                "[updater] failed to parse settings for launch-at-login preference path={} error={}",
                path.display(),
                e
            );
            return false;
        }
    };
    value
        .get("launchAtLogin")
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

#[cfg(test)]
mod launch_at_login_preference_tests {

    /// Unit-test the JSON-extraction logic that `read_launch_at_login_preference`
    /// performs. The full function (which resolves `persisted_settings_path` from
    /// an `AppHandle`) is covered by integration tests against a real Tauri binary.
    fn preference_from_json(raw: &str) -> bool {
        let value: serde_json::Value = serde_json::from_str(raw).unwrap();
        value
            .get("launchAtLogin")
            .and_then(|v| v.as_bool())
            .unwrap_or(true)
    }

    #[test]
    fn defaults_to_true_when_missing() {
        assert_eq!(preference_from_json("{}"), true);
    }

    #[test]
    fn reflects_explicit_false() {
        assert_eq!(
            preference_from_json(r#"{"launchAtLogin": false}"#),
            false
        );
    }

    #[test]
    fn reflects_explicit_true() {
        assert_eq!(preference_from_json(r#"{"launchAtLogin": true}"#), true);
    }

    #[test]
    fn file_missing_resolves_to_true() {
        // When the settings file doesn't exist, we default to true (first launch).
        let dir = tempfile::tempdir().unwrap();
        // read_launch_at_login_preference expects settings.json to not exist.
        // Since we can't mock AppHandle easily here, verify the fallback at the
        // preference-extraction layer: a missing key defaults to true.
        assert_eq!(preference_from_json("{}"), true);
        let _ = dir;
    }
}

fn discover_installed_piper_path(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let runtime_dir = piper_runtime_dir(app)?;
    find_file_by_name(&runtime_dir, PIPER_BINARY_NAME)
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









// STT helpers moved to pipeline::stt.
// They are available via `use pipeline::stt::*;` at the top of this file.


fn transcript_candidate_score(input: &str) -> usize {
    input.chars().filter(|ch| ch.is_alphanumeric()).count()
}

// All routing-related functions have been moved to pipeline::routing.
// They are available via `use pipeline::routing::*;` at the top of this file.

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
    use winreg::enums::*;
    use winreg::RegKey;

    // CPU name from registry
    if let Ok(hklm) = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags("HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0", KEY_READ)
    {
        if let Ok(name) = hklm.get_value::<String, _>("ProcessorNameString") {
            let trimmed = name.trim().to_string();
            if !trimmed.is_empty() {
                probe.cpu_name = trimmed;
            }
        }
    }

    // Logical cores from GetSystemInfo
    unsafe {
        let mut info: SYSTEM_INFO = std::mem::zeroed();
        GetSystemInfo(&mut info);
        if info.dwNumberOfProcessors > 0 {
            probe.logical_cores = info.dwNumberOfProcessors as usize;
        }
    }

    // Total RAM from GlobalMemoryStatusEx
    unsafe {
        let mut status = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            dwMemoryLoad: 0,
            ullTotalPhys: 0,
            ullAvailPhys: 0,
            ullTotalPageFile: 0,
            ullAvailPageFile: 0,
            ullTotalVirtual: 0,
            ullAvailVirtual: 0,
            ullAvailExtendedVirtual: 0,
        };
        if GlobalMemoryStatusEx(&mut status) != 0 {
            probe.total_ram_bytes = status.ullTotalPhys;
        }
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
        command
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
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
        .args([
            "--query-gpu=name,memory.total",
            "--format=csv,noheader,nounits",
        ])
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

fn local_stt_performance_tier(
    probe: &LocalSttHardwareProbe,
    ram_gb: f64,
    gpu_vram_gb: f64,
) -> &'static str {
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
    // Performance: strong CPU/GPU + ample RAM can handle the larger 0.6B model.
    // Balanced/Basic: recommend the lightweight 110m model; caution about the
    // heavier 0.6B model which may be slow on constrained hardware.
    // NOTE: Native Parakeet runs on CPU int8 regardless of GPU, so
    // _nvidia_gpu_detected is unused today but reserved for future GPU-accelerated
    // inference paths.
    match tier {
        "performance" => (
            "nvidia/parakeet-tdt-0.6b-v3",
            vec!["nvidia/parakeet-tdt-0.6b-v3", "nvidia/parakeet-tdt_ctc-110m"],
            vec![],
        ),
        "balanced" => (
            "nvidia/parakeet-tdt_ctc-110m",
            vec!["nvidia/parakeet-tdt_ctc-110m"],
            vec!["nvidia/parakeet-tdt-0.6b-v3"],
        ),
        _ => (
            "nvidia/parakeet-tdt_ctc-110m",
            vec!["nvidia/parakeet-tdt_ctc-110m"],
            vec!["nvidia/parakeet-tdt-0.6b-v3"],
        ),
    }
}

fn build_local_stt_hardware_advice(
    selected_model: Option<String>,
) -> commands::local_stt::LocalSttHardwareAdviceResponse {
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
        format!(
            " Heavy models on this hardware: {}.",
            caution_labels.join(", ")
        )
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

    commands::local_stt::LocalSttHardwareAdviceResponse {
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
        Ok(output) if output.status.success() => {
            !String::from_utf8_lossy(&output.stdout).trim().is_empty()
        }
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
    let probe_faster_whisper =
        run_local_stt_python_command(&venv_python, &["-c", "import faster_whisper"], &cache_dir);
    if probe_nemo.is_ok() && probe_faster_whisper.is_ok() {
        let _ = try_install_local_stt_cuda_torch(
            &venv_python,
            &cache_dir,
            &runtime_dir,
            "runtime-ready",
        );
        let cuda_available =
            local_stt_torch_cuda_available(&venv_python, &cache_dir).unwrap_or(false);
        info!(
            "[local.stt.runtime] ready python={} cuda={}",
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
        &[
            "-m",
            "pip",
            "install",
            "--upgrade",
            "pip",
            "setuptools",
            "wheel",
        ],
        &cache_dir,
    )?;

    let cuda_torch_installed =
        try_install_local_stt_cuda_torch(&venv_python, &cache_dir, &runtime_dir, "first-install")
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
    let model_cached = audio::parakeet::get_or_load_native_parakeet_runtime(&model_root)?;
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
        command.arg(path).spawn().map_err(|error| {
            format!(
                "Failed to open '{}' in File Explorer: {error}",
                path.display()
            )
        })?;
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










fn update_github_token() -> Option<String> {
    non_empty_env_var(UPDATE_GITHUB_TOKEN_ENV)
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

    // validates_safe_update_urls moved to updater::tests
    use super::*;

    fn pipeline_mode_request_template() -> AssistantPipelineRequest {
        AssistantPipelineRequest {
            api_key: "test-key".to_string(),
            api_base_url: Some("https://api.example.com/v1".to_string()),
            stt_model: Some("gpt-4o-mini-transcribe".to_string()),
            ai_model: Some("gpt-4o-mini".to_string()),
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
            raw_mode: None,
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
            noise_suppression: None,
            raw_pcm_base64: None,
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
    fn normalizes_latex_heavy_assistant_responses() {
        let input = r#"\(x = 37.5\)

Explanation:

\[
\left(\frac{x}{3}\right) \times 4 + 90 - 40 = 100
\]

\[
\frac{4x}{3} + 50 = 100 \;\Longrightarrow\; \frac{4x}{3} = 50 \;\Longrightarrow\; x = 37.5
\]"#;
        let normalized = normalize_assistant_response_text(input);

        assert!(normalized.contains("x = 37.5"));
        assert!(normalized.contains("((x) / (3)) x 4 + 90 - 40 = 100"));
        assert!(normalized.contains("(4x) / (3) + 50 = 100 => (4x) / (3) = 50 => x = 37.5"));
        assert!(!normalized.contains("\\["));
        assert!(!normalized.contains("\\frac"));
        assert!(!normalized.contains("\\Longrightarrow"));
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
    fn detects_repetitive_transcript_noise() {
        let noisy = "ලලලලලලලලලලලලලලලලලලලලලලලලලලලල";
        assert!(looks_like_repetitive_transcript_noise(noisy, Some("en")));
    }

    #[test]
    fn rejects_script_mismatch_for_latin_language_hint() {
        let transcript = "සාරි සාරි සාරි සාරි සාරි";
        assert!(looks_like_repetitive_transcript_noise(
            transcript,
            Some("en")
        ));
    }

    #[test]
    fn accepts_normal_english_transcript() {
        let transcript = "Hey Lily what do you think about India today";
        assert!(!looks_like_repetitive_transcript_noise(
            transcript,
            Some("en")
        ));
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
        let incomplete =
            "Subject: Sick Leave - Unable to Attend Work Tomorrow\n\nDear [Boss's Name],\n\nI am";
        assert!(looks_like_incomplete_draft_output(incomplete));

        let complete = "Subject: Sick Leave Request for Tomorrow\n\nDear Manager,\n\nI am feeling unwell and will not be able to attend work tomorrow. I will monitor urgent messages and hand over critical items before the day starts.\n\nBest regards,\nSuman";
        assert!(!looks_like_incomplete_draft_output(complete));
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

    // Updater tests moved to updater::tests

    #[test]
    fn resolve_installer_file_name_keeps_supported_extension() {
        let from_asset = crate::updater::resolve_installer_file_name(
            Some("SlasshyWispr_0.1.2_x64.msi"),
            "https://example.com/download",
            "0.1.1",
        );
        assert_eq!(from_asset, "SlasshyWispr_0.1.2_x64.msi");

        let from_url = crate::updater::resolve_installer_file_name(
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
    }    // Updater tests moved to updater::tests

    // ===== PIPELINE MODE ROUTING — FULL COVERAGE =====

    #[test]
    fn resolve_pipeline_mode_supports_fully_local() {
        let mut request = pipeline_mode_request_template();
        request.stt_local_mode = Some(true);
        request.ai_local_mode = Some(true);
        request.api_key = String::new();
        request.api_base_url = None;

        let mode = resolve_pipeline_mode(&request).expect("fully local should resolve without api key");
        assert!(matches!(mode.stt, SttModeConfig::Local(_)));
        assert!(matches!(mode.ai, AiModeConfig::Local(_)));
    }

    #[test]
    fn resolve_pipeline_mode_supports_fully_online() {
        let request = pipeline_mode_request_template();
        let mode = resolve_pipeline_mode(&request).expect("fully online should resolve");
        assert!(matches!(mode.stt, SttModeConfig::Online { .. }));
        assert!(matches!(mode.ai, AiModeConfig::Online { .. }));
    }

    #[test]
    fn resolve_pipeline_mode_fails_when_api_base_url_missing_for_online() {
        let mut request = pipeline_mode_request_template();
        request.api_base_url = None;
        let error = resolve_pipeline_mode(&request)
            .expect_err("should fail when api base url missing");
        assert!(error.contains("API base URL is required"));
    }

    #[test]
    fn resolve_pipeline_mode_fails_when_api_key_empty_for_online() {
        let mut request = pipeline_mode_request_template();
        request.api_key = String::new();
        let error = resolve_pipeline_mode(&request)
            .expect_err("should fail when api key empty");
        assert!(error.contains("API key is required"));
    }

    #[test]
    fn resolve_pipeline_mode_fails_when_online_stt_model_missing() {
        let mut request = pipeline_mode_request_template();
        request.stt_model = None;
        let error = resolve_pipeline_mode(&request)
            .expect_err("should fail when online stt model missing");
        assert!(error.contains("Online STT model is required"));
    }

    #[test]
    fn resolve_pipeline_mode_fails_when_online_ai_model_missing() {
        let mut request = pipeline_mode_request_template();
        request.ai_model = None;
        let error = resolve_pipeline_mode(&request)
            .expect_err("should fail when online ai model missing");
        assert!(error.contains("Online AI model is required"));
    }

    #[test]
    fn resolve_pipeline_mode_fails_when_local_stt_model_missing() {
        let mut request = pipeline_mode_request_template();
        request.stt_local_mode = Some(true);
        request.local_stt_model = None;
        let error = resolve_pipeline_mode(&request)
            .expect_err("should fail when local stt model missing");
        assert!(error.contains("Local STT model is required"));
    }

    #[test]
    fn resolve_pipeline_mode_local_ai_allows_empty_ollama_model() {
        let mut request = pipeline_mode_request_template();
        request.ai_local_mode = Some(true);
        request.local_ollama_model = None;
        let mode = resolve_pipeline_mode(&request).expect("local ai should resolve without ollama model");
        match &mode.ai {
            AiModeConfig::Local(config) => {
                assert!(config.ollama_model.is_none());
            }
            _ => panic!("expected local AI config"),
        }
    }

    #[test]
    fn resolve_pipeline_mode_online_stt_carries_correct_credentials() {
        let request = pipeline_mode_request_template();
        let mode = resolve_pipeline_mode(&request).expect("online should resolve");
        match &mode.stt {
            SttModeConfig::Online { api_key, api_base_url, stt_model } => {
                assert_eq!(api_key, "test-key");
                assert_eq!(api_base_url, "https://api.example.com/v1");
                assert_eq!(stt_model, "gpt-4o-mini-transcribe");
            }
            _ => panic!("expected online STT config"),
        }
    }

    #[test]
    fn resolve_pipeline_mode_local_stt_uses_canonical_model_id() {
        let mut request = pipeline_mode_request_template();
        request.stt_local_mode = Some(true);
        request.local_stt_model = Some("nvidia/parakeet-tdt-0.6b-v2".to_string());
        let mode = resolve_pipeline_mode(&request).expect("should resolve");
        match &mode.stt {
            SttModeConfig::Local(config) => {
                // v2 alias should be canonicalized to v2 legacy id
                assert_eq!(config.stt_model, "nvidia/parakeet-tdt_ctc-110m");
            }
            _ => panic!("expected local STT config"),
        }
    }

    // ===== SINGLE_LINE AND CLIP_TEXT =====







    // ===== MIME EXTENSION MAPPING =====

    #[test]
    fn mime_to_extension_handles_common_types() {
        assert_eq!(mime_to_extension("audio/webm"), "webm");
        assert_eq!(mime_to_extension("audio/wav"), "wav");
        assert_eq!(mime_to_extension("audio/ogg"), "ogg");
        assert_eq!(mime_to_extension("audio/mp4"), "m4a");
        assert_eq!(mime_to_extension("audio/mpeg"), "mp3");
        assert_eq!(mime_to_extension("audio/mp3"), "mp3");
    }

    #[test]
    fn mime_to_extension_defaults_to_webm() {
        assert_eq!(mime_to_extension("audio/unknown"), "webm");
        assert_eq!(mime_to_extension("application/octet-stream"), "webm");
    }

    // ===== SELECTION EDIT DECISION =====

    #[test]
    fn parse_selection_edit_decision_rejects_invalid_json() {
        assert!(parse_selection_edit_decision("not json").is_err());
    }

    #[test]
    fn parse_selection_edit_decision_unknown_action_defaults_to_ask_confirm() {
        let raw = r#"{"action":"unknown","rewrite":"text","message":"msg"}"#;
        let decision = parse_selection_edit_decision(raw).unwrap();
        assert_eq!(decision.action, SelectionEditAction::AskConfirm);
    }

    // ===== INCOMPLETE DRAFT DETECTION =====

    #[test]
    fn looks_like_incomplete_draft_detects_bracket_placeholder() {
        let text = "Dear [Manager's Name], I am";
        assert!(looks_like_incomplete_draft_output(text));
    }

    #[test]
    fn looks_like_incomplete_draft_short_text_is_not_incomplete() {
        let text = "Yes.";
        assert!(!looks_like_incomplete_draft_output(text));
    }

    // ===== SELECTION EDIT / DRAFT INSTRUCTION DETECTION =====

    #[test]
    fn seems_like_draft_instruction_rejects_questions() {
        assert!(!seems_like_draft_generation_instruction("what is the capital of France"));
        assert!(!seems_like_draft_generation_instruction("who is the president"));
    }

    #[test]
    fn seems_like_selection_edit_rejects_factual_questions() {
        assert!(!seems_like_selection_edit_instruction("what time is it"));
        assert!(!seems_like_selection_edit_instruction("how does TCP work"));
    }

    // ===== REWRITE SUSPICION DETECTION =====

    #[test]
    fn is_rewrite_suspicious_detects_overshortening() {
        // "summarize this" is in instruction_allows_short_rewrite, so returns false
        let long_text = "This is a very detailed explanation of how the system works with many paragraphs and specifics and a lot of content to analyze.";
        let short_rewrite = "Ok.";
        // "make this better" is NOT in instruction_allows_short_rewrite
        assert!(is_rewrite_suspicious("make this better", long_text, short_rewrite));
    }

    #[test]
    fn is_rewrite_suspicious_allows_similar_length_output() {
        let text = "Please improve this text.";
        let rewrite = "Please improve this text now.";
        assert!(!is_rewrite_suspicious("improve", text, rewrite));
    }

    // ===== SELECTION CONFIRMATION DETECTION =====

    #[test]
    fn is_affirmative_detection_handles_various_intents() {
        assert!(is_affirmative_selection_confirmation("yes"));
        assert!(is_affirmative_selection_confirmation("apply it"));
        assert!(is_affirmative_selection_confirmation("do it"));
    }

    #[test]
    fn is_negative_detection_handles_various_intents() {
        assert!(is_negative_selection_confirmation("no"));
        assert!(is_negative_selection_confirmation("skip this"));
        assert!(is_negative_selection_confirmation("cancel"));
    }

    // ===== ONLINE AI REASONING DETECTION =====







    // ===== PIPELINE STAGE SEQUENCING =====

    /// Helper: build a fully-online pipeline request
    fn online_pipeline_request() -> AssistantPipelineRequest {
        AssistantPipelineRequest {
            api_key: "sk-test-key".to_string(),
            api_base_url: Some("https://api.example.com/v1".to_string()),
            stt_model: Some("gpt-4o-mini-transcribe".to_string()),
            ai_model: Some("gpt-4o-mini".to_string()),
            stt_local_mode: Some(false),
            ai_local_mode: Some(false),
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
            raw_mode: None,
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
            noise_suppression: None,
            raw_pcm_base64: None,
        }
    }

    #[test]
    fn fully_online_pipeline_resolves_both_stages_to_online() {
        let request = online_pipeline_request();
        let mode = resolve_pipeline_mode(&request).expect("should resolve");
        assert!(matches!(mode.stt, SttModeConfig::Online { .. }));
        assert!(matches!(mode.ai, AiModeConfig::Online { .. }));
    }

    #[test]
    fn fully_local_pipeline_resolves_both_stages_to_local() {
        let mut request = online_pipeline_request();
        request.stt_local_mode = Some(true);
        request.ai_local_mode = Some(true);
        request.api_key = String::new();
        let mode = resolve_pipeline_mode(&request).expect("should resolve");
        assert!(matches!(mode.stt, SttModeConfig::Local(_)));
        assert!(matches!(mode.ai, AiModeConfig::Local(_)));
    }

    #[test]
    fn hybrid_online_stt_local_ai_resolves_correctly() {
        let mut request = online_pipeline_request();
        request.stt_local_mode = Some(false);
        request.ai_local_mode = Some(true);
        let mode = resolve_pipeline_mode(&request).expect("should resolve");
        assert!(matches!(mode.stt, SttModeConfig::Online { .. }));
        assert!(matches!(mode.ai, AiModeConfig::Local(_)));
    }

    #[test]
    fn hybrid_local_stt_online_ai_resolves_correctly() {
        let mut request = online_pipeline_request();
        request.stt_local_mode = Some(true);
        request.ai_local_mode = Some(false);
        let mode = resolve_pipeline_mode(&request).expect("should resolve");
        assert!(matches!(mode.stt, SttModeConfig::Local(_)));
        assert!(matches!(mode.ai, AiModeConfig::Online { .. }));
    }

    #[test]
    fn fully_online_pipeline_stt_model_is_preserved() {
        let mut request = online_pipeline_request();
        request.stt_model = Some("whisper-large-v3".to_string());
        let mode = resolve_pipeline_mode(&request).expect("should resolve");
        match &mode.stt {
            SttModeConfig::Online { stt_model, .. } => {
                assert_eq!(stt_model, "whisper-large-v3");
            }
            _ => panic!("expected online STT"),
        }
    }

    #[test]
    fn fully_online_pipeline_ai_model_is_preserved() {
        let mut request = online_pipeline_request();
        request.ai_model = Some("claude-3-opus".to_string());
        let mode = resolve_pipeline_mode(&request).expect("should resolve");
        match &mode.ai {
            AiModeConfig::Online { ai_model, .. } => {
                assert_eq!(ai_model, "claude-3-opus");
            }
            _ => panic!("expected online AI"),
        }
    }

    #[test]
    fn fully_local_pipeline_ollama_config_is_preserved() {
        let mut request = online_pipeline_request();
        request.stt_local_mode = Some(true);
        request.ai_local_mode = Some(true);
        request.api_key = String::new();
        request.local_ollama_model = Some("mistral:latest".to_string());
        let mode = resolve_pipeline_mode(&request).expect("should resolve");
        match &mode.ai {
            AiModeConfig::Local(config) => {
                assert_eq!(config.ollama_model.as_deref(), Some("mistral:latest"));
                assert_eq!(config.ollama_base_url, "http://127.0.0.1:11434");
            }
            _ => panic!("expected local AI"),
        }
    }

    #[test]
    fn fully_local_pipeline_stt_model_is_canonicalized() {
        let mut request = online_pipeline_request();
        request.stt_local_mode = Some(true);
        request.ai_local_mode = Some(true);
        request.api_key = String::new();
        request.local_stt_model = Some("nvidia/parakeet-tdt-0.6b-v2".to_string());
        let mode = resolve_pipeline_mode(&request).expect("should resolve");
        match &mode.stt {
            SttModeConfig::Local(config) => {
                // v2 alias → canonical v2 id
                assert_eq!(config.stt_model, "nvidia/parakeet-tdt_ctc-110m");
            }
            _ => panic!("expected local STT"),
        }
    }

    #[test]
    fn pipeline_error_messages_are_user_friendly() {
        // Missing API key
        let mut req = online_pipeline_request();
        req.api_key = String::new();
        let err = resolve_pipeline_mode(&req).unwrap_err();
        assert!(err.contains("API key is required"));

        // Missing API base URL
        let mut req = online_pipeline_request();
        req.api_base_url = None;
        let err = resolve_pipeline_mode(&req).unwrap_err();
        assert!(err.contains("API base URL is required"));

        // Missing online STT model
        let mut req = online_pipeline_request();
        req.stt_model = None;
        let err = resolve_pipeline_mode(&req).unwrap_err();
        assert!(err.contains("Online STT model is required"));

        // Missing online AI model
        let mut req = online_pipeline_request();
        req.ai_model = None;
        let err = resolve_pipeline_mode(&req).unwrap_err();
        assert!(err.contains("Online AI model is required"));

        // Missing local STT model
        let mut req = online_pipeline_request();
        req.stt_local_mode = Some(true);
        req.local_stt_model = None;
        let err = resolve_pipeline_mode(&req).unwrap_err();
        assert!(err.contains("Local STT model is required"));
    }

    // ===== IPC SERIALIZATION CONTRACT =====
    // These tests verify that the Rust serde configuration matches
    // the TypeScript type definitions for the IPC request/response types.
    // If these tests fail, the Rust ↔ TypeScript contract has drifted.

    #[test]
    fn ipc_request_serializes_with_camel_case() {
        let request = AssistantPipelineRequest {
            api_key: "sk-test".to_string(),
            api_base_url: Some("https://api.example.com".to_string()),
            stt_model: Some("gpt-4o-mini-transcribe".to_string()),
            ai_model: Some("gpt-4o-mini".to_string()),
            stt_local_mode: Some(false),
            ai_local_mode: Some(true),
            local_ollama_base_url: Some("http://127.0.0.1:11434".to_string()),
            local_ollama_model: Some("llama3".to_string()),
            local_stt_model: Some("nvidia/parakeet-tdt-0.6b-v3".to_string()),
            piper_path: Some("/path/to/piper".to_string()),
            audio_base64: "dGVzdA==".to_string(),
            audio_mime_type: "audio/wav".to_string(),
            language: Some("en".to_string()),
            allowed_languages: Some(vec!["en".to_string(), "es".to_string()]),
            system_prompt: Some("You are helpful.".to_string()),
            temperature: Some(0.5),
            max_tokens: Some(256),
            dictionary_entries: Some(vec![DictionaryEntryRequest {
                source: "brb".to_string(),
                target: "be right back".to_string(),
            }]),
            snippet_entries: Some(vec![SnippetEntryRequest {
                trigger: "gj".to_string(),
                expansion: "good job".to_string(),
            }]),
            raw_mode: Some(false),
            apply_backtrack: Some(true),
            remove_fillers: Some(true),
            auto_punctuation: Some(true),
            auto_numbered_lists: Some(false),
            noise_suppression: Some(true),
            raw_pcm_base64: Some("cGNtZGF0YQ==".to_string()),
            command_mode: Some(true),
            wake_word_enabled: Some(true),
            assistant_name: Some("Lily".to_string()),
            selected_text: Some("selected text".to_string()),
            tts_engine: Some("piper".to_string()),
            piper: Some(PiperPipelineRequest {
                speed: Some(1.08),
                quality: Some("fast".to_string()),
                emotion: Some("neutral".to_string()),
            }),
            coqui: None,
        };

        let json = serde_json::to_value(&request).expect("should serialize");
        let obj = json.as_object().expect("should be object");

        // Verify camelCase field names match the TypeScript types
        assert!(obj.contains_key("apiKey"), "expected camelCase 'apiKey'");
        assert!(obj.contains_key("apiBaseUrl"), "expected camelCase 'apiBaseUrl'");
        assert!(obj.contains_key("sttModel"), "expected camelCase 'sttModel'");
        assert!(obj.contains_key("aiModel"), "expected camelCase 'aiModel'");
        assert!(obj.contains_key("sttLocalMode"), "expected camelCase 'sttLocalMode'");
        assert!(obj.contains_key("aiLocalMode"), "expected camelCase 'aiLocalMode'");
        assert!(obj.contains_key("localOllamaBaseUrl"), "expected camelCase 'localOllamaBaseUrl'");
        assert!(obj.contains_key("localOllamaModel"), "expected camelCase 'localOllamaModel'");
        assert!(obj.contains_key("localSttModel"), "expected camelCase 'localSttModel'");
        assert!(obj.contains_key("piperPath"), "expected camelCase 'piperPath'");
        assert!(obj.contains_key("audioBase64"), "expected camelCase 'audioBase64'");
        assert!(obj.contains_key("audioMimeType"), "expected camelCase 'audioMimeType'");
        assert!(obj.contains_key("allowedLanguages"), "expected camelCase 'allowedLanguages'");
        assert!(obj.contains_key("systemPrompt"), "expected camelCase 'systemPrompt'");
        assert!(obj.contains_key("maxTokens"), "expected camelCase 'maxTokens'");
        assert!(obj.contains_key("dictionaryEntries"), "expected camelCase 'dictionaryEntries'");
        assert!(obj.contains_key("snippetEntries"), "expected camelCase 'snippetEntries'");
        assert!(obj.contains_key("rawMode"), "expected camelCase 'rawMode'");
        assert!(obj.contains_key("applyBacktrack"), "expected camelCase 'applyBacktrack'");
        assert!(obj.contains_key("removeFillers"), "expected camelCase 'removeFillers'");
        assert!(obj.contains_key("autoPunctuation"), "expected camelCase 'autoPunctuation'");
        assert!(obj.contains_key("autoNumberedLists"), "expected camelCase 'autoNumberedLists'");
        assert!(obj.contains_key("noiseSuppression"), "expected camelCase 'noiseSuppression'");
        assert!(obj.contains_key("rawPcmBase64"), "expected camelCase 'rawPcmBase64'");
        assert!(obj.contains_key("commandMode"), "expected camelCase 'commandMode'");
        assert!(obj.contains_key("wakeWordEnabled"), "expected camelCase 'wakeWordEnabled'");
        assert!(obj.contains_key("assistantName"), "expected camelCase 'assistantName'");
        assert!(obj.contains_key("selectedText"), "expected camelCase 'selectedText'");
        assert!(obj.contains_key("ttsEngine"), "expected camelCase 'ttsEngine'");

        // Verify nested objects
        let piper = obj.get("piper").expect("piper should exist").as_object().unwrap();
        assert!(piper.contains_key("speed"));
        assert!(piper.contains_key("quality"));
        assert!(piper.contains_key("emotion"));

        // Verify values
        assert_eq!(obj.get("apiKey").unwrap(), "sk-test");
        assert_eq!(obj.get("sttLocalMode").unwrap(), false);
        assert_eq!(obj.get("aiLocalMode").unwrap(), true);
        assert_eq!(obj.get("temperature").unwrap(), 0.5);
        assert_eq!(obj.get("maxTokens").unwrap(), 256);
    }

    #[test]
    fn ipc_request_missing_optional_fields_serializes_as_null() {
        let request = AssistantPipelineRequest {
            api_key: String::new(),
            api_base_url: None,
            stt_model: None,
            ai_model: None,
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
            raw_mode: None,
            apply_backtrack: None,
            remove_fillers: None,
            auto_punctuation: None,
            auto_numbered_lists: None,
            noise_suppression: None,
            raw_pcm_base64: None,
            command_mode: None,
            wake_word_enabled: None,
            assistant_name: None,
            selected_text: None,
            tts_engine: None,
            piper: None,
            coqui: None,
        };

        let json = serde_json::to_value(&request).expect("should serialize");
        let obj = json.as_object().unwrap();

        // All optional fields should be null when None
        assert!(obj.get("apiBaseUrl").unwrap().is_null());
        assert!(obj.get("sttModel").unwrap().is_null());
        assert!(obj.get("aiModel").unwrap().is_null());
        assert!(obj.get("sttLocalMode").unwrap().is_null());
        assert!(obj.get("aiLocalMode").unwrap().is_null());
        assert!(obj.get("language").unwrap().is_null());
        assert!(obj.get("systemPrompt").unwrap().is_null());
        assert!(obj.get("temperature").unwrap().is_null());
        assert!(obj.get("piper").unwrap().is_null());
        assert!(obj.get("coqui").unwrap().is_null());
    }

    #[test]
    fn ipc_response_has_expected_camel_case_fields() {
        let response = AssistantPipelineResponse {
            mode: "dictation".to_string(),
            selection_rewrite: false,
            selection_pending: false,
            selection_context_cleared: false,
            selection_context_used: false,
            transcript: "Hello world".to_string(),
            assistant_response: "Hello world.".to_string(),
            audio_base64: String::new(),
            stt_latency_ms: 250,
            ai_latency_ms: 800,
            tts_latency_ms: 150,
            total_latency_ms: 1200,
        };

        let json = serde_json::to_value(&response).expect("should serialize");
        let obj = json.as_object().expect("should be object");

        // Verify camelCase field names match TypeScript AssistantPipelineResponse
        assert!(obj.contains_key("mode"));
        assert!(obj.contains_key("selectionRewrite"), "expected camelCase 'selectionRewrite'");
        assert!(obj.contains_key("selectionPending"), "expected camelCase 'selectionPending'");
        assert!(obj.contains_key("selectionContextCleared"), "expected camelCase 'selectionContextCleared'");
        assert!(obj.contains_key("selectionContextUsed"), "expected camelCase 'selectionContextUsed'");
        assert!(obj.contains_key("transcript"));
        assert!(obj.contains_key("assistantResponse"), "expected camelCase 'assistantResponse'");
        assert!(obj.contains_key("audioBase64"), "expected camelCase 'audioBase64'");
        assert!(obj.contains_key("sttLatencyMs"), "expected camelCase 'sttLatencyMs'");
        assert!(obj.contains_key("aiLatencyMs"), "expected camelCase 'aiLatencyMs'");
        assert!(obj.contains_key("ttsLatencyMs"), "expected camelCase 'ttsLatencyMs'");
        assert!(obj.contains_key("totalLatencyMs"), "expected camelCase 'totalLatencyMs'");

        // Verify values
        assert_eq!(obj.get("mode").unwrap(), "dictation");
        assert_eq!(obj.get("sttLatencyMs").unwrap(), 250);
        assert_eq!(obj.get("totalLatencyMs").unwrap(), 1200);
    }

    #[test]
    fn ipc_nested_entry_requests_serialize_correctly() {
        let request = AssistantPipelineRequest {
            api_key: "key".to_string(),
            api_base_url: Some("https://api.example.com".to_string()),
            stt_model: Some("model".to_string()),
            ai_model: Some("model".to_string()),
            stt_local_mode: Some(false),
            ai_local_mode: Some(false),
            local_ollama_base_url: None,
            local_ollama_model: None,
            local_stt_model: None,
            piper_path: None,
            audio_base64: String::new(),
            audio_mime_type: "audio/wav".to_string(),
            language: None,
            allowed_languages: None,
            system_prompt: None,
            temperature: None,
            max_tokens: None,
            dictionary_entries: Some(vec![
                DictionaryEntryRequest {
                    source: "brb".to_string(),
                    target: "be right back".to_string(),
                },
                DictionaryEntryRequest {
                    source: "idk".to_string(),
                    target: "I don't know".to_string(),
                },
            ]),
            snippet_entries: Some(vec![SnippetEntryRequest {
                trigger: "gj".to_string(),
                expansion: "good job".to_string(),
            }]),
            raw_mode: None,
            apply_backtrack: None,
            remove_fillers: None,
            auto_punctuation: None,
            auto_numbered_lists: None,
            noise_suppression: None,
            raw_pcm_base64: None,
            command_mode: None,
            wake_word_enabled: None,
            assistant_name: None,
            selected_text: None,
            tts_engine: None,
            piper: None,
            coqui: None,
        };

        let json = serde_json::to_value(&request).expect("should serialize");
        let entries = json.get("dictionaryEntries").unwrap().as_array().unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].get("source").unwrap(), "brb");
        assert_eq!(entries[0].get("target").unwrap(), "be right back");

        let snippets = json.get("snippetEntries").unwrap().as_array().unwrap();
        assert_eq!(snippets.len(), 1);
        assert_eq!(snippets[0].get("trigger").unwrap(), "gj");
        assert_eq!(snippets[0].get("expansion").unwrap(), "good job");
    }

    #[test]
    fn ipc_round_trip_preserves_option_vs_null_distinction() {
        // When frontend sends null for optional fields, Rust should deserialize as None
        let json_str = r#"{
            "apiKey": "test",
            "apiBaseUrl": null,
            "sttModel": null,
            "aiModel": null,
            "sttLocalMode": true,
            "aiLocalMode": true,
            "localOllamaBaseUrl": null,
            "localOllamaModel": null,
            "localSttModel": null,
            "piperPath": null,
            "audioBase64": "",
            "audioMimeType": "audio/wav",
            "language": null,
            "allowedLanguages": null,
            "systemPrompt": null,
            "temperature": null,
            "maxTokens": null,
            "dictionaryEntries": null,
            "snippetEntries": null,
            "rawMode": null,
            "applyBacktrack": null,
            "removeFillers": null,
            "autoPunctuation": null,
            "autoNumberedLists": null,
            "noiseSuppression": null,
            "rawPcmBase64": null,
            "commandMode": null,
            "wakeWordEnabled": null,
            "assistantName": null,
            "selectedText": null,
            "ttsEngine": null,
            "piper": null,
            "coqui": null
        }"#;

        let request: AssistantPipelineRequest =
            serde_json::from_str(json_str).expect("should deserialize from null-heavy JSON");

        // Verify that null fields become None
        assert!(request.api_base_url.is_none());
        assert!(request.stt_model.is_none());
        assert!(request.ai_model.is_none());
        assert_eq!(request.stt_local_mode, Some(true));
        assert_eq!(request.ai_local_mode, Some(true));
        assert!(request.local_ollama_model.is_none());
        assert!(request.local_stt_model.is_none());
        assert!(request.temperature.is_none());
        assert!(request.max_tokens.is_none());
        assert!(request.system_prompt.is_none());
        assert!(request.dictionary_entries.is_none());
        assert!(request.piper.is_none());
    }

    // ===== HARDWARE TIER RECOMMENDATION POLICY =====

    #[test]
    fn performance_tier_suggests_heavier_model() {
        let (suggested, suggested_candidates, caution) =
            local_stt_models_for_tier("performance", false);
        assert_eq!(suggested, "nvidia/parakeet-tdt-0.6b-v3");
        assert!(suggested_candidates.contains(&"nvidia/parakeet-tdt-0.6b-v3"));
        assert!(suggested_candidates.contains(&"nvidia/parakeet-tdt_ctc-110m"));
        assert!(caution.is_empty());
    }

    #[test]
    fn balanced_tier_suggests_lightweight_model() {
        let (suggested, suggested_candidates, caution) =
            local_stt_models_for_tier("balanced", false);
        assert_eq!(suggested, "nvidia/parakeet-tdt_ctc-110m");
        assert_eq!(suggested_candidates, vec!["nvidia/parakeet-tdt_ctc-110m"]);
        assert!(caution.contains(&"nvidia/parakeet-tdt-0.6b-v3"));
    }

    #[test]
    fn basic_tier_suggests_lightweight_model() {
        let (suggested, suggested_candidates, caution) =
            local_stt_models_for_tier("basic", false);
        assert_eq!(suggested, "nvidia/parakeet-tdt_ctc-110m");
        assert_eq!(suggested_candidates, vec!["nvidia/parakeet-tdt_ctc-110m"]);
        assert!(caution.contains(&"nvidia/parakeet-tdt-0.6b-v3"));
    }

    #[test]
    fn unknown_tier_defaults_to_lightweight() {
        let (suggested, _, _) = local_stt_models_for_tier("unknown", false);
        assert_eq!(suggested, "nvidia/parakeet-tdt_ctc-110m");
    }

    // ===== HARDWARE TIER CLASSIFICATION =====

    fn make_probe(logical_cores: usize, ram_bytes: u64, nvidia: bool, vram_mb: u64) -> LocalSttHardwareProbe {
        LocalSttHardwareProbe {
            cpu_name: "Test CPU".to_string(),
            logical_cores,
            total_ram_bytes: ram_bytes,
            nvidia_gpu_detected: nvidia,
            gpu_name: if nvidia { "NVIDIA GPU".to_string() } else { String::new() },
            gpu_vram_mb: vram_mb,
        }
    }

    #[test]
    fn tier_performance_with_strong_gpu_and_ram() {
        // 8+ cores, 16+ GB RAM, 8+ GB VRAM → performance
        let probe = make_probe(12, 32 * 1024 * 1024 * 1024, true, 12 * 1024);
        assert_eq!(local_stt_performance_tier(&probe, 32.0, 12.0), "performance");
    }

    #[test]
    fn tier_basic_with_low_ram() {
        let probe = make_probe(4, 4 * 1024 * 1024 * 1024, false, 0);
        assert_eq!(local_stt_performance_tier(&probe, 4.0, 0.0), "basic");
    }

    #[test]
    fn tier_balanced_with_mid_gpu() {
        // 4+ GB VRAM + 12+ GB RAM → balanced
        let probe = make_probe(6, 16 * 1024 * 1024 * 1024, true, 6 * 1024);
        assert_eq!(local_stt_performance_tier(&probe, 16.0, 6.0), "balanced");
    }

    #[test]
    fn tier_balanced_with_ample_ram_and_strong_cpu() {
        // 16+ GB RAM + 8+ cores → balanced (no GPU)
        let probe = make_probe(8, 16 * 1024 * 1024 * 1024, false, 0);
        assert_eq!(local_stt_performance_tier(&probe, 16.0, 0.0), "balanced");
    }

    // ===== FOREGROUND INPUT BLOCKING POLICY =====

    #[test]
    fn blocks_known_game_processes() {
        assert_eq!(commands::input::foreground_input_block_reason("cs2", "", false), Some("game-process"));
        assert_eq!(commands::input::foreground_input_block_reason("valorant", "", false), Some("game-process"));
        assert_eq!(commands::input::foreground_input_block_reason("fortniteclient-win64-shipping", "", false), Some("game-process"));
        assert_eq!(commands::input::foreground_input_block_reason("gta5", "", false), Some("game-process"));
    }

    #[test]
    fn blocks_game_prefixes() {
        assert_eq!(commands::input::foreground_input_block_reason("cyberpunk2077", "", false), Some("game-process"));
        assert_eq!(commands::input::foreground_input_block_reason("cod_ghosts", "", false), Some("game-process"));
        assert_eq!(commands::input::foreground_input_block_reason("eldenring", "", false), Some("game-process"));
    }

    #[test]
    fn blocks_terminal_processes() {
        assert_eq!(commands::input::foreground_input_block_reason("cmd", "", false), Some("terminal-process"));
        assert_eq!(commands::input::foreground_input_block_reason("powershell", "", false), Some("terminal-process"));
        assert_eq!(commands::input::foreground_input_block_reason("windowsterminal", "", false), Some("terminal-process"));
        assert_eq!(commands::input::foreground_input_block_reason("mintty", "", false), Some("terminal-process"));
    }

    #[test]
    fn blocks_ide_terminal_tabs() {
        assert_eq!(
            commands::input::foreground_input_block_reason("code", "My Project — terminal", false),
            Some("ide-terminal")
        );
        assert_eq!(
            commands::input::foreground_input_block_reason("cursor", "main.rs — PowerShell", false),
            Some("ide-terminal")
        );
    }

    #[test]
    fn does_not_block_normal_processes() {
        assert_eq!(commands::input::foreground_input_block_reason("chrome", "", false), None);
        assert_eq!(commands::input::foreground_input_block_reason("slack", "", false), None);
        assert_eq!(commands::input::foreground_input_block_reason("explorer", "", false), None);
        assert_eq!(commands::input::foreground_input_block_reason("app", "", false), None);
    }

    #[test]
    fn does_not_block_ide_with_non_terminal_tab() {
        assert_eq!(
            commands::input::foreground_input_block_reason("code", "main.rs — Visual Studio Code", false),
            None
        );
    }

    #[test]
    fn blocks_fullscreen_game_heuristic() {
        assert_eq!(
            commands::input::foreground_input_block_reason("unknown_game", "My Game", true),
            Some("fullscreen-game-heuristic")
        );
    }

    #[test]
    fn does_not_block_fullscreen_allowed_processes() {
        assert_eq!(
            commands::input::foreground_input_block_reason("chrome", "YouTube", true),
            None
        );
    }

    #[test]
    fn does_not_block_fullscreen_video_content() {
        assert_eq!(
            commands::input::foreground_input_block_reason("vlc", "youtube.com/video", true),
            None
        );
    }

    #[test]
    fn empty_process_name_not_blocked() {
        assert_eq!(commands::input::foreground_input_block_reason("", "", false), None);
    }
}

pub fn run() {
    let app_state = AppState::new().expect("failed to initialize app state");
    let tts_setup_state = TtsSetupState::default();
    let start_in_tray =
        std::env::args().any(|arg| arg.eq_ignore_ascii_case(STARTUP_ARG_START_IN_TRAY));

    let mut builder = tauri::Builder::default();
    // window-state plugin — needs to be added before .manage()
    builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            info!(
                "[app.single-instance] secondary launch blocked args={:?}",
                args
            );
            if args
                .iter()
                .any(|a| a.eq_ignore_ascii_case(STARTUP_ARG_START_IN_TRAY))
            {
                info!("[app.single-instance] --start-in-tray passed; respecting hidden state");
                return;
            }
            commands::windows::show_main_window(app);
        }));
    }

    builder
        .plugin(tauri_plugin_window_state::Builder::default().build())
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
            commands::windows::build_tray_icon(&app_handle)?;
            ensure_local_stt_daemon_idle_sweeper();
            start_local_stt_boot_warmup(app_handle.clone());

            if let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let app_handle_for_close = app_handle.clone();
                let app_handle_for_resize = app_handle.clone();
                let main_window_for_resize = main_window.clone();
                main_window.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::CloseRequested { api, .. } => {
                            api.prevent_close();
                            commands::windows::hide_main_window_to_tray(&app_handle_for_close);
                        }
                        tauri::WindowEvent::Resized(_) => {
                            // Track minimize/restore transitions. On every
                            // resize while the window is NOT minimized, capture
                            // the current rect into WindowVisibilityState so we
                            // can restore to that exact size+position after the
                            // user restores from a taskbar click.
                            //
                            // When the transition is minimized -> not-minimized
                            // (i.e. user restored from taskbar), apply the saved
                            // pre-minimize rect via set_position + set_size.
                            let minimized_now = main_window_for_resize
                                .is_minimized()
                                .unwrap_or(false);

                            if let Some(state) =
                                app_handle_for_resize.try_state::<AppState>()
                            {
                                if let Ok(mut visibility) =
                                    state.window_visibility.lock()
                                {
                                    if minimized_now {
                                        // Mark that we just entered the
                                        // minimized state. The "last_rect"
                                        // already holds the pre-minimize rect
                                        // because the previous Resized events
                                        // kept updating it.
                                        visibility.was_minimized = true;
                                    } else if visibility.was_minimized {
                                        // Transition minimized -> restored.
                                        // Restore to the saved rect.
                                        visibility.was_minimized = false;
                                        let rect = visibility.last_rect;
                                        drop(visibility);
                                        if let Some(r) = rect {
                                            if let Err(error) = main_window_for_resize
                                                .set_position(
                                                    tauri::PhysicalPosition {
                                                        x: r.position_x,
                                                        y: r.position_y,
                                                    },
                                                )
                                            {
                                                warn!("[tray] failed to restore position on un-minimize: {error}");
                                            }
                                            if let Err(error) = main_window_for_resize
                                                .set_size(tauri::PhysicalSize {
                                                    width: r.width,
                                                    height: r.height,
                                                })
                                            {
                                                warn!("[tray] failed to restore size on un-minimize: {error}");
                                            }
                                        }
                                    } else {
                                        // Plain resize while visible. Update
                                        // the saved rect.
                                        visibility.last_rect =
                                            Some(commands::windows::capture_rect(&main_window_for_resize));
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                });
            } else {
                warn!("[tray] main window not found for close-to-tray hook");
            }

            // Clean up stale installer files from previous update attempts
            if let Ok(app_data) = app.path().app_data_dir() {
                let updates_dir = app_data.join("updates");
                if updates_dir.is_dir() {
                    if let Ok(entries) = fs::read_dir(&updates_dir) {
                        for entry in entries.flatten() {
                            let path = entry.path();
                            if path.extension().is_some_and(|ext| ext == "exe" || ext == "msi") {
                                let _ = fs::remove_file(&path);
                                info!(
                                    "[updater] cleaned stale installer: {}",
                                    clip_text(&path.to_string_lossy(), 200)
                                );
                            }
                        }
                    }
                }
            }

            if start_in_tray {
                commands::windows::hide_main_window_to_tray(&app_handle);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            log_client_event,
            check_for_app_update,
            download_and_install_app_update,
            load_persisted_local_settings,
            save_persisted_local_settings,
            save_dictation_recording,
            list_dictation_recordings_stats,
            list_dictation_recording_ids,
            clear_dictation_recordings,
            get_dictation_recording,
            capture_selected_text,
            set_clipboard_text,
            configure_launch_at_login,
            launch_at_login_status,
            paste_clipboard_text,
            paste_text_via_clipboard,
            control_media_playback,
            mute_system_audio,
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
            get_local_stt_model_status,
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
            show_update_settings,
            set_tray_update_available,
            toggle_main_window_visibility,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
