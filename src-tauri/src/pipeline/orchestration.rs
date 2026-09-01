//! Pipeline orchestration logic.
//!
//! This module owns the post-STT decision-making logic that determines
//! how the pipeline processes a transcript through AI and TTS stages.
//!
//! It is pure — no Tauri, no network, no filesystem. The Tauri adapter
//! (`run_assistant_pipeline`) handles runtime concerns and delegates
//! decision logic here.

use std::sync::Mutex;

use crate::pipeline::response::{
    looks_like_direct_question, looks_like_question_echo,
    normalize_assistant_response_text,
};
use crate::pipeline::selection::{
    build_selected_context_answer_prompt, is_affirmative_selection_confirmation,
    is_negative_selection_confirmation, is_rewrite_suspicious, looks_like_incomplete_draft_output,
    seems_like_draft_generation_instruction, seems_like_selection_context_query,
    seems_like_selection_edit_instruction, SelectionEditAction, SelectionEditDecision,
};

// ===== Types =====

/// Minimal pipeline state for the orchestrator.
/// Mirrors the relevant fields of AppState.
pub struct PipelineState {
    pub pending_selection_rewrite: Mutex<Option<String>>,
    pub recent_selection_context: Mutex<Option<String>>,
}

impl PipelineState {
    pub fn new() -> Self {
        Self {
            pending_selection_rewrite: Mutex::new(None),
            recent_selection_context: Mutex::new(None),
        }
    }

    #[cfg(test)]
    pub fn with_pending_rewrite(rewrite: &str) -> Self {
        Self {
            pending_selection_rewrite: Mutex::new(Some(rewrite.to_string())),
            recent_selection_context: Mutex::new(None),
        }
    }

    #[cfg(test)]
    pub fn with_recent_context(context: &str) -> Self {
        Self {
            pending_selection_rewrite: Mutex::new(None),
            recent_selection_context: Mutex::new(Some(context.to_string())),
        }
    }

    pub fn set_pending_rewrite(&self, text: &str) {
        *self.pending_selection_rewrite.lock().unwrap() = Some(text.to_string());
    }

    pub fn clear_pending_rewrite(&self) -> bool {
        self.pending_selection_rewrite.lock().unwrap().take().is_some()
    }

    pub fn peek_pending_rewrite(&self) -> Option<String> {
        self.pending_selection_rewrite
            .lock()
            .unwrap()
            .clone()
    }

    pub fn take_pending_rewrite(&self) -> Option<String> {
        self.pending_selection_rewrite.lock().unwrap().take()
    }

    pub fn set_recent_context(&self, text: &str) {
        *self.recent_selection_context.lock().unwrap() = Some(text.to_string());
    }

    #[cfg(test)]
    pub fn peek_recent_context(&self) -> Option<String> {
        self.recent_selection_context.lock().unwrap().clone()
    }
}

/// Resolved pipeline configuration for the orchestrator.
/// Contains everything the orchestrator needs to make decisions.
pub struct PipelineConfig {
    /// System prompt for AI calls.
    pub system_prompt: String,
    /// Temperature for AI calls.
    pub temperature: f32,
    /// Max tokens for AI calls.
    pub max_tokens: u32,
    /// Assistant name for wake-word responses.
    pub assistant_name: String,
}

/// Orchestrator input: everything needed for post-STT decisions.
pub struct OrchestratorInput<'a> {
    /// The refined transcript from STT.
    pub transcript: &'a str,
    /// Whether wake word detection is enabled.
    pub wake_word_enabled: bool,
    /// Whether the user sent text as command_mode.
    pub command_mode: bool,
    /// Selected text from the frontend (if any).
    pub selected_text: Option<&'a str>,
    /// Pipeline configuration.
    pub config: PipelineConfig,
    /// Pipeline state (pending rewrites, recent context).
    pub state: &'a PipelineState,
}

