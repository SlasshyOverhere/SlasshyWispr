//! Selection-editing state machine.
//!
//! This module owns the pure logic for:
//! - Parsing LLM selection-edit decisions
//! - Classifying confirmation responses
//! - Detecting suspicious rewrites
//! - Detecting edit/draft/query intents
//! - Detecting incomplete draft outputs
//! - Orchestration of the selection-edit decision process
//!
//! It is pure — no Tauri, no network, no `AppState`.

use serde_json::Value;

use super::response::strip_wrapped_markdown_block;

// ===== Types =====

/// The action the LLM recommends for a selection edit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelectionEditAction {
    ReplaceNow,
    AskConfirm,
    NoEdit,
}

/// A parsed selection-edit decision from the LLM.
#[derive(Debug, Clone)]
pub struct SelectionEditDecision {
    pub action: SelectionEditAction,
    pub rewrite_text: String,
    pub message: String,
}

/// The result of classifying a user's confirmation response.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfirmationResult {
    Affirmative,
    Negative,
    Unrecognized,
}

// ===== Text normalization helpers =====

/// Normalize text to lowercase ASCII words (non-alphanumeric → space, collapse spaces).
pub fn normalize_ascii_words(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_space = true;
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_space = false;
            continue;
        }
        if !last_space {
            out.push(' ');
            last_space = true;
        }
    }
    out.trim().to_string()
}

/// Check if `haystack` contains `phrase` as a whole word boundary match.
pub fn contains_phrase(haystack: &str, phrase: &str) -> bool {
    if haystack.is_empty() || phrase.is_empty() {
        return false;
    }
    let padded_haystack = format!(" {} ", haystack);
    let padded_phrase = format!(" {} ", phrase);
    padded_haystack.contains(&padded_phrase)
}

// ===== Decision parsing =====

/// Parse a raw LLM response into a `SelectionEditDecision`.
pub fn parse_selection_edit_decision(raw: &str) -> Result<SelectionEditDecision, String> {
    let parsed = match serde_json::from_str::<Value>(raw) {
        Ok(value) => value,
        Err(_) => extract_json_value_from_output(raw).ok_or_else(|| {
            format!(
                "Invalid edit-decision JSON from AI: {}",
                &raw.chars().take(420).collect::<String>()
            )
        })?,
    };

    let action_raw = parsed
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("ask_confirm")
        .trim()
        .to_ascii_lowercase();
    let action = match action_raw.as_str() {
        "replace_now" | "replace" | "rewrite" | "apply" => SelectionEditAction::ReplaceNow,
        "ask_confirm" | "confirm" | "needs_confirmation" => SelectionEditAction::AskConfirm,
        "no_edit" | "none" | "answer" => SelectionEditAction::NoEdit,
        _ => SelectionEditAction::AskConfirm,
    };

    let rewrite_text = parsed
        .get("rewrite")
        .or_else(|| parsed.get("rewritten_text"))
        .or_else(|| parsed.get("text"))
        .and_then(Value::as_str)
        .map(strip_wrapped_markdown_block)
        .unwrap_or_default()
        .trim()
        .to_string();
    let message = parsed
        .get("message")
        .or_else(|| parsed.get("reason"))
        .or_else(|| parsed.get("note"))
        .and_then(Value::as_str)
        .map(strip_wrapped_markdown_block)
        .unwrap_or_default()
        .trim()
        .to_string();

    if matches!(
        action,
        SelectionEditAction::ReplaceNow | SelectionEditAction::AskConfirm
    ) && rewrite_text.is_empty()
    {
        return Ok(SelectionEditDecision {
            action: SelectionEditAction::NoEdit,
            rewrite_text: String::new(),
            message: "I could not produce a usable rewrite from that request.".to_string(),
        });
    }

    Ok(SelectionEditDecision {
        action,
        rewrite_text,
        message,
    })
}

/// Try to extract a JSON value from mixed text output (e.g., JSON embedded in markdown).
fn extract_json_value_from_output(raw: &str) -> Option<Value> {
    let trimmed = raw.trim();
    // Try to find a JSON object in the text
    if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            if end > start {
                let candidate = &trimmed[start..=end];
                if let Ok(value) = serde_json::from_str::<Value>(candidate) {
                    return Some(value);
                }
            }
        }
    }
    None
}

// ===== Action label =====

