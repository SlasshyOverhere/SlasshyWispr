/**
 * Availability move-boundary test — Phase 5 shell decomposition.
 *
 * Pins syncActionAvailability: idle leaves controls enabled, recording
 * disables the busy set, local-STT busy gates the STT controls, and
 * all-online runtimes additionally lock the provider fields. Runs
 * against stub elements and form refs.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { initAvailability, syncActionAvailability } from "./availability";
import type { SettingsFormRefs } from "../settings/settings-form-refs";

function fakeButton(disabled = false): HTMLButtonElement {
  return { disabled } as unknown as HTMLButtonElement;
}

function fakeInput(disabled = false): HTMLInputElement {
  return { disabled } as unknown as HTMLInputElement;
}

function fakeSelect(disabled = false): HTMLSelectElement {
  return { disabled } as unknown as HTMLSelectElement;
}

function fakeFormRefs(): SettingsFormRefs {
  const input = () => fakeInput();
  const option = () => fakeInput();
  return {
    sttRuntimeModeOnlineInput: input(),
    sttRuntimeModeOfflineInput: input(),
    aiRuntimeModeOnlineInput: input(),
    aiRuntimeModeOfflineInput: input(),
    microphoneSelect: fakeSelect(),
    dictationLanguageSelect: fakeSelect(),
    dictationLanguageModeSingleInput: input(),
    dictationLanguageModeMultipleInput: input(),
    dictationLanguageOptionInputs: [option(), option()],
    styleProfileSelect: fakeSelect(),
    apiKeyInput: input(),
    rememberApiKeyInput: input(),
    apiBaseUrlInput: input(),
    sttModelInput: input(),
    aiModelInput: input(),
    localOllamaBaseUrlInput: input(),
    localOllamaModelInput: input(),
    piperPathInput: input(),
    piperQualitySelect: fakeSelect(),
    piperEmotionSelect: fakeSelect(),
    piperSpeedInput: input(),
    captureModeSingleInput: input(),
    captureModePushToTalkInput: input(),
    commandModeToggle: input(),
    wakeWordEnabledToggle: input(),
    assistantNameInput: input(),
    autoPasteDictationToggle: input(),
    contextAwarenessToggle: input(),
    copyToClipboardToggle: input(),
    incognitoModeToggle: input(),
    themeModeSelect: fakeSelect(),
    themeCardInputs: [input()],
    backtrackToggle: input(),
    removeFillersToggle: input(),
    autoPunctuationToggle: input(),
    numberedListsToggle: input(),
  } as unknown as SettingsFormRefs;
}

function wireHarness(options: {
  stage?: string;
  pipelineRunning?: boolean;
  sttMode?: string;
  aiMode?: string;
  localSttBusy?: boolean;
} = {}) {
  const elements = {
    refreshMicsBtn: fakeButton(),
    setupRuntimeBtn: fakeButton(),
    validatePiperBtn: fakeButton(),
    downloadVoiceBtn: fakeButton(),
    setupAllTtsBtn: fakeButton(),
    clearHistoryBtn: fakeButton(),
    fetchProviderModelsBtn: fakeButton(),
    applyModelToAiBtn: fakeButton(),
    applyModelToSttBtn: fakeButton(),
    checkOllamaStatusBtn: fakeButton(),
    installOllamaBtn: fakeButton(),
    fetchOllamaModelsBtn: fakeButton(),
    useOllamaModelBtn: fakeButton(),
    pullOllamaModelBtn: fakeButton(),
    sidebarToggleLocalSttBtn: fakeButton(),
    downloadLocalSttModelBtn: fakeButton(),
    deleteLocalSttModelBtn: fakeButton(),
    openLocalSttModelPathBtn: fakeButton(),
    providerModelCatalogSelect: fakeSelect(),
    localOllamaModelCatalogSelect: fakeSelect(),
    localSttModelInput: fakeInput(),
    localSttModelCatalogSelect: fakeSelect(),
    ttsEngineSelect: fakeSelect(),
    hotkeyInput: fakeInput(),
    commandHotkeyInput: fakeInput(),
    toggleMicEditorBtn: fakeButton(),
    toggleHotkeyEditorBtn: fakeButton(),
    dictionaryAddBtn: fakeButton(),
    dictionaryAddBtnTop: fakeButton(),
    snippetAddBtn: fakeButton(),
    snippetsAddBtnTop: fakeButton(),
  };
  const formRefs = fakeFormRefs();
  let renders = 0;
  initAvailability(elements, {
    isPipelineRunning: () => options.pipelineRunning ?? false,
    getStage: () => options.stage ?? "idle",
    isTtsSetupRunning: () => false,
    isOllamaStatusBusy: () => false,
    isOllamaInstallBusy: () => false,
    isOllamaPullBusy: () => false,
    isLocalSttHardwareAdvisorOpen: () => false,
    isLocalSttBusy: () => options.localSttBusy ?? false,
    getSttRuntimeMode: () => options.sttMode ?? "online",
    getAiRuntimeMode: () => options.aiMode ?? "online",
    getFormRefs: () => formRefs,
    renderLocalSttSettingsStatus: () => {
      renders += 1;
    },
  });
  return { elements, formRefs, renders: () => renders };
}

beforeEach(() => {
  wireHarness();
});

describe("syncActionAvailability", () => {
  it("leaves controls enabled when idle", () => {
    const harness = wireHarness();
    syncActionAvailability();
    expect(harness.elements.refreshMicsBtn.disabled).toBe(false);
    expect(harness.elements.downloadLocalSttModelBtn.disabled).toBe(false);
    expect(harness.formRefs.apiKeyInput.disabled).toBe(false);
    expect(harness.renders()).toBe(1);
  });

  it("disables the busy set while recording", () => {
    const harness = wireHarness({ stage: "recording" });
    syncActionAvailability();
    expect(harness.elements.refreshMicsBtn.disabled).toBe(true);
    expect(harness.elements.sidebarToggleLocalSttBtn.disabled).toBe(true);
    expect(harness.formRefs.microphoneSelect.disabled).toBe(true);
  });

  it("gates STT controls on local-STT busy", () => {
    const harness = wireHarness({ localSttBusy: true });
    syncActionAvailability();
    expect(harness.elements.downloadLocalSttModelBtn.disabled).toBe(true);
    expect(harness.elements.localSttModelInput.disabled).toBe(true);
    expect(harness.elements.refreshMicsBtn.disabled).toBe(false);
  });

  it("locks provider fields when both runtimes are local", () => {
    const harness = wireHarness({ sttMode: "local", aiMode: "local" });
    syncActionAvailability();
    expect(harness.formRefs.apiKeyInput.disabled).toBe(true);
    expect(harness.elements.fetchProviderModelsBtn.disabled).toBe(true);
    expect(harness.elements.providerModelCatalogSelect.disabled).toBe(true);
  });
});
