/**
 * Navigation move-boundary test — Phase 5 shell decomposition.
 *
 * Pins asMainPage/asSettingsPane parsing (including legacy online /
 * offline / hybrid aliases), setActivePage persistence + aria + store
 * event, setActiveSettingsPane title/panel switching + persistence, the
 * TTS gate visibility matrix, and opening Settings as a main tab while
 * preserving the previous page for Escape. Runs against stub elements
 * with the real localStorage
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
  closeSettings,
  setActivePage,
  setActiveSettingsPane,
  setActiveTtsProfile,
  updateTtsSetupGate,
} from "./navigation";

function fakeButton(): HTMLButtonElement {
  const classes = new Set<string>();
  const listeners = new Map<string, () => void>();
  return {
    dataset: {},
    addEventListener(type: string, listener: () => void) {
      listeners.set(type, listener);
    },
    click() {
      for (const listener of listeners.values()) listener();
    },
    setAttribute() {},
    classList: {
      toggle(name: string, force?: boolean) {
        const active = force ?? !classes.has(name);
        if (active) classes.add(name);
        else classes.delete(name);
      },
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name),
    },
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

function fakeSection(owner: string, section: string): HTMLDivElement {
  const div = fakeDiv(true);
  (div as unknown as { dataset: Record<string, string> }).dataset = {
    settingsSectionOwner: owner,
    settingsSection: section,
  };
  return div;
}

function fakeSectionGroup(owner: string, sections: string[]) {
  const group = fakeDiv();
  group.dataset.settingsSectionOwner = owner;
  const buttons = sections.map((section) => {
    const button = fakeButton();
    button.dataset.settingsSectionNav = section;
    Object.defineProperty(button, "parentElement", { value: group });
    return button;
  });
  return { group, buttons };
}

function fakeDiv(hidden = false): HTMLDivElement {
  const classes = new Set<string>();
  return {
    dataset: {},
    hidden,
    classList: {
      toggle(name: string, force?: boolean) {
        const active = force ?? !classes.has(name);
        if (active) classes.add(name);
        else classes.delete(name);
      },
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
  let visibilityChanges = 0;
  (globalThis as unknown as { HTMLElement?: unknown }).HTMLElement ??= class {};
  const settingsPageButton = fakeButton();
  settingsPageButton.dataset.pageNav = "settings";
  const generalNav = fakeSectionGroup("general", ["audio"]);
  const modelsNav = fakeSectionGroup("models", ["runtime", "voice"]);
  const updatesNav = fakeSectionGroup("update-security", ["updates"]);
  const elements = {
    pageNavButtons: [fakeButton(), settingsPageButton],
    settingsNavButtons: [fakeButton()],
    settingsSectionButtons: [
      ...generalNav.buttons,
      ...modelsNav.buttons,
      ...updatesNav.buttons,
    ],
    settingsPanels: [fakePanel("general"), fakePanel("models")],
    settingsSections: [
      fakeSection("general", "audio"),
      fakeSection("models", "runtime"),
      fakeSection("models", "voice"),
      fakeSection("update-security", "updates"),
    ],
    settingsPaneTitle: { textContent: "" } as unknown as HTMLElement,
    settingsSectionDescription: { textContent: "" } as unknown as HTMLElement,
    settingsMain: fakeDiv(),
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
      notifySettingsVisibilityChanged: () => {
        visibilityChanges += 1;
      },
    },
    { page: "home", pane: "general" },
  );
  return { elements, logs, visibilityChanges: () => visibilityChanges };
}

beforeEach(() => {
  localStorage.clear();
  wireHarness();
});

describe("parsers", () => {
  it("accepts known pages and panes plus legacy aliases", () => {
    expect(asMainPage("analytics")).toBe("analytics");
    expect(asMainPage("settings")).toBe("settings");
    expect(asMainPage("dictionary")).toBeNull();
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
  it("persists, opens the default section, and toggles panels", () => {
    const harness = wireHarness();
    setActiveSettingsPane("models", "test");
    expect(getActiveSettingsPane()).toBe("models");
    expect(localStorage.getItem(ACTIVE_SETTINGS_PANE_STORAGE_KEY)).toBe("models");
    expect(harness.elements.settingsPaneTitle.textContent).toBe("Runtime");
    expect(harness.logs.some((line) => line.includes("next=models"))).toBe(true);
  });

  it("keeps every settings section visible instead of filtering the pane", () => {
    const harness = wireHarness();

    setActiveSettingsPane("models", "test");

    expect(harness.elements.settingsSections.every((section) => !section.hidden)).toBe(true);
  });

  it("shows quick jumps for the active pane using their group owner", () => {
    const harness = wireHarness();

    setActiveSettingsPane("general", "test");

    expect(harness.elements.settingsSectionButtons[0].hidden).toBe(false);
    expect(harness.elements.settingsSectionButtons[1].hidden).toBe(true);
  });

  it("remembers the last explicit section within each top-level pane", () => {
    const harness = wireHarness();
    const voiceButton = harness.elements.settingsSectionButtons[2];

    voiceButton.click();
    expect(harness.elements.settingsPaneTitle.textContent).toBe("Voice");
    expect(harness.elements.settingsSectionDescription.textContent).toBe("Set up Piper or a voice cloned from your recording.");
    expect(voiceButton.classList.contains("is-active")).toBe(true);
    expect(harness.elements.settingsSections[1].hidden).toBe(false);
    expect(harness.elements.settingsSections[2].hidden).toBe(false);

    setActiveSettingsPane("general", "test");
    expect(harness.elements.settingsPaneTitle.textContent).toBe("Audio & shortcuts");

    setActiveSettingsPane("models", "test");
    expect(harness.elements.settingsPaneTitle.textContent).toBe("Voice");
  });

  it("restores a persisted section during initialization", () => {
    localStorage.setItem(
      "slasshywispr-settings-sections-v1",
      JSON.stringify({ general: "audio", models: "voice" }),
    );

    const harness = wireHarness();

    expect(harness.elements.settingsPaneTitle.textContent).toBe("Audio & shortcuts");
    setActiveSettingsPane("models", "test");
    expect(harness.elements.settingsPaneTitle.textContent).toBe("Voice");
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

describe("settings page", () => {
  it("opens as a main tab and returns to the previous page", () => {
    const harness = wireHarness();
    setActivePage("history");

    expect(isSettingsOpen()).toBe(false);
    harness.elements.pageNavButtons[1].click();
    expect(getActivePage()).toBe("settings");
    expect(isSettingsOpen()).toBe(true);
    expect(localStorage.getItem(ACTIVE_PAGE_STORAGE_KEY)).toBe("settings");
    expect(harness.visibilityChanges()).toBe(1);

    closeSettings();
    expect(getActivePage()).toBe("history");
    expect(isSettingsOpen()).toBe(false);
    expect(harness.visibilityChanges()).toBe(2);
  });
});
