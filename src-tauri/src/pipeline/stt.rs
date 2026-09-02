//! Pipeline STT (Speech-to-Text) orchestration.
//!
//! This module owns the sequencing logic for transcription:
//! - Dispatching to online or local STT backends
//! - Hallucination detection
//! - Repetitive noise detection
//! - Transcript refinement
//!
//! The actual STT implementations (HTTP calls, Parakeet, Python bridge)
//! remain in `lib.rs` as they require runtime state.

/// Normalize a language hint for STT.
pub fn normalize_stt_language_hint(raw: Option<&str>) -> Option<String> {
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
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

/// Normalize a list of allowed languages for STT.
pub fn normalize_stt_allowed_languages(raw: Option<&[String]>) -> Vec<String> {
    let Some(values) = raw else {
        return Vec::new();
    };

    let mut normalized = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
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

/// Check if a transcript is a known STT hallucination.
pub fn is_known_stt_hallucination(transcript: &str) -> bool {
    let trimmed = transcript.trim();
    if trimmed.is_empty() {
        return true;
    }

    let lower = trimmed.to_ascii_lowercase();

    let known_hallucinations: &[&str] = &[
        ".", "..", "...", ",", "?", "!", "you", "i", "a", "thank you.", "thank you",
        "thanks for watching.", "thanks for watching", "thank you for watching.",
        "thank you for watching", "thanks for watching!", "you", "i", "uh", "mm", "okay.",
        "yeah.", "thank you for watching i'll see you in the next video", "thanks for watching",
        "thank you", "thank you!", "thank you.", "thanks.",
    ];

    if known_hallucinations.contains(&lower.as_str()) {
        return true;
    }

    if lower.starts_with("thank you") && trimmed.len() < 80 {
        return true;
    }
    if lower.starts_with("thanks for watching") && trimmed.len() < 80 {
        return true;
    }

    let alpha: Vec<char> = trimmed.chars().filter(|c| c.is_alphabetic()).collect();
    if alpha.len() <= 2 && trimmed.len() <= 4 {
        return true;
    }

    false
}

/// Check if a transcript looks like repetitive noise.
pub fn looks_like_repetitive_transcript_noise(
    input: &str,
    language_hint: Option<&str>,
) -> bool {
    use std::collections::HashMap;

    let compact: Vec<char> = input.chars().filter(|ch| ch.is_alphabetic()).collect();
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

/// Whether a language typically uses Latin script.
fn language_prefers_latin_script(language: &str) -> bool {
    matches!(language, "en" | "es" | "fr" | "de" | "it" | "pt")
}

/// Whether a character is a Latin script letter.
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

/// Get the effective language hint from request fields.
pub fn effective_language_hint(
    language: Option<&str>,
    allowed_languages: Option<&[String]>,
) -> Option<String> {
    normalize_stt_language_hint(language).or_else(|| {
        normalize_stt_allowed_languages(allowed_languages)
            .first()
            .cloned()
    })
}

// ===== Tests =====

#[cfg(test)]
mod tests {
    use super::*;

    // ===== normalize_stt_language_hint =====

    #[test]
    fn normalizes_full_language_names() {
        assert_eq!(normalize_stt_language_hint(Some("English")), Some("en".to_string()));
        assert_eq!(normalize_stt_language_hint(Some("Spanish")), Some("es".to_string()));
        assert_eq!(normalize_stt_language_hint(Some("french")), Some("fr".to_string()));
    }

    #[test]
    fn normalizes_iso_codes() {
        assert_eq!(normalize_stt_language_hint(Some("en")), Some("en".to_string()));
        assert_eq!(normalize_stt_language_hint(Some("en-US")), Some("en".to_string()));
    }

    #[test]
    fn filters_auto_detection() {
        assert_eq!(normalize_stt_language_hint(Some("auto")), None);
        assert_eq!(normalize_stt_language_hint(Some("auto-detect")), None);
        assert_eq!(normalize_stt_language_hint(Some("none")), None);
    }

    #[test]
    fn handles_empty_input() {
        assert_eq!(normalize_stt_language_hint(None), None);
        assert_eq!(normalize_stt_language_hint(Some("")), None);
        assert_eq!(normalize_stt_language_hint(Some("  ")), None);
    }

    // ===== normalize_stt_allowed_languages =====

    #[test]
    fn deduplicates_languages() {
        let langs = vec!["en".to_string(), "en".to_string(), "es".to_string()];
        let result = normalize_stt_allowed_languages(Some(&langs));
        assert_eq!(result, vec!["en".to_string(), "es".to_string()]);
    }

    #[test]
    fn filters_auto_detect_languages() {
        let langs = vec!["en".to_string(), "auto".to_string(), "fr".to_string()];
        let result = normalize_stt_allowed_languages(Some(&langs));
        assert_eq!(result, vec!["en".to_string(), "fr".to_string()]);
    }

    // ===== is_known_stt_hallucination =====

    #[test]
    fn detects_known_hallucinations() {
        assert!(is_known_stt_hallucination("thank you"));
        assert!(is_known_stt_hallucination("Thanks for watching."));
        assert!(is_known_stt_hallucination("uh"));
        assert!(is_known_stt_hallucination("mm"));
    }

    #[test]
    fn accepts_valid_transcripts() {
        assert!(!is_known_stt_hallucination("Hello, how are you?"));
        assert!(!is_known_stt_hallucination("The quick brown fox jumps over the lazy dog."));
    }

    #[test]
    fn empty_is_hallucination() {
        assert!(is_known_stt_hallucination(""));
        assert!(is_known_stt_hallucination("   "));
    }

    // ===== looks_like_repetitive_transcript_noise =====

    #[test]
    fn detects_repetitive_noise() {
        assert!(looks_like_repetitive_transcript_noise("aaaaaaaaaaaaaaaaaaaa", Some("en")));
    }

    #[test]
    fn accepts_normal_transcript() {
        assert!(!looks_like_repetitive_transcript_noise(
            "Hello, this is a normal transcript with reasonable content.",
            Some("en")
        ));
    }
}
