/**
 * Settings-change move-boundary test — Phase 5 shell decomposition.
 *
 * Pins handleSettingsChange (pipeline commit, snapshot commit, hotkey
 * display cache refresh), settingsHandleEffects.afterPersist (shortcut
 * resync on signature drift, launch-at-login sync, runtime-mode notices,
 * local-STT sync request, capture prime on mic change), hydrate (apply +
 * notify chain, null passthrough), and backfillAchievementsFromUsageStats
 * (threshold totals, single-fire guard, store notify). Runs against stub
 * form refs and seam deps.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { defaultSettings } from "../state/settings-store";
import type { PersistedSettings } from "../types";
import {
  backfillAchievementsFromUsageStats,
  getCachedHotkeyDisplay,
  handleSettingsChange,
  hydrateSettingsFromNativeStorage,
  initSettingsChange,
  describeMaxTokensCorrection,
  describeSttTimeoutCorrection,
  describeTemperatureCorrection,
  reconcileMaxTokensWithBounds,
  reconcileSttTimeoutWithBounds,
  reconcileTemperatureWithBounds,
  settingsHandleEffects,
  type SettingsChangeDeps,
} from "./settings-change";
import {
  resetSttTimeoutBoundsForTests,
  setSttTimeoutBounds,
  sttTimeoutBounds,
} from "./stt-timeout-bounds";
import {
  maxTokensBounds,
  resetMaxTokensBoundsForTests,
  setMaxTokensBounds,
} from "./max-tokens-bounds";
import {
  resetTemperatureBoundsForTests,
  setTemperatureBounds,
  temperatureBounds,
} from "./temperature-bounds";

// The pipeline touches real DOM APIs (setCustomValidity, document theme
// root, classList on panels); stub them at module scope.
{
  const root = {
    setAttribute() {},
    removeAttribute() {},
  };
  (globalThis as unknown as { document?: unknown }).document ??= {};
  Object.assign(globalThis as unknown as { document: Record<string, unknown> }, {
    document: {
      ...((globalThis as unknown as { document: Record<string, unknown> }).document ?? {}),
      documentElement: root,
    },
  });
}

function fakeInput(value = ""): HTMLInputElement {
  return {
    value,
    checked: false,
    disabled: false,
    setCustomValidity() {},
    toggleAttribute() {},
  } as unknown as HTMLInputElement;
}

function fakeSelect(value = ""): HTMLSelectElement {
  return { value, disabled: false, options: [] } as unknown as HTMLSelectElement;
}

function fakePanel(): HTMLElement {
  return { classList: { contains: () => false }, dataset: {} } as unknown as HTMLElement;
}

function fakeDiv(): HTMLDivElement {
  return { hidden: false } as unknown as HTMLDivElement;
}

function fakePara(): HTMLParagraphElement {
  return { textContent: "", hidden: false } as unknown as HTMLParagraphElement;
}

function fakeRefs() {
  return {
    apiKeyInput: fakeInput(),
    apiBaseUrlInput: fakeInput("https://api.example.com/v1"),
    sttModelInput: fakeInput("whisper-1"),
    aiModelInput: fakeInput("gpt-4o"),
    localOllamaBaseUrlInput: fakeInput(""),
    localOllamaModelInput: fakeInput(""),
    localSttModelInput: fakeInput(""),
    rememberApiKeyInput: fakeInput(),
    captureModeSingleInput: { ...fakeInput(), checked: true },
    captureModePushToTalkInput: fakeInput(),
    microphoneSelect: fakeSelect("mic-1"),
    hotkeyInput: fakeInput("Ctrl+Space"),
    commandHotkeyInput: fakeInput("Ctrl+Shift+Space"),
    sttRuntimeModeOnlineInput: { ...fakeInput(), checked: true },
    sttRuntimeModeOfflineInput: fakeInput(),
    aiRuntimeModeOnlineInput: { ...fakeInput(), checked: true },
    aiRuntimeModeOfflineInput: fakeInput(),
    dictationLanguageSelect: fakeSelect("en"),
    dictationLanguageModeSingleInput: { ...fakeInput(), checked: true },
    dictationLanguageModeMultipleInput: fakeInput(),
    dictationLanguageOptionInputs: [],
    styleProfileSelect: fakeSelect("adaptive"),
    systemPromptInput: { value: "prompt" },
    temperatureInput: fakeInput("0.35"),
    maxTokensInput: fakeInput("320"),
    sttTimeoutSecondsInput: fakeInput("60"),
    launchAtLoginToggle: fakeInput(),
    showFlowBarToggle: fakeInput(),
    showDockAlwaysToggle: fakeInput(),
    commandModeToggle: fakeInput(),
    wakeWordEnabledToggle: fakeInput(),
    assistantNameInput: fakeInput("Nova"),
    autoPasteDictationToggle: fakeInput(),
    contextAwarenessToggle: fakeInput(),
    copyToClipboardToggle: fakeInput(),
    incognitoModeToggle: fakeInput(),
    saveRecordingsToggle: fakeInput(),
    themeModeSelect: fakeSelect("dark"),
    captureBackendSelect: fakeSelect("webview"),
    shellIntegrationToggle: fakeInput(),
    dictationSoundEffectsToggle: fakeInput(),
    muteMusicWhileDictatingToggle: fakeInput(),
    pushToTalkSoundSelect: fakeSelect("beep-start"),
    pushToTalkEndSoundSelect: fakeSelect("beep-end"),
    pushToTalkSoundVolumeRange: fakeInput("50"),
    rawModeToggle: fakeInput(),
    backtrackToggle: fakeInput(),
    removeFillersToggle: fakeInput(),
    autoPunctuationToggle: fakeInput(),
    numberedListsToggle: fakeInput(),
    noiseSuppressionToggle: fakeInput(),
    ttsEngineSelect: fakeSelect("piper"),
    piperPathInput: fakeInput(""),
    piperQualitySelect: fakeSelect("balanced"),
    piperEmotionSelect: fakeSelect("neutral"),
    piperSpeedInput: fakeInput("1.00"),
    piperSpeedValue: { textContent: "" },
    systemPromptInput: { value: "prompt" },
    temperatureValue: { textContent: "" },
    dictationLanguageMultiWrap: fakeDiv(),
    dictationLanguageSummary: fakePara(),
    themeCardInputs: [],
    runtimeModeNotice: fakePara(),
    onlineProviderSection: fakeDiv(),
    onlineSttModelField: fakeDiv(),
    onlineAiModelField: fakeDiv(),
    offlineOllamaSection: fakeDiv(),
    offlineSttSection: fakeDiv(),
    onlineProviderModeNotice: fakePara(),
    offlineRuntimeModeNotice: fakePara(),
    settingsPanels: [fakePanel()],
    wakePhrasePreview: fakePara(),
    recordingsStorageHint: { textContent: "" },
    recordingsStorageHintWeb: fakePara(),
    pttVolumeHint: { textContent: "" },
    hotkeyHint: { textContent: "" },
    captureModeHint: { textContent: "" },
  } as unknown as SettingsChangeDeps["getFormRefs"] extends () => infer R ? R : never;
}

function wireHarness(overrides: {
  settings?: PersistedSettings;
  nativePayload?: string | null;
  sessions?: number;
  achievements?: number;
  stats?: Partial<PersistedSettings>;
} = {}) {
  let settings = overrides.settings ?? defaultSettings();
  const formRefs = fakeRefs();
  const notices: string[] = [];
  const logs: string[] = [];
  const calls: string[] = [];
  let snapshots = 0;
  let persists = 0;
  let storeUpdates = 0;
  let appended = 0;
  const stats = {
    sessions: 5,
    words: 100,
    avgWpm: 0,
    speakingSeconds: 60,
    prevSessions: 0,
    prevWords: 0,
    prevWpm: 0,
    prevSpeakingSeconds: 0,
    lastPeriodReset: Date.now(),
  };
  const achievements: Array<{ id: string }> = Array.from(
    { length: overrides.achievements ?? 0 },
    (_, i) => ({ id: `a-${i}` }),
  ) as never[];
  const providerSelect = fakeSelect();
  const ollamaSelect = fakeSelect();
  const sttSelect = fakeSelect();
  initSettingsChange({
    getSettings: () => settings,
    setSettings: (next) => {
      settings = next;
    },
    commitSettingsSnapshot: () => {
      snapshots += 1;
    },
    getFormRefs: () => formRefs,
    getCatalogs: () => ({ providerModels: [], localOllamaModels: [], localSttModels: [] }),
    getAssistantInfoDefaults: () => null,
    getStage: () => "idle",
    currentSettings: () => settings,
    buildCaptureDeps: () => ({
      isCapturingHotkey: () => false,
      isCapturingCommandHotkey: () => false,
      refreshRecordingsStorageHint: () => {},
      isTauri: () => true,
      showStaleRuntimePane: () => {},
    }),
    formatHotkeyDisplay: (hotkey) => hotkey,
    log: (message) => {
      logs.push(message);
    },
    warn: () => {},
    renderSidebarLocalSttToggle: () => {
      calls.push("sidebar-toggle");
    },
    refreshRecordButton: () => {
      calls.push("record-button");
    },
    syncActionAvailability: () => {
      calls.push("availability");
    },
    updateMicrophoneSummary: () => {
      calls.push("mic-summary");
    },
    renderAssistantInfo: () => {
      calls.push("assistant-info");
    },
    setActiveTtsProfile: () => {
      calls.push("tts-profile");
    },
    setCatalogSelects: () => {
      providerSelect.value = "";
      ollamaSelect.value = "";
      sttSelect.value = "";
    },
    requestGlobalShortcutSync: () => {
      calls.push("shortcut-sync");
    },
    requestLaunchAtLoginSync: () => {
      calls.push("launch-sync");
    },
    interruptTtsPlayback: () => {
      calls.push("tts-interrupt");
    },
    notice: (message) => {
      notices.push(message);
    },
    requestLocalSttRuntimeSyncForMode: () => {
      calls.push("local-stt-sync");
    },
    updateTtsSetupGate: () => {
      calls.push("tts-gate");
    },
    publishDockState: () => {
      calls.push("dock");
    },
    syncFloatingIndicatorWindow: () => {},
    primeCaptureReadiness: () => {
      calls.push("prime");
    },
    clearCaptureHolds: () => {
      calls.push("clear-holds");
    },
    notifyIncognitoChanged: () => {},
    syncExternalMediaMute: () => {},
    persist: () => {
      persists += 1;
    },
    notifyStoreUpdated: () => {
      storeUpdates += 1;
    },
    readSettingsFromForm: (refs) => {
      void refs;
      return settings;
    },
    applySettingsToForm: () => {},
    getUsageStats: () => stats,
    getSessionCount: () => overrides.sessions ?? 3,
    getAchievements: () => achievements,
    appendAchievements: (unlocked) => {
      appended += unlocked.length;
    },
    persistAchievements: () => {
      calls.push("persist-achievements");
    },
    isTauri: () => true,
    loadNativeSettings: async () => overrides.nativePayload ?? "",
  });
  return {
    formRefs,
    notices,
    logs,
    calls,
    snapshots: () => snapshots,
    persists: () => persists,
    storeUpdates: () => storeUpdates,
    appended: () => appended,
    getSettings: () => settings,
  };
}

beforeEach(() => {
  // Reset first: defaultSettings() reads these bounds.
  resetMaxTokensBoundsForTests();
  resetTemperatureBoundsForTests();
  resetSttTimeoutBoundsForTests();
  wireHarness();
});

describe("handleSettingsChange", () => {
  it("commits the pipeline result and caches the hotkey display", async () => {
    const harness = wireHarness();
    await handleSettingsChange();
    expect(harness.snapshots()).toBe(1);
    expect(harness.persists()).toBe(1);
    expect(getCachedHotkeyDisplay()).toContain("Ctrl");
    expect(harness.getSettings().assistantName).toBe("Nova");
  });
});

describe("reconcileSttTimeoutWithBounds", () => {
  it("raises a stored timeout below the backend minimum", () => {
    // A value persisted while the backend allowed a wider range. Leaving it
    // would show one number on screen while every request used another.
    setSttTimeoutBounds({ defaultSeconds: 60, minSeconds: 120, maxSeconds: 600 });
    const harness = wireHarness({
      settings: { ...defaultSettings(), sttTimeoutSeconds: 30 },
    });

    // The descriptor is what bootstrap shows the user, so it has to carry the
    // real numbers rather than just a flag.
    expect(reconcileSttTimeoutWithBounds()).toEqual({
      previousSeconds: 30,
      seconds: 120,
      minSeconds: 120,
      maxSeconds: 600,
    });
    expect(harness.getSettings().sttTimeoutSeconds).toBe(120);
    expect(harness.snapshots()).toBe(1);
    expect(harness.persists()).toBe(1);
  });

  it("lowers a stored timeout above the backend maximum", () => {
    setSttTimeoutBounds({ defaultSeconds: 60, minSeconds: 10, maxSeconds: 120 });
    const harness = wireHarness({
      settings: { ...defaultSettings(), sttTimeoutSeconds: 900 },
    });

    expect(reconcileSttTimeoutWithBounds()).toEqual({
      previousSeconds: 900,
      seconds: 120,
      minSeconds: 10,
      maxSeconds: 120,
    });
    expect(harness.getSettings().sttTimeoutSeconds).toBe(120);
  });

  it("leaves an in-range timeout untouched", () => {
    const harness = wireHarness({
      settings: { ...defaultSettings(), sttTimeoutSeconds: 120 },
    });

    // null, not a no-op descriptor: nothing happened and nothing is reported.
    expect(reconcileSttTimeoutWithBounds()).toBeNull();
    expect(harness.getSettings().sttTimeoutSeconds).toBe(120);
    // No write, so a normal boot does not churn the settings file.
    expect(harness.snapshots()).toBe(0);
    expect(harness.persists()).toBe(0);
  });

  it("repairs a non-numeric stored value", () => {
    const harness = wireHarness({
      settings: { ...defaultSettings(), sttTimeoutSeconds: Number.NaN },
    });

    const correction = reconcileSttTimeoutWithBounds();
    expect(correction?.seconds).toBe(sttTimeoutBounds().defaultSeconds);
    expect(harness.getSettings().sttTimeoutSeconds).toBe(
      sttTimeoutBounds().defaultSeconds,
    );
  });

  it("reports each stale value once, because correcting it persists the fix", () => {
    setSttTimeoutBounds({ defaultSeconds: 60, minSeconds: 120, maxSeconds: 600 });
    wireHarness({ settings: { ...defaultSettings(), sttTimeoutSeconds: 5 } });

    expect(reconcileSttTimeoutWithBounds()).not.toBeNull();
    // Persisted, so the next launch has nothing to correct and nothing to say.
    expect(reconcileSttTimeoutWithBounds()).toBeNull();
  });
});

describe("settingsHandleEffects.afterPersist", () => {
  it("resyncs shortcuts on signature drift and syncs launch-at-login", () => {
    const harness = wireHarness();
    const previous = defaultSettings();
    const next = { ...defaultSettings(), pushToTalkHotkey: "Alt+X", launchAtLogin: !previous.launchAtLogin };
    settingsHandleEffects.afterPersist(previous, next, "idle");
    expect(harness.calls).toContain("shortcut-sync");
    expect(harness.calls).toContain("launch-sync");
    expect(harness.calls).toContain("tts-gate");
    expect(harness.calls).toContain("dock");
  });

  it("notices runtime-mode flips and requests local STT sync", () => {
    const harness = wireHarness();
    const previous = defaultSettings();
    const next = { ...defaultSettings(), sttRuntimeMode: "local" as const };
    settingsHandleEffects.afterPersist(previous, next, "idle");
    expect(harness.calls).toContain("local-stt-sync");
    expect(harness.notices.some((line) => line.includes("Hybrid"))).toBe(true);
  });

  it("primes capture when the microphone changes at idle", () => {
    const harness = wireHarness();
    const previous = defaultSettings();
    const next = { ...defaultSettings(), microphoneDeviceId: "mic-2" };
    settingsHandleEffects.afterPersist(previous, next, "idle");
    expect(harness.calls).toContain("prime");
  });
});

describe("reconcileMaxTokensWithBounds", () => {
  it("lowers a stored ceiling above the backend maximum", () => {
    // The value the frontend used to allow (4096) survived its own coercion and
    // was clamped to 1024 on every request, so the setting was displayed and
    // ignored. That is what this reconcile now repairs and reports.
    setMaxTokensBounds({ defaultTokens: 320, minTokens: 64, maxTokens: 1024 });
    const harness = wireHarness({
      settings: { ...defaultSettings(), maxTokens: 4096 },
    });

    expect(reconcileMaxTokensWithBounds()).toEqual({
      previousTokens: 4096,
      tokens: 1024,
      minTokens: 64,
      maxTokens: 1024,
    });
    expect(harness.getSettings().maxTokens).toBe(1024);
    expect(harness.snapshots()).toBe(1);
    expect(harness.persists()).toBe(1);
  });

  it("raises a stored ceiling below the backend minimum", () => {
    setMaxTokensBounds({ defaultTokens: 320, minTokens: 256, maxTokens: 1024 });
    const harness = wireHarness({
      settings: { ...defaultSettings(), maxTokens: 64 },
    });

    expect(reconcileMaxTokensWithBounds()?.tokens).toBe(256);
    expect(harness.getSettings().maxTokens).toBe(256);
  });

  it("leaves an in-range ceiling untouched", () => {
    const harness = wireHarness({
      settings: { ...defaultSettings(), maxTokens: 512 },
    });

    // null, not a no-op descriptor: nothing happened and nothing is reported.
    expect(reconcileMaxTokensWithBounds()).toBeNull();
    // No write, so a normal boot does not churn the settings file.
    expect(harness.snapshots()).toBe(0);
    expect(harness.persists()).toBe(0);
  });

  it("repairs a non-numeric stored value", () => {
    const harness = wireHarness({
      settings: { ...defaultSettings(), maxTokens: Number.NaN },
    });

    expect(reconcileMaxTokensWithBounds()?.tokens).toBe(maxTokensBounds().defaultTokens);
    expect(harness.getSettings().maxTokens).toBe(maxTokensBounds().defaultTokens);
  });
});

describe("reconcileTemperatureWithBounds", () => {
  it("lowers a stored temperature above the backend maximum", () => {
    // The validator used to accept up to 2.0 while the request path clamped to
    // 1.2, so a stored 1.5 passed every check and was then silently changed.
    setTemperatureBounds({ defaultTemperature: 0.35, minTemperature: 0, maxTemperature: 1.2 });
    const harness = wireHarness({
      settings: { ...defaultSettings(), temperature: 1.5 },
    });

    // The descriptor is what bootstrap shows the user, so it has to carry the
    // real numbers rather than just a flag.
    expect(reconcileTemperatureWithBounds()).toEqual({
      previousTemperature: 1.5,
      temperature: 1.2,
      minTemperature: 0,
      maxTemperature: 1.2,
    });
    expect(harness.getSettings().temperature).toBe(1.2);
    expect(harness.snapshots()).toBe(1);
    expect(harness.persists()).toBe(1);
  });

  it("raises a stored temperature below the backend minimum", () => {
    setTemperatureBounds({ defaultTemperature: 0.35, minTemperature: 0.2, maxTemperature: 1.2 });
    const harness = wireHarness({
      settings: { ...defaultSettings(), temperature: 0.05 },
    });

    expect(reconcileTemperatureWithBounds()?.temperature).toBe(0.2);
    expect(harness.getSettings().temperature).toBe(0.2);
  });

  it("leaves an in-range temperature untouched", () => {
    const harness = wireHarness({
      settings: { ...defaultSettings(), temperature: 0.7 },
    });

    // null, not a no-op descriptor: nothing happened and nothing is reported.
    expect(reconcileTemperatureWithBounds()).toBeNull();
    // No write, so a normal boot does not churn the settings file.
    expect(harness.snapshots()).toBe(0);
    expect(harness.persists()).toBe(0);
  });

  it("repairs a non-numeric stored value", () => {
    const harness = wireHarness({
      settings: { ...defaultSettings(), temperature: Number.NaN },
    });

    const corrected = temperatureBounds().defaultTemperature;
    expect(reconcileTemperatureWithBounds()?.temperature).toBe(corrected);
    expect(harness.getSettings().temperature).toBe(corrected);
  });

  it("reports each stale value once, because correcting it persists the fix", () => {
    setTemperatureBounds({ defaultTemperature: 0.35, minTemperature: 0, maxTemperature: 1.2 });
    wireHarness({ settings: { ...defaultSettings(), temperature: 9 } });

    expect(reconcileTemperatureWithBounds()).not.toBeNull();
    // Persisted, so the next launch has nothing to correct and nothing to say.
    expect(reconcileTemperatureWithBounds()).toBeNull();
  });
});

describe("bounds correction notices", () => {
  it("names the temperature range too", () => {
    expect(
      describeTemperatureCorrection({
        previousTemperature: 1.5,
        temperature: 1.2,
        minTemperature: 0,
        maxTemperature: 1.2,
      }),
    ).toBe(
      "Temperature 1.5 is outside the supported 0-1.2 range; set to 1.2. Change it in Settings > Pipeline.",
    );
  });
  it("names the previous value, the range, and the corrected value", () => {
    // A silent correction is the thing being fixed here, so the copy has to
    // carry enough to act on: what it was, what it is now, and where to change it.
    expect(
      describeSttTimeoutCorrection({
        previousSeconds: 900,
        seconds: 600,
        minSeconds: 10,
        maxSeconds: 600,
      }),
    ).toBe(
      "Request Timeout 900s is outside the supported 10-600s range; set to 600s. Change it in Settings > Pipeline.",
    );
    expect(
      describeMaxTokensCorrection({
        previousTokens: 4096,
        tokens: 1024,
        minTokens: 64,
        maxTokens: 1024,
      }),
    ).toBe(
      "Max Tokens 4096 is outside the supported 64-1024 range; set to 1024. Change it in Settings > Pipeline.",
    );
  });
});

describe("hydrateSettingsFromNativeStorage", () => {
  it("returns quietly on empty payload", async () => {
    const harness = wireHarness({ nativePayload: "" });
    await hydrateSettingsFromNativeStorage();
    expect(harness.snapshots()).toBe(0);
  });
});

describe("backfillAchievementsFromUsageStats", () => {
  it("unlocks once and notifies the store", () => {
    const harness = wireHarness({ sessions: 2, achievements: 0 });
    backfillAchievementsFromUsageStats();
    expect(harness.storeUpdates()).toBe(1);
  });

  it("stays quiet with no sessions", () => {
    const harness = wireHarness({ sessions: 0, achievements: 0 });
    backfillAchievementsFromUsageStats();
    expect(harness.storeUpdates()).toBe(0);
    expect(harness.appended()).toBe(0);
  });
});
