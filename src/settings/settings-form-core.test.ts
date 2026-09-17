/**
 * Settings read/apply round-trip tests — Phase 4c move boundary guard.
 *
 * readSettingsFromForm and applySettingsToForm own the DOM <-> settings
 * mapping. These tests pin the mapping with a lightweight fake DOM so a
 * future pane conversion cannot silently shift a field.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { defaultSettings } from "../state/settings-store";
import type { PersistedSettings } from "../types";
import {
  applySettingsToForm,
  normalizeHotkeyLabelsInPlace,
  readSettingsFromForm,
  refreshGeneralDisplayFromSettings,
  type SettingsCoreDeps,
} from "./settings-service";
import type { SettingsFormRefs } from "./settings-form-refs";

function fakeInput(value = ""): HTMLInputElement {
  return { value, checked: false, disabled: false } as unknown as HTMLInputElement;
}

function fakeSelect(value = ""): HTMLSelectElement {
  return {
    value,
    disabled: false,
    options: [] as unknown as HTMLOptionElement[],
  } as unknown as HTMLSelectElement;
}

function fakePara(content = ""): HTMLParagraphElement {
  return { textContent: content, hidden: false } as unknown as HTMLParagraphElement;
}

function fakeRefs(): SettingsFormRefs {
  return {
    apiBaseUrlInput: fakeInput("https://api.example.com/v1"),
    assistantNameInput: fakeInput("TestName"),
    dictationLanguageSelect: fakeSelect("en"),
    dictationLanguageModeSingleInput: fakeInput(),
    dictationLanguageModeMultipleInput: fakeInput(),
    dictationLanguageMultiWrap: { hidden: true } as HTMLDivElement,
    dictationLanguageOptionInputs: [],
    dictationLanguageSummary: fakePara(),
    themeCardInputs: [],
    runtimeModeNotice: fakePara(),
    onlineProviderSection: { hidden: false } as unknown as HTMLDivElement,
    onlineSttModelField: { hidden: false } as unknown as HTMLElement,
    onlineAiModelField: { hidden: false } as unknown as HTMLElement,
    offlineOllamaSection: { hidden: false } as unknown as HTMLDivElement,
    offlineSttSection: { hidden: false } as unknown as HTMLDivElement,
    onlineProviderModeNotice: fakePara(),
    offlineRuntimeModeNotice: fakePara(),
    settingsPanels: [],
    apiKeyInput: fakeInput("sk-test"),
    sttModelInput: fakeInput("stt-model"),
    aiModelInput: fakeInput("ai-model"),
    localOllamaBaseUrlInput: fakeInput(""),
    localOllamaModelInput: fakeInput("llama3.1:8b"),
    localSttModelInput: fakeInput(""),
    rememberApiKeyInput: fakeInput(),
    captureModeSingleInput: fakeInput(),
    captureModePushToTalkInput: fakeInput(),
    microphoneSelect: fakeSelect("mic-1"),
    hotkeyInput: fakeInput("Ctrl+Space"),
    commandHotkeyInput: fakeInput("Ctrl+Shift+Space"),
    styleProfileSelect: fakeSelect("adaptive"),
    ttsEngineSelect: fakeSelect("piper"),
    piperPathInput: fakeInput(""),
    piperQualitySelect: fakeSelect("balanced"),
    piperEmotionSelect: fakeSelect("neutral"),
    piperSpeedInput: fakeInput("1.00"),
    piperSpeedValue: { textContent: "" } as unknown as HTMLElement,
    systemPromptInput: { value: "prompt" } as unknown as HTMLTextAreaElement,
    temperatureInput: fakeInput("0.35"),
    temperatureValue: { textContent: "" } as unknown as HTMLElement,
    maxTokensInput: fakeInput("320"),
    launchAtLoginToggle: fakeInput(),
    showFlowBarToggle: fakeInput(),
    showDockAlwaysToggle: fakeInput(),
    commandModeToggle: fakeInput(),
    wakeWordEnabledToggle: fakeInput(),
    wakePhrasePreview: fakePara(),
    sttRuntimeModeOnlineInput: fakeInput(),
    sttRuntimeModeOfflineInput: fakeInput(),
    aiRuntimeModeOnlineInput: fakeInput(),
    aiRuntimeModeOfflineInput: fakeInput(),
    contextAwarenessToggle: fakeInput(),
    copyToClipboardToggle: fakeInput(),
    autoPasteDictationToggle: fakeInput(),
    incognitoModeToggle: fakeInput(),
    saveRecordingsToggle: fakeInput(),
    recordingsStorageHint: { textContent: "" } as unknown as HTMLElement,
    recordingsStorageHintWeb: fakePara(),
    themeModeSelect: fakeSelect("dark"),
    dictationSoundEffectsToggle: fakeInput(),
    muteMusicWhileDictatingToggle: fakeInput(),
    pushToTalkSoundSelect: fakeSelect("beep-start"),
    pushToTalkEndSoundSelect: fakeSelect("beep-end"),
    pushToTalkSoundVolumeRange: fakeInput("50"),
    pttVolumeHint: { textContent: "" } as unknown as HTMLElement,
    rawModeToggle: fakeInput(),
    backtrackToggle: fakeInput(),
    removeFillersToggle: fakeInput(),
    autoPunctuationToggle: fakeInput(),
    numberedListsToggle: fakeInput(),
    noiseSuppressionToggle: fakeInput(),
    hotkeyHint: { textContent: "" } as unknown as HTMLElement,
    captureModeHint: { textContent: "" } as unknown as HTMLElement,
  };
}

function baseDeps(): SettingsCoreDeps {
  return {
    isCapturingHotkey: () => false,
    isCapturingCommandHotkey: () => false,
    currentSettings: () => defaultSettings(),
    refreshRecordingsStorageHint: () => {},
    isTauri: () => false,
    showStaleRuntimePane: () => {},
  };
}

beforeEach(() => {
  localStorage.clear();
  // The bun test document stub has no documentElement; applyTheme needs one.
  const doc = globalThis.document as unknown as Record<string, unknown>;
  doc["documentElement"] ??= { setAttribute: () => {}, removeAttribute: () => {} };
});

describe("readSettingsFromForm", () => {
  it("reads representative fields and coerces ranges", () => {
    const refs = fakeRefs();
    refs.captureModeSingleInput.checked = true;
    refs.sttRuntimeModeOfflineInput.checked = true;
    refs.temperatureInput.value = "5.0";

    const next = readSettingsFromForm(refs, baseDeps());

    expect(next.apiBaseUrl).toBe("https://api.example.com/v1");
    expect(next.captureMode).toBe("single-tap");
    expect(next.sttRuntimeMode).toBe("local");
    expect(next.aiRuntimeMode).toBe("online");
    expect(next.temperature).toBe(1.2);
    expect(next.pushToTalkHotkey).toBe("Ctrl+Space");
    expect(next.themeMode).toBe("dark");
  });

  it("keeps the stored hotkey while capture is active", () => {
    const refs = fakeRefs();
    refs.hotkeyInput.value = "garbage-during-capture";
    const stored: PersistedSettings = {
      ...defaultSettings(),
      pushToTalkHotkey: "Alt+Space",
    };

    const next = readSettingsFromForm(refs, {
      ...baseDeps(),
      isCapturingHotkey: () => true,
      currentSettings: () => stored,
    });

    expect(next.pushToTalkHotkey).toBe("Alt+Space");
  });
});

describe("normalizeHotkeyLabelsInPlace", () => {
  it("normalizes label casing on the settings object and the inputs", () => {
    const refs = fakeRefs();
    const next: PersistedSettings = {
      ...defaultSettings(),
      pushToTalkHotkey: "ctrl+space",
      commandHotkey: "ctrl+shift+space",
    };

    normalizeHotkeyLabelsInPlace(refs, next);

    expect(next.pushToTalkHotkey).toBe("Ctrl+Space");
    expect(refs.hotkeyInput.value).toBe("Ctrl+Space");
    expect(next.commandHotkey).toBe("Ctrl+Shift+Space");
    expect(refs.commandHotkeyInput.value).toBe("Ctrl+Shift+Space");
  });
});

describe("applySettingsToForm", () => {
  it("writes fields back and refreshes General display text", () => {
    const refs = fakeRefs();
    const next: PersistedSettings = {
      ...defaultSettings(),
      assistantName: "Nova",
      pushToTalkHotkey: "Ctrl+Space",
      captureMode: "push-to-talk",
      pushToTalkSoundVolume: 0.75,
      temperature: 0.5,
      piperSpeed: 1.25,
      themeMode: "dark",
    };

    applySettingsToForm(refs, baseDeps(), next);

    expect(refs.hotkeyInput.value).toBe("Ctrl+Space");
    expect(refs.captureModePushToTalkInput.checked).toBe(true);
    expect(refs.captureModeSingleInput.checked).toBe(false);
    expect(refs.wakePhrasePreview.textContent).toContain("Nova");
    expect(refs.hotkeyHint.textContent).toBe("Ctrl + Space");
    expect(refs.captureModeHint.textContent).toBe("Push-To-Talk");
    expect(refs.pttVolumeHint.textContent).toBe("75%");
    expect(refs.recordingsStorageHint.textContent).toBe("Desktop only");
  });
});

describe("refreshGeneralDisplayFromSettings", () => {
  it("syncs hints, volume, and value labels", () => {
    const refs = fakeRefs();
    refreshGeneralDisplayFromSettings(refs, {
      ...defaultSettings(),
      assistantName: "",
      pushToTalkHotkey: "Alt+Space",
      captureMode: "single-tap",
      pushToTalkSoundVolume: 0.5,
      temperature: 0.35,
      piperSpeed: 1,
      themeMode: "system",
    });

    expect(refs.themeModeSelect.value).toBe("system");
    expect(refs.hotkeyHint.textContent).toBe("Alt + Space");
    expect(refs.captureModeHint.textContent).toBe("Single Tap");
  });
});
