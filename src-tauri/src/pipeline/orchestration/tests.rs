//! Integration tests for pipeline orchestration.
//!
//! These tests exercise the real orchestration decision logic with
//! controlled inputs, verifying state transitions and pipeline path selection.

use super::{
    apply_selection_edit_result, normalize_and_validate_response, orchestrate_post_stt,
    post_ai_processing, AiAction, OrchestratorInput, OrchestratorResult, PipelineConfig,
    PipelineState, PostAiAction,
};
use crate::pipeline::selection::SelectionEditAction;

// ===== Helpers =====

fn default_config() -> PipelineConfig {
    PipelineConfig {
        system_prompt: "You are a helpful assistant.".to_string(),
        temperature: 0.35,
        max_tokens: 320,
        assistant_name: "Lily".to_string(),
    }
}

fn config_with_name(name: &str) -> PipelineConfig {
    PipelineConfig {
        assistant_name: name.to_string(),
        ..default_config()
    }
}

// ===== Dictation mode =====

#[test]
fn wake_enabled_no_wake_phrase_is_dictation() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "random text without wake phrase",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    assert_eq!(result.decision.mode, "dictation");
    assert!(result.decision.skip_tts);
    assert_eq!(result.ai_action, AiAction::None);
}

#[test]
fn dictation_clears_pending_rewrite() {
    let state = PipelineState::with_pending_rewrite("old rewrite");
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "some dictation text",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    assert_eq!(result.decision.mode, "dictation");
    assert!(result.decision.selection_context_cleared);
    assert!(state.peek_pending_rewrite().is_none());
}

// ===== Wake-only mode =====

#[test]
fn wake_only_returns_listening() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    assert_eq!(result.ai_action, AiAction::None);
    assert_eq!(result.decision.assistant_response, "I'm listening.");
    assert!(result.decision.skip_tts);
}

// ===== Command mode =====

#[test]
fn command_mode_no_selection_routes_to_ai() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily what is the capital of France",
        wake_word_enabled: true,
        command_mode: true,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    // command_mode + no selection → command mode request path → GenerateResponse
    assert!(matches!(result.ai_action, AiAction::GenerateResponse { .. }));
    assert_eq!(result.decision.mode, "assistant");
}

#[test]
fn command_mode_with_selection_edit_intent_and_no_text_shows_prompt() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily improve this",
        wake_word_enabled: true,
        command_mode: true,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    // command_mode + selection_edit_intent + no selected_text → prompt user
    assert_eq!(result.ai_action, AiAction::None);
    assert!(result.decision.skip_tts);
}

// ===== Normal assistant mode =====

#[test]
fn normal_command_routes_to_ai() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily what is the capital of France",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    assert!(matches!(result.ai_action, AiAction::GenerateResponse { .. }));
    assert!(!result.decision.skip_tts);
    assert_eq!(result.decision.mode, "assistant");
}

#[test]
fn pending_rewrite_entering_normal_command_sets_pending() {
    // When there is a pending rewrite and user gives a new command
    // that is not a selection intent, and no selected text,
    // the orchestrator enters the "pending rewrite" path
    // because selection_control_mode is true (pending_rewrite_present).
    let state = PipelineState::with_pending_rewrite("old rewrite");
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily what is Rust",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    // With pending rewrite present, selection_control_mode is true.
    // Since no selected_text and no confirmation → "I still have a pending rewrite"
    assert_eq!(result.ai_action, AiAction::None);
    assert!(result.decision.selection_pending);
    assert!(result.decision.skip_tts);
}

// ===== Wake word disabled =====

#[test]
fn wake_disabled_treats_whole_transcript_as_command() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "what is the capital of France",
        wake_word_enabled: false,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    assert!(matches!(
        result.ai_action,
        AiAction::GenerateResponse { ref prompt, .. } if prompt == "what is the capital of France"
    ));
    assert!(!result.decision.skip_tts);
}

#[test]
fn wake_disabled_not_dictation() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "random text",
        wake_word_enabled: false,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    assert_ne!(result.decision.mode, "dictation");
}

// ===== Selection context queries =====

#[test]
fn selection_context_query_with_text_triggers_ai() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily summarize this",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: Some("selected text to summarize"),
        config: default_config(),
        state: &state,
    });

    assert!(matches!(
        result.ai_action,
        AiAction::GenerateSelectionEditDecision { .. }
    ));
}

