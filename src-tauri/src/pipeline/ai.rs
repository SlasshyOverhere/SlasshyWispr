//! AI execution for the voice assistant pipeline.
//!
//! This module contains the runtime-dependent AI operations:
//! LLM request dispatch, online/Ollama backends, fallback strategies,
//! and response parsing. It depends on `reqwest::Client` and
//! `pipeline::routing::AiModeConfig` but NOT on Tauri or AppState.

use reqwest::Client;
use serde_json::{json, Value};

use crate::pipeline::log::{clip_text, single_line};
use crate::pipeline::routing::AiModeConfig;
use crate::pipeline::selection::{parse_selection_edit_decision, SelectionEditDecision};

// ===== Model capability detection =====

/// Whether the given online AI model defaults to reasoning-mode parameters.
pub fn online_ai_model_defaults_to_reasoning(ai_model: &str) -> bool {
    let normalized = ai_model.trim().to_ascii_lowercase();
    normalized == "openai/gpt-oss-20b" || normalized == "openai/gpt-oss-120b"
}

/// Compute effective completion tokens for reasoning models.
pub fn effective_online_ai_completion_tokens(ai_model: &str, max_tokens: u32) -> u32 {
    if online_ai_model_defaults_to_reasoning(ai_model) {
        return max_tokens.saturating_add(384).clamp(640, 4096);
    }

    max_tokens
}

// ===== Chat response parsing =====

/// Recursively extract text content from an OpenAI-compatible chat value.
fn extract_text_from_chat_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Array(items) => {
            let mut combined = Vec::new();
            for item in items {
                if let Some(text) = extract_text_from_chat_value(item) {
                    if !text.trim().is_empty() {
                        combined.push(text);
                    }
                }
            }
            if combined.is_empty() {
                None
            } else {
                Some(combined.join("\n"))
            }
        }
        Value::Object(object) => {
            for key in [
                "text",
                "content",
                "output_text",
                "value",
                "refusal",
                "message",
                "delta",
            ] {
                if let Some(candidate) = object.get(key) {
                    if let Some(text) = extract_text_from_chat_value(candidate) {
                        return Some(text);
                    }
                }
            }
            None
        }
        _ => None,
    }
}

/// Extract assistant text content from an OpenAI-compatible chat completions response.
fn extract_chat_content(payload: &Value) -> Option<String> {
    let candidate_paths = [
        "/choices/0/message/content",
        "/choices/0/message",
        "/choices/0/text",
        "/choices/0/delta/content",
        "/output_text",
        "/output/0/content",
        "/response/output_text",
    ];

    for path in candidate_paths {
        if let Some(candidate) = payload.pointer(path) {
            if let Some(text) = extract_text_from_chat_value(candidate) {
                return Some(text);
            }
        }
    }

    None
}

// ===== Core AI dispatch =====

/// Dispatch an AI request to the configured backend (online or Ollama).
pub async fn generate_assistant_response(
    client: &Client,
    ai_mode: &AiModeConfig,
    transcript: &str,
    system_prompt: &str,
    temperature: f32,
    max_tokens: u32,
) -> Result<String, String> {
    match ai_mode {
        AiModeConfig::Online {
            api_key,
            api_base_url,
            ai_model,
        } => {
            generate_assistant_response_online(
                client,
                api_key,
                api_base_url,
                ai_model,
                transcript,
                system_prompt,
                temperature,
                max_tokens,
            )
            .await
        }
        AiModeConfig::Local(local) => {
            generate_assistant_response_ollama(
                client,
                local,
                transcript,
                system_prompt,
                temperature,
                max_tokens,
            )
            .await
        }
    }
}

// ===== Online backend =====

