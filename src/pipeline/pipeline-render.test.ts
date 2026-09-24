/**
 * Pipeline render move-boundary test — Phase 5 shell decomposition.
 *
 * Pins renderPipelineResponse branching (rewrite/pending/selection/
 * assistant/dictation speaker labels, history cap, incognito skip,
 * intent label) and the pure conversation-entry list fold.
 */
import { describe, it, expect } from "bun:test";
import { MAX_HISTORY_ITEMS } from "../constants";
import type { AssistantPipelineResponse, HomeHistoryEntry } from "../types";
import {
  appendConversationEntryToLists,
  initPipelineRender,
  renderPipelineResponse,
} from "./pipeline-render";

function fakeElement(): HTMLElement {
  return { textContent: "" } as unknown as HTMLElement;
}

function fakeResponse(overrides: Partial<AssistantPipelineResponse> = {}): AssistantPipelineResponse {
  return {
    transcript: "hello world",
    assistantResponse: "hello world",
    mode: "dictation",
    sttLatencyMs: 10,
    aiLatencyMs: 20,
    ttsLatencyMs: 30,
    totalLatencyMs: 60,
    audioBase64: "",
    selectionRewrite: false,
    selectionPending: false,
    selectionContextUsed: false,
    ...overrides,
  } as AssistantPipelineResponse;
}

function wireHarness(state: {
  incognito?: boolean;
  intentLabel?: string;
  history?: HomeHistoryEntry[];
} = {}) {
  const elements = {
    sttLatency: fakeElement(),
    aiLatency: fakeElement(),
    ttsLatency: fakeElement(),
    totalLatency: fakeElement(),
  };
  const usage: string[] = [];
  let history = state.history ?? [];
  const recent: Array<{ speaker: string; content: string }> = [];
  initPipelineRender(elements, {
    isIncognito: () => state.incognito ?? false,
    now: () => 60_000,
    getRecordingStartedAt: () => 55_000,
    getLastSavedRecordingId: () => "rec_1",
    getLastCaptureIntentLabel: () => state.intentLabel ?? "",
    trackUsage: (transcript) => {
      usage.push(transcript);
    },
    getHomeHistory: () => history,
    setHomeHistory: (entries) => {
      history = entries;
    },
    persistHomeHistory: () => {},
    notifyStoreUpdated: () => {},
    getRecentTurns: () => recent,
  });
  return { elements, usage, getHistory: () => history, getRecent: () => recent };
}

describe("appendConversationEntryToLists", () => {
  it("prepends to both lists and caps at MAX_HISTORY_ITEMS", () => {
    const home = Array.from({ length: MAX_HISTORY_ITEMS }, (_, i) => ({
      speaker: "x",
      content: `${i}`,
      tone: "user" as const,
      timestamp: i,
    }));
    const merged = appendConversationEntryToLists(home, [], "You", "hi", "user", {}, 999);
    expect(merged.homeHistory.length).toBe(MAX_HISTORY_ITEMS);
    expect(merged.homeHistory[0].content).toBe("hi");
    expect(merged.recentTurns).toEqual([{ speaker: "You", content: "hi" }]);
  });

  it("skips the home list when showInLog is false but keeps recent turns", () => {
    const merged = appendConversationEntryToLists([], [], "You", "hi", "user", { showInLog: false }, 999);
    expect(merged.homeHistory).toEqual([]);
    expect(merged.recentTurns).toEqual([{ speaker: "You", content: "hi" }]);
  });
});

describe("renderPipelineResponse", () => {
  it("renders latencies, logs user + assistant entries, tracks usage", () => {
    const harness = wireHarness();
    renderPipelineResponse(fakeResponse({ mode: "assistant" }));
    expect(harness.elements.sttLatency.textContent).toBe("10 ms");
    expect(harness.elements.totalLatency.textContent).toBe("60 ms");
    // The "You" entry uses showInLog: false, so it only lands in recent turns.
    expect(harness.getHistory().map((entry) => entry.speaker)).toEqual([
      "SlasshyWispr",
    ]);
    expect(harness.usage).toEqual(["hello world"]);
    expect(harness.getRecent().length).toBe(2);
  });

  it("labels rewrite and pending branches", () => {
    const harness = wireHarness();
    renderPipelineResponse(fakeResponse({ selectionRewrite: true }));
    expect(harness.getHistory().map((entry) => entry.speaker)).toEqual(["Rewrite"]);
    const pending = wireHarness();
    renderPipelineResponse(fakeResponse({ selectionPending: true }));
    expect(pending.getHistory().map((entry) => entry.speaker)).toEqual(["Rewrite pending"]);
    const selection = wireHarness();
    renderPipelineResponse(fakeResponse({ selectionContextUsed: true }));
    expect(selection.getHistory().map((entry) => entry.speaker)).toEqual(["Selection"]);
  });

  it("records nothing in incognito — no history and no usage (F-003)", () => {
    const harness = wireHarness({ incognito: true });
    renderPipelineResponse(fakeResponse());
    expect(harness.getHistory()).toEqual([]);
    expect(harness.usage).toEqual([]);
  });
});