#[test]
fn selection_context_query_without_text_shows_prompt() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily summarize this",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    // "summarize this" triggers selection_context_query
    // Without selected_text, prompts user to select first
    assert_eq!(result.ai_action, AiAction::None);
    assert!(result.decision.skip_tts);
}

// ===== Selection edit =====

#[test]
fn selected_text_with_edit_command_triggers_decision() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily improve this",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: Some("some text to improve"),
        config: default_config(),
        state: &state,
    });

    // "improve this" is a selection edit intent
    assert!(matches!(
        result.ai_action,
        AiAction::GenerateSelectionEditDecision { .. }
    ));
}

#[test]
fn selection_with_command_uses_command_as_instruction() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily make this more formal",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: Some("casual greeting text"),
        config: default_config(),
        state: &state,
    });

    if let AiAction::GenerateSelectionEditDecision { ref instruction, .. } = result.ai_action {
        assert!(instruction.contains("formal"));
    } else {
        panic!("Expected GenerateSelectionEditDecision");
    }
}

// ===== Selection edit result application =====

#[test]
fn selection_edit_applies_replace_now() {
    let state = PipelineState::new();
    let result = apply_selection_edit_result(
        crate::pipeline::selection::SelectionEditDecision {
            action: SelectionEditAction::ReplaceNow,
            rewrite_text: "shortened text".to_string(),
            message: String::new(),
        },
        "rewrite this",
        "original text",
        &state,
        "Lily",
    );

    assert_eq!(result.assistant_response, "shortened text");
    assert!(result.selection_rewrite);
    assert!(result.skip_tts);
    // selection_context_cleared depends on whether pending rewrite existed
    // With no pending rewrite, clear_pending_rewrite returns false
    assert_eq!(state.peek_pending_rewrite(), None);
    assert_eq!(
        state.recent_selection_context.lock().unwrap().as_deref(),
        Some("shortened text")
    );
}

#[test]
fn selection_edit_suspicious_downgrades_to_ask_confirm() {
    let state = PipelineState::new();
    // A very short rewrite of long text is suspicious
    // is_rewrite_suspicious uses word count (>=16 words) or char count (>=220 chars)
    // to detect overshortening.
    let long_text = "a".repeat(250);
    let result = apply_selection_edit_result(
        crate::pipeline::selection::SelectionEditDecision {
            action: SelectionEditAction::ReplaceNow,
            rewrite_text: "x".to_string(),
            message: String::new(),
        },
        "rewrite this professionally",
        &long_text,
        &state,
        "Lily",
    );

    assert!(result.selection_pending);
    assert!(result.skip_tts);
}

#[test]
fn selection_edit_ask_confirm_sets_pending() {
    let state = PipelineState::new();
    let result = apply_selection_edit_result(
        crate::pipeline::selection::SelectionEditDecision {
            action: SelectionEditAction::AskConfirm,
            rewrite_text: "Improved version".to_string(),
            message: String::new(),
        },
        "improve this",
        "original text",
        &state,
        "Lily",
    );

    assert!(result.selection_pending);
    assert!(!result.selection_rewrite);
    assert!(result.skip_tts);
}

#[test]
fn selection_edit_noedit_returns_fallback() {
    let state = PipelineState::new();
    let result = apply_selection_edit_result(
        crate::pipeline::selection::SelectionEditDecision {
            action: SelectionEditAction::NoEdit,
            rewrite_text: String::new(),
            message: "Nothing to edit here.".to_string(),
        },
        "edit this",
        "some text",
        &state,
        "Lily",
    );

    assert!(!result.selection_rewrite);
    assert!(!result.selection_pending);
}

#[test]
fn selection_context_query_triggers_ai() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily explain this",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: Some("some code snippet"),
        config: default_config(),
        state: &state,
    });

    assert!(matches!(
        result.ai_action,
        AiAction::GenerateSelectionEditDecision { .. }
    ));
}

#[test]
fn selection_edit_without_text_prompts_user() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily improve this",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    // edit intent detected but no selected text → prompts user
    assert_eq!(result.ai_action, AiAction::None);
    assert!(result.decision.skip_tts);
}

// ===== State transitions =====

#[test]
fn recent_context_set_on_ask_confirm() {
    let state = PipelineState::new();
    let result = apply_selection_edit_result(
        crate::pipeline::selection::SelectionEditDecision {
            action: SelectionEditAction::AskConfirm,
            rewrite_text: "Improved version".to_string(),
            message: "Looks good?".to_string(),
        },
        "improve",
        "original",
        &state,
        "Lily",
    );

    assert_eq!(
        state.recent_selection_context.lock().unwrap().as_deref(),
        Some("Improved version")
    );
}