async fn generate_assistant_response_online(
    client: &Client,
    api_key: &str,
    api_base_url: &str,
    ai_model: &str,
    transcript: &str,
    system_prompt: &str,
    temperature: f32,
    max_tokens: u32,
) -> Result<String, String> {
    let mut payload = json!({
      "model": ai_model,
      "temperature": temperature,
      "stream": false,
      "messages": [
        {
          "role": "system",
          "content": system_prompt
        },
        {
          "role": "user",
          "content": transcript
        }
      ]
    });
    if online_ai_model_defaults_to_reasoning(ai_model) {
        payload["include_reasoning"] = Value::Bool(false);
        payload["reasoning_effort"] = Value::String("low".to_string());
        payload["max_completion_tokens"] =
            Value::from(effective_online_ai_completion_tokens(ai_model, max_tokens));
    } else {
        payload["max_tokens"] = Value::from(max_tokens);
    }

    let mut last_error = String::new();
    for attempt in 0..2 {
        let response = match client
            .post(format!("{api_base_url}/chat/completions"))
            .bearer_auth(api_key)
            .json(&payload)
            .timeout(std::time::Duration::from_secs(35))
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                last_error = format!("Failed to call AI endpoint: {error}");
                if attempt == 0 {
                    log::warn!(
                        "[pipeline] online ai transport error; retrying: {}",
                        clip_text(&single_line(&last_error), 280)
                    );
                    std::thread::sleep(std::time::Duration::from_millis(350));
                    continue;
                }
                log::warn!(
                    "[pipeline] online ai request failed after retry: {}",
                    clip_text(&single_line(&last_error), 320)
                );
                return Err(last_error);
            }
        };

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| format!("Failed to parse AI response body: {error}"))?;

        if !status.is_success() {
            let message = format!(
                "AI request failed ({status}): {}",
                clip_text(&single_line(&body), 420)
            );
            if attempt == 0 && matches!(status.as_u16(), 429 | 500 | 502 | 503 | 504) {
                log::warn!(
                    "[pipeline] online ai temporary failure; retrying status={} body={}",
                    status,
                    clip_text(&single_line(&body), 220)
                );
                last_error = message;
                std::thread::sleep(std::time::Duration::from_millis(450));
                continue;
            }
            log::warn!(
                "[pipeline] online ai request failed status={} body={}",
                status,
                clip_text(&single_line(&body), 320)
            );
            return Err(message);
        }

        let payload: Value = serde_json::from_str(&body)
            .map_err(|error| format!("Invalid AI JSON response: {error}"))?;
        let content = extract_chat_content(&payload)
            .map(|text| text.trim().to_string())
            .filter(|text| !text.is_empty());
        if let Some(value) = content {
            return Ok(value);
        }
        let missing_content_error = "AI response is missing usable text content.".to_string();
        let top_level_keys = payload
            .as_object()
            .map(|object| object.keys().cloned().collect::<Vec<_>>().join(","))
            .unwrap_or_else(|| "<non-object>".to_string());
        let message_keys = payload
            .pointer("/choices/0/message")
            .and_then(Value::as_object)
            .map(|object| object.keys().cloned().collect::<Vec<_>>().join(","))
            .unwrap_or_else(|| "<none>".to_string());
        if attempt == 0 {
            log::warn!(
                "[pipeline] online ai missing text content; retrying top_keys={} message_keys={} body_preview={}",
                top_level_keys,
                message_keys,
                clip_text(&single_line(&body), 360)
            );
            last_error = missing_content_error;
            std::thread::sleep(std::time::Duration::from_millis(350));
            continue;
        }
        log::warn!(
            "[pipeline] online ai response missing message content top_keys={} message_keys={} body_preview={}",
            top_level_keys,
            message_keys,
            clip_text(&single_line(&body), 360)
        );
        return Err(missing_content_error);
    }

    if last_error.is_empty() {
        Err("AI request failed unexpectedly.".to_string())
    } else {
        Err(last_error)
    }
}

// ===== Ollama local backend =====