/// Return the string label for a selection edit action.
pub fn selection_action_label(action: SelectionEditAction) -> &'static str {
    match action {
        SelectionEditAction::ReplaceNow => "replace_now",
        SelectionEditAction::AskConfirm => "ask_confirm",
        SelectionEditAction::NoEdit => "no_edit",
    }
}

// ===== Word counting =====

/// Rough word count (split on whitespace).
pub fn rough_word_count(input: &str) -> usize {
    input
        .split_whitespace()
        .filter(|chunk| !chunk.trim().is_empty())
        .count()
}

// ===== Rewrite suspiciousness =====

/// Check if the instruction allows a short rewrite (e.g., "summarize", "shorten").
pub fn instruction_allows_short_rewrite(instruction: &str) -> bool {
    let normalized = normalize_ascii_words(instruction);
    [
        "summarize",
        "summary",
        "shorten",
        "brief",
        "title",
        "headline",
        "bullet",
        "keywords",
        "one line",
        "one sentence",
        "tldr",
    ]
    .iter()
    .any(|phrase| normalized.contains(phrase))
}

/// Detect if a rewrite is suspicious (overshortening, placeholders, etc.).
pub fn is_rewrite_suspicious(instruction: &str, selected_text: &str, rewrite_text: &str) -> bool {
    let selected_trimmed = selected_text.trim();
    let rewrite_trimmed = rewrite_text.trim();
    if selected_trimmed.is_empty() || rewrite_trimmed.is_empty() {
        return true;
    }

    if rewrite_trimmed.contains("<<<") || rewrite_trimmed.contains(">>>") {
        return true;
    }

    if rewrite_trimmed.contains("[insert") || rewrite_trimmed.contains("[replace") {
        return true;
    }

    if instruction_allows_short_rewrite(instruction) {
        return false;
    }

    let selected_words = rough_word_count(selected_trimmed);
    let rewrite_words = rough_word_count(rewrite_trimmed);

    if selected_words >= 16 && rewrite_words <= 5 {
        return true;
    }

    if selected_trimmed.chars().count() >= 220 && rewrite_trimmed.chars().count() <= 60 {
        return true;
    }

    false
}

// ===== Intent detection =====

/// Detect if a command is an affirmative confirmation for a pending selection rewrite.
pub fn is_affirmative_selection_confirmation(command: &str) -> bool {
    if is_negative_selection_confirmation(command) {
        return false;
    }

    let normalized = normalize_ascii_words(command);
    if normalized.is_empty() {
        return false;
    }

    [
        "yes",
        "yeah",
        "yep",
        "sure",
        "confirm",
        "apply",
        "go ahead",
        "do it",
        "replace",
        "replace it",
        "use it",
        "paste it",
        "proceed",
    ]
    .iter()
    .any(|phrase| contains_phrase(&normalized, phrase))
}

/// Detect if a command is a negative rejection for a pending selection rewrite.
pub fn is_negative_selection_confirmation(command: &str) -> bool {
    let normalized = normalize_ascii_words(command);
    if normalized.is_empty() {
        return false;
    }

    [
        "no", "nope", "cancel", "stop", "discard", "skip", "not now", "leave it", "do not", "don t",
    ]
    .iter()
    .any(|phrase| contains_phrase(&normalized, phrase))
}

/// Classify a user's response to a pending rewrite.
pub fn classify_confirmation(command: &str) -> ConfirmationResult {
    if is_negative_selection_confirmation(command) {
        ConfirmationResult::Negative
    } else if is_affirmative_selection_confirmation(command) {
        ConfirmationResult::Affirmative
    } else {
        ConfirmationResult::Unrecognized
    }
}

/// Detect if a command is a selection context query (explain, summarize, etc.).
pub fn seems_like_selection_context_query(command: &str) -> bool {
    let normalized = normalize_ascii_words(command);
    if normalized.is_empty() {
        return false;
    }
    [
        "tell me about it",
        "tell me about this",
        "about it",
        "about this",
        "explain it",
        "explain this",
        "what does this mean",
        "summarize this",
        "summarise this",
        "review this",
        "analyze this",
        "analyse this",
        "is this good",
        "what do you think about this",
    ]
    .iter()
    .any(|phrase| contains_phrase(&normalized, phrase))
}

