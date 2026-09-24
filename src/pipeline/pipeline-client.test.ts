/**
 * Pipeline-client move-boundary test — Phase 5 shell decomposition.
 *
 * Pins runPipeline gating branches without invoking IPC: missing local
 * STT files, missing local STT model, STT not loaded, and missing local
 * Ollama model each block with the right notice + pipeline-blocked
 * transition and never reach run_assistant_pipeline. A local-STT
 * success path pins the invoke request shape (camelCase contract,
 * commandMode/selectedText/systemPrompt/temperature/maxTokens).
 *
 * The Tauri invoke layer is stubbed with mock.module (same pattern as
 * ipc/client.test.ts) so ipc/client.ts routes through the harness.
 * FileReader is stubbed because bun has no DOM FileReader.
 */
import { describe, it, expect, mock, beforeEach } from "bun:test";

const invokeCalls: Array<{ command: string; args: unknown }> = [];
let invokeResult: unknown = null;

mock.module("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => {
    invokeCalls.push({ command, args });
    return Promise.resolve(invokeResult);
  },
}));

// Import after the mocks so the client binds the stubbed invoke.
const { initPipelineClient, runPipeline } = await import("./pipeline-client");
const { initCommandMode } = await import("../recording/command-mode");
const { initPipelineRender } = await import("./pipeline-render");
const { defaultSettings: makeDefaultSettings } = await import("../state/settings-store");
import type { AssistantPipelineResponse } from "../types";

