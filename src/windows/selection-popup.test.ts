/**
 * Selection-popup move-boundary test — Phase 5 shell decomposition.
 *
 * Pins the pure size helpers (clamp/estimate/apply) and the channel
 * action routing (request-state payload/clear, copy-result, close-popup
 * hide) without creating real Tauri windows. WebviewWindow is stubbed
 * with mock.module.
 */
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { SELECTION_POPUP_MIN_HEIGHT } from "../constants";

mock.module("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    static getByLabel = async () => null;
  },
}));

mock.module("@tauri-apps/api/window", () => ({
  LogicalSize: class {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
  // selection-popup.ts pulls prefersReducedMotion from dock-geometry, which
  // imports monitor helpers at module scope; stub them so the import resolves.
  currentMonitor: async () => null,
  availableMonitors: async () => [],
}));

// Import after the mocks.
const popup = await import("./selection-popup");
import type { SelectionPopupPayload } from "../types";

function fakePayload(text = "hello world"): SelectionPopupPayload {
  return { token: 1, mode: "rewrite", title: "t", text, audioBase64: "" };
}

function wireHarness(win: unknown = null) {
  const posted: unknown[] = [];
  const notices: Array<{ message: string; isError?: boolean }> = [];
  const copied: string[] = [];
  let latest: SelectionPopupPayload | null = null;
  let hidden = 0;
  let focusCalls = 0;
  const channel = {
    posted,
    postMessage(message: unknown) {
      posted.push(message);
    },
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
  };
  popup.initSelectionPopup(
    {
      isTauri: () => true,
      notify: (message, isError) => {
        notices.push({ message, isError });
      },
      log: () => {},
      copyResult: (text) => {
        copied.push(text);
      },
      replaceSelection: async () => true,
      getWindow: () => win as never,
      setWindow: () => {},
      getLatestPayload: () => latest,
      setLatestPayload: (payload) => {
        latest = payload;
      },
      nextToken: () => 7,
      focusMainWindow: async () => {
        focusCalls += 1;
      },
    },
    channel as unknown as BroadcastChannel,
  );
  return {
    posted,
    notices,
    copied,
    focusCalls: () => focusCalls,
    setLatest: (payload: SelectionPopupPayload | null) => {
      latest = payload;
    },
    send: (action: string) => {
      channel.onmessage?.({ data: { kind: "action", action } } as MessageEvent<unknown>);
    },
    hiddenCalls: () => hidden,
    markHidden: () => {
      hidden += 1;
    },
  };
}

beforeEach(() => {
  wireHarness();
});

describe("size helpers", () => {
  it("clamps and estimates deterministically", () => {
    expect(popup.clampSelectionPopupHeight(1_000_000)).toBeLessThanOrEqual(560);
    expect(popup.estimateSelectionPopupHeight("")).toBe(SELECTION_POPUP_MIN_HEIGHT);
    const oneLine = popup.estimateSelectionPopupHeight("hello");
    const twoLines = popup.estimateSelectionPopupHeight("hello\nworld");
    expect(twoLines).toBeGreaterThanOrEqual(oneLine);
  });

  it("applies the estimated size to the window", async () => {
    const sizes: Array<{ width: number; height: number }> = [];
    const win = {
      setSize: async (size: { width: number; height: number }) => {
        sizes.push(size);
      },
    };
    await popup.applySelectionPopupSize(win as never, fakePayload("hello"));
    expect(sizes.length).toBe(1);
    expect(sizes[0].width).toBe(640);
  });

  it("hands out tokens from the shell counter", () => {
    wireHarness();
    expect(popup.nextSelectionPopupToken()).toBe(7);
  });
});

describe("channel actions", () => {
  it("answers request-state with payload or clear", () => {
    const harness = wireHarness();
    harness.setLatest(fakePayload("abc"));
    harness.send("request-state");
    expect(harness.posted).toEqual([{ kind: "payload", payload: fakePayload("abc") }]);

    const empty = wireHarness();
    empty.send("request-state");
    expect(empty.posted).toEqual([{ kind: "clear" }]);
  });

  it("routes copy-result through the copy seam", () => {
    const harness = wireHarness();
    harness.setLatest(fakePayload("copy me"));
    harness.send("copy-result");
    expect(harness.copied).toEqual(["copy me"]);
  });

  it("ignores non-action messages", () => {
    const harness = wireHarness();
    harness.send("not-a-real-action");
    expect(harness.posted).toEqual([]);
    expect(harness.copied).toEqual([]);
  });

  it("leaves focus alone when no popup window exists (dictation paste path)", async () => {
    const harness = wireHarness();
    await popup.dismissSelectionPopup();
    expect(harness.focusCalls()).toBe(0);
  });

  it("returns focus when a visible popup is dismissed", async () => {
    const harness = wireHarness({ isVisible: async () => true, hide: async () => {} });
    await popup.dismissSelectionPopup();
    expect(harness.focusCalls()).toBe(1);
  });

  it("leaves focus alone when a hidden popup is dismissed", async () => {
    const harness = wireHarness({ isVisible: async () => false, hide: async () => {} });
    await popup.dismissSelectionPopup();
    expect(harness.focusCalls()).toBe(0);
  });
});
