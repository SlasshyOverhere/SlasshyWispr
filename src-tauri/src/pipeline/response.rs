//! Pipeline response post-processing.
//!
//! This module owns response normalization, echo detection, and draft validation.
//! It is pure — no Tauri, no network, no runtime state.

/// Strip a wrapped markdown code block from AI output.
pub fn strip_wrapped_markdown_block(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.starts_with("```") && trimmed.ends_with("```") && trimmed.len() >= 6 {
        let mut inner = &trimmed[3..trimmed.len() - 3];
        inner = inner.trim_start_matches(|ch: char| ch.is_ascii_alphabetic());
        inner = inner.strip_prefix('\n').unwrap_or(inner);
        return inner.trim().to_string();
    }
    trimmed.to_string()
}

/// Extract a braced LaTeX segment starting at position 0.
fn extract_braced_latex_segment(input: &str) -> Option<(String, usize)> {
    let mut depth = 0usize;
    let mut content = String::new();

    for (index, ch) in input.char_indices() {
        if index == 0 {
            if ch != '{' {
                return None;
            }
            depth = 1;
            continue;
        }

        match ch {
            '{' => {
                depth += 1;
                content.push(ch);
            }
            '}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some((content, index + ch.len_utf8()));
                }
                content.push(ch);
            }
            _ => content.push(ch),
        }
    }

    None
}

/// Replace LaTeX fractions with ASCII equivalents.
fn replace_latex_fractions(input: &str) -> String {
    let mut output = String::new();
    let mut cursor = 0usize;

    while let Some(relative_index) = input[cursor..].find("\\frac") {
        let start = cursor + relative_index;
        output.push_str(&input[cursor..start]);
        let mut tail = &input[start + "\\frac".len()..];
        let trimmed_tail = tail.trim_start();
        let whitespace_offset = tail.len().saturating_sub(trimmed_tail.len());
        tail = trimmed_tail;

        let Some((numerator, numerator_end)) = extract_braced_latex_segment(tail) else {
            output.push_str("\\frac");
            cursor = start + "\\frac".len();
            continue;
        };
        let denominator_tail = &tail[numerator_end..];
        let denominator_trimmed = denominator_tail.trim_start();
        let denominator_whitespace = denominator_tail
            .len()
            .saturating_sub(denominator_trimmed.len());
        let Some((denominator, denominator_end)) =
            extract_braced_latex_segment(denominator_trimmed)
        else {
            output.push_str("\\frac");
            cursor = start + "\\frac".len();
            continue;
        };

        output.push('(');
        output.push_str(normalize_assistant_response_text(&numerator).trim());
        output.push_str(") / (");
        output.push_str(normalize_assistant_response_text(&denominator).trim());
        output.push(')');

        cursor = start
            + "\\frac".len()
            + whitespace_offset
            + numerator_end
            + denominator_whitespace
            + denominator_end;
    }

    output.push_str(&input[cursor..]);
    output
}

/// Normalize an assistant response text (LaTeX, markdown, spacing).
pub fn normalize_assistant_response_text(input: &str) -> String {
    let mut normalized = strip_wrapped_markdown_block(input);
    if normalized.is_empty() {
        return normalized;
    }

    normalized = replace_latex_fractions(&normalized);

    for (from, to) in [
        ("\\(", ""),
        ("\\)", ""),
        ("\\[", ""),
        ("\\]", ""),
        ("\\left", ""),
        ("\\right", ""),
        ("\\times", " x "),
        ("\\cdot", " * "),
        ("\\div", " / "),
        ("\\Longrightarrow", " => "),
        ("\\Rightarrow", " => "),
        ("\\rightarrow", " -> "),
        ("\\to", " -> "),
        ("\\geq", " >= "),
        ("\\leq", " <= "),
        ("\\neq", " != "),
        ("\\approx", " approx "),
        ("\\;", " "),
        ("\\,", " "),
        ("\\!", ""),
        ("**", ""),
        ("__", ""),
    ] {
        normalized = normalized.replace(from, to);
    }

    let mut cleaned_lines = Vec::new();
    let mut previous_blank = false;
    for line in normalized.lines() {
        let compact = line.split_whitespace().collect::<Vec<_>>().join(" ");
        let trimmed = compact.trim();
        if trimmed.is_empty() {
            if !previous_blank {
                cleaned_lines.push(String::new());
            }
            previous_blank = true;
            continue;
        }
        cleaned_lines.push(trimmed.to_string());
        previous_blank = false;
    }

    cleaned_lines.join("\n").trim().to_string()
}

/// Normalize text for echo checking (lowercase, collapse whitespace).
pub fn normalize_text_for_echo_check(input: &str) -> String {
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

/// Strip common command prefixes from normalized text.
pub fn strip_command_prefix(input: &str) -> String {
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

/// Detect if a command is a direct question.
pub fn looks_like_direct_question(input: &str) -> bool {
    let raw = input.trim();
    if raw.is_empty() {
        return false;
    }
    let normalized = normalize_text_for_echo_check(input);
    raw.contains('?')
        || [
            "what ", "who ", "when ", "where ", "why ", "how ", "is ", "are ", "do ", "does ",
            "did ", "can ", "could ", "would ", "tell me ",
        ]
        .iter()
        .any(|prefix| normalized.starts_with(prefix))
}

/// Detect if an AI response echoes the user's question.
pub fn looks_like_question_echo(command: &str, response: &str) -> bool {
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
    if response_stripped.ends_with(&command_stripped)
        || command_stripped.ends_with(&response_stripped)
    {
        return true;
    }
    false
}

// ===== Tests =====

#[cfg(test)]
mod tests {
    use super::*;

    // ===== strip_wrapped_markdown_block =====

    #[test]
    fn strips_markdown_code_block() {
        assert_eq!(strip_wrapped_markdown_block("```markdown\nHello\n```"), "Hello");
        assert_eq!(strip_wrapped_markdown_block("```rust\nfn main() {}\n```"), "fn main() {}");
        assert_eq!(strip_wrapped_markdown_block("plain text"), "plain text");
    }

    // ===== normalize_assistant_response_text =====

    #[test]
    fn normalizes_latex_commands() {
        let input = "The formula is \\(x^2\\) and \\[y = mx + b\\]";
        let result = normalize_assistant_response_text(input);
        assert!(!result.contains("\\("));
        assert!(!result.contains("\\)"));
    }

    #[test]
    fn normalizes_latex_fractions() {
        let input = "The result is \\frac{a}{b}";
        let result = normalize_assistant_response_text(input);
        assert!(result.contains("(a) / (b)"));
    }

    #[test]
    fn collapses_blank_lines() {
        let input = "Line 1\n\n\n\nLine 2";
        let result = normalize_assistant_response_text(input);
        assert_eq!(result, "Line 1\n\nLine 2");
    }

    // ===== looks_like_direct_question =====

    #[test]
    fn detects_questions() {
        assert!(looks_like_direct_question("What is the capital of France?"));
        assert!(looks_like_direct_question("Who is the president"));
        assert!(looks_like_direct_question("how does TCP work"));
    }

    #[test]
    fn rejects_non_questions() {
        assert!(!looks_like_direct_question("Make this better"));
        assert!(!looks_like_direct_question(""));
    }

    // ===== looks_like_question_echo =====

    #[test]
    fn detects_exact_echo() {
        assert!(looks_like_question_echo("What time is it?", "What time is it?"));
    }

    #[test]
    fn rejects_non_echo() {
        assert!(!looks_like_question_echo("What time is it?", "It's 3 PM."));
    }
}
