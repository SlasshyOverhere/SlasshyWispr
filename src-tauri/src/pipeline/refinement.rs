//! Pure transcript refinement pipeline.
//!
//! Transforms raw STT output through a configurable chain of text
//! normalizations: snippet expansion, dictionary substitution, backtrack
//! correction, filler-word removal, numbered-list formatting, and
//! automatic punctuation.
//!
//! This module is **entirely pure** — no Tauri, no AppState, no I/O,
//! no global state. It depends only on `pipeline::tts::normalize_spacing`
//! for final whitespace normalization.

use crate::pipeline::tts::normalize_spacing;

/// Configuration for the transcript refinement pipeline.
///
/// Each field controls whether a specific transformation stage is active.
/// Snippet and dictionary entries provide user-defined text substitutions.
#[derive(Debug, Clone)]
pub struct RefinementConfig {
    /// When true, skip all refinement except basic spacing normalization.
    pub raw_mode: bool,
    /// Apply case-insensitive snippet expansions (trigger → expansion).
    pub snippet_entries: Vec<RefinementSnippetEntry>,
    /// Apply case-insensitive dictionary substitutions (source → target).
    pub dictionary_entries: Vec<RefinementDictionaryEntry>,
    /// Remove trailing backtrack phrases ("scratch that", "delete that", etc.).
    pub apply_backtrack: bool,
    /// Remove filler words ("um", "uh", "you know", etc.).
    pub remove_fillers: bool,
    /// Format "numbered list … next item …" as an actual numbered list.
    pub auto_numbered_lists: bool,
    /// Replace spoken punctuation ("comma", "period", etc.) and ensure trailing punctuation.
    pub auto_punctuation: bool,
}

/// A user-defined snippet expansion: when `trigger` appears in the transcript
/// (case-insensitive), it is replaced with `expansion`.
#[derive(Debug, Clone)]
pub struct RefinementSnippetEntry {
    pub trigger: String,
    pub expansion: String,
}

/// A user-defined dictionary substitution: when `source` appears in the
/// transcript (case-insensitive), it is replaced with `target`.
#[derive(Debug, Clone)]
pub struct RefinementDictionaryEntry {
    pub source: String,
    pub target: String,
}

/// Apply the full transcript refinement pipeline.
///
/// Transformation order (preserved exactly from the original implementation):
/// 1. Trim input
/// 2. If `raw_mode`, return with only spacing normalization
/// 3. Snippet expansions
/// 4. Dictionary substitutions
/// 5. Backtrack correction
/// 6. Filler-word removal
/// 7. Numbered-list formatting
/// 8. Auto-punctuation
/// 9. Final spacing normalization
pub fn refine_transcript(input: &str, config: &RefinementConfig) -> String {
    let mut transcript = input.trim().to_string();

    if config.raw_mode {
        return normalize_spacing(&transcript);
    }

    if !config.snippet_entries.is_empty() {
        transcript = apply_snippet_expansions(&transcript, &config.snippet_entries);
    }

    if !config.dictionary_entries.is_empty() {
        transcript = apply_dictionary_terms(&transcript, &config.dictionary_entries);
    }

    if config.apply_backtrack {
        transcript = apply_backtrack_correction(&transcript);
    }

    if config.remove_fillers {
        transcript = remove_filler_words(&transcript);
    }

    if config.auto_numbered_lists {
        transcript = apply_numbered_list_formatting(&transcript);
    }

    if config.auto_punctuation {
        transcript = apply_auto_punctuation(&transcript);
    }

    normalize_spacing(&transcript)
}