/// Detect if a command is a selection edit instruction (improve, rewrite, etc.).
pub fn seems_like_selection_edit_instruction(command: &str) -> bool {
    let normalized = normalize_ascii_words(command);
    if normalized.is_empty() {
        return false;
    }
    let edit_verbs = [
        "improve", "rewrite", "edit", "rephrase", "fix", "correct", "polish", "refine",
    ];
    if edit_verbs
        .iter()
        .any(|phrase| contains_phrase(&normalized, phrase))
    {
        return true;
    }

    let style_rewrite_cues = [
        "shorten",
        "expand",
        "formal",
        "professional",
        "grammar",
        "typo",
    ];
    if style_rewrite_cues
        .iter()
        .any(|phrase| contains_phrase(&normalized, phrase))
    {
        return true;
    }

    let requests_better = contains_phrase(&normalized, "better");
    if requests_better {
        let asks_make = contains_phrase(&normalized, "make");
        let has_edit_verb = edit_verbs
            .iter()
            .any(|phrase| contains_phrase(&normalized, phrase));
        if asks_make || has_edit_verb {
            return true;
        }
    }

    false
}

/// Detect if a command is a draft generation instruction (write email, etc.).
pub fn seems_like_draft_generation_instruction(command: &str) -> bool {
    let normalized = normalize_ascii_words(command);
    if normalized.is_empty() {
        return false;
    }

    let draft_verbs = [
        "write", "draft", "compose", "create", "generate", "make", "prepare", "send",
    ];
    let draft_targets = [
        "email",
        "mail",
        "letter",
        "message",
        "application",
        "review",
        "proposal",
        "summary",
        "description",
        "cover letter",
        "follow up",
    ];

    let has_verb = draft_verbs
        .iter()
        .any(|phrase| contains_phrase(&normalized, phrase));
    let has_target = draft_targets
        .iter()
        .any(|phrase| contains_phrase(&normalized, phrase));
    if has_verb && has_target {
        return true;
    }

    if contains_phrase(&normalized, "make this")
        && [
            "better",
            "professional",
            "formal",
            "longer",
            "shorter",
            "clearer",
            "improve",
        ]
        .iter()
        .any(|phrase| contains_phrase(&normalized, phrase))
    {
        return true;
    }

    false
}

// ===== Output validation =====

/// Detect if a draft output looks incomplete (placeholders, trailing ellipsis, etc.).
pub fn looks_like_incomplete_draft_output(response: &str) -> bool {
    let trimmed = response.trim();
    if trimmed.is_empty() {
        return true;
    }

    let normalized = normalize_ascii_words(trimmed);
    if normalized.is_empty() {
        return true;
    }

    if trimmed.contains('[') && trimmed.contains(']') {
        return true;
    }

    if [
        "boss s name",
        "your name",
        "recipient name",
        "insert name",
        "insert date",
        "date here",
    ]
    .iter()
    .any(|phrase| contains_phrase(&normalized, phrase))
    {
        return true;
    }

    let lower_trimmed = trimmed.to_ascii_lowercase();
    if lower_trimmed.ends_with(" i am")
        || lower_trimmed.ends_with(" i will")
        || lower_trimmed.ends_with(" i have")
        || lower_trimmed.ends_with(" thanks")
    {
        return true;
    }

    let non_empty_lines = trimmed
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count();
    if contains_phrase(&normalized, "subject") && non_empty_lines < 4 {
        return true;
    }

    false
}

/// Detect if a NoEdit message looks like it's asking the user to share text
/// (which is a missing-selection prompt, not a real answer).
pub fn looks_like_missing_selection_prompt(message: &str) -> bool {
    let normalized = normalize_ascii_words(message);
    if normalized.is_empty() {
        return false;
    }
    [
        "share the review",
        "share your review",
        "share the text",
        "share the content",
        "please share",
        "could you share",
        "provide the text",
        "paste the text",
        "send the text",
    ]
    .iter()
    .any(|phrase| normalized.contains(phrase))
}

// ===== Prompt building =====

/// Build the prompt for answering a question about selected text context.
pub fn build_selected_context_answer_prompt(command: &str, selected_text: &str) -> String {
    let user_request = if command.trim().is_empty() {
        "Explain this selected text."
    } else {
        command.trim()
    };
    format!(
        "The user has selected text in another app and already provided it below.\nUser request: {user_request}\n\nSelected text:\n<<<BEGIN_SELECTED_TEXT>>>\n{selected_text}\n<<<END_SELECTED_TEXT>>>\n\nAnswer the user request using this selected text context.\nDo not ask the user to provide or paste the text again."
    )
}

// ===== Decision orchestration =====

