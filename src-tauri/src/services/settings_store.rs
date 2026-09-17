//! Settings persistence services — secure storage backend.
//!
//! Moved verbatim from lib.rs: keyring targets + read/write/clear, DPAPI
//! encrypt/decrypt fallback (Windows) with non-Windows stubs, secure/restore
//! payload transforms, and settings-file path resolution. Single consumer is
//! commands::settings (plus boot warmup + launch-at-login preference reads).

use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use keyring::Entry;
use log::{info, warn};
use serde_json::Value;
use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
use std::io;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::LocalFree;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

use crate::constants::{PERSISTED_SETTINGS_DIR_NAME, PERSISTED_SETTINGS_FILE_NAME};
use crate::pipeline::routing::normalize_api_key_secret;

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

pub(crate) fn api_key_fingerprint(api_key: &str) -> String {
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

pub(crate) fn known_keyring_targets() -> Vec<(&'static str, &'static str)> {
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

pub(crate) fn write_api_key_to_primary_keyring(api_key: &str) -> Result<(), String> {
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

pub(crate) fn clear_api_key_from_known_keyring_entries() {
    for (service, user) in known_keyring_targets() {
        if let Ok(entry) = Entry::new(service, user) {
            let _ = entry.delete_credential();
        }
    }
}

pub(crate) fn read_api_key_from_known_keyring_entries() -> Option<(String, String, String)> {
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
pub(crate) fn encrypt_api_key_fallback(api_key: &str) -> Result<String, String> {
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
pub(crate) fn encrypt_api_key_fallback(_api_key: &str) -> Result<String, String> {
    Err("Encrypted API key fallback is unavailable on this OS build.".to_string())
}

#[cfg(target_os = "windows")]
pub(crate) fn decrypt_api_key_fallback(encoded_value: &str) -> Result<String, String> {
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
pub(crate) fn decrypt_api_key_fallback(_encoded_value: &str) -> Result<String, String> {
    Err("Encrypted API key fallback is unavailable on this OS build.".to_string())
}

pub(crate) fn secure_settings_payload(payload: &str) -> Result<String, String> {
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

pub(crate) fn restore_settings_payload(payload: &str) -> Result<String, String> {
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

pub(crate) fn resolve_user_home_dir() -> Option<PathBuf> {
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

pub(crate) fn legacy_persisted_settings_paths(app: &AppHandle) -> Vec<PathBuf> {
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

pub(crate) fn resolve_primary_persisted_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
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

pub(crate) fn persisted_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
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
