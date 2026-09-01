//! TTS synthesis for the voice assistant pipeline.
//!
//! This module contains the runtime-dependent TTS operations:
//! Piper synthesis, Coqui synthesis, text normalization for speech,
//! binary validation, and path resolution. It depends on `AppHandle`,
//! filesystem, and subprocess execution but NOT on `AppState`.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
#[cfg(target_os = "windows")]
#[allow(unused_imports)]
use std::os::windows::process::CommandExt;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use log::{info, warn};
use reqwest::Client;
use serde_json::{json, Value};
use tauri::AppHandle;
use tauri::Manager;

use crate::constants::*;
use crate::pipeline::ai::{clip_text, single_line};

// ===== Global state =====


// ===== Platform helpers =====

#[cfg(target_os = "windows")]
pub fn apply_no_window(command: &mut Command) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
pub fn apply_no_window(_command: &mut Command) {}

pub fn merge_process_output(stdout: &[u8], stderr: &[u8]) -> String {
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

// ===== Piper text normalization =====

pub fn normalize_spacing(input: &str) -> String {
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

pub fn piper_integer_to_words(value: u64) -> String {
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

pub fn piper_digits_to_words(digits: &str) -> Option<String> {
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

pub fn normalize_piper_numeric_token(token: &str) -> String {
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

pub fn normalize_piper_math_symbols(input: &str) -> String {
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

pub fn validate_tts_input_length(text: &str) -> Result<(), String> {
    let count = text.chars().count();
    if count > MAX_TTS_INPUT_LENGTH {
        return Err(format!(
            "TTS input text is too long ({count} characters). Maximum is {MAX_TTS_INPUT_LENGTH}."
        ));
    }
    Ok(())
}

pub fn normalize_piper_text_for_tts(input: &str) -> String {
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

// ===== Binary/path validation =====

pub fn validate_piper_binary_path(path: &str) -> Result<(), String> {
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

pub fn validate_python_binary_path(path: &str) -> Result<(), String> {
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

    if !matches!(normalized, "python" | "python3" | "pythonw" | "py") && !is_python3_with_version {
        return Err(format!(
            "Invalid python binary name '{}'. Expected a python executable name.",
            file_name
        ));
    }

    Ok(())
}

// ===== Path resolution =====

pub fn piper_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;

    let runtime_dir = app_data.join("piper").join("runtime");
    fs::create_dir_all(&runtime_dir)
        .map_err(|error| format!("Failed to create Piper runtime directory: {error}"))?;

    Ok(runtime_dir)
}

pub fn voice_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
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

pub fn coqui_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    let root = app_data.join("coqui");
    fs::create_dir_all(&root)
        .map_err(|error| format!("Failed to create Coqui root directory: {error}"))?;
    Ok(root)
}

pub fn coqui_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let runtime_dir = coqui_root_dir(app)?.join("runtime");
    fs::create_dir_all(&runtime_dir)
        .map_err(|error| format!("Failed to create Coqui runtime directory: {error}"))?;
    Ok(runtime_dir)
}

pub fn coqui_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let cache_dir = coqui_root_dir(app)?.join("cache");
    fs::create_dir_all(&cache_dir)
        .map_err(|error| format!("Failed to create Coqui cache directory: {error}"))?;
    Ok(cache_dir)
}

pub fn coqui_voices_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let voice_dir = coqui_root_dir(app)?.join("voices");
    fs::create_dir_all(&voice_dir)
        .map_err(|error| format!("Failed to create Coqui voices directory: {error}"))?;
    Ok(voice_dir)
}

pub fn coqui_uploads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let uploads_dir = coqui_root_dir(app)?.join("uploads");
    fs::create_dir_all(&uploads_dir)
        .map_err(|error| format!("Failed to create Coqui uploads directory: {error}"))?;
    Ok(uploads_dir)
}

pub fn coqui_previews_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let previews_dir = coqui_root_dir(app)?.join("previews");
    fs::create_dir_all(&previews_dir)
        .map_err(|error| format!("Failed to create Coqui previews directory: {error}"))?;
    Ok(previews_dir)
}

pub fn coqui_venv_python_path(app: &AppHandle) -> Result<PathBuf, String> {
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

pub fn resolve_coqui_python_path(
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
    if crate::file_exists_with_content(&venv_python) {
        let resolved = venv_python.to_string_lossy().into_owned();
        validate_python_binary_path(&resolved)?;
        return Ok(resolved);
    }

    validate_python_binary_path("python")?;
    Ok("python".to_string())
}

pub fn ensure_coqui_bridge_script(_app: &AppHandle) -> Result<PathBuf, String> {
    Err("Coqui TTS is disabled. The bridge script is no longer bundled.".to_string())
}

// ===== Coqui bridge execution =====

pub fn run_coqui_bridge(app: &AppHandle, python_path: &str, payload: Value) -> Result<Value, String> {
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
        return crate::pipeline::daemon::run_coqui_bridge_via_daemon(
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
        crate::pipeline::daemon::parse_coqui_bridge_response(&action, output.status.success(), &stdout_text, &stderr_text)?;
    info!("[coqui.bridge] success action={}", action);
    Ok(result)
}

// ===== Synthesis =====

pub async fn synthesize_with_piper(
    piper_path: String,
    model_path: PathBuf,
    text: String,
    piper: Option<&crate::PiperPipelineRequest>,
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
            let guard = crate::piper_tuning_support()
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
                let mut guard = crate::piper_tuning_support()
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
                    let mut guard = crate::piper_tuning_support()
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
                crate::elapsed_ms(synth_start)
            );
        }
        result
    })?
}

