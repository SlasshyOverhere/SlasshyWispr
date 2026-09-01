import { describe, it, expect, beforeEach } from "bun:test";
import {
  matchHistoryToRecordings,
  removeHistoryEntry,
  uiStore,
} from "./store";
import {
  HOME_HISTORY_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  USAGE_STORAGE_KEY,
  SNIPPETS_STORAGE_KEY,
  DICTIONARY_STORAGE_KEY,
  NOTES_STORAGE_KEY,
} from "./constants";
import type { HomeHistoryEntry } from "./types";

function makeEntry(
  overrides: Partial<HomeHistoryEntry> & { timestamp: number },
): HomeHistoryEntry {
  return {
    speaker: "user",
    content: "test content",
    tone: "user",
    ...overrides,
  };
}

// ===== matchHistoryToRecordings =====

describe("matchHistoryToRecordings", () => {
  it("matches a recording to a history entry within the 10-second window", () => {
    const ts = Date.now();
    const entries = [makeEntry({ timestamp: ts })];
    const recordingIds = [`rec_${ts}`];

    const matches = matchHistoryToRecordings(entries, recordingIds);
    expect(matches.length).toBe(1);
    expect(matches[0].timestamp).toBe(ts);
    expect(matches[0].recordingId).toBe(`rec_${ts}`);
  });

  it("does not match a recording outside the 10-second window", () => {
    const ts = Date.now();
    const entries = [makeEntry({ timestamp: ts })];
    // Recording timestamp 15 seconds before the entry
    const recordingIds = [`rec_${ts - 15000}`];

    const matches = matchHistoryToRecordings(entries, recordingIds);
    expect(matches.length).toBe(0);
  });

  it("does not re-match entries that already have a recordingId", () => {
    const ts = Date.now();
    const entries = [makeEntry({ timestamp: ts, recordingId: "rec_existing" })];
    const recordingIds = [`rec_${ts}`];

    const matches = matchHistoryToRecordings(entries, recordingIds);
    expect(matches.length).toBe(0);
  });

  it("skips recording IDs that don't start with rec_", () => {
    const ts = Date.now();
    const entries = [makeEntry({ timestamp: ts })];
    const recordingIds = [`invalid_${ts}`];

    const matches = matchHistoryToRecordings(entries, recordingIds);
    expect(matches.length).toBe(0);
  });

  it("skips recording IDs with non-numeric timestamp", () => {
    const entries = [makeEntry({ timestamp: Date.now() })];
    const recordingIds = ["rec_not-a-number"];

    const matches = matchHistoryToRecordings(entries, recordingIds);
    expect(matches.length).toBe(0);
  });

  it("handles empty inputs", () => {
    expect(matchHistoryToRecordings([], [])).toEqual([]);
    expect(matchHistoryToRecordings([], ["rec_123"])).toEqual([]);
    expect(matchHistoryToRecordings([makeEntry({ timestamp: 1 })], [])).toEqual([]);
  });

  it("matches each recording to at most one entry (first match wins)", () => {
    const ts1 = Date.now();
    const ts2 = ts1 + 5000; // within 10 seconds of same recording
    const entries = [
      makeEntry({ timestamp: ts1 }),
      makeEntry({ timestamp: ts2 }),
    ];
    const recordingIds = [`rec_${ts1}`];

    const matches = matchHistoryToRecordings(entries, recordingIds);
    expect(matches.length).toBe(1);
    // Should match the first eligible entry (ts1)
    expect(matches[0].timestamp).toBe(ts1);
  });

  it("matches multiple recordings to different entries", () => {
    const ts1 = Date.now();
    const ts2 = ts1 + 60000; // far apart
    const entries = [
      makeEntry({ timestamp: ts1 }),
      makeEntry({ timestamp: ts2 }),
    ];
    const recordingIds = [`rec_${ts1}`, `rec_${ts2}`];

    const matches = matchHistoryToRecordings(entries, recordingIds);
    expect(matches.length).toBe(2);
  });
});

// ===== removeHistoryEntry =====

