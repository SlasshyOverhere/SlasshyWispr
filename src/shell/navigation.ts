/**
 * Page and settings-pane navigation — Phase 5 shell decomposition.
 *
 * Owns asMainPage + asSettingsPane + setActivePage +
 * setActiveSettingsPane + setActiveTtsProfile + updateTtsSetupGate +
 * openSettings + closeSettings + isSettingsOpen, plus the nav button /
 * settings overlay / Escape-adjacent wiring owned by these controls.
 * Moved verbatim from main.tsx; active page/pane and timer state live
 * here, and shell seams (TTS readiness, overlay visibility, log) arrive
 * via initNavigation so this module never touches main.tsx globals.
 */
import { ACTIVE_PAGE_STORAGE_KEY } from "../constants";
import type { MainPage, SettingsPane, TtsProfilePane } from "../types";

export const ACTIVE_SETTINGS_PANE_STORAGE_KEY = "slasshywispr-active-settings-pane-v1";

export interface NavigationElements {
  pageNavButtons: HTMLButtonElement[];
  settingsNavButtons: HTMLButtonElement[];
  settingsPanels: HTMLElement[];
  settingsPaneTitle: HTMLElement;
  settingsMain: HTMLElement;
  settingsOverlay: HTMLDivElement;
  openSettingsBtn: HTMLButtonElement;
  closeSettingsBtn: HTMLButtonElement;
  ttsBootstrapCard: HTMLDivElement;
  ttsProfilesArea: HTMLDivElement;
  ttsSetupStatus: HTMLParagraphElement;
  ttsProfilePiperTab: HTMLButtonElement;
  ttsProfilePiperPanel: HTMLDivElement;
}

export interface NavigationDeps {
  log: (message: string) => void;
  isPiperRuntimeReady: () => boolean;
  isTtsSetupRunning: () => boolean;
  notifyOverlayVisibilityChanged: () => void;
}

let navElements!: NavigationElements;
let navDeps!: NavigationDeps;

let activePage: MainPage = "home";
let activeSettingsPane: SettingsPane = "general";
let settingsCloseTimer: number | null = null;
let settingsPaneTransitionTimer: number | null = null;

export function initNavigation(
  elements: NavigationElements,
  deps: NavigationDeps,
  initial: { page: MainPage; pane: SettingsPane },
): void {
  navElements = elements;
  navDeps = deps;
  activePage = initial.page;
  activeSettingsPane = initial.pane;

  for (const navButton of elements.pageNavButtons) {
    navButton.addEventListener("click", () => {
      const page = asMainPage(navButton.dataset.pageNav);
      if (!page) return;
      setActivePage(page);
    });
  }

  for (const navButton of elements.settingsNavButtons) {
    navButton.addEventListener("click", () => {
      const pane = asSettingsPane(navButton.dataset.settingsPaneNav);
      if (!pane) return;
      setActiveSettingsPane(pane);
    });
  }

  elements.openSettingsBtn.addEventListener("click", () => {
    openSettings("user-click-settings-button");
  });

  elements.closeSettingsBtn.addEventListener("click", () => {
    closeSettings();
  });

  elements.settingsOverlay.addEventListener("click", (event) => {
    if (event.target === elements.settingsOverlay) {
      closeSettings();
    }
  });
}

export function asMainPage(value: string | undefined): MainPage | null {
  if (value === "home" || value === "history" || value === "analytics") {
    return value;
  }

  return null;
}

export function asSettingsPane(value: string | undefined): SettingsPane | null {
  if (value === "online" || value === "offline" || value === "hybrid") {
    return "models";
  }
  if (
    value === "general" ||
    value === "models" ||
    value === "update-security" ||
    value === "pipeline"
  ) {
    return value;
  }

  return null;
}

export function getActivePage(): MainPage {
  return activePage;
}

export function getActiveSettingsPane(): SettingsPane {
  return activeSettingsPane;
}

export function setActivePage(next: MainPage): void {
  activePage = next;
  localStorage.setItem(ACTIVE_PAGE_STORAGE_KEY, next);

  // Let React control nav button and panel classes via the store event below.
  // Vanilla JS only updates aria-current for accessibility.
  for (const navButton of navElements.pageNavButtons) {
    const current = navButton.dataset.pageNav === next;
    navButton.setAttribute("aria-current", current ? "page" : "false");
  }

  // Notify React to re-render with the new active page.
  // React is the single source of truth for page content (history, etc.).
  // Do NOT call renderHomeHistory()/renderFullHistory() here — that causes
  // innerHTML writes on React-controlled DOM nodes, leading to blank screens.
  window.dispatchEvent(new CustomEvent("slasshywispr:store-updated"));
}

