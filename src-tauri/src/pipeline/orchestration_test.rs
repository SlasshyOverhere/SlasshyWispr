//! Integration tests for pipeline orchestration.
//!
//! These tests exercise the real orchestration decision logic with
//! controlled inputs, verifying state transitions and pipeline path selection.

use super::orchestration::{
    apply_selection_decision, normalize_and_validate_response, orchestrate_post_stt, AiAction,
    OrchestratorInput, OrchestratorResult, PipelineConfig, PipelineState,
};
use crate::pipeline::selection::SelectionEditAction;

// ===== Helpers =====

fn default_config() -> PipelineConfig {
    PipelineConfig {
        ai_available: true,
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
fn dictation_returns_transcript_without_wake_phrase() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hello world this is dictation",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    assert_eq!(result.decision.mode, "dictation");
    assert_eq!(result.decision.assistant_response, "hello world this is dictation");
    assert!(result.decision.skip_tts);
    assert!(!result.decision.selection_rewrite);
    assert!(!result.decision.selection_pending);
    assert!(matches!(result.ai_action, AiAction::None));
}

#[test]
fn dictation_clears_pending_rewrite() {
    let state = PipelineState::with_pending_rewrite("old rewrite");
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "just dictating something",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    assert!(result.decision.selection_context_cleared);
    assert!(state.peek_pending_rewrite().is_none());
}

#[test]
fn dictation_does_not_clear_when_no_pending() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "just dictating",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    assert!(!result.decision.selection_context_cleared);
}

// ===== Wake-only (acknowledgement) =====

#[test]
fn wake_only_returns_listening_without_tts() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    assert_eq!(result.decision.mode, "assistant");
    assert_eq!(result.decision.assistant_response, "I'm listening.");
    assert!(result.decision.skip_tts);
    assert!(matches!(result.ai_action, AiAction::None));
}

// ===== Selection edit: direct replacement =====

#[test]
fn selection_edit_triggers_decision_generation() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily rewrite this to be shorter",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: Some("selected text here"),
        config: default_config(),
        state: &state,
    });

    assert_eq!(result.decision.mode, "assistant");
    assert!(result.decision.skip_tts);
    assert!(result.decision.selection_context_used);
    assert!(matches!(result.ai_action, AiAction::GenerateSelectionEditDecision { .. }));
}

#[test]
fn selection_edit_applies_replace_now() {
    let state = PipelineState::new();
    let decision = SelectionEditAction::ReplaceNow;
    let (response, selection_rewrite, _, context_cleared, skip_tts) = apply_selection_decision(
        crate::pipeline::selection::SelectionEditDecision {
            action: decision,
            rewrite_text: "shortened text".to_string(),
            message: String::new(),
        },
        "rewrite this",
        "original text",
        &state,
        "Lily",
    );

    assert_eq!(response, "shortened text");
    assert!(selection_rewrite);
    assert!(skip_tts);
    assert!(context_cleared);
    assert_eq!(state.peek_pending_rewrite(), None);
    assert_eq!(state.peek_recent_context(), Some("shortened text".to_string()));
}

#[test]
fn selection_edit_suspicious_downgrades_to_ask_confirm() {
    let state = PipelineState::new();
    // A very short rewrite of long text is suspicious
    let (response, _, selection_pending, _, skip_tts) = apply_selection_decision(
        crate::pipeline::selection::SelectionEditDecision {
            action: SelectionEditAction::ReplaceNow,
            rewrite_text: "x".to_string(),
            message: String::new(),
        },
        "rewrite this professionally",
        "This is a long paragraph with many sentences that should be rewritten to be more professional and clear.",
        &state,
        "Lily",
    );

    assert!(selection_pending);
    assert!(skip_tts);
    assert!(state.peek_pending_rewrite().is_some());
    assert!(response.contains("drafted an edit") || response.contains("confirmation"));
}

// ===== Selection edit: confirmation flow =====

#[test]
fn affirmative_confirmation_applies_pending_rewrite() {
    let state = PipelineState::with_pending_rewrite("pending rewrite text");
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily yes replace it",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    assert!(result.decision.selection_rewrite);
    assert!(result.decision.skip_tts);
    assert!(result.decision.selection_context_cleared);
    assert!(state.peek_pending_rewrite().is_none());
    assert_eq!(result.decision.assistant_response, "pending rewrite text");
    assert_eq!(state.peek_recent_context(), Some("pending rewrite text".to_string()));
}

#[test]
fn negative_confirmation_cancels_pending_rewrite() {
    let state = PipelineState::with_pending_rewrite("pending rewrite text");
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily no cancel that",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    assert!(!result.decision.selection_rewrite);
    assert!(result.decision.skip_tts);
    assert!(result.decision.selection_context_cleared);
    assert!(state.peek_pending_rewrite().is_none());
    assert_eq!(result.decision.assistant_response, "Pending rewrite canceled.");
}

#[test]
fn unrecognized_confirmation_keeps_pending() {
    let state = PipelineState::with_pending_rewrite("pending rewrite text");
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily hmm what do you think",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    assert!(result.decision.selection_pending);
    assert!(result.decision.skip_tts);
    assert!(state.peek_pending_rewrite().is_some());
    assert!(result.decision.assistant_response.contains("pending rewrite"));
}

// ===== Selection edit: no selected text =====

#[test]
fn selection_edit_without_text_prompts_user() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily rewrite this",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    assert!(result.decision.skip_tts);
    assert!(result.decision.assistant_response.contains("No selected text"));
}

// ===== Command mode =====