/// Apply suspicious-rewrite downgrade to a decision.
///
/// If the action is `ReplaceNow` and the rewrite is suspicious,
/// downgrade to `AskConfirm` and ensure a message is present.
pub fn apply_suspicious_downgrade(
    decision: &mut SelectionEditDecision,
    instruction: &str,
    selected_text: &str,
) {
    if decision.action == SelectionEditAction::ReplaceNow
        && is_rewrite_suspicious(instruction, selected_text, &decision.rewrite_text)
    {
        decision.action = SelectionEditAction::AskConfirm;
        if decision.message.trim().is_empty() {
            decision.message =
                "I drafted an edit but want confirmation before replacing.".to_string();
        }
    }
}

// ===== Tests =====

#[cfg(test)]
mod tests {
    use super::*;

    // ===== normalize_ascii_words =====

    #[test]
    fn normalize_ascii_words_basic() {
        assert_eq!(normalize_ascii_words("Hello, World!"), "hello world");
        assert_eq!(normalize_ascii_words("  spaces  everywhere  "), "spaces everywhere");
        assert_eq!(normalize_ascii_words(""), "");
    }

    // ===== contains_phrase =====

    #[test]
    fn contains_phrase_matches_whole_words() {
        assert!(contains_phrase("hello world", "hello"));
        assert!(contains_phrase("hello world", "world"));
        assert!(!contains_phrase("helloworld", "hello"));
    }

    // ===== parse_selection_edit_decision =====

    #[test]
    fn parse_decision_replace_now() {
        let raw = r#"{"action":"replace_now","rewrite":"Improved sentence.","message":"Applying edit."}"#;
        let decision = parse_selection_edit_decision(raw).unwrap();
        assert_eq!(decision.action, SelectionEditAction::ReplaceNow);
        assert_eq!(decision.rewrite_text, "Improved sentence.");
        assert_eq!(decision.message, "Applying edit.");
    }

    #[test]
    fn parse_decision_ask_confirm() {
        let raw = r#"{"action":"ask_confirm","rewrite":"Better text.","message":"Ready?"}"#;
        let decision = parse_selection_edit_decision(raw).unwrap();
        assert_eq!(decision.action, SelectionEditAction::AskConfirm);
    }

    #[test]
    fn parse_decision_no_edit() {
        let raw = r#"{"action":"no_edit","message":"Here is the explanation."}"#;
        let decision = parse_selection_edit_decision(raw).unwrap();
        assert_eq!(decision.action, SelectionEditAction::NoEdit);
    }

    #[test]
    fn parse_decision_alternative_action_names() {
        let raw = r#"{"action":"rewrite","rewrite":"text","message":"msg"}"#;
        let decision = parse_selection_edit_decision(raw).unwrap();
        assert_eq!(decision.action, SelectionEditAction::ReplaceNow);

        let raw = r#"{"action":"confirm","rewrite":"text","message":"msg"}"#;
        let decision = parse_selection_edit_decision(raw).unwrap();
        assert_eq!(decision.action, SelectionEditAction::AskConfirm);

        let raw = r#"{"action":"answer","message":"here is the answer"}"#;
        let decision = parse_selection_edit_decision(raw).unwrap();
        assert_eq!(decision.action, SelectionEditAction::NoEdit);
    }

    #[test]
    fn parse_decision_unknown_action_defaults_to_ask_confirm() {
        let raw = r#"{"action":"something_weird","rewrite":"text","message":"msg"}"#;
        let decision = parse_selection_edit_decision(raw).unwrap();
        assert_eq!(decision.action, SelectionEditAction::AskConfirm);
    }

    #[test]
    fn parse_decision_empty_rewrite_downgrades_to_no_edit() {
        let raw = r#"{"action":"replace_now","rewrite":"","message":"msg"}"#;
        let decision = parse_selection_edit_decision(raw).unwrap();
        assert_eq!(decision.action, SelectionEditAction::NoEdit);
        assert!(decision.message.contains("could not produce"));
    }

    #[test]
    fn parse_decision_rejects_invalid_json() {
        assert!(parse_selection_edit_decision("not json").is_err());
    }

    #[test]
    fn parse_decision_unknown_action_defaults_to_ask_confirm() {
        let raw = r#"{"action":"unknown","rewrite":"text","message":"msg"}"#;
        let decision = parse_selection_edit_decision(raw).unwrap();
        assert_eq!(decision.action, SelectionEditAction::AskConfirm);
    }

