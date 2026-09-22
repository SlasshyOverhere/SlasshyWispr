/**
 * Local-STT diagnostics move-boundary test — Phase 5 shell decomposition.
 *
 * Pins the pure getOfflineDiagnosticData matrix (every issue key + the
 * default branch carry distinct titles and at least one action). IPC is
 * stubbed with mock.module.
 */
import { describe, it, expect, mock, beforeEach } from "bun:test";

const invokeCalls: Array<{ command: string; args: unknown }> = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => {
    invokeCalls.push({ command, args });
    return Promise.resolve(null);
  },
}));

// Import after the mock so IPC wrappers bind the stub.
const diagnostics = await import("./local-stt-diagnostics");
const { defaultSettings: makeDefaultSettings } = await import("../state/settings-store");

function wireHarness() {
  const notices: Array<{ message: string; isError?: boolean }> = [];
  diagnostics.initLocalSttDiagnostics({
    readSettings: () => makeDefaultSettings(),
    commitSettings: () => {},
    notify: (message, isError) => {
      notices.push({ message, isError });
    },
    openSettings: () => {},
    setActiveSettingsPane: () => {},
    openInSystemBrowser: () => {},
    activateSelectedLocalSttModel: () => {},
  });
  return { notices };
}

beforeEach(() => {
  invokeCalls.length = 0;
  wireHarness();
});

describe("getOfflineDiagnosticData", () => {
  it("covers every issue key with a distinct title and actions", () => {
    const cases = [
      "no-model-downloaded",
      "wrong-stt-mode",
      "model-file-missing",
      "insufficient-memory",
      "load-timeout",
      "some raw error string",
    ];
    const titles = new Set<string>();
    for (const issue of cases) {
      const data = diagnostics.getOfflineDiagnosticData(issue, { model: "m" });
      expect(data.title.length).toBeGreaterThan(0);
      expect(data.steps.length).toBeGreaterThan(0);
      expect(data.actions.length).toBeGreaterThan(0);
      titles.add(data.title);
    }
    // All branches distinct except the default, which echoes the raw issue.
    expect(titles.size).toBe(cases.length);
  });

  it("includes the model name in the file-missing description", () => {
    const data = diagnostics.getOfflineDiagnosticData("model-file-missing", {
      model: "nvidia/parakeet-tdt-0.6b-v3",
    });
    expect(data.description).toContain("nvidia/parakeet-tdt-0.6b-v3");
  });
});

