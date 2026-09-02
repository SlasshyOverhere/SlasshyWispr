//! STT repository/model resolution and file-selection policy.
//!
//! Pure decision logic: repository aliases, relative-path validation, and the
//! "which files should be downloaded from a HuggingFace snapshot" policy.
//! No I/O, no AppState, no Tauri.

use std::path::{Path, PathBuf};

use crate::pipeline::routing::normalize_local_stt_provider;

/// Build a filesystem-safe directory name from a repo/model identifier.
pub(crate) fn sanitize_model_cache_dir_name(input: &str) -> String {
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

/// Map a known OpenAI Whisper model to its faster-whisper CTranslate2 mirror.
pub(crate) fn faster_whisper_repo_alias_for_model(model: &str) -> Option<&'static str> {
    let normalized_model = model.trim().to_ascii_lowercase();
    match normalized_model.as_str() {
        "openai/whisper-large-v3" => Some("Systran/faster-whisper-large-v3"),
        "openai/whisper-large-v3-turbo" => Some("mobiuslabsgmbh/faster-whisper-large-v3-turbo"),
        "openai/whisper-medium" => Some("Systran/faster-whisper-medium"),
        "openai/whisper-small" => Some("Systran/faster-whisper-small"),
        _ => None,
    }
}

/// Resolve the canonical HuggingFace repo id for a provider/model pair.
pub(crate) fn resolve_huggingface_repo_id(provider: &str, model: &str) -> String {
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

/// Legacy repo id for a provider/model pair (pre-alias downloads), if any.
pub(crate) fn legacy_huggingface_repo_id_for_model(provider: &str, model: &str) -> Option<String> {
    let normalized_provider = normalize_local_stt_provider(Some(provider));
    if normalized_provider != "whisper" {
        return None;
    }
    let normalized_model = model.trim();
    if normalized_model
        .to_ascii_lowercase()
        .starts_with("openai/whisper-")
    {
        Some(normalized_model.to_string())
    } else {
        None
    }
}

/// Normalize a HuggingFace sibling relative path into a safe relative path.
pub(crate) fn normalize_huggingface_relative_path(raw: &str) -> Result<PathBuf, String> {
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

/// Whether a HuggingFace sibling path should be considered for download.
pub(crate) fn should_download_huggingface_stt_file(path: &str) -> bool {
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
        "FunAudioLLM/SenseVoiceSmall" => &["model.pt", "chn_jpn_yue_eng_ko_spectok.bpe.model"],
        _ => &[],
    }
}

/// Select which sibling files should be downloaded for a snapshot, preserving
/// the repo-specific primary-file policy and generic fallbacks.
pub(crate) fn select_huggingface_stt_download_entries(
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
    } else if selected_indices.is_empty()
        && repo_id.eq_ignore_ascii_case("FunAudioLLM/SenseVoiceSmall")
    {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str) -> (PathBuf, Option<u64>) {
        (PathBuf::from(name), Some(1024))
    }

    #[test]
    fn sanitize_cache_dir_replaces_separators_and_specials() {
        assert_eq!(
            sanitize_model_cache_dir_name("nvidia/parakeet-tdt_ctc-110m"),
            "nvidia__parakeet-tdt_ctc-110m"
        );
        assert_eq!(sanitize_model_cache_dir_name("a b:c"), "a_b_c");
        assert_eq!(sanitize_model_cache_dir_name("   "), "model");
        assert_eq!(sanitize_model_cache_dir_name(""), "model");
    }

    #[test]
    fn faster_whisper_alias_maps_known_openai_models() {
        assert_eq!(
            faster_whisper_repo_alias_for_model("openai/whisper-large-v3"),
            Some("Systran/faster-whisper-large-v3")
        );
        assert_eq!(faster_whisper_repo_alias_for_model("OPENAI/whisper-small"), Some("Systran/faster-whisper-small"));
        assert_eq!(faster_whisper_repo_alias_for_model("whisper-base"), None);
    }

    #[test]
    fn resolve_huggingface_repo_maps_v2_alias_and_parakeet() {
        assert_eq!(
            resolve_huggingface_repo_id("parakeet", "nvidia/parakeet-tdt-0.6b-v2"),
            "nvidia/parakeet-tdt_ctc-110m"
        );
        assert_eq!(
            resolve_huggingface_repo_id("parakeet", "parakeet-tdt-0.6b-v3"),
            "nvidia/parakeet-tdt-0.6b-v3"
        );
        assert_eq!(
            resolve_huggingface_repo_id("whisper", "small"),
            "openai/whisper-small"
        );
        assert_eq!(
            resolve_huggingface_repo_id("whisper", "openai/whisper-large-v3"),
            "Systran/faster-whisper-large-v3"
        );
    }

    #[test]
    fn legacy_whisper_repo_keeps_openai_prefix() {
        assert_eq!(
            legacy_huggingface_repo_id_for_model("whisper", "openai/whisper-large-v2"),
            Some("openai/whisper-large-v2".to_string())
        );
        assert_eq!(
            legacy_huggingface_repo_id_for_model("whisper", "small"),
            None
        );
        assert_eq!(legacy_huggingface_repo_id_for_model("parakeet", "x"), None);
    }

    #[test]
    fn normalize_huggingface_path_rejects_absolute_and_parent_segments() {
        assert!(normalize_huggingface_relative_path("/etc/passwd").is_err());
        assert!(normalize_huggingface_relative_path("../secret").is_err());
        assert!(normalize_huggingface_relative_path("a/../secret").is_err());
        assert!(normalize_huggingface_relative_path("").is_err());
        assert_eq!(
            normalize_huggingface_relative_path("onnx/model.onnx").unwrap(),
            PathBuf::from("onnx/model.onnx")
        );
        assert_eq!(
            normalize_huggingface_relative_path("./model.safetensors").unwrap(),
            PathBuf::from("model.safetensors")
        );
    }

    #[test]
    fn should_download_filters_gitattributes_docs_and_media() {
        assert!(!should_download_huggingface_stt_file(".gitattributes"));
        assert!(!should_download_huggingface_stt_file("README.md"));
        assert!(!should_download_huggingface_stt_file("assets/logo.png"));
        assert!(!should_download_huggingface_stt_file("plots/loss.png"));
        assert!(!should_download_huggingface_stt_file("sample.wav"));
        assert!(should_download_huggingface_stt_file("model.safetensors"));
        assert!(should_download_huggingface_stt_file("config.json"));
    }

    #[test]
    fn select_entries_prefers_primary_then_supports_parakeet_fallback() {
        let entries = vec![
            entry("README.md"),
            entry("tokenizer_config.json"),
            entry("model.bin"),
            entry("parakeet-tdt-0.6b-v3.nemo"),
            entry("config.json"),
        ];
        let selected = select_huggingface_stt_download_entries(
            "nvidia/parakeet-tdt-0.6b-v3",
            &entries,
        );
        let names: Vec<String> = selected
            .iter()
            .map(|(path, _)| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert!(names.contains(&"parakeet-tdt-0.6b-v3.nemo".to_string()));
        assert!(names.contains(&"config.json".to_string()));
        assert!(names.contains(&"tokenizer_config.json".to_string()));
        assert!(!names.contains(&"README.md".to_string()));
    }

    #[test]
    fn select_entries_generic_fallback_uses_weight_extension() {
        let entries = vec![entry("model.safetensors"), entry("settings.json")];
        let selected = select_huggingface_stt_download_entries("SomeOrg/anything", &entries);
        let names: Vec<String> = selected
            .iter()
            .map(|(path, _)| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["model.safetensors".to_string()]);
    }
}