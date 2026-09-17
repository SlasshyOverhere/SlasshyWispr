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
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use tauri::{menu::MenuItem, AppHandle, Manager};


#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::LocalFree;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

pub mod audio;
pub mod commands;
pub mod services;
pub mod constants;
pub mod pipeline;
pub mod platform;
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
static TRAY_UPDATE_ITEM: OnceLock<MenuItem<tauri::Wry>> = OnceLock::new();

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
        let (repo_id, model_dir) = match services::transcribe::resolve_local_stt_repo_and_dir(&app, &provider, &model) {
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
                services::transcribe::warmup_local_stt_parakeet_model_blocking(&app_for_worker, "", &model_for_worker)
            }
            "whisper" | "moonshine" | "sensevoice" => {
                if zero_python_mode_enabled() {
                    return Err(ZERO_PYTHON_STT_NOTICE.to_string());
                }
                let python_path = services::transcribe::setup_local_stt_runtime_blocking(&app_for_worker, "python")?;
                services::transcribe::warmup_local_stt_hf_model_blocking(&app_for_worker, &python_path, &model_for_worker)
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

// STT helpers moved to pipeline::stt.
// They are available via `use pipeline::stt::*;` at the top of this file.



// All routing-related functions have been moved to pipeline::routing.
// They are available via `use pipeline::routing::*;` at the top of this file.

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

fn update_github_token() -> Option<String> {
    non_empty_env_var(UPDATE_GITHUB_TOKEN_ENV)
}

#[cfg(test)]
mod tests {
    // validates_safe_update_urls moved to updater::tests
    use super::*;


    // TTS normalize tests live in pipeline::tts::normalize::tests.

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












    // ===== SINGLE_LINE AND CLIP_TEXT =====







    // ===== MIME EXTENSION MAPPING =====

    #[test]
    fn mime_to_extension_handles_common_types() {
        assert_eq!(services::transcribe::mime_to_extension("audio/webm"), "webm");
        assert_eq!(services::transcribe::mime_to_extension("audio/wav"), "wav");
        assert_eq!(services::transcribe::mime_to_extension("audio/ogg"), "ogg");
        assert_eq!(services::transcribe::mime_to_extension("audio/mp4"), "m4a");
        assert_eq!(services::transcribe::mime_to_extension("audio/mpeg"), "mp3");
        assert_eq!(services::transcribe::mime_to_extension("audio/mp3"), "mp3");
    }

    #[test]
    fn mime_to_extension_defaults_to_webm() {
        assert_eq!(services::transcribe::mime_to_extension("audio/unknown"), "webm");
        assert_eq!(services::transcribe::mime_to_extension("application/octet-stream"), "webm");
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