/// What the orchestrator decided the pipeline should do.
pub struct OrchestratorDecision {
    /// The pipeline mode.
    pub mode: String,
    /// The assistant response text.
    /// For most paths, this is the final response.
    /// For AiAction::GenerateResponse or GenerateSelectionEditDecision,
    /// this is a placeholder — the caller must produce the real response.
    pub assistant_response: String,
    /// Whether TTS should be skipped.
    pub skip_tts: bool,
    /// Whether a selection rewrite was applied.
    pub selection_rewrite: bool,
    /// Whether a selection rewrite is pending confirmation.
    pub selection_pending: bool,
    /// Whether pending selection context was cleared.
    pub selection_context_cleared: bool,
    /// Whether selection context was used in this pipeline run.
    pub selection_context_used: bool,
}

/// The AI action the orchestrator requests the caller to execute.
pub enum AiAction {
    /// No AI call needed (dictation, wake-only, or state-only paths).
    None,
    /// Standard AI response generation.
    /// Caller must also run post_ai_processing on the result.
    GenerateResponse {
        prompt: String,
        system_prompt: String,
        temperature: f32,
        max_tokens: u32,
    },
    /// Selection-edit decision generation.
    /// Caller must: call AI → get SelectionEditDecision → call apply_selection_edit_result.
    GenerateSelectionEditDecision {
        instruction: String,
        selected_text: String,
        temperature: f32,
    },
}

/// Full orchestrator result: decision + what AI action to take.
pub struct OrchestratorResult {
    pub decision: OrchestratorDecision,
    pub ai_action: AiAction,
}

/// Result of applying a selection-edit decision to the orchestrator state.
pub struct SelectionEditResult {
    /// The final assistant response text.
    pub assistant_response: String,
    /// Whether a selection rewrite was applied.
    pub selection_rewrite: bool,
    /// Whether a selection rewrite is pending confirmation.
    pub selection_pending: bool,
    /// Whether pending selection context was cleared.
    pub selection_context_cleared: bool,
    /// Whether TTS should be skipped.
    pub skip_tts: bool,
}

// ===== Orchestrator =====

