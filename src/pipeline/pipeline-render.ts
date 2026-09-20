/**
 * Pipeline response render — Phase 5 shell decomposition.
 *
 * Owns renderPipelineResponse + appendConversationEntry + the pure
 * conversation-entry list builder. Moved verbatim from main.tsx; shell
 * seams (latency elements, incognito probe, clock, history lists,
 * usage/notes, store notify) arrive via initPipelineRender so this module
 * never touches main.tsx module globals.
 */
import { MAX_HISTORY_ITEMS } from "../constants";
import type { AssistantPipelineResponse, HomeHistoryEntry } from "../types";
import { countWords } from "../analytics/analytics-service";
import { formatLatency } from "../utils";

export type ConversationTone = "user" | "assistant";

export interface ConversationEntryOptions {
  showInLog?: boolean;
  metrics?: Pick<HomeHistoryEntry, "wpm" | "pipelineMs" | "spokenSeconds">;
  recordingId?: string;
}

export interface PipelineRenderElements {
  sttLatency: HTMLElement;
  aiLatency: HTMLElement;
  ttsLatency: HTMLElement;
  totalLatency: HTMLElement;
}

export interface PipelineRenderDeps {
  isIncognito: () => boolean;
  now: () => number;
  getRecordingStartedAt: () => number;
  getLastSavedRecordingId: () => string | null;
  getLastCaptureIntentLabel: () => string;
  trackUsage: (transcript: string) => void;
  addQuickNote: (text: string) => void;
  getHomeHistory: () => HomeHistoryEntry[];
  setHomeHistory: (entries: HomeHistoryEntry[]) => void;
  persistHomeHistory: () => void;
  notifyStoreUpdated: () => void;
  getRecentTurns: () => Array<{ speaker: string; content: string }>;
}

let renderElements!: PipelineRenderElements;
let renderDeps!: PipelineRenderDeps;

export function initPipelineRender(
  elements: PipelineRenderElements,
  deps: PipelineRenderDeps,
): void {
  renderElements = elements;
  renderDeps = deps;
}

export interface ConversationAppend {
  speaker: string;
  content: string;
  tone: ConversationTone;
  options: ConversationEntryOptions;
}

/** Pure list fold for appendConversationEntry — no DOM, no storage. */
export function appendConversationEntryToLists(
  homeHistory: HomeHistoryEntry[],
  recentTurns: Array<{ speaker: string; content: string }>,
  speaker: string,
  content: string,
  tone: ConversationTone,
  options: ConversationEntryOptions,
  now: number,
): { homeHistory: HomeHistoryEntry[]; recentTurns: Array<{ speaker: string; content: string }> } {
  const showInLog = options.showInLog ?? true;
  let nextHome = homeHistory;
  if (showInLog) {
    const historyEntry: HomeHistoryEntry = {
      speaker,
      content,
      tone,
      timestamp: now,
      ...(options.metrics ?? {}),
      ...(options.recordingId ? { recordingId: options.recordingId } : {}),
    };

    nextHome = [historyEntry, ...homeHistory].slice(0, MAX_HISTORY_ITEMS);
  }

  const nextRecent = [{ speaker, content }, ...recentTurns].slice(0, MAX_HISTORY_ITEMS);
  return { homeHistory: nextHome, recentTurns: nextRecent };
}

export function appendConversationEntry(
  speaker: string,
  content: string,
  tone: ConversationTone,
  options: ConversationEntryOptions = {},
): void {
  const liveRecentTurns = renderDeps.getRecentTurns();
  const merged = appendConversationEntryToLists(
    renderDeps.getHomeHistory(),
    liveRecentTurns,
    speaker,
    content,
    tone,
    options,
    renderDeps.now(),
  );
  // main.tsx mutates recentTurns in place; splice the merged list back into
  // the live array so the caller's reference stays current.
  liveRecentTurns.length = 0;
  liveRecentTurns.push(...merged.recentTurns);
  const showInLog = options.showInLog ?? true;
  if (showInLog) {
    renderDeps.setHomeHistory(merged.homeHistory);
    renderDeps.persistHomeHistory();
    // Notify React to re-render with updated history from localStorage.
    renderDeps.notifyStoreUpdated();
  }
}

export function renderPipelineResponse(response: AssistantPipelineResponse): void {
  renderElements.sttLatency.textContent = formatLatency(response.sttLatencyMs);
  renderElements.aiLatency.textContent = formatLatency(response.aiLatencyMs);
  renderElements.ttsLatency.textContent = formatLatency(response.ttsLatencyMs);
  renderElements.totalLatency.textContent = formatLatency(response.totalLatencyMs);

  if (!renderDeps.isIncognito()) {
    const userWords = countWords(response.transcript);
    const spokenSeconds = Math.max((renderDeps.now() - renderDeps.getRecordingStartedAt()) / 1000, 0);
    const userWpm = userWords > 0 && spokenSeconds > 0
      ? Math.round((userWords / spokenSeconds) * 60)
      : 0;
    const userMetrics: ConversationEntryOptions["metrics"] | undefined = userWords > 0
      ? {
          wpm: userWpm,
          pipelineMs: response.totalLatencyMs,
          spokenSeconds: Math.round(spokenSeconds * 10) / 10,
        }
      : undefined;
    const userRecordingId = renderDeps.getLastSavedRecordingId() ?? undefined;
    appendConversationEntry("You", response.transcript, "user", { showInLog: false, metrics: userMetrics, recordingId: userRecordingId });
    if (response.selectionRewrite) {
      appendConversationEntry("Rewrite", response.assistantResponse, "assistant", { metrics: userMetrics, recordingId: userRecordingId });
    } else if (response.selectionPending) {
      appendConversationEntry("Rewrite pending", response.assistantResponse, "assistant", { metrics: userMetrics, recordingId: userRecordingId });
    } else if (response.selectionContextUsed) {
      appendConversationEntry("Selection", response.assistantResponse, "assistant", { metrics: userMetrics, recordingId: userRecordingId });
    } else if (response.mode === "assistant") {
      appendConversationEntry("SlasshyWispr", response.assistantResponse, "assistant", { metrics: userMetrics, recordingId: userRecordingId });
    } else {
      appendConversationEntry("Dictation", response.assistantResponse, "assistant", { metrics: userMetrics, recordingId: userRecordingId });
    }
  }

  // F-003: incognito suppresses the history etc. above; usage, sessions and
  // notes are the same promise, so they are gated here too (trackUsage also
  // guards, but the notes write has no other check).
  if (renderDeps.isIncognito()) {
    return;
  }

  renderDeps.trackUsage(response.transcript);
  if (renderDeps.getLastCaptureIntentLabel() === "notes-button") {
    renderDeps.addQuickNote(response.transcript);
  }
}
