//! Wake-word matcher.
//!
//! Pure transcript parsing that detects "<prefix> <assistant-name>" wake
//! phrases (with tolerant matching for misspellings, filler words, and
//! phonetic variants) and extracts the trailing command. No Tauri, no
//! AppState, no I/O.
//!
//! Matching is Unicode-aware: tokens are NFKD-folded and lowercased, edit
//! distance is measured in chars, so accented and non-Latin assistant names
//! match as well as ASCII ones.

use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

/// Comparison form: NFKD, combining marks dropped, lowercased.
fn fold_for_match(raw: &str) -> String {
    raw.nfkd()
        .filter(|character| !is_combining_mark(*character))
        .flat_map(|character| character.to_lowercase())
        .collect()
}

// Combining marks count as token chars so decomposed diacritics
// ("cafe\u{301}") stay inside one token and fold away cleanly.
fn is_token_char(character: char) -> bool {
    character.is_alphanumeric() || is_combining_mark(character)
}

fn wake_name_tokens(raw_name: &str) -> Vec<String> {
    fold_for_match(raw_name)
        .split(|character: char| !is_token_char(character))
        .filter(|token| !token.is_empty())
        .map(str::to_string)
        .collect()
}

fn skip_non_token_chars(input: &str, mut index: usize) -> usize {
    while index < input.len() {
        let Some(character) = input[index..].chars().next() else {
            break;
        };
        if is_token_char(character) {
            break;
        }
        index += character.len_utf8();
    }
    index
}

fn consume_next_token(input: &str, index: usize) -> Option<(String, usize)> {
    let mut cursor = index;
    loop {
        let start = skip_non_token_chars(input, cursor);
        if start >= input.len() {
            return None;
        }

        cursor = start;
        while cursor < input.len() {
            let current = input[cursor..].chars().next()?;
            if !is_token_char(current) {
                break;
            }
            cursor += current.len_utf8();
        }

        let folded = fold_for_match(&input[start..cursor]);
        if !folded.is_empty() {
            return Some((folded, cursor));
        }
        // Token was pure combining marks; keep scanning from `cursor`.
    }
}

