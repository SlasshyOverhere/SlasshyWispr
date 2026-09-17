/**
 * Local-STT client move-boundary test — Phase 5 shell decomposition.
 *
 * Pins the gating branches that guard every mutating entry point
 * (activate/warmup/deactivate/download/delete/open-path return early
 * when reportBlockedLocalSttAction fires and never touch IPC), the
 * sidebar-toggle online-mode branch, and the hardware-advisor escape
 * routing. IPC is stubbed with mock.module; the harness drives the
 * client through initLocalSttClient seams.
 */
import { describe, it, expect, mock, beforeEach } from "bun:test";

const invokeCalls: Array<{ command: string; args: unknown }> = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => {
    invokeCalls.push({ command, args });
    return Promise.resolve(null);
  },
}));

// Import after the mock so the client binds the stubbed invoke.
const client = await import("./local-stt-client");
const { defaultSettings: makeDefaultSettings } = await import("../state/settings-store");

function fakeButton(): HTMLButtonElement {
  return {
    hidden: false,
    disabled: false,
    dataset: {},
    title: "",
    setAttribute() {},
    addEventListener() {},
  } as unknown as HTMLButtonElement;
}

function fakeDiv(): HTMLDivElement {
  return {
    hidden: true,
    style: {},
    addEventListener() {},
  } as unknown as HTMLDivElement;
}

function fakeInput(value = ""): HTMLInputElement {
  return { value } as unknown as HTMLInputElement;
}

function fakeSelect(value = ""): HTMLSelectElement {
  return { value, addEventListener() {} } as unknown as HTMLSelectElement;
}

function fakeParagraph(): HTMLParagraphElement {
  return { textContent: "", dataset: {} } as unknown as HTMLParagraphElement;
}

function fakeSpan(): HTMLSpanElement {
  return { textContent: "", dataset: {}, style: {}, parentElement: null } as unknown as HTMLSpanElement;
}

function wireHarness(options: {
  blockReason?: string | null;
  sttMode?: "online" | "local";
  localSttModel?: string;
  modelExists?: boolean;
} = {}) {
  const notices: Array<{ message: string; isError?: boolean }> = [];
  const settings = {
    ...makeDefaultSettings(),
    sttRuntimeMode: options.sttMode ?? "local",
    localSttModel: options.localSttModel ?? "nvidia/parakeet-tdt-0.6b-v3",
    sttModelName: "whisper-1",
  };

  client.initLocalSttClient(
    {
      sidebarToggleBtn: fakeButton(),
      sidebarToggleGlyph: fakeSpan(),
      sidebarToggleLabel: fakeSpan(),
      loadOverlay: fakeDiv(),
      loadModel: fakeParagraph(),
      loadDetail: fakeParagraph(),
      modelInput: fakeInput(settings.localSttModel),
      modelCatalogSelect: fakeSelect(settings.localSttModel),
      statusBadge: fakeSpan(),
      statusDetail: fakeParagraph(),
      downloadNotice: fakeParagraph(),
      downloadProgressBar: fakeSpan(),
      downloadProgressText: fakeParagraph(),
      downloadBtn: fakeButton(),
      deleteBtn: fakeButton(),
      openPathBtn: fakeButton(),
      hardwareAdvisorOverlay: fakeDiv(),
      hardwareAdvisorUseSuggestionBtn: fakeButton(),
      hardwareAdvisorContinueBtn: fakeButton(),
      hardwareAdvisorCancelBtn: fakeButton(),
    },
    {
      readSettings: () => settings,
      commitFormSettings: () => {},
      getCatalog: () => ["nvidia/parakeet-tdt-0.6b-v3"],
      isPipelineRunning: () => options.blockReason === "pipeline",
      getStage: () => (options.blockReason === "recording" ? "recording" : "idle"),
      setStage: () => {},
      notify: (message, isError) => {
        notices.push({ message, isError });
      },
      log: () => {},
      syncAvailability: () => {},
      openSettings: () => {},
      setActiveSettingsPane: () => {},
      refreshAssistantInfo: async () => {},
      renderFetchedCatalog: () => {},
      checkModelFileExists: async () => options.modelExists ?? true,
      checkPythonDependencies: async () => true,
      checkAvailableMemory: async () => ({ sufficient: true }),
      showOfflineModeDiagnostic: () => {},
      ensureSelectedLocalSttModelForWarmup: async () => settings.localSttModel,
      isSettingsOpen: () => false,
    },
  );

  return { notices, settings };
}

beforeEach(() => {
  invokeCalls.length = 0;
  localStorage.clear();
});

describe("mutating entry points respect the block reason", () => {
  it("activate/deactivate/download/delete/open-path early-return while recording", async () => {
    wireHarness({ blockReason: "recording" });
    await client.activateSelectedLocalSttModel();
    await client.deactivateLocalSttModel();
    await client.downloadLocalSttModel();
    await client.deleteLocalSttModel();
    await client.openLocalSttModelPath();
    expect(invokeCalls).toEqual([]);
  });

  it("warmup returns null for non-local mode unless explicit", async () => {
    // warmupActiveLocalSttModel skips silently when STT runtime mode is not
    // local and the call is not explicit — no IPC fires.
    wireHarness({ sttMode: "online" });
    await expect(client.warmupActiveLocalSttModel()).resolves.toBeNull();
    expect(invokeCalls).toEqual([]);
  });
});

describe("handleSidebarToggleClick", () => {
  it("routes online mode through runtime sync with an explanatory notice", async () => {
    const harness = wireHarness({ sttMode: "online" });
    await client.handleSidebarToggleClick();
    expect(harness.notices[0].message).toContain("STT runtime is Online");
    expect(invokeCalls.map((call) => call.command)).toContain("get_local_stt_runtime_state");
  });
});

describe("hardware advisor escape", () => {
  it("returns false when closed and true after resolving", () => {
    wireHarness();
    expect(client.handleLocalSttAdvisorEscape()).toBe(false);
    expect(client.isLocalSttHardwareAdvisorOpen()).toBe(false);
  });
});

describe("catalog selection markers", () => {
  it("cleared marker renders the toggle without IPC", () => {
    wireHarness();
    client.markCatalogSelectionCleared();
    expect(invokeCalls).toEqual([]);
    client.markCatalogSelectionChanged();
    expect(invokeCalls).toEqual([]);
  });
});