export function setActiveSettingsPane(next: SettingsPane, reason = "unspecified"): void {
  navDeps.log(
    `[ui.settings.pane] next=${next} reason=${reason}`,
  );
  const previousPane = activeSettingsPane;
  activeSettingsPane = next;
  localStorage.setItem(ACTIVE_SETTINGS_PANE_STORAGE_KEY, next);

  const titleMap: Record<SettingsPane, string> = {
    general: "General",
    models: "Models",
    "update-security": "Update and Security",
    pipeline: "Pipeline",
  };

  navElements.settingsPaneTitle.textContent = titleMap[next];

  for (const navButton of navElements.settingsNavButtons) {
    const current = navButton.dataset.settingsPaneNav === next;
    navButton.classList.toggle("is-active", current);
    navButton.setAttribute("aria-current", current ? "page" : "false");
  }

  if (settingsPaneTransitionTimer !== null) {
    window.clearTimeout(settingsPaneTransitionTimer);
    settingsPaneTransitionTimer = null;
  }

  navElements.settingsMain.classList.remove("is-pane-switching", "is-switching-forward", "is-switching-backward");
  for (const panel of navElements.settingsPanels) {
    panel.classList.remove("is-transitioning-in", "is-transitioning-forward", "is-transitioning-backward");
  }

  const previousIndex = navElements.settingsPanels.findIndex((panel) => panel.dataset.settingsPane === previousPane);
  const nextIndex = navElements.settingsPanels.findIndex((panel) => panel.dataset.settingsPane === next);
  const shouldAnimate = previousPane !== next && previousIndex >= 0 && nextIndex >= 0;

  for (const panel of navElements.settingsPanels) {
    const current = panel.dataset.settingsPane === next;
    panel.classList.toggle("is-active", current);
    panel.hidden = !current;
    if (current && shouldAnimate) {
      const directionClass = nextIndex > previousIndex ? "is-transitioning-forward" : "is-transitioning-backward";
      panel.classList.add("is-transitioning-in", directionClass);
    }
  }

  if (shouldAnimate) {
    const switchDirectionClass = nextIndex > previousIndex ? "is-switching-forward" : "is-switching-backward";
    navElements.settingsMain.classList.add("is-pane-switching", switchDirectionClass);
    settingsPaneTransitionTimer = window.setTimeout(() => {
      navElements.settingsMain.classList.remove("is-pane-switching", "is-switching-forward", "is-switching-backward");
      for (const panel of navElements.settingsPanels) {
        panel.classList.remove("is-transitioning-in", "is-transitioning-forward", "is-transitioning-backward");
      }
      settingsPaneTransitionTimer = null;
    }, 180);
  }
}

export function setActiveTtsProfile(_next: TtsProfilePane): void {
  navElements.ttsProfilePiperTab.classList.toggle("is-active", true);
  navElements.ttsProfilePiperTab.setAttribute("aria-selected", "true");
  navElements.ttsProfilePiperPanel.hidden = false;
}

export function updateTtsSetupGate(): void {
  const piperReady = navDeps.isPiperRuntimeReady();
  const showBootstrap = !piperReady || navDeps.isTtsSetupRunning();
  navElements.ttsBootstrapCard.hidden = !showBootstrap;
  navElements.ttsProfilesArea.hidden = !piperReady;

  if (piperReady && !navDeps.isTtsSetupRunning() && !navElements.ttsSetupStatus.textContent?.trim()) {
    navElements.ttsSetupStatus.textContent = "Piper is ready.";
  }
}

export function openSettings(reason = "unspecified"): void {
  navDeps.log(`[ui.settings.open] reason=${reason}`);
  if (settingsCloseTimer !== null) {
    window.clearTimeout(settingsCloseTimer);
    settingsCloseTimer = null;
  }
  navElements.settingsOverlay.hidden = false;
  navElements.settingsOverlay.classList.remove("is-closing");
  void navElements.settingsOverlay.offsetWidth;
  navElements.settingsOverlay.classList.add("is-open");
  navDeps.notifyOverlayVisibilityChanged();
}

export function closeSettings(): void {
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement && navElements.settingsOverlay.contains(activeElement)) {
    activeElement.blur();
  }
  navElements.settingsOverlay.classList.remove("is-open");
  navElements.settingsOverlay.classList.add("is-closing");
  if (settingsCloseTimer !== null) {
    window.clearTimeout(settingsCloseTimer);
  }
  settingsCloseTimer = window.setTimeout(() => {
    navElements.settingsOverlay.hidden = true;
    navElements.settingsOverlay.classList.remove("is-closing");
    settingsCloseTimer = null;
  }, 180);
  navDeps.notifyOverlayVisibilityChanged();
}

export function isSettingsOpen(): boolean {
  return !navElements.settingsOverlay.hidden && navElements.settingsOverlay.classList.contains("is-open");
}