pub async fn synthesize_with_coqui(
    app: &AppHandle,
    coqui: &crate::CoquiPipelineRequest,
    text: String,
) -> Result<Vec<u8>, String> {
    if crate::zero_python_mode_enabled() {
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
        crate::elapsed_ms(synth_start)
    );

    Ok(wav_bytes)
}

// ===== Binary/voice management =====

pub async fn ensure_voice_files(
    app: &AppHandle,
    client: &Client,
) -> Result<(PathBuf, PathBuf), String> {
    let (model_path, config_path) = voice_paths(app)?;

    if !crate::file_exists_with_content(&model_path) {
        crate::download_file(client, VOICE_MODEL_URL, &model_path).await?;
    }

    if !crate::file_exists_with_content(&config_path) {
        crate::download_file(client, VOICE_CONFIG_URL, &config_path).await?;
    }

    Ok((model_path, config_path))
}

pub async fn ensure_piper_binary(app: &AppHandle, client: &Client) -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let runtime_dir = piper_runtime_dir(app)?;

        if let Some(existing_path) = crate::find_file_by_name(&runtime_dir, PIPER_BINARY_NAME)? {
            return Ok(existing_path);
        }

        let archive_path = runtime_dir.join(PIPER_ARCHIVE_FILE);
        crate::download_file(client, PIPER_ARCHIVE_URL, &archive_path).await?;
        crate::extract_zip_archive(&archive_path, &runtime_dir)?;
        let _ = fs::remove_file(&archive_path);

        return crate::find_file_by_name(&runtime_dir, PIPER_BINARY_NAME)?
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

// ===== Tests =====

#[cfg(test)]
mod tests {
    use super::*;

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
    fn validates_piper_binary_path() {
        assert!(validate_piper_binary_path("piper").is_ok());
        assert!(validate_piper_binary_path("piper.exe").is_ok());
        assert!(validate_piper_binary_path("/usr/local/bin/piper").is_ok());
        assert!(validate_piper_binary_path("C:/Program Files (x86)/piper/piper.exe").is_ok());

        assert!(validate_piper_binary_path("bash").is_err());
        assert!(validate_piper_binary_path("piper\nbad").is_err());
    }
}