/// Pure orchestrator: determines the pipeline path and what actions to take.
///
/// This function contains the core decision logic from run_assistant_pipeline,
/// extracted for testability. It does NOT execute STT, AI, or TTS.
/// The caller is responsible for executing the returned AiAction and
/// assembling the final response.
pub fn orchestrate_post_stt(input: OrchestratorInput) -> OrchestratorResult {
    let transcript = input.transcript.trim();

    // --- Wake word handling ---
    let wake_command = if input.wake_word_enabled {
        crate::extract_wake_command(transcript, &input.config.assistant_name)
    } else {
        Some(transcript.to_string())
    };

    // Dictation mode: wake enabled but no wake phrase detected
    if input.wake_word_enabled && wake_command.is_none() {
        let selection_context_cleared = input.state.clear_pending_rewrite();
        return OrchestratorResult {
            decision: OrchestratorDecision {
                mode: "dictation".to_string(),
                assistant_response: transcript.to_string(),
                skip_tts: true,
                selection_rewrite: false,
                selection_pending: false,
                selection_context_cleared,
                selection_context_used: false,
            },
            ai_action: AiAction::None,
        };
    }

    let wake_command = wake_command.unwrap_or_default();
    let command_for_ai = wake_command.trim().to_string();
    let wake_only = input.wake_word_enabled && command_for_ai.is_empty();

    // --- Selection context evaluation ---
    let selection_edit_intent = seems_like_selection_edit_instruction(&command_for_ai);
    let selection_context_query_intent = seems_like_selection_context_query(&command_for_ai);
    let selection_intent_active = selection_edit_intent || selection_context_query_intent;
    let pending_rewrite_present = input.state.peek_pending_rewrite().is_some();
    let selected_text = input.selected_text.map(|s| s.to_string());

    let selection_control_mode = selected_text.is_some()
        || input.command_mode
        || pending_rewrite_present
        || selection_intent_active;
    let selection_context_used = selected_text.is_some() || pending_rewrite_present;

    let mut skip_tts = false;
    let mut selection_rewrite = false;
    let mut selection_pending = false;
    let mut selection_context_cleared = false;

    // --- AI response generation ---
    let ai_action;
    let assistant_response = if wake_only {
        ai_action = AiAction::None;
        "I'm listening.".to_string()
    } else if selection_control_mode {
        if let Some(ref selected) = selected_text {
            let instruction = if command_for_ai.trim().is_empty() {
                "Improve this text while keeping the original meaning and tone."
            } else {
                command_for_ai.as_str()
            };
            ai_action = AiAction::GenerateSelectionEditDecision {
                instruction: instruction.to_string(),
                selected_text: selected.clone(),
                temperature: input.config.temperature,
            };
            // Placeholder — caller executes AI and calls apply_selection_edit_result
            String::new()
        } else if input.state.peek_pending_rewrite().is_some() {
            if is_negative_selection_confirmation(&command_for_ai) {
                selection_context_cleared = input.state.clear_pending_rewrite() || selection_context_cleared;
                skip_tts = true;
                ai_action = AiAction::None;
                "Pending rewrite canceled.".to_string()
            } else if is_affirmative_selection_confirmation(&command_for_ai) {
                let rewrite = input.state.take_pending_rewrite().unwrap_or_default();
                input.state.set_recent_context(&rewrite);
                selection_rewrite = true;
                selection_context_cleared = true;
                skip_tts = true;
                ai_action = AiAction::None;
                rewrite
            } else {
                selection_pending = true;
                skip_tts = true;
                ai_action = AiAction::None;
                "I still have a pending rewrite. Say \"yes replace it\" to apply or \"cancel\" to discard.".to_string()
            }
        } else {
            if selection_edit_intent || selection_context_query_intent {
                skip_tts = true;
                ai_action = AiAction::None;
                "No selected text detected. Select text first, then repeat your selection command.".to_string()
            } else {
                let transcript_for_ai = if command_for_ai.is_empty() {
                    "Command mode is active. Ask the user what to edit next.".to_string()
                } else {
                    format!("Command mode request: {}", command_for_ai)
                };
                ai_action = AiAction::GenerateResponse {
                    prompt: transcript_for_ai,
                    system_prompt: input.config.system_prompt.clone(),
                    temperature: input.config.temperature,
                    max_tokens: input.config.max_tokens,
                };
                String::new() // Placeholder — caller produces response
            }
        }
    } else {
        selection_context_cleared = input.state.clear_pending_rewrite() || selection_context_cleared;
        ai_action = AiAction::GenerateResponse {
            prompt: command_for_ai.clone(),
            system_prompt: input.config.system_prompt.clone(),
            temperature: input.config.temperature,
            max_tokens: input.config.max_tokens,
        };
        String::new() // Placeholder — caller produces response
    };

    // --- Wake-only early return ---
    if wake_only {
        return OrchestratorResult {
            decision: OrchestratorDecision {
                mode: "assistant".to_string(),
                assistant_response,
                skip_tts: true,
                selection_rewrite: false,
                selection_pending: false,
                selection_context_cleared: false,
                selection_context_used: false,
            },
            ai_action,
        };
    }

    // --- Selection rewrite/pending with skip TTS ---
    if skip_tts {
        return OrchestratorResult {
            decision: OrchestratorDecision {
                mode: "assistant".to_string(),
                assistant_response,
                skip_tts: true,
                selection_rewrite,
                selection_pending,
                selection_context_cleared,
                selection_context_used,
            },
            ai_action,
        };
    }

    // --- Default: run TTS ---
    OrchestratorResult {
        decision: OrchestratorDecision {
            mode: "assistant".to_string(),
            assistant_response,
            skip_tts: false,
            selection_rewrite,
            selection_pending,
            selection_context_cleared,
            selection_context_used,
        },
        ai_action,
    }
}