async fn generate_assistant_response_ollama(
    client: &Client,
    local: &crate::pipeline::routing::LocalAiConfig,
    transcript: &str,
    system_prompt: &str,
    temperature: f32,
    max_tokens: u32,
) -> Result<String, String> {
    let ollama_model = local
        .ollama_model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "Local Ollama model is required for assistant responses. Open Settings > Models and select an Ollama model."
                .to_string()
        })?;
    let endpoint = format!("{}/api/chat", local.ollama_base_url);

    let payload = json!({
      "model": ollama_model,
      "stream": false,
      "options": {
        "temperature": temperature,
        "num_predict": max_tokens,
      },
      "messages": [
        {
          "role": "system",
          "content": system_prompt
        },
        {
          "role": "user",
          "content": transcript
        }
      ]
    });

    let mut last_error = String::new();
    for attempt in 0..2 {
        let response = match client.post(&endpoint).json(&payload).send().await {
            Ok(response) => response,
            Err(error) => {
                last_error = format!("Failed to call local Ollama endpoint: {error}");
                if attempt == 0 {
                    log::warn!(
                        "[pipeline] local ollama request transport error; retrying: {}",
                        clip_text(&single_line(&last_error), 280)
                    );
                    std::thread::sleep(std::time::Duration::from_millis(350));
                    continue;
                }
                return Err(last_error);
            }
        };

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| format!("Failed to parse local Ollama response body: {error}"))?;

        if !status.is_success() {
            let message = format!(
                "Local Ollama request failed ({status}): {}",
                clip_text(&single_line(&body), 420)
            );
            if attempt == 0 && matches!(status.as_u16(), 429 | 500 | 502 | 503 | 504) {
                log::warn!(
                    "[pipeline] local ollama temporary failure; retrying status={} body={}",
                    status,
                    clip_text(&single_line(&body), 220)
                );
                last_error = message;
                std::thread::sleep(std::time::Duration::from_millis(450));
                continue;
            }
            return Err(message);
        }

        let payload: Value = serde_json::from_str(&body)
            .map_err(|error| format!("Invalid local Ollama JSON response: {error}"))?;
        let content = payload
            .pointer("/message/content")
            .and_then(Value::as_str)
            .or_else(|| payload.get("response").and_then(Value::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        return content
            .ok_or_else(|| "Local Ollama response is missing message.content".to_string());
    }

    if last_error.is_empty() {
        Err("Local Ollama request failed unexpectedly.".to_string())
    } else {
        Err(last_error)
    }
}

// ===== Fallback AI strategies =====

/// Retry with a strict direct-answer prompt to fix question-echo responses.
pub async fn generate_direct_answer_fallback(
    client: &Client,
    ai_mode: &AiModeConfig,
    question: &str,
    temperature: f32,
    max_tokens: u32,
) -> Result<String, String> {
    let strict_prompt = "You are a direct-answer assistant.
- The user message is a question/command from voice input.
- Return the actual answer/result, not a paraphrase of the question.
- Do not prefix with labels or filler text.
- If the question asks for a number/calculation, return the computed result clearly.";
    generate_assistant_response(
        client,
        ai_mode,
        question,
        strict_prompt,
        temperature.clamp(0.0, 0.35),
        max_tokens.clamp(64, 320),
    )
    .await
}