class StubFileReader {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  result: string | null = null;
  readAsDataURL(blob: Blob) {
    const self = this;
    void blob.arrayBuffer().then((buffer) => {
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }
      self.result = `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
      self.onload?.();
    });
  }
}

function fakeElement(value = ""): HTMLInputElement {
  return { value } as unknown as HTMLInputElement;
}

function fakeResponse(overrides: Partial<AssistantPipelineResponse> = {}): AssistantPipelineResponse {
  return {
    transcript: "hello",
    assistantResponse: "hello",
    mode: "dictation",
    sttLatencyMs: 1,
    aiLatencyMs: 2,
    ttsLatencyMs: 3,
    totalLatencyMs: 6,
    audioBase64: "",
    selectionRewrite: false,
    selectionPending: false,
    selectionContextUsed: false,
    ...overrides,
  } as AssistantPipelineResponse;
}

function wireHarness(options: {
  sttMode?: "online" | "local";
  aiMode?: "online" | "local";
  localSttModel?: string;
  modelExists?: boolean;
  sttLoaded?: boolean;
  ollamaModel?: string;
  response?: AssistantPipelineResponse;
  catalog?: string[];
} = {}) {
  const notices: Array<{ message: string; isError?: boolean }> = [];
  const transitions: unknown[] = [];
  const settings = {
    ...makeDefaultSettings(),
    sttRuntimeMode: options.sttMode ?? "local",
    aiRuntimeMode: options.aiMode ?? "online",
    localSttModel: options.localSttModel ?? "parakeet-tdt-0.6b-v3",
    localOllamaModel: options.ollamaModel ?? "",
    apiKey: "test-key",
  };

  initCommandMode({
    isTauri: () => false,
    captureSelectedText: async () => null,
    setNotice: () => {},
    log: () => {},
    publishDockState: () => {},
  });

  initPipelineRender(
    {
      sttLatency: { textContent: "" } as unknown as HTMLElement,
      aiLatency: { textContent: "" } as unknown as HTMLElement,
      ttsLatency: { textContent: "" } as unknown as HTMLElement,
      totalLatency: { textContent: "" } as unknown as HTMLElement,
    },
    {
      isIncognito: () => true,
      now: () => 0,
      getRecordingStartedAt: () => 0,
      getLastSavedRecordingId: () => null,
      getLastCaptureIntentLabel: () => "",
      trackUsage: () => {},
      getHomeHistory: () => [],
      setHomeHistory: () => {},
      persistHomeHistory: () => {},
      notifyStoreUpdated: () => {},
      getRecentTurns: () => [],
    },
  );

  initPipelineClient(
    { localSttModelInput: fakeElement(), localSttModelCatalogSelect: fakeElement() },
    {
      readSettings: () => settings,
      getStage: () => "processing",
      markIdle: () => {},
      transition: (event) => {
        transitions.push(event);
      },
      syncAvailability: () => {},
      setPipelineRunning: () => {},
      notify: (message, isError) => {
        notices.push({ message, isError });
      },
      log: () => {},
      getLocalSttCatalog: () => options.catalog ?? ["parakeet-tdt-0.6b-v3"],
      commitFormSettings: () => {},
      checkModelFileExists: async () => options.modelExists ?? true,
      localSttModelLabel: (model) => model,
      refreshLocalSttRuntimeState: async () => {},
      warmupActiveLocalSttModel: async () => null,
      isSelectedLocalSttModelLoaded: () => options.sttLoaded ?? true,
      getLocalSttRuntimeLoaded: () => true,
      getLastWarmedLocalSttModel: () => settings.localSttModel,
      setLastWarmedLocalSttModel: () => {},
      ensureLocalOllamaModelSelected: async () => settings.localOllamaModel,
      nextSelectionPopupToken: () => 1,
      dismissSelectionPopup: async () => {},
      showSelectionAssistantPopup: async () => false,
      triggerAutoPaste: async () => false,
      copyToClipboard: async () => true,
      openSettings: () => {},
      setActiveSettingsPane: () => {},
      refreshAssistantInfo: async () => {},
    },
  );

  invokeResult = options.response ?? fakeResponse();
  return { notices, transitions, settings };
}

beforeEach(() => {
  invokeCalls.length = 0;
  invokeResult = fakeResponse();
  (globalThis as unknown as { FileReader?: unknown }).FileReader = StubFileReader;
});

describe("runPipeline local-STT gating", () => {
  it("blocks when the selected model files are missing", async () => {
    const harness = wireHarness({ modelExists: false });
    await runPipeline(new Blob(["x"]), "audio/webm");
    expect(invokeCalls).toEqual([]);
    expect(harness.notices[0].message).toContain("is not downloaded yet");
    expect(harness.transitions).toContainEqual({
      type: "pipeline-blocked",
      reason: "Local setup required.",
    });
  });

  it("blocks when no local STT model is selected", async () => {
    const harness = wireHarness({ localSttModel: "", catalog: [] });
    await runPipeline(new Blob(["x"]), "audio/webm");
    expect(invokeCalls).toEqual([]);
    expect(harness.notices[0].message).toContain("needs a local STT model");
    expect(harness.transitions).toContainEqual({
      type: "pipeline-blocked",
      reason: "Local setup required.",
    });
  });

  it("blocks when local STT is not loaded", async () => {
    const harness = wireHarness({ sttLoaded: false });
    await runPipeline(new Blob(["x"]), "audio/webm");
    expect(invokeCalls).toEqual([]);
    expect(harness.notices[0].message).toContain("Local STT is not loaded");
  });

  it("blocks when local AI mode has no Ollama model", async () => {
    const harness = wireHarness({ aiMode: "local", ollamaModel: "" });
    await runPipeline(new Blob(["x"]), "audio/webm");
    expect(invokeCalls).toEqual([]);
    expect(harness.notices[0].message).toContain("Local AI mode needs a local Ollama model");
  });
});

describe("runPipeline capture-gate release", () => {
  it("marks idle and clears pipeline-running before the paste tail settles", async () => {
    const order: string[] = [];
    let runningAtPasteTime: boolean | null = null;
    const { initPipelineClient: initClient, runPipeline: run } = await import("./pipeline-client");
    const settings = {
      ...makeDefaultSettings(),
      sttRuntimeMode: "online" as const,
      aiRuntimeMode: "online" as const,
      apiKey: "test-key",
      autoPasteDictation: true,
      copyToClipboard: true,
    };

    initClient(
      { localSttModelInput: fakeElement(), localSttModelCatalogSelect: fakeElement() },
      {
        readSettings: () => settings,
        getStage: () => "processing",
        markIdle: () => {
          order.push("markIdle");
        },
        transition: () => {},
        syncAvailability: () => {},
        setPipelineRunning: (running: boolean) => {
          order.push(`pipelineRunning=${running}`);
        },
        notify: () => {},
        log: () => {},
        getLocalSttCatalog: () => [],
        commitFormSettings: () => {},
        checkModelFileExists: async () => true,
        localSttModelLabel: (model) => model,
        refreshLocalSttRuntimeState: async () => {},
        warmupActiveLocalSttModel: async () => null,
        isSelectedLocalSttModelLoaded: () => true,
        getLocalSttRuntimeLoaded: () => true,
        getLastWarmedLocalSttModel: () => "",
        setLastWarmedLocalSttModel: () => {},
        ensureLocalOllamaModelSelected: async () => "",
        nextSelectionPopupToken: () => 1,
        dismissSelectionPopup: async () => {},
        showSelectionAssistantPopup: async () => false,
        triggerAutoPaste: async () => {
          runningAtPasteTime = order.includes("pipelineRunning=false");
          order.push("paste");
          return true;
        },
        copyToClipboard: async () => true,
        openSettings: () => {},
        setActiveSettingsPane: () => {},
        refreshAssistantInfo: async () => {
          order.push("refresh");
        },
      },
    );

    invokeResult = fakeResponse({ mode: "dictation" });
    await run(new Blob(["hello-audio"]), "audio/webm");

    expect(runningAtPasteTime).toBe(true);
    expect(order.indexOf("markIdle")).toBeLessThan(order.indexOf("paste"));
    expect(order.indexOf("pipelineRunning=false")).toBeLessThan(order.indexOf("paste"));
  });
});

describe("runPipeline invoke shape", () => {
  it("sends the camelCase contract with prompt and command flags", async () => {
    wireHarness({ sttMode: "online", response: fakeResponse({ mode: "assistant" }) });
    await runPipeline(new Blob(["hello-audio"]), "audio/webm");
    expect(invokeCalls.length).toBe(1);
    const call = invokeCalls[0];
    expect(call.command).toBe("run_assistant_pipeline");
    const request = (call.args as { request: Record<string, unknown> }).request;
    expect(request.audioMimeType).toBe("audio/webm");
    expect(typeof request.systemPrompt).toBe("string");
    expect(request.commandMode).toBe(false);
    expect(request.temperature).toBe(makeDefaultSettings().temperature);
    expect(request.maxTokens).toBe(makeDefaultSettings().maxTokens);
    expect(request.ttsEngine).toBe(makeDefaultSettings().ttsEngine);
    expect(request.voiceClone).toBeNull();
    expect("audio_base64" in request).toBe(false);
  });
});