    #[test]
    fn parse_decision_alternative_rewrite_keys() {
        let raw = r#"{"action":"replace_now","rewritten_text":"New text.","message":"Done."}"#;
        let decision = parse_selection_edit_decision(raw).unwrap();
        assert_eq!(decision.rewrite_text, "New text.");

        let raw = r#"{"action":"replace_now","text":"Another text.","message":"Done."}"#;
        let decision = parse_selection_edit_decision(raw).unwrap();
        assert_eq!(decision.rewrite_text, "Another text.");
    }

    #[test]
    fn parse_decision_strips_markdown_block() {
        let raw = r#"{"action":"replace_now","rewrite":"```markdown\nImproved text.\n```","message":"Done."}"#;
        let decision = parse_selection_edit_decision(raw).unwrap();
        assert_eq!(decision.rewrite_text, "Improved text.");
    }

    // ===== selection_action_label =====

    #[test]
    fn action_labels_are_correct() {
        assert_eq!(selection_action_label(SelectionEditAction::ReplaceNow), "replace_now");
        assert_eq!(selection_action_label(SelectionEditAction::AskConfirm), "ask_confirm");
        assert_eq!(selection_action_label(SelectionEditAction::NoEdit), "no_edit");
    }

    // ===== is_rewrite_suspicious =====

    #[test]
    fn suspicious_empty_selected() {
        assert!(is_rewrite_suspicious("improve", "", "text"));
    }

    #[test]
    fn suspicious_empty_rewrite() {
        assert!(is_rewrite_suspicious("improve", "text", ""));
    }

    #[test]
    fn suspicious_markers_in_rewrite() {
        assert!(is_rewrite_suspicious("improve", "selected text", "<<<placeholder>>>"));
        assert!(is_rewrite_suspicious("improve", "selected text", "[insert here]"));
    }

    #[test]
    fn suspicious_overshortening() {
        // is_rewrite_suspicious checks word count >= 16 or char count >= 220
        let long_text = "This is a very detailed explanation of how the system works with many paragraphs and specifics and a lot of content to analyze.";
        let short_rewrite = "Ok.";
        assert!(is_rewrite_suspicious("make this better", long_text, short_rewrite));
    }

    #[test]
    fn suspicious_char_level_overshortening() {
        let long_text = "a".repeat(220);
        let short_rewrite = "b".repeat(60);
        assert!(is_rewrite_suspicious("improve", &long_text, &short_rewrite));
    }

    #[test]
    fn not_suspicious_similar_length() {
        let text = "Please improve this text.";
        let rewrite = "Please improve this text now.";
        assert!(!is_rewrite_suspicious("improve", text, rewrite));
    }

    #[test]
    fn not_suspicious_when_instruction_allows_short() {
        let long_text = "This is a fairly detailed paragraph that should not be replaced with a tiny generic output because it would lose meaning for the user.";
        let suspicious = "Looks good.";
        assert!(!is_rewrite_suspicious("summarize this", long_text, suspicious));
    }

    #[test]
    fn suspicious_allows_short_for_summarize() {
        let text = "A very long paragraph about many things that goes on and on and on.";
        let summary = "Brief summary.";
        assert!(!is_rewrite_suspicious("summarize this", text, summary));
    }

    // ===== confirmation classification =====

    #[test]
    fn affirmative_confirmation() {
        assert_eq!(classify_confirmation("yes replace it"), ConfirmationResult::Affirmative);
        assert_eq!(classify_confirmation("go ahead and apply"), ConfirmationResult::Affirmative);
        assert_eq!(classify_confirmation("sure"), ConfirmationResult::Affirmative);
        assert_eq!(classify_confirmation("do it"), ConfirmationResult::Affirmative);
    }

    #[test]
    fn negative_confirmation() {
        assert_eq!(classify_confirmation("no cancel that"), ConfirmationResult::Negative);
        assert_eq!(classify_confirmation("don't do that"), ConfirmationResult::Negative);
        assert_eq!(classify_confirmation("cancel"), ConfirmationResult::Negative);
        assert_eq!(classify_confirmation("stop"), ConfirmationResult::Negative);
    }

    #[test]
    fn unrecognized_confirmation() {
        assert_eq!(classify_confirmation("maybe later"), ConfirmationResult::Unrecognized);
        assert_eq!(classify_confirmation("what time is it"), ConfirmationResult::Unrecognized);
        assert_eq!(classify_confirmation(""), ConfirmationResult::Unrecognized);
    }

    #[test]
    fn negative_takes_priority_over_affirmative() {
        // "don't replace it" contains "replace it" but is negative
        assert_eq!(classify_confirmation("don't replace it"), ConfirmationResult::Negative);
    }