/// Replace each snippet trigger with its expansion (case-insensitive ASCII matching).
fn apply_snippet_expansions(input: &str, snippets: &[RefinementSnippetEntry]) -> String {
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

/// Replace each dictionary source term with its target (case-insensitive ASCII matching).
fn apply_dictionary_terms(input: &str, entries: &[RefinementDictionaryEntry]) -> String {
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

/// Remove the last backtrack phrase and everything after it.
///
/// Recognized markers: "scratch that", "delete that", "undo that", "backtrack".
/// Only triggers when the marker is preceded by a word boundary and followed
/// by nothing (i.e., it is the trailing instruction).
fn apply_backtrack_correction(input: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let markers = ["scratch that", "delete that", "undo that", "backtrack"];
    let last_marker = markers
        .iter()
        .filter_map(|marker| {
            lower.rfind(marker).and_then(|index| {
                let has_boundary = index == 0
                    || !lower.as_bytes()[index - 1].is_ascii_alphanumeric();
                if !has_boundary {
                    return None;
                }
                Some((index, *marker))
            })
        })
        .max_by_key(|(index, _)| *index);

    if let Some((index, marker)) = last_marker {
        let after = input[index + marker.len()..].trim();
        if after.is_empty() {
            let before = input[..index].trim();
            if !before.is_empty() {
                return before.to_string();
            }
        }
    }
    input.to_string()
}

/// Remove filler words and phrases from the transcript.
///
/// Phrase fillers ("you know", "i mean", etc.) are replaced with a space.
/// Single-word fillers ("um", "uh", etc.) are dropped during token iteration.
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

/// Format "numbered list …" transcripts as actual numbered lists.
///
/// Looks for "numbered list" as a spoken instruction, then splits on
/// "next item" separators and formats as "1. item\n2. item\n…".
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

/// Replace spoken punctuation tokens with their symbols and ensure trailing punctuation.
///
/// Replaces: "new paragraph", "new line", "question mark", "exclamation mark",
/// "semicolon", "colon", "comma", "period". Then cleans up stray spaces before
/// punctuation and appends a period if the result doesn't already end with
/// sentence-ending punctuation.
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

/// ASCII case-insensitive substring replacement.
///
/// Finds all occurrences of `needle` in `input` (matching case-insensitively
/// on ASCII characters only) and replaces them with `replacement`.
/// Preserves the casing of non-matching portions of the input.
pub(crate) fn replace_case_insensitive_ascii(input: &str, needle: &str, replacement: &str) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn config(
        backtrack: bool,
        fillers: bool,
        punctuation: bool,
        numbered_lists: bool,
    ) -> RefinementConfig {
        RefinementConfig {
            raw_mode: false,
            snippet_entries: Vec::new(),
            dictionary_entries: Vec::new(),
            apply_backtrack: backtrack,
            remove_fillers: fillers,
            auto_numbered_lists: numbered_lists,
            auto_punctuation: punctuation,
        }
    }

    fn config_all_disabled() -> RefinementConfig {
        config(false, false, false, false)
    }

    fn config_all_enabled() -> RefinementConfig {
        config(true, true, true, true)
    }

    // ===== replace_case_insensitive_ascii =====

    #[test]
    fn case_insensitive_replacement_basic() {
        let result = replace_case_insensitive_ascii("Hello World", "world", "rust");
        assert_eq!(result, "Hello rust");
    }

    #[test]
    fn case_insensitive_replacement_no_match() {
        let result = replace_case_insensitive_ascii("Hello World", "xyz", "abc");
        assert_eq!(result, "Hello World");
    }

    #[test]
    fn case_insensitive_replacement_empty_needle() {
        let result = replace_case_insensitive_ascii("Hello", "", "x");
        assert_eq!(result, "Hello");
    }

    #[test]
    fn case_insensitive_replacement_multiple_occurrences() {
        let result = replace_case_insensitive_ascii("aAaBbAa", "aa", "X");
        assert_eq!(result, "XBbX");
    }

    // ===== refine_transcript — raw mode =====

    #[test]
    fn raw_mode_skips_all_refinements() {
        let mut cfg = config_all_enabled();
        cfg.raw_mode = true;
        let output = refine_transcript("um write this exactly", &cfg);
        assert_eq!(output, "um write this exactly");
    }

    // ===== refine_transcript — disabled toggles =====

    #[test]
    fn respects_disabled_toggles() {
        let output = refine_transcript("um write this exactly", &config_all_disabled());
        assert_eq!(output, "um write this exactly");
    }

    // ===== refine_transcript — filler removal =====

    #[test]
    fn keeps_meaningful_like() {
        let output = refine_transcript(
            "um I would like this approach",
            &config(false, true, false, false),
        );
        assert_eq!(output, "I would like this approach");
    }

    // ===== refine_transcript — numbered lists =====

    #[test]
    fn applies_numbered_lists_when_enabled() {
        let output = refine_transcript(
            "numbered list apples next item oranges",
            &config(false, false, false, true),
        );
        assert_eq!(output, "1. apples\n2. oranges");
    }

    // ===== refine_transcript — auto punctuation =====

    #[test]
    fn auto_punctuation_toggle() {
        let disabled = config_all_disabled();
        let enabled = config(false, false, true, false);
        assert_eq!(
            refine_transcript("please send update", &disabled),
            "please send update"
        );
        assert_eq!(
            refine_transcript("please send update", &enabled),
            "please send update."
        );
    }

    // ===== refine_transcript — empty input =====

    #[test]
    fn empty_input() {
        let output = refine_transcript("", &config_all_enabled());
        assert_eq!(output, "");
    }

    // ===== refine_transcript — backtrack =====

    #[test]
    fn backtrack_removes_repeated_segments() {
        let output = refine_transcript(
            "Hello world hello world",
            &config(true, false, false, false),
        );
        assert!(!output.is_empty());
    }

    // ===== refine_transcript — all toggles =====

    #[test]
    fn all_toggles_enabled() {
        let output = refine_transcript(
            "um number one apples next item oranges",
            &config_all_enabled(),
        );
        assert!(!output.is_empty());
    }

    // ===== apply_backtrack_correction =====

    #[test]
    fn backtrack_removes_trailing_scratch_that() {
        let output = apply_backtrack_correction("Hello world scratch that");
        assert_eq!(output, "Hello world");
    }

    #[test]
    fn backtrack_removes_trailing_delete_that() {
        let output = apply_backtrack_correction("Some text delete that");
        assert_eq!(output, "Some text");
    }

    #[test]
    fn backtrack_noop_when_no_marker() {
        let input = "Hello world";
        let output = apply_backtrack_correction(input);
        assert_eq!(output, input);
    }

    #[test]
    fn backtrack_ignores_mid_text_marker() {
        let input = "Hello scratch that world";
        let output = apply_backtrack_correction(input);
        assert_eq!(output, input);
    }

    // ===== remove_filler_words =====

    #[test]
    fn removes_phrase_fillers() {
        let output = remove_filler_words("I you know think so");
        assert_eq!(output, "I think so");
    }

    #[test]
    fn removes_single_word_fillers() {
        let output = remove_filler_words("I um think so");
        assert_eq!(output, "I think so");
    }

    #[test]
    fn preserves_non_filler_words() {
        let output = remove_filler_words("Hello world");
        assert_eq!(output, "Hello world");
    }

    // ===== apply_numbered_list_formatting =====

    #[test]
    fn formats_numbered_list() {
        let output = apply_numbered_list_formatting("numbered list apples next item oranges");
        assert_eq!(output, "1. apples\n2. oranges");
    }

    #[test]
    fn noop_when_no_numbered_list_keyword() {
        let input = "just plain text";
        let output = apply_numbered_list_formatting(input);
        assert_eq!(output, input);
    }

    #[test]
    fn single_item_returns_without_numbering() {
        let output = apply_numbered_list_formatting("numbered list apples");
        assert_eq!(output, "apples");
    }

    // ===== apply_auto_punctuation =====

    #[test]
    fn replaces_spoken_comma() {
        let output = apply_auto_punctuation("hello comma world");
        assert_eq!(output, "hello, world.");
    }

    #[test]
    fn replaces_spoken_question_mark() {
        let output = apply_auto_punctuation("is that right question mark");
        assert_eq!(output, "is that right?");
    }

    #[test]
    fn appends_period_if_missing() {
        let output = apply_auto_punctuation("hello world");
        assert_eq!(output, "hello world.");
    }

    #[test]
    fn does_not_double_period() {
        let output = apply_auto_punctuation("hello world period");
        assert_eq!(output, "hello world.");
    }

    #[test]
    fn preserves_existing_punctuation() {
        let output = apply_auto_punctuation("hello world?");
        assert_eq!(output, "hello world?");
    }

    // ===== snippet expansion =====

    #[test]
    fn snippet_expansion_replaces_trigger() {
        let cfg = RefinementConfig {
            raw_mode: false,
            snippet_entries: vec![RefinementSnippetEntry {
                trigger: "btw".to_string(),
                expansion: "by the way".to_string(),
            }],
            dictionary_entries: Vec::new(),
            apply_backtrack: false,
            remove_fillers: false,
            auto_numbered_lists: false,
            auto_punctuation: false,
        };
        let output = refine_transcript("Hello btw world", &cfg);
        assert_eq!(output, "Hello by the way world");
    }

    // ===== dictionary expansion =====

    #[test]
    fn dictionary_expansion_replaces_source() {
        let cfg = RefinementConfig {
            raw_mode: false,
            snippet_entries: Vec::new(),
            dictionary_entries: vec![RefinementDictionaryEntry {
                source: "foo".to_string(),
                target: "bar".to_string(),
            }],
            apply_backtrack: false,
            remove_fillers: false,
            auto_numbered_lists: false,
            auto_punctuation: false,
        };
        let output = refine_transcript("Hello foo world", &cfg);
        assert_eq!(output, "Hello bar world");
    }
}
