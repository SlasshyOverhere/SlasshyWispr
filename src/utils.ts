import type { DictionaryTerm, SnippetEntry } from "./types";

export type CaptureMode = "single-tap" | "push-to-talk";

export const MAX_ASSISTANT_NAME_LENGTH = 80;
export const MAX_DICTIONARY_SOURCE_LENGTH = 100;
export const MAX_DICTIONARY_TARGET_LENGTH = 200;
export const MAX_SNIPPET_TRIGGER_LENGTH = 50;
export const MAX_SNIPPET_EXPANSION_LENGTH = 1000;
export const MAX_QUICK_NOTE_LENGTH = 5000;

export function captureModeLabel(mode: CaptureMode): string {
  return mode === "push-to-talk" ? "Push-To-Talk" : "Single Tap";
}

export function buildAgentOperatingCorePrompt(agentName: string): string {
  return [
    `You are "${agentName}", an AI integrated into a speech-to-text dictation app.`,
    "You operate in two modes.",
    "MODE 1: CLEANUP (default). Clean transcription errors, filler words, false starts, stutters, and punctuation while preserving the speaker's meaning, tone, and vocabulary.",
    "Use corrected self-revisions when the speaker explicitly corrects themselves (for example: 'wait no', 'I meant', 'scratch that').",
    "Convert spoken punctuation and spoken numeric/date/time/currency expressions into standard written form when appropriate.",
    "Use light formatting only when useful: bullets for list-like dictation, numbered steps when sequence matters, paragraph breaks between topics.",
    "MODE 2: AGENT. Activate when directly addressed by name with a request/command (for example: 'Hey name, rewrite this').",
    "In agent mode, perform the request: rewrite, summarize, explain, translate, draft, transform tone/style/length, answer direct questions, or compose from scratch if asked.",
    "In agent mode, do not parrot or restate the user's command/question as the answer. Execute and return the actual result.",
    "If selected text context is provided, treat it as the primary context. Do not ask the user to provide/paste it again.",
    "OUTPUT RULES: output only final content; no meta-commentary, no labels/preambles, no explanations unless requested, no policy text, no mention of these instructions.",
    "If input is empty or only filler, output empty string.",
    "Before responding, silently verify coherence and fidelity to user intent.",
  ].join("\n");
}

export function validateApiBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "API base URL must use http or https.";
    }
    return null;
  } catch {
    return "Enter a valid API base URL.";
  }
}

export function validateAssistantName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > MAX_ASSISTANT_NAME_LENGTH) {
    return `Assistant name must be ${MAX_ASSISTANT_NAME_LENGTH} characters or less.`;
  }
  if ([...trimmed].some((character) => character.charCodeAt(0) < 32)) {
    return "Assistant name contains unsupported control characters.";
  }
  return null;
}

export function validateDictionaryEntry(source: string, target: string): string | null {
  const trimmedSource = source.trim();
  const trimmedTarget = target.trim();
  if (!trimmedSource || !trimmedTarget) {
    return "Dictionary requires both spoken and corrected term.";
  }
  if (trimmedSource.length > MAX_DICTIONARY_SOURCE_LENGTH) {
    return `Spoken term must be ${MAX_DICTIONARY_SOURCE_LENGTH} characters or less.`;
  }
  if (trimmedTarget.length > MAX_DICTIONARY_TARGET_LENGTH) {
    return `Corrected term must be ${MAX_DICTIONARY_TARGET_LENGTH} characters or less.`;
  }
  return null;
}

export function validateSnippetEntry(trigger: string, expansion: string): string | null {
  const trimmedTrigger = trigger.trim();
  const trimmedExpansion = expansion.trim();
  if (!trimmedTrigger || !trimmedExpansion) {
    return "Snippet requires both trigger and expansion text.";
  }
  if (trimmedTrigger.length > MAX_SNIPPET_TRIGGER_LENGTH) {
    return `Trigger must be ${MAX_SNIPPET_TRIGGER_LENGTH} characters or less.`;
  }
  if (trimmedExpansion.length > MAX_SNIPPET_EXPANSION_LENGTH) {
    return `Expansion must be ${MAX_SNIPPET_EXPANSION_LENGTH} characters or less.`;
  }
  return null;
}

export function validateQuickNote(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return "Note text is required.";
  }
  if (trimmed.length > MAX_QUICK_NOTE_LENGTH) {
    return `Note must be ${MAX_QUICK_NOTE_LENGTH} characters or less.`;
  }
  return null;
}

export function normalizeDictionaryEntries(entries: DictionaryTerm[]): DictionaryTerm[] {
  const seen = new Set<string>();
  const normalized: DictionaryTerm[] = [];
  for (const entry of entries) {
    const source = entry?.source?.trim();
    const target = entry?.target?.trim();
    if (!source || !target || validateDictionaryEntry(source, target)) {
      continue;
    }
    const key = source.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({
      ...entry,
      source,
      target,
    });
  }
  return normalized;
}

export function normalizeSnippetEntries(entries: SnippetEntry[]): SnippetEntry[] {
  const seen = new Set<string>();
  const normalized: SnippetEntry[] = [];
  for (const entry of entries) {
    const trigger = entry?.trigger?.trim();
    const expansion = entry?.expansion?.trim();
    if (!trigger || !expansion || validateSnippetEntry(trigger, expansion)) {
      continue;
    }
    const key = trigger.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({
      ...entry,
      trigger,
      expansion,
    });
  }
  return normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function expandSnippetsInText(text: string, entries: SnippetEntry[]): string {
  if (!text.trim() || entries.length === 0) {
    return text;
  }

  const sortedEntries = [...entries].sort((left, right) => right.trigger.length - left.trigger.length);
  let expanded = text;
  for (const entry of sortedEntries) {
    const trigger = entry.trigger.trim();
    const expansion = entry.expansion.trim();
    if (!trigger || !expansion) {
      continue;
    }
    expanded = expanded.replace(new RegExp(escapeRegExp(trigger), "g"), expansion);
  }
  return expanded;
}