fn within_one_edit(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }

    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();

    if a.len().abs_diff(b.len()) > 1 {
        return false;
    }

    if a.len() == b.len() {
        let mut mismatches = 0usize;
        for (left, right) in a.iter().zip(b.iter()) {
            if left != right {
                mismatches += 1;
                if mismatches > 1 {
                    return false;
                }
            }
        }
        return mismatches <= 1;
    }

    let (shorter, longer) = if a.len() < b.len() {
        (&a, &b)
    } else {
        (&b, &a)
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

fn within_n_edits(a: &str, b: &str, max_edits: usize) -> bool {
    if a == b {
        return true;
    }

    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.len().abs_diff(b.len()) > max_edits {
        return false;
    }

    let mut previous: Vec<usize> = (0..=b.len()).collect();
    let mut current: Vec<usize> = vec![0; b.len() + 1];

    for (row_index, a_char) in a.iter().enumerate() {
        current[0] = row_index + 1;
        let mut row_min = current[0];
        for (col_index, b_char) in b.iter().enumerate() {
            let substitution_cost = if a_char == b_char { 0 } else { 1 };
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

    previous[b.len()] <= max_edits
}

/// Consonant skeleton used for phonetic fallback matching.
///
/// Latin vowels are dropped (they carry little consonant signal); every other
/// script keeps all its letters, since vowel stripping is not defined there.
fn consonant_signature(raw: &str) -> String {
    let mut output = String::new();
    let mut last: Option<char> = None;
    for character in fold_for_match(raw).chars() {
        if !character.is_alphabetic() {
            continue;
        }
        if character.is_ascii() && matches!(character, 'a' | 'e' | 'i' | 'o' | 'u') {
            continue;
        }
        if Some(character) == last {
            continue;
        }
        output.push(character);
        last = Some(character);
    }
    output
}

fn assistant_name_token_matches(expected: &str, actual: &str) -> bool {
    let expected = fold_for_match(expected);
    let actual = fold_for_match(actual);

    if expected == actual {
        return true;
    }

    if expected.chars().count() < 3 || actual.chars().count() < 3 {
        return false;
    }

    if within_one_edit(&expected, &actual) {
        return true;
    }

    if expected.chars().count() <= 5 && within_n_edits(&expected, &actual, 2) {
        return true;
    }

    if let Some(tail) = actual.strip_prefix('h') {
        if !tail.is_empty() && within_n_edits(&expected, tail, 2) {
            return true;
        }

        let expected_signature = consonant_signature(&expected);
        let tail_signature = consonant_signature(tail);
        if !expected_signature.is_empty() && !tail_signature.is_empty() {
            let starts_alike = expected_signature
                .chars()
                .next()
                .zip(tail_signature.chars().next())
                .map(|(left, right)| left == right)
                .unwrap_or(false);
            if starts_alike && within_n_edits(&expected_signature, &tail_signature, 1) {
                return true;
            }
        }
    }

    false
}

fn consume_assistant_name_token(input: &str, index: usize, expected: &str) -> Option<usize> {
    let (actual, next_cursor) = consume_next_token(input, index)?;
    if assistant_name_token_matches(expected, &actual) {
        Some(next_cursor)
    } else {
        None
    }
}

fn wake_prefix_token_matches(expected: &str, actual: &str) -> bool {
    let expected = fold_for_match(expected);
    let actual = fold_for_match(actual);

    if expected == actual {
        return true;
    }

    if (expected == "ok" && actual == "okay") || (expected == "okay" && actual == "ok") {
        return true;
    }

    if expected.chars().count() >= 3 && within_one_edit(&expected, &actual) {
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

pub(crate) fn extract_wake_command(transcript: &str, assistant_name: &str) -> Option<String> {
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
        let Some((token, next_cursor)) = consume_next_token(transcript, filler_cursor) else {
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
                let Some((actual, next_cursor)) = consume_next_token(transcript, cursor) else {
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

#[cfg(test)]
mod tests {
    use super::*;

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
        let command =
            extract_wake_command("He Lily draft a follow up email", "Lily").unwrap_or_default();
        assert_eq!(command, "draft a follow up email");
    }

    // ===== Wake phrase edge cases =====

    #[test]
    fn wake_phrase_empty_input_returns_none() {
        assert!(extract_wake_command("", "Lily").is_none());
    }

    #[test]
    fn wake_phrase_empty_name_defaults_to_lily() {
        // With empty assistant name, defaults to "lily".
        // "Hey summarize this" doesn't contain "lily", so no wake phrase found.
        assert!(extract_wake_command("Hey summarize this", "").is_none());
        // But "Hey Lily summarize this" does match.
        assert!(extract_wake_command("Hey Lily summarize this", "").is_some());
    }

    #[test]
    fn wake_phrase_very_long_command() {
        let long_command = "summarize this very long document that goes on and on and on";
        let input = format!("Hey Lily {long_command}");
        let command = extract_wake_command(&input, "Lily").unwrap_or_default();
        assert_eq!(command, long_command);
    }

    // ===== Unicode assistant names =====

    #[test]
    fn matches_accented_latin_name() {
        let command = extract_wake_command("Hey José summarize this", "José").unwrap_or_default();
        assert_eq!(command, "summarize this");
    }

    #[test]
    fn matches_accented_name_written_without_diacritics() {
        let command = extract_wake_command("Hey Jose summarize this", "José").unwrap_or_default();
        assert_eq!(command, "summarize this");
    }

    #[test]
    fn matches_name_with_decomposed_diacritics() {
        // "cafe\u{301}" is NFKD-decomposed "café"; folding must reunite them.
        let command =
            extract_wake_command("Hey cafe\u{301} open settings", "café").unwrap_or_default();
        assert_eq!(command, "open settings");
    }

    #[test]
    fn matches_cyrillic_name() {
        let command = extract_wake_command("Hey Нова summarise this", "Нова").unwrap_or_default();
        assert_eq!(command, "summarise this");
    }

    #[test]
    fn matches_devanagari_name() {
        let command = extract_wake_command("Hey नोवा open settings", "नोवा").unwrap_or_default();
        assert_eq!(command, "open settings");
    }

    #[test]
    fn matches_cjk_name() {
        let command = extract_wake_command("Hey 小美 summarize this", "小美").unwrap_or_default();
        assert_eq!(command, "summarize this");
    }

    #[test]
    fn rejects_different_cyrillic_name() {
        assert!(extract_wake_command("Hey Анна open settings", "Нова").is_none());
    }

    #[test]
    fn unicode_name_does_not_leak_ascii_only_assumptions() {
        // A non-Latin name must not be silently treated as empty and fall back
        // to the "lily" default.
        assert!(extract_wake_command("Hey Lily open settings", "Нова").is_none());
    }
}