describe("removeHistoryEntry", () => {
  beforeEach(() => {
    localStorage.removeItem(HOME_HISTORY_STORAGE_KEY);
  });

  it("removes an entry matching the given timestamp", () => {
    const entries = [
      makeEntry({ timestamp: 1000 }),
      makeEntry({ timestamp: 2000 }),
      makeEntry({ timestamp: 3000 }),
    ];
    localStorage.setItem(HOME_HISTORY_STORAGE_KEY, JSON.stringify(entries));

    removeHistoryEntry(2000);

    const remaining = JSON.parse(
      localStorage.getItem(HOME_HISTORY_STORAGE_KEY) || "[]",
    );
    expect(remaining.length).toBe(2);
    expect(remaining.every((e: HomeHistoryEntry) => e.timestamp !== 2000)).toBe(
      true,
    );
  });

  it("is a no-op when timestamp does not match any entry", () => {
    const entries = [makeEntry({ timestamp: 1000 })];
    localStorage.setItem(HOME_HISTORY_STORAGE_KEY, JSON.stringify(entries));

    removeHistoryEntry(9999);

    const remaining = JSON.parse(
      localStorage.getItem(HOME_HISTORY_STORAGE_KEY) || "[]",
    );
    expect(remaining.length).toBe(1);
  });

  it("does not crash when localStorage is empty", () => {
    removeHistoryEntry(12345);
    // Should not throw
  });

  it("does not crash when localStorage contains invalid JSON", () => {
    localStorage.setItem(HOME_HISTORY_STORAGE_KEY, "not-json");
    removeHistoryEntry(12345);
    // Should not throw
  });

  it("dispatches slasshy:store-updated event", () => {
    let eventFired = false;
    const handler = () => {
      eventFired = true;
    };
    window.addEventListener("slasshy:store-updated", handler);

    const entries = [makeEntry({ timestamp: 1000 })];
    localStorage.setItem(HOME_HISTORY_STORAGE_KEY, JSON.stringify(entries));
    removeHistoryEntry(1000);

    expect(eventFired).toBe(true);
    window.removeEventListener("slasshy:store-updated", handler);
  });
});

// ===== Settings / Store integration =====

describe("uiStore integration", () => {
  beforeEach(() => {
    localStorage.removeItem(HOME_HISTORY_STORAGE_KEY);
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
    localStorage.removeItem(USAGE_STORAGE_KEY);
    localStorage.removeItem(SNIPPETS_STORAGE_KEY);
    localStorage.removeItem(DICTIONARY_STORAGE_KEY);
    localStorage.removeItem(NOTES_STORAGE_KEY);
  });

  it("returns default state when localStorage is empty", () => {
    const state = uiStore.getState();
    expect(state.activePage).toBe("home");
    expect(state.history).toEqual([]);
    expect(state.dictionary).toEqual([]);
    expect(state.snippets).toEqual([]);
    expect(state.notes).toEqual([]);
    expect(state.usage.sessions).toBe(0);
    expect(state.usage.words).toBe(0);
  });

  it("loads history from localStorage", () => {
    const entries = [
      makeEntry({ timestamp: 1000, content: "hello world" }),
      makeEntry({ timestamp: 2000, content: "goodbye world", tone: "assistant" }),
    ];
    localStorage.setItem(HOME_HISTORY_STORAGE_KEY, JSON.stringify(entries));

    uiStore.reNotify();
    const state = uiStore.getState();
    expect(state.history.length).toBe(2);
    expect(state.history[0].content).toBe("hello world");
    expect(state.history[1].tone).toBe("assistant");
  });

  it("filters out malformed history entries", () => {
    const entries = [
      makeEntry({ timestamp: 1000 }),
      { timestamp: 2000 }, // missing speaker/content
      null, // null entry
      { speaker: "user", content: "ok", timestamp: 3000 }, // missing tone
    ];
    localStorage.setItem(HOME_HISTORY_STORAGE_KEY, JSON.stringify(entries));

    uiStore.reNotify();
    const state = uiStore.getState();
    // Only the valid entry should survive
    expect(state.history.length).toBe(1);
    expect(state.history[0].timestamp).toBe(1000);
  });

  it("loads usage stats from localStorage", () => {
    const stats = {
      sessions: 42,
      words: 12345,
      avgWpm: 120,
      speakingSeconds: 3600,
      prevSessions: 10,
      prevWords: 3000,
      prevWpm: 115,
      prevSpeakingSeconds: 900,
      lastPeriodReset: Date.now(),
    };
    localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(stats));

    uiStore.reNotify();
    const state = uiStore.getState();
    expect(state.usage.sessions).toBe(42);
    expect(state.usage.words).toBe(12345);
    expect(state.usage.avgWpm).toBe(120);
  });

  it("handles malformed usage stats JSON gracefully", () => {
    localStorage.setItem(USAGE_STORAGE_KEY, "not-valid-json{");

    uiStore.reNotify();
    const state = uiStore.getState();
    // Should fall back to defaults
    expect(state.usage.sessions).toBe(0);
    expect(state.usage.words).toBe(0);
  });

  it("handles NaN values in usage stats by falling back to 0", () => {
    const stats = { sessions: NaN, words: NaN, avgWpm: NaN };
    localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(stats));

    uiStore.reNotify();
    const state = uiStore.getState();
    expect(state.usage.sessions).toBe(0);
    expect(state.usage.words).toBe(0);
  });

  it("loads snippets from localStorage", () => {
    const snippets = [
      {
        id: "s1",
        trigger: "brb",
        expansion: "be right back",
        createdAt: Date.now(),
      },
    ];
    localStorage.setItem(SNIPPETS_STORAGE_KEY, JSON.stringify(snippets));

    uiStore.reNotify();
    const state = uiStore.getState();
    expect(state.snippets.length).toBe(1);
    expect(state.snippets[0].trigger).toBe("brb");
  });

  it("loads notes from localStorage", () => {
    const notes = [
      { id: "n1", text: "remember this", createdAt: Date.now() },
    ];
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));

    uiStore.reNotify();
    const state = uiStore.getState();
    expect(state.notes.length).toBe(1);
    expect(state.notes[0].text).toBe("remember this");
  });

  it("filters out notes without text field", () => {
    const notes = [
      { id: "n1", text: "valid note", createdAt: Date.now() },
      { id: "n2", createdAt: Date.now() }, // missing text
    ];
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));

    uiStore.reNotify();
    const state = uiStore.getState();
    expect(state.notes.length).toBe(1);
  });

  it("notify listeners on custom event", () => {
    let notified = false;
    const unsub = uiStore.subscribe(() => {
      notified = true;
    });

    window.dispatchEvent(new CustomEvent("slasshy:store-updated"));
    expect(notified).toBe(true);
    unsub();
  });

  it("subscribe returns unsubscribe function", () => {
    let callCount = 0;
    const unsub = uiStore.subscribe(() => {
      callCount++;
    });

    window.dispatchEvent(new CustomEvent("slasshy:store-updated"));
    expect(callCount).toBe(1);

    unsub();
    window.dispatchEvent(new CustomEvent("slasshy:store-updated"));
    expect(callCount).toBe(1); // Should not increase
  });
});

