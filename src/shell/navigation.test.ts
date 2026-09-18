/**
 * Navigation move-boundary test — Phase 5 shell decomposition.
 *
 * Pins asMainPage/asSettingsPane parsing (including legacy online /
 * offline / hybrid aliases), setActivePage persistence + aria + store
 * event, setActiveSettingsPane title/panel switching + persistence, the
 * TTS gate visibility matrix, and open/close/isSettingsOpen overlay
 * transitions. Runs against stub elements with the real localStorage
 * via test-setup preload.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { ACTIVE_PAGE_STORAGE_KEY } from "../constants";
import {
  ACTIVE_SETTINGS_PANE_STORAGE_KEY,
  asMainPage,
  asSettingsPane,
  getActivePage,
  getActiveSettingsPane,
  initNavigation,
  isSettingsOpen,
  openSettings,
  closeSettings,
  setActivePage,
  setActiveSettingsPane,
  setActiveTtsProfile,
  updateTtsSetupGate,
} from "./navigation";

function fakeButton(): HTMLButtonElement {
  return {
    dataset: {},
    addEventListener() {},
    setAttribute() {},
    classList: { toggle() {}, add() {}, remove() {} },
  } as unknown as HTMLButtonElement;
}

function fakePanel(pane = "general"): HTMLDivElement {
  const div = fakeDiv();
  (div as unknown as { dataset: Record<string, string> }).dataset = {
    settingsPane: pane,
  };
  (div as unknown as { hidden: boolean }).hidden = true;
  return div;
}

function fakeDiv(hidden = false): HTMLDivElement {
  const classes = new Set<string>();
  return {
    hidden,
    classList: {
      toggle() {},
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
    offsetWidth: 0,
    contains: () => false,
    addEventListener() {},
    setAttribute() {},
  } as unknown as HTMLDivElement;
}

function wireHarness(options: { piperReady?: boolean; ttsRunning?: boolean } = {}) {
  const logs: string[] = [];
  let overlays = 0;
  const settingsOverlay = fakeDiv(true);
  (globalThis as unknown as { HTMLElement?: unknown }).HTMLElement ??= class {};
  const elements = {
    pageNavButtons: [fakeButton()],
    settingsNavButtons: [fakeButton()],
    settingsPanels: [fakePanel("general"), fakePanel("models")],
    settingsPaneTitle: { textContent: "" } as unknown as HTMLElement,
    settingsMain: fakeDiv(),
    settingsOverlay,
    openSettingsBtn: fakeButton(),
    closeSettingsBtn: fakeButton(),
    ttsBootstrapCard: fakeDiv(),
    ttsProfilesArea: fakeDiv(),
    ttsSetupStatus: { textContent: "" } as unknown as HTMLParagraphElement,
    ttsProfilePiperTab: fakeButton(),
    ttsProfilePiperPanel: fakeDiv(),
  };
  initNavigation(
    elements,
    {
      log: (message) => {
        logs.push(message);
      },
      isPiperRuntimeReady: () => options.piperReady ?? true,
      isTtsSetupRunning: () => options.ttsRunning ?? false,
      notifyOverlayVisibilityChanged: () => {
        overlays += 1;
      },
    },
    { page: "home", pane: "general" },
  );
  return { elements, logs, overlays: () => overlays, settingsOverlay };
}

beforeEach(() => {
  localStorage.clear();
  wireHarness();
});

describe("parsers", () => {
  it("accepts known pages and panes plus legacy aliases", () => {
    expect(asMainPage("notes")).toBe("notes");
    expect(asMainPage("nope")).toBeNull();
    expect(asSettingsPane("pipeline")).toBe("pipeline");
    expect(asSettingsPane("online")).toBe("models");
    expect(asSettingsPane("offline")).toBe("models");
    expect(asSettingsPane("hybrid")).toBe("models");
    expect(asSettingsPane("nope")).toBeNull();
  });
});

describe("setActivePage", () => {
  it("persists, updates aria, and notifies the store", () => {
    const seen: string[] = [];
    const listener = () => {
      seen.push("updated");
    };
    window.addEventListener("slasshywispr:store-updated", listener);
    try {
      const harness = wireHarness();
      setActivePage("history");
      expect(getActivePage()).toBe("history");
      expect(localStorage.getItem(ACTIVE_PAGE_STORAGE_KEY)).toBe("history");
      expect(harness.elements.pageNavButtons[0].dataset).toBeDefined();
      expect(seen).toEqual(["updated"]);
    } finally {
      window.removeEventListener("slasshywispr:store-updated", listener);
    }
  });
});

describe("setActiveSettingsPane", () => {
  it("persists, titles, and toggles panels", () => {
    const harness = wireHarness();
    setActiveSettingsPane("models", "test");
    expect(getActiveSettingsPane()).toBe("models");
    expect(localStorage.getItem(ACTIVE_SETTINGS_PANE_STORAGE_KEY)).toBe("models");
    expect(harness.elements.settingsPaneTitle.textContent).toBe("Models");
    expect(harness.logs[0]).toContain("next=models");
  });
});

describe("TTS gate", () => {
  it("shows bootstrap until piper is ready and idle", () => {
    const harness = wireHarness({ piperReady: false });
    updateTtsSetupGate();
    expect(harness.elements.ttsBootstrapCard.hidden).toBe(false);
    expect(harness.elements.ttsProfilesArea.hidden).toBe(true);
    const ready = wireHarness({ piperReady: true });
    updateTtsSetupGate();
    expect(ready.elements.ttsBootstrapCard.hidden).toBe(true);
    expect(ready.elements.ttsSetupStatus.textContent).toBe("Piper is ready.");
    setActiveTtsProfile("piper");
    expect(ready.elements.ttsProfilePiperPanel.hidden).toBe(false);
  });
});

describe("settings overlay", () => {
  it("opens, reports open, and closes", () => {
    const harness = wireHarness();
    expect(isSettingsOpen()).toBe(false);
    openSettings("test");
    expect(isSettingsOpen()).toBe(true);
    expect(harness.overlays()).toBe(1);
    expect(harness.settingsOverlay.hidden).toBe(false);
    closeSettings();
    expect(harness.overlays()).toBe(2);
  });
});