#[test]
fn recent_context_set_on_selection_edit_replace() {
    let state = PipelineState::new();
    let result = apply_selection_edit_result(
        crate::pipeline::selection::SelectionEditDecision {
            action: SelectionEditAction::ReplaceNow,
            rewrite_text: "new version".to_string(),
            message: String::new(),
        },
        "rewrite",
        "old text",
        &state,
        "Lily",
    );

    assert_eq!(
        state.recent_selection_context.lock().unwrap().as_deref(),
        Some("new version")
    );
}

#[test]
fn pending_rewrite_cleared_on_negative_confirmation() {
    let state = PipelineState::with_pending_rewrite("old rewrite");
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily cancel",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    assert!(result.decision.selection_context_cleared);
    assert!(state.peek_pending_rewrite().is_none());
    assert_eq!(result.ai_action, AiAction::None);
}

#[test]
fn pending_rewrite_applied_on_affirmative() {
    let state = PipelineState::with_pending_rewrite("new text here");
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily yes replace it",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    assert_eq!(result.decision.assistant_response, "new text here");
    assert!(result.decision.selection_rewrite);
    assert!(result.decision.selection_context_cleared);
    assert!(state.peek_pending_rewrite().is_none());
}

// ===== Confirmation =====

#[test]
fn unrecognized_confirmation_keeps_pending() {
    let state = PipelineState::with_pending_rewrite("pending rewrite");
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily maybe later",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    assert!(result.decision.selection_pending);
    assert!(state.peek_pending_rewrite().is_some());
}

// ===== Normalization =====

#[test]
fn normalize_latex_conversion() {
    let result = normalize_and_validate_response(
        r#"Some text with \[\frac{x}{2}\] inline"#,
    );
    assert!(result.is_ok());
    let text = result.unwrap();
    assert!(text.contains("(x) / (2)") || text.contains("x / 2"));
}

#[test]
fn normalize_preserves_content() {
    let result = normalize_and_validate_response("Hello, this is normal text.");
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), "Hello, this is normal text.");
}

#[test]
fn normalize_rejects_empty() {
    let result = normalize_and_validate_response("");
    assert!(result.is_err());
}

#[test]
fn normalize_rejects_whitespace_only() {
    let result = normalize_and_validate_response("   \n  ");
    assert!(result.is_err());
}

// ===== Response processing =====

#[test]
fn echo_detection_returns_direct_answer_fallback() {
    let action = post_ai_processing(
        "What is the capital of France? The capital is Paris.",
        "what is the capital of France",
        false,
        false,
        false,
        false,
    );

    assert!(matches!(action, PostAiAction::DirectAnswerFallback { .. }));
}

#[test]
fn draft_fallback_for_incomplete_output() {
    let action = post_ai_processing(
        "Here is the beginning of your email I am",
        "write an email to the team",
        false,
        false,
        false,
        false,
    );

    // "i am" is detected as incomplete draft output by looks_like_incomplete_draft_output
    assert!(matches!(action, PostAiAction::ComposeDraftFallback { .. }));
}

#[test]
fn no_draft_fallback_when_selection_used() {
    let action = post_ai_processing(
        "Here is the beginning...",
        "write an email",
        false,
        true, // selection_context_used
        false,
        false,
    );

    assert!(matches!(action, PostAiAction::None));
}

#[test]
fn no_echo_for_non_question() {
    let action = post_ai_processing(
        "Paris is the capital of France.",
        "what is the capital of France",
        false,
        false,
        false,
        false,
    );

    assert!(matches!(action, PostAiAction::None));
}

#[test]
fn no_echo_for_wake_only() {
    let action = post_ai_processing(
        "What is the capital? The capital is Paris.",
        "what is the capital",
        true, // wake_only
        false,
        false,
        false,
    );

    assert!(matches!(action, PostAiAction::None));
}

// ===== Wake phrase tests =====

#[test]
fn wake_phrase_extracts_command() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily what is Rust",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    if let AiAction::GenerateResponse { ref prompt, .. } = result.ai_action {
        assert!(prompt.contains("what is Rust"));
    } else {
        panic!("Expected GenerateResponse");
    }
}

#[test]
fn wake_phrase_with_different_name() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey sam summarize this",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: Some("some text"),
        config: config_with_name("Sam"),
        state: &state,
    });

    assert!(matches!(
        result.ai_action,
        AiAction::GenerateSelectionEditDecision { .. }
    ));
}
