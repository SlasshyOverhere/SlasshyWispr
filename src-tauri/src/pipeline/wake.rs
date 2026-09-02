//! Wake-word matcher.
//!
//! Pure transcript parsing that detects "<prefix> <assistant-name>" wake
//! phrases (with tolerant matching for misspellings, filler words, and
//! phonetic variants) and extracts the trailing command. No Tauri, no
//! AppState, no I/O.

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
    if expected_normalized.len() <= 5
        && within_n_edits_ascii(&expected_normalized, &actual_normalized, 2)
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
}