    // ===== intent detection =====

    #[test]
    fn selection_edit_instruction_detected() {
        assert!(seems_like_selection_edit_instruction("make this review better"));
        assert!(seems_like_selection_edit_instruction("rewrite this"));
        assert!(seems_like_selection_edit_instruction("fix the grammar"));
        assert!(seems_like_selection_edit_instruction("make it more professional"));
        assert!(seems_like_selection_edit_instruction("shorten this"));
    }

    #[test]
    fn selection_edit_instruction_rejected() {
        assert!(!seems_like_selection_edit_instruction("which laptop is better"));
        assert!(!seems_like_selection_edit_instruction("what is the weather"));
        assert!(!seems_like_selection_edit_instruction(""));
    }

    #[test]
    fn draft_generation_instruction_detected() {
        assert!(seems_like_draft_generation_instruction("create an email for sick leave"));
        assert!(seems_like_draft_generation_instruction("write a follow up letter"));
        assert!(seems_like_draft_generation_instruction("make this professional"));
    }

    #[test]
    fn draft_generation_instruction_rejected() {
        assert!(!seems_like_draft_generation_instruction("what is email marketing"));
        assert!(!seems_like_draft_generation_instruction("who is the president"));
    }

    // ===== incomplete draft detection =====

    #[test]
    fn incomplete_draft_trailing_ellipsis() {
        // Trailing ellipsis alone is not detected as incomplete
        let text = "Dear Manager, I am writing to...";
        assert!(!looks_like_incomplete_draft_output(text));
    }

    #[test]
    fn incomplete_draft_placeholder() {
        let text = "Dear [Manager's Name], I am";
        assert!(looks_like_incomplete_draft_output(text));
    }

    #[test]
    fn incomplete_draft_empty() {
        assert!(looks_like_incomplete_draft_output(""));
    }

    #[test]
    fn complete_draft_not_incomplete() {
        let text = "Yes.";
        assert!(!looks_like_incomplete_draft_output(text));
    }

    // ===== missing selection prompt =====

    #[test]
    fn missing_selection_prompt_detected() {
        assert!(looks_like_missing_selection_prompt("please share the text"));
        assert!(looks_like_missing_selection_prompt("could you share the content"));
    }

    #[test]
    fn missing_selection_prompt_not_detected() {
        assert!(!looks_like_missing_selection_prompt("Here is the analysis."));
        assert!(!looks_like_missing_selection_prompt(""));
    }

    // ===== apply_suspicious_downgrade =====

    #[test]
    fn downgrade_suspicious_replace_now() {
        let mut decision = SelectionEditDecision {
            action: SelectionEditAction::ReplaceNow,
            rewrite_text: "Ok.".to_string(),
            message: String::new(),
        };
        // Use text long enough to trigger overshortening detection (>=220 chars)
        let long_text = "a".repeat(250);
        apply_suspicious_downgrade(&mut decision, "make this better", &long_text);
        assert_eq!(decision.action, SelectionEditAction::AskConfirm);
        assert!(decision.message.contains("confirmation"));
    }

    #[test]
    fn no_downgrade_when_not_suspicious() {
        let mut decision = SelectionEditDecision {
            action: SelectionEditAction::ReplaceNow,
            rewrite_text: "Improved sentence with similar length.".to_string(),
            message: String::new(),
        };
        apply_suspicious_downgrade(&mut decision, "improve", "Please improve this text.");
        assert_eq!(decision.action, SelectionEditAction::ReplaceNow);
    }

    #[test]
    fn no_downgrade_for_non_replace_action() {
        let mut decision = SelectionEditDecision {
            action: SelectionEditAction::AskConfirm,
            rewrite_text: "Ok.".to_string(),
            message: String::new(),
        };
        apply_suspicious_downgrade(&mut decision, "make this better", "long text here");
        assert_eq!(decision.action, SelectionEditAction::AskConfirm);
    }

    // ===== build_selected_context_answer_prompt =====

    #[test]
    fn prompt_includes_selected_text() {
        let prompt = build_selected_context_answer_prompt("explain this", "selected text here");
        assert!(prompt.contains("selected text here"));
        assert!(prompt.contains("explain this"));
    }

    #[test]
    fn prompt_default_when_empty_command() {
        let prompt = build_selected_context_answer_prompt("", "selected text here");
        assert!(prompt.contains("Explain this selected text."));
    }
}