/// Retry with a strict compose/draft prompt to fix incomplete draft output.
pub async fn generate_compose_draft_fallback(
    client: &Client,
    ai_mode: &AiModeConfig,
    request: &str,
    temperature: f32,
    max_tokens: u32,
) -> Result<String, String> {
    let strict_prompt = "You are a professional writing assistant for email and document drafting.
- Return a complete, ready-to-send draft.
- Never output bracket placeholders such as [Name], [Boss's Name], [Date], or [Your Name].
- If a specific recipient name is unknown, use a neutral salutation like 'Dear Manager,'.
- Finish every sentence; do not stop mid-sentence.
- For email requests, include a clear Subject line, concise body, and closing.
- Return only the final draft text.";

    let draft_max_tokens = std::cmp::max(max_tokens, 420).clamp(180, 900);
    generate_assistant_response(
        client,
        ai_mode,
        request,
        strict_prompt,
        temperature.clamp(0.0, 0.5),
        draft_max_tokens,
    )
    .await
}

// ===== Selection-edit decision generation =====

/// Generate a selection-edit decision by asking the LLM to classify the edit intent.
pub async fn generate_selection_edit_decision(
    client: &Client,
    ai_mode: &AiModeConfig,
    instruction: &str,
    selected_text: &str,
    temperature: f32,
) -> Result<SelectionEditDecision, String> {
    let decision_system_prompt = "You are a strict selected-text editing controller.
Return valid JSON only with this exact schema:
{\"action\":\"replace_now|ask_confirm|no_edit\",\"rewrite\":\"...\",\"message\":\"...\"}

Rules:
- Use replace_now when the user instruction clearly asks for direct editing of the selected text.
- Treat style/tone/length transformations as direct edits (for example: \"make it gentle\", \"longer\", \"200 words\", \"professional tone\").
- Use ask_confirm when instruction is ambiguous/high-risk before replacing user-selected text.
- Use no_edit when the spoken request is informational about the selected text (explain/summarize/tell me about it).
- rewrite must be the full rewritten selected text when action is replace_now or ask_confirm.
- message requirements:
  - For no_edit: provide the final assistant answer to the user request using the selected text context.
  - For ask_confirm: provide a short confirmation prompt.
  - For replace_now: message may be empty.
- Never ask the user to share or paste the text again; selected text is already provided.
- Never use markdown/code fences/placeholders.";
    let decision_request = format!(
        "Instruction:\n{}\n\nSelected text:\n<<<BEGIN_SELECTED_TEXT>>>\n{}\n<<<END_SELECTED_TEXT>>>",
        instruction.trim(),
        selected_text
    );
    let decision_temperature = temperature.clamp(0.0, 0.45);
    let raw = generate_assistant_response(
        client,
        ai_mode,
        &decision_request,
        decision_system_prompt,
        decision_temperature,
        900,
    )
    .await?;

    parse_selection_edit_decision(&raw)
}

// ===== Tests =====

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_line_collapses_whitespace() {
        assert_eq!(single_line("hello  world\n\t  foo"), "hello world foo");
        assert_eq!(single_line("  leading and trailing  "), "leading and trailing");
        assert_eq!(single_line(""), "");
    }

    #[test]
    fn clip_text_short_circuits_when_within_limit() {
        assert_eq!(clip_text("hello", 10), "hello");
        assert_eq!(clip_text("", 10), "");
    }

    #[test]
    fn clip_text_truncates_and_adds_ellipsis() {
        let result = clip_text("abcdefghij", 5);
        assert_eq!(result, "abcde...");
        assert!(result.len() <= 10);
    }

    #[test]
    fn extract_chat_content_supports_nested_text_value_parts() {
        let payload = serde_json::json!({
            "choices": [
                {
                    "message": {
                        "content": [
                            {
                                "type": "output_text",
                                "text": { "value": "Draft complete." }
                            }
                        ]
                    }
                }
            ]
        });
        assert_eq!(
            extract_chat_content(&payload).as_deref(),
            Some("Draft complete.")
        );
    }

    #[test]
    fn extract_chat_content_supports_legacy_choices_text() {
        let payload = serde_json::json!({
            "choices": [
                {
                    "text": "Legacy completion output"
                }
            ]
        });
        assert_eq!(
            extract_chat_content(&payload).as_deref(),
            Some("Legacy completion output")
        );
    }

    #[test]
    fn extract_chat_content_supports_refusal_field() {
        let payload = serde_json::json!({
            "choices": [
                {
                    "message": {
                        "refusal": "I cannot help with that request."
                    }
                }
            ]
        });
        assert_eq!(
            extract_chat_content(&payload).as_deref(),
            Some("I cannot help with that request.")
        );
    }

    #[test]
    fn online_ai_model_defaults_to_reasoning_only_for_gpt_oss_models() {
        assert!(online_ai_model_defaults_to_reasoning("openai/gpt-oss-20b"));
        assert!(online_ai_model_defaults_to_reasoning(
            " openai/gpt-oss-120b "
        ));
        assert!(!online_ai_model_defaults_to_reasoning(
            "llama-3.3-70b-versatile"
        ));
        assert!(!online_ai_model_defaults_to_reasoning("gpt-4o-mini"));
    }

    #[test]
    fn effective_online_ai_completion_tokens_adds_headroom_for_gpt_oss_models() {
        assert_eq!(
            effective_online_ai_completion_tokens("openai/gpt-oss-120b", 320),
            704
        );
        assert_eq!(
            effective_online_ai_completion_tokens("openai/gpt-oss-20b", 64),
            640
        );
        assert_eq!(
            effective_online_ai_completion_tokens("llama-3.3-70b-versatile", 320),
            320
        );
    }
}
