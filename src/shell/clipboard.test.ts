/**
 * Clipboard move-boundary test — Phase 5 shell decomposition.
 *
 * Pins copyToClipboard (Tauri IPC path, web clipboard path, quiet flag,
 * failure notice) and triggerAutoPaste (non-Tauri false, text vs
 * clipboard-empty dispatch, failure notice). IPC is stubbed with
 * mock.module; navigator.clipboard is stubbed per test.
 */
import { describe, it, expect, mock, beforeEach } from "bun:test";

const invokeCalls: Array<{ command: string; args: unknown }> = [];
let invokeImpl: (command: string, args?: unknown) => Promise<unknown> = async () => null;

mock.module("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => {
    invokeCalls.push({ command, args });
    return invokeImpl(command, args);
  },
}));

// Import after the mock so IPC wrappers bind the stub.
const { copyToClipboard, initClipboard, triggerAutoPaste } = await import("./clipboard");

function wireHarness(tauri = true) {
  const notices: Array<{ message: string; isError?: boolean }> = [];
  initClipboard({
    isTauri: () => tauri,
    notify: (message, isError) => {
      notices.push({ message, isError });
    },
  });
  return { notices };
}

beforeEach(() => {
  invokeCalls.length = 0;
  invokeImpl = async () => null;
  wireHarness(true);
});

describe("copyToClipboard", () => {
  it("uses the Tauri IPC path with the default success notice", async () => {
    const harness = wireHarness(true);
    await expect(copyToClipboard("hello")).resolves.toBe(true);
    expect(invokeCalls).toEqual([
      { command: "set_clipboard_text", args: { text: "hello" } },
    ]);
    expect(harness.notices).toEqual([
      { message: "Assistant response copied to clipboard.", isError: undefined },
    ]);
  });

  it("uses navigator.clipboard on web and honors quiet", async () => {
    const harness = wireHarness(false);
    const written: string[] = [];
    (globalThis as unknown as { navigator: unknown }).navigator = {
      clipboard: {
        writeText: async (text: string) => {
          written.push(text);
        },
      },
    };
    await expect(copyToClipboard("web text", { quiet: true })).resolves.toBe(true);
    expect(written).toEqual(["web text"]);
    expect(harness.notices).toEqual([]);
    expect(invokeCalls).toEqual([]);
  });

  it("notices on failure and returns false", async () => {
    const harness = wireHarness(true);
    invokeImpl = async () => {
      throw new Error("ipc down");
    };
    await expect(copyToClipboard("x")).resolves.toBe(false);
    expect(harness.notices).toEqual([
      {
        message: "Unable to copy response to clipboard in this environment.",
        isError: true,
      },
    ]);
  });
});

describe("triggerAutoPaste", () => {
  it("returns false outside Tauri without IPC", async () => {
    wireHarness(false);
    await expect(triggerAutoPaste("hello")).resolves.toBe(false);
    expect(invokeCalls).toEqual([]);
  });

  it("dispatches text vs clipboard-empty pastes", async () => {
    wireHarness(true);
    await expect(triggerAutoPaste("hello")).resolves.toBe(true);
    await expect(triggerAutoPaste()).resolves.toBe(true);
    expect(invokeCalls.map((call) => call.command)).toEqual([
      "paste_text_via_clipboard",
      "paste_clipboard_text",
    ]);
  });

  it("refuses a whitespace-only payload instead of pasting stale clipboard", async () => {
    wireHarness(true);
    await expect(triggerAutoPaste("   ")).resolves.toBe(false);
    expect(invokeCalls).toEqual([]);
  });

  it("notices on failure and returns false", async () => {
    const harness = wireHarness(true);
    invokeImpl = async () => {
      throw new Error("paste down");
    };
    await expect(triggerAutoPaste("hello")).resolves.toBe(false);
    expect(harness.notices[0].message).toContain("Auto paste failed");
  });
});
