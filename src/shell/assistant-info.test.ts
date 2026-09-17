/**
 * Assistant-info move-boundary test — Phase 5 shell decomposition.
 *
 * Pins renderAssistantInfo: version text, local vs online model/base-url
 * selection, placeholder fills, installed/missing TTS labels, and the
 * runtime-ready flag plus gate callback. Runs against stub elements.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import {
  initAssistantInfo,
  initAssistantStatus,
  refreshAssistantInfo,
  refreshAssistantInfoSafely,
  renderAssistantInfo,
} from "./assistant-info";
import type { AssistantInfoResponse } from "../types";

function fakeParagraph(): HTMLParagraphElement {
  return { textContent: "" } as unknown as HTMLParagraphElement;
}

function fakeElement(): HTMLElement {
  return { textContent: "" } as unknown as HTMLElement;
}

function fakeInput(): HTMLInputElement {
  return { placeholder: "" } as unknown as HTMLInputElement;
}

function fakeResponse(overrides: Partial<AssistantInfoResponse> = {}): AssistantInfoResponse {
  return {
    appVersion: "1.2.3",
    baseUrl: "https://api.example.com/v1",
    sttModel: "whisper-1",
    aiModel: "gpt-4o",
    piperInstalled: true,
    piperPath: "/usr/bin/piper",
    voiceInstalled: true,
    voiceModelPath: "/models/voice.onnx",
    ...overrides,
  } as AssistantInfoResponse;
}

function wireHarness(modes: { stt?: string; ai?: string } = {}) {
  const elements = {
    settingsVersionText: fakeParagraph(),
    updateCurrentVersion: fakeElement(),
    baseUrlValue: fakeElement(),
    sttModelValue: fakeElement(),
    aiModelValue: fakeElement(),
    piperStatusValue: fakeElement(),
    piperPathValue: fakeElement(),
    voiceStatusValue: fakeElement(),
    voicePathValue: fakeElement(),
  };
  const formRefs = {
    apiBaseUrlInput: fakeInput(),
    sttModelInput: fakeInput(),
    aiModelInput: fakeInput(),
    localOllamaBaseUrlInput: fakeInput(),
    runtimeModeNotice: fakeElement(),
  };
  let latest: AssistantInfoResponse | null = null;
  let ready = false;
  let gates = 0;
  initAssistantInfo(elements, {
    getSttRuntimeMode: () => (modes.stt ?? "online") as never,
    getAiRuntimeMode: () => (modes.ai ?? "online") as never,
    getLocalOllamaBaseUrl: () => "",
    getApiBaseUrl: () => "https://custom.example.com/v1",
    getLocalSttModel: () => "nvidia/parakeet-tdt-0.6b-v3",
    getSttModelName: () => "whisper-1",
    getLocalOllamaModel: () => "llama3",
    getAiModelName: () => "gpt-4o",
    getFormRefs: () => formRefs as never,
    setLatestDefaults: (info) => {
      latest = info;
    },
    setPiperRuntimeReady: (value) => {
      ready = value;
    },
    updateTtsSetupGate: () => {
      gates += 1;
    },
  });
  return {
    elements,
    formRefs,
    getLatest: () => latest,
    isReady: () => ready,
    gates: () => gates,
  };
}

beforeEach(() => {
  wireHarness();
});

describe("renderAssistantInfo", () => {
  it("renders version, online models, placeholders, and TTS state", () => {
    const harness = wireHarness();
    const info = fakeResponse();
    renderAssistantInfo(info);
    expect(harness.elements.settingsVersionText.textContent).toBe("SlasshyWispr v1.2.3");
    expect(harness.elements.updateCurrentVersion.textContent).toBe("1.2.3");
    expect(harness.elements.baseUrlValue.textContent).toBe("https://custom.example.com/v1");
    expect(harness.elements.sttModelValue.textContent).toBe("whisper-1");
    expect(harness.elements.aiModelValue.textContent).toBe("gpt-4o");
    expect(harness.formRefs.apiBaseUrlInput.placeholder).toBe("https://api.example.com/v1");
    expect(harness.elements.piperStatusValue.textContent).toBe("Installed");
    expect(harness.elements.voicePathValue.textContent).toBe("/models/voice.onnx");
    expect(harness.getLatest()).toBe(info);
    expect(harness.isReady()).toBe(true);
    expect(harness.gates()).toBe(1);
  });

  it("prefers local models in local mode and marks missing TTS", () => {
    const harness = wireHarness({ stt: "local", ai: "local" });
    renderAssistantInfo(
      fakeResponse({ appVersion: "", piperInstalled: false, voiceInstalled: false }),
    );
    expect(harness.elements.settingsVersionText.textContent).toBe("SlasshyWispr");
    expect(harness.elements.sttModelValue.textContent).toBe("nvidia/parakeet-tdt-0.6b-v3");
    expect(harness.elements.aiModelValue.textContent).toBe("llama3");
    expect(harness.elements.piperStatusValue.textContent).toBe("Missing");
    expect(harness.isReady()).toBe(false);
  });
});

describe("refreshAssistantInfo", () => {
  function wireStatus(options: {
    info?: AssistantInfoResponse;
    fetchError?: unknown;
    piperPathValue?: string;
  } = {}) {
    wireHarness();
    const renders: { provider: string[]; ollama: string[]; stt: string[] } = {
      provider: [],
      ollama: [],
      stt: [],
    };
    const notices: string[] = [];
    let settingsChanged = 0;
    const piperPathInput = { value: options.piperPathValue ?? "" } as HTMLInputElement;
    const info = options.info ?? fakeResponse();
    initAssistantStatus({
      fetchInfo: async () => {
        if (options.fetchError !== undefined) throw options.fetchError;
        return info;
      },
      notify: (message) => {
        notices.push(message);
      },
      renderProviderCatalog: (models) => {
        renders.provider = models;
      },
      renderLocalOllamaCatalog: (models) => {
        renders.ollama = models;
      },
      renderLocalSttCatalog: (models) => {
        renders.stt = models;
      },
      getProviderCatalog: () => ["gpt-4o"],
      getLocalOllamaCatalog: () => ["llama3"],
      getLocalSttCatalog: () => ["parakeet"],
      getSettings: () => ({
        aiModelName: "gpt-4o",
        sttModelName: "whisper-1",
        localOllamaModel: "llama3",
        localSttModel: "parakeet",
      }),
      getPiperPathInput: () => piperPathInput,
      onSettingsChanged: () => {
        settingsChanged += 1;
      },
    });
    return { renders, notices, piperPathInput, settingsChanged: () => settingsChanged };
  }

  it("renders info plus catalogs and backfills an empty piper path", async () => {
    const harness = wireStatus();
    await refreshAssistantInfo();
    expect(harness.renders.provider).toEqual(["gpt-4o"]);
    expect(harness.renders.ollama).toEqual(["llama3"]);
    expect(harness.renders.stt).toEqual(["parakeet"]);
    expect(harness.piperPathInput.value).toBe("/usr/bin/piper");
    expect(harness.settingsChanged()).toBe(1);
  });

  it("notifies instead of throwing on fetch failure", async () => {
    const harness = wireStatus({ fetchError: new Error("offline") });
    await refreshAssistantInfoSafely();
    expect(harness.notices).toEqual(["Unable to refresh runtime status: offline"]);
  });
});
