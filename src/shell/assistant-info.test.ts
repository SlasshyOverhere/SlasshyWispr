/**
 * Assistant-info move-boundary test — Phase 5 shell decomposition.
 *
 * Pins renderAssistantInfo: version text, local vs online model/base-url
 * selection, placeholder fills, installed/missing TTS labels, and the
 * runtime-ready flag plus gate callback. Runs against stub elements.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { initAssistantInfo, renderAssistantInfo } from "./assistant-info";
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