// ===== History entry validation edge cases =====

describe("history entry validation in loadHistory", () => {
  beforeEach(() => {
    localStorage.removeItem(HOME_HISTORY_STORAGE_KEY);
  });

  it("rejects entries with non-string speaker", () => {
    const entries = [
      { speaker: 123, content: "test", tone: "user", timestamp: 1000 },
    ];
    localStorage.setItem(HOME_HISTORY_STORAGE_KEY, JSON.stringify(entries));

    uiStore.reNotify();
    const state = uiStore.getState();
    expect(state.history.length).toBe(0);
  });

  it("rejects entries with non-string content", () => {
    const entries = [
      { speaker: "user", content: 42, tone: "user", timestamp: 1000 },
    ];
    localStorage.setItem(HOME_HISTORY_STORAGE_KEY, JSON.stringify(entries));

    uiStore.reNotify();
    const state = uiStore.getState();
    expect(state.history.length).toBe(0);
  });

  it("rejects entries with invalid tone", () => {
    const entries = [
      { speaker: "user", content: "test", tone: "invalid", timestamp: 1000 },
    ];
    localStorage.setItem(HOME_HISTORY_STORAGE_KEY, JSON.stringify(entries));

    uiStore.reNotify();
    const state = uiStore.getState();
    expect(state.history.length).toBe(0);
  });

  it("rejects entries with non-numeric timestamp", () => {
    const entries = [
      { speaker: "user", content: "test", tone: "user", timestamp: "not-a-number" },
    ];
    localStorage.setItem(HOME_HISTORY_STORAGE_KEY, JSON.stringify(entries));

    uiStore.reNotify();
    const state = uiStore.getState();
    expect(state.history.length).toBe(0);
  });

  it("accepts both user and assistant tone entries", () => {
    const entries = [
      makeEntry({ timestamp: 1000, tone: "user" }),
      makeEntry({ timestamp: 2000, tone: "assistant" }),
    ];
    localStorage.setItem(HOME_HISTORY_STORAGE_KEY, JSON.stringify(entries));

    uiStore.reNotify();
    const state = uiStore.getState();
    expect(state.history.length).toBe(2);
  });
});