/// Apply a selection-edit AI result to the orchestrator state.
///
/// This is called after the caller gets a `SelectionEditDecision` from the AI
/// in response to `AiAction::GenerateSelectionEditDecision`.
/// It handles:
/// - Suspicious rewrite downgrade (ReplaceNow → AskConfirm)
/// - State mutations (pending rewrite, recent context, selection flags)
/// - Response text generation
/// - NoEdit fallback to AI answer prompt
pub fn apply_selection_edit_result(
    decision: SelectionEditDecision,
    instruction: &str,
    selected_text: &str,
    state: &PipelineState,
    assistant_name: &str,
) -> SelectionEditResult {
    let mut decision = decision;

    if decision.action == SelectionEditAction::ReplaceNow
        && is_rewrite_suspicious(instruction, selected_text, &decision.rewrite_text)
    {
        decision.action = SelectionEditAction::AskConfirm;
        if decision.message.trim().is_empty() {
            decision.message = "I drafted an edit but want confirmation before replacing.".to_string();
        }
    }

    let mut selection_rewrite = false;
    let mut selection_pending = false;
    let mut selection_context_cleared = false;
    let mut skip_tts = false;

    let response = match decision.action {
        SelectionEditAction::ReplaceNow => {
            let rewrite = decision.rewrite_text;
            state.set_recent_context(&rewrite);
            selection_rewrite = true;
            selection_context_cleared = state.clear_pending_rewrite();
            skip_tts = true;
            rewrite
        }
        SelectionEditAction::AskConfirm => {
            if decision.rewrite_text.trim().is_empty() {
                selection_context_cleared = state.clear_pending_rewrite();
                "I could not prepare a safe rewrite. Try a clearer edit instruction.".to_string()
            } else {
                let rewrite = decision.rewrite_text;
                state.set_recent_context(&rewrite);
                state.set_pending_rewrite(&rewrite);
                selection_pending = true;
                skip_tts = true;
                if decision.message.trim().is_empty() {
                    format!(
                        "I drafted an edit. Say \"hey {}, yes replace it\" to apply or \"hey {}, cancel\" to discard.",
                        assistant_name, assistant_name
                    )
                } else {
                    decision.message
                }
            }
        }
        SelectionEditAction::NoEdit => {
            selection_context_cleared = state.clear_pending_rewrite();
            if decision.message.trim().is_empty()
                || crate::pipeline::selection::looks_like_missing_selection_prompt(&decision.message)
            {
                // NoEdit with empty/prompt-like message → generate AI answer with selected context
                skip_tts = false;
                // Return empty response to signal caller to generate AI answer
                String::new()
            } else {
                decision.message
            }
        }
    };

    SelectionEditResult {
        assistant_response: response,
        selection_rewrite,
        selection_pending,
        selection_context_cleared,
        skip_tts,
    }
}

/// The post-AI fallback action to take.
pub enum PostAiAction {
    /// No fallback needed.
    None,
    /// Echo detected — retry with direct answer.
    DirectAnswerFallback {
        command: String,
        temperature: f32,
        max_tokens: u32,
    },
    /// Incomplete draft — retry with compose fallback.
    ComposeDraftFallback {
        command: String,
        temperature: f32,
        max_tokens: u32,
    },
}

/// Post-AI processing: check for echo and incomplete drafts.
/// Returns a fallback action if the response needs retry.
pub fn post_ai_processing(
    assistant_response: &str,
    command_for_ai: &str,
    wake_only: bool,
    selection_context_used: bool,
    selection_rewrite: bool,
    selection_pending: bool,
) -> PostAiAction {
    // Echo detection
    if !wake_only
        && looks_like_direct_question(command_for_ai)
        && looks_like_question_echo(command_for_ai, assistant_response)
    {
        return PostAiAction::DirectAnswerFallback {
            command: command_for_ai.to_string(),
            temperature: 0.35,
            max_tokens: 320,
        };
    }

    // Incomplete draft detection
    if !wake_only
        && !selection_context_used
        && !selection_rewrite
        && !selection_pending
        && seems_like_draft_generation_instruction(command_for_ai)
        && looks_like_incomplete_draft_output(assistant_response)
    {
        return PostAiAction::ComposeDraftFallback {
            command: command_for_ai.to_string(),
            temperature: 0.35,
            max_tokens: 320,
        };
    }

    PostAiAction::None
}

/// Normalize and validate the final assistant response.
/// Returns Ok(normalized_response) or Err if empty.
pub fn normalize_and_validate_response(response: &str) -> Result<String, String> {
    let normalized = normalize_assistant_response_text(response);
    if normalized.trim().is_empty() {
        return Err("AI model returned an empty response".to_string());
    }
    Ok(normalized)
}

#[cfg(test)]
mod tests;