#[test]
fn command_mode_no_selection_routes_to_ai() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily summarize this",
        wake_word_enabled: true,
        command_mode: true,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    assert!(matches!(result.ai_action, AiAction::GenerateResponse { .. }));
    assert_eq!(result.decision.mode, "assistant");
}

#[test]
fn command_mode_empty_command_prompts_for_input() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily",
        wake_word_enabled: true,
        command_mode: true,
        selected_text: None,
        config: config_with_name("Lily"),
        state: &state,
    });

    // Empty command with command_mode should still go to AI
    assert!(matches!(result.ai_action, AiAction::GenerateResponse { .. }));
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
fn normal_command_clears_pending_rewrite() {
    let state = PipelineState::with_pending_rewrite("old rewrite");
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily what is Rust",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    assert!(result.decision.selection_context_cleared);
    assert!(state.peek_pending_rewrite().is_none());
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

    // With wake disabled, the entire transcript is the command
    assert!(matches!(result.ai_action, AiAction::GenerateResponse { ref prompt, .. } if prompt == "what is the capital of France"));
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

    // Even with random text, wake disabled means it goes to AI, not dictation
    assert_ne!(result.decision.mode, "dictation");
}

// ===== State transitions =====

#[test]
fn pending_rewrite_cleared_on_new_command() {
    let state = PipelineState::with_pending_rewrite("old");
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily do something else",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    assert!(result.decision.selection_context_cleared);
    assert!(state.peek_pending_rewrite().is_none());
}

#[test]
fn recent_context_set_on_selection_edit_replace() {
    let state = PipelineState::new();
    let (response, _, _, _, _) = apply_selection_decision(
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

    assert_eq!(response, "new version");
    assert_eq!(state.peek_recent_context(), Some("new version".to_string()));
}

#[test]
fn recent_context_set_on_ask_confirm() {
    let state = PipelineState::new();
    let (_, _, selection_pending, _, _) = apply_selection_decision(
        crate::pipeline::selection::SelectionEditDecision {
            action: SelectionEditAction::AskConfirm,
            rewrite_text: "proposed edit".to_string(),
            message: "Does this look right?".to_string(),
        },
        "rewrite",
        "original",
        &state,
        "Lily",
    );

    assert!(selection_pending);
    assert_eq!(state.peek_recent_context(), Some("proposed edit".to_string()));
    assert_eq!(state.peek_pending_rewrite(), Some("proposed edit".to_string()));
}

// ===== Normalize and validate =====

#[test]
fn normalize_preserves_content() {
    let result = normalize_and_validate_response("Hello, world!").unwrap();
    assert_eq!(result, "Hello, world!");
}

#[test]
fn normalize_strips_markdown() {
    let result = normalize_and_validate_response("```markdown\nHello\n```").unwrap();
    assert_eq!(result, "Hello");
}

#[test]
fn normalize_rejects_empty_response() {
    let result = normalize_and_validate_response("");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("empty"));
}

#[test]
fn normalize_rejects_whitespace_only() {
    let result = normalize_and_validate_response("   \n  \n  ");
    assert!(result.is_err());
}

#[test]
fn normalize_latex_conversion() {
    let result = normalize_and_validate_response("The formula is \\(x^2\\)").unwrap();
    assert!(!result.contains("\\("));
}

// ===== Selection context query =====

#[test]
fn selection_context_query_triggers_ai() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily explain this",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: Some("selected code block"),
        config: default_config(),
        state: &state,
    });

    assert!(result.decision.selection_context_used);
    // Should trigger selection-edit decision (since selected text is available)
    assert!(matches!(result.ai_action, AiAction::GenerateSelectionEditDecision { .. }));
}

// ===== Edge cases =====

#[test]
fn empty_command_with_selected_text_uses_default_instruction() {
    let state = PipelineState::new();
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: Some("some text to improve"),
        config: default_config(),
        state: &state,
    });

    assert!(matches!(result.ai_action, AiAction::GenerateSelectionEditDecision { ref instruction, .. } if instruction.contains("Improve this text")));
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

    assert!(matches!(result.ai_action, AiAction::GenerateSelectionEditDecision { ref instruction, .. } if instruction == "make this more formal"));
}

#[test]
fn selection_control_mode_active_with_pending_rewrite() {
    let state = PipelineState::with_pending_rewrite("existing");
    let result = orchestrate_post_stt(OrchestratorInput {
        transcript: "hey lily something",
        wake_word_enabled: true,
        command_mode: false,
        selected_text: None,
        config: default_config(),
        state: &state,
    });

    // Should recognize the pending rewrite and enter confirmation flow
    assert!(result.decision.selection_context_used);
}

// ===== NoEdit decision =====

#[test]
fn noedit_with_message_returns_message() {
    let state = PipelineState::new();
    let (response, _, _, _, _) = apply_selection_decision(
        crate::pipeline::selection::SelectionEditDecision {
            action: SelectionEditAction::NoEdit,
            rewrite_text: String::new(),
            message: "The text is already well-written.".to_string(),
        },
        "rewrite this",
        "already good text",
        &state,
        "Lily",
    );

    assert_eq!(response, "The text is already well-written.");
    assert!(!response.is_empty());
}

#[test]
fn noedit_empty_message_triggers_ai_answer() {
    let state = PipelineState::new();
    let (response, _, _, _, _) = apply_selection_decision(
        crate::pipeline::selection::SelectionEditDecision {
            action: SelectionEditAction::NoEdit,
            rewrite_text: String::new(),
            message: String::new(),
        },
        "explain this",
        "some code",
        &state,
        "Lily",
    );

    // Should return a prompt marker for the caller to generate AI answer
    assert!(response.starts_with("[no-edit-ai-prompt]"));
}
