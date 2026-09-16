import type { AssistantPipelineResponse, SelectionPopupPayload } from "../types";

/**
 * Canonical selection intent classification — Phase 5e extraction.
 * Pure, no DOM, no windows, no invoke. Moved verbatim from main.tsx.
 * Token counter stays in main.tsx (mutable shell state); callers pass
 * the token in. Window management (ensure/show/size) stays in main.tsx.
 */

const NON_ALNUM_INTENT_CHAR_PATTERN = /[^\p{L}\p{N}\s]/gu;
const MULTI_SPACE_PATTERN = /\s+/g;

export function normalizeIntentText(value: string): string {
  return value
    .toLowerCase()
    .replace(NON_ALNUM_INTENT_CHAR_PATTERN, " ")
    .replace(MULTI_SPACE_PATTERN, " ")
    .trim();
}

export function includesAnyIntentPhrase(text: string, phrases: readonly string[]): boolean {
  for (const fragment of phrases) {
    if (text.includes(fragment)) {
      return true;
    }
  }
  return false;
}

export const COMPOSE_VERBS = [
  "write",
  "draft",
  "compose",
  "create",
  "generate",
  "make",
  "prepare",
];

export const COMPOSE_TARGETS = [
  "email",
  "mail",
  "message",
  "reply",
  "letter",
  "review",
  "proposal",
  "summary",
  "description",
  "caption",
  "post",
  "bio",
  "application",
];

const DRAFT_EDIT_VERB_PATTERN = /\b(make|rewrite|edit|improve|polish|refine|fix)\b/;
const DRAFT_EDIT_TARGET_PATTERN = /\b(this|it|text|review|email|message|paragraph|sentence)\b/;

export function looksLikeDraftingRequest(transcript: string): boolean {
  const normalized = normalizeIntentText(transcript);
  if (!normalized) {
    return false;
  }

  const hasComposeVerb = includesAnyIntentPhrase(normalized, COMPOSE_VERBS);
  const hasComposeTarget = includesAnyIntentPhrase(normalized, COMPOSE_TARGETS);
  if (hasComposeVerb && hasComposeTarget) {
    return true;
  }

  if (DRAFT_EDIT_VERB_PATTERN.test(normalized) && DRAFT_EDIT_TARGET_PATTERN.test(normalized)) {
    return true;
  }

  return false;
}

const DRAFT_RESPONSE_START_PATTERN = /^(subject:|dear\s|hello\s|hi\s|to:)/i;

export function looksLikeDraftResponse(assistantResponse: string): boolean {
  const trimmed = assistantResponse.trim();
  if (trimmed.length < 24) {
    return false;
  }

  if (DRAFT_RESPONSE_START_PATTERN.test(trimmed)) {
    return true;
  }

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length >= 3) {
    return true;
  }

  return trimmed.length >= 120;
}

export function inferAnswerPopupTitle(transcript: string): string {
  const normalized = normalizeIntentText(transcript);
  if (normalized.includes("email") || normalized.includes("mail")) {
    return "Email Draft Ready";
  }
  if (normalized.includes("review")) {
    return "Review Draft Ready";
  }
  return "Draft Ready";
}

export function shouldOpenAnswerPopup(response: AssistantPipelineResponse): boolean {
  if (response.mode !== "assistant") {
    return false;
  }
  if (response.selectionRewrite || response.selectionPending || response.selectionContextUsed) {
    return false;
  }
  if (!response.assistantResponse.trim()) {
    return false;
  }

  return looksLikeDraftingRequest(response.transcript) && looksLikeDraftResponse(response.assistantResponse);
}

export function buildSelectionPopupPayload(
  response: AssistantPipelineResponse,
  token: number,
): SelectionPopupPayload | null {
  if (!response.selectionRewrite && !response.selectionPending && !shouldOpenAnswerPopup(response)) {
    return null;
  }

  if (response.selectionPending) {
    return {
      token,
      mode: "pending",
      title: "Rewrite Draft Ready",
      text: response.assistantResponse,
      audioBase64: "",
    };
  }

  if (response.selectionRewrite) {
    return {
      token,
      mode: "rewrite",
      title: "Rewrite Result",
      text: response.assistantResponse,
      audioBase64: "",
    };
  }

  if (shouldOpenAnswerPopup(response)) {
    return {
      token,
      mode: "answer",
      title: inferAnswerPopupTitle(response.transcript),
      text: response.assistantResponse,
      audioBase64: "",
    };
  }

  return null;
}
