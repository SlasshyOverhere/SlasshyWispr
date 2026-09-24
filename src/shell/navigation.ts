/**
 * Page and settings-pane navigation — Phase 5 shell decomposition.
 *
 * Owns asMainPage + asSettingsPane + setActivePage +
 * setActiveSettingsPane + setActiveTtsProfile + updateTtsSetupGate +
 * openSettings + closeSettings + isSettingsOpen, plus the main and
 * settings-directory navigation wiring owned by these controls. Active
 * page/pane and transition state live here, while shell seams (TTS
 * readiness, settings visibility, log) arrive via initNavigation so this
 * module never touches main.tsx globals.
 */
import { ACTIVE_PAGE_STORAGE_KEY } from "../constants";
import {
  defaultSettingsSection,
  findSettingsSection,
  parseSettingsSectionMemory,
  type SettingsSection,
  type SettingsSectionMemory,
} from "../settings/settings-directory";
import type { MainPage, SettingsPane, TtsProfilePane } from "../types";

export const ACTIVE_SETTINGS_PANE_STORAGE_KEY = "slasshywispr-active-settings-pane-v1";
export const ACTIVE_SETTINGS_SECTIONS_STORAGE_KEY = "slasshywispr-settings-sections-v1";

export interface NavigationElements {
  pageNavButtons: HTMLButtonElement[];
  settingsNavButtons: HTMLButtonElement[];
  settingsSectionButtons: HTMLButtonElement[];
  settingsPanels: HTMLElement[];
  settingsSections: HTMLElement[];
  settingsPaneTitle: HTMLElement;
  settingsSectionDescription: HTMLElement;
  settingsMain: HTMLElement;
  settingsScrollContainer: HTMLElement;
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
  notifySettingsVisibilityChanged: () => void;
}

let navElements!: NavigationElements;
let navDeps!: NavigationDeps;

let activePage: MainPage = "home";
let activeSettingsPane: SettingsPane = "general";
let activeSettingsSectionMemory: SettingsSectionMemory = {};
let settingsReturnPage: MainPage = "home";

export function initNavigation(
  elements: NavigationElements,
  deps: NavigationDeps,
  initial: { page: MainPage; pane: SettingsPane },
): void {
  navElements = elements;
  navDeps = deps;
  activePage = initial.page;
  activeSettingsPane = initial.pane;
  activeSettingsSectionMemory = parseSettingsSectionMemory(
    localStorage.getItem(ACTIVE_SETTINGS_SECTIONS_STORAGE_KEY),
  );

  for (const navButton of elements.pageNavButtons) {
    navButton.addEventListener("click", () => {
      const page = asMainPage(navButton.dataset.pageNav);
      if (!page) return;
      if (page === "settings") {
        openSettings("main-navigation");
      } else {
        setActivePage(page);
      }
    });
  }

  for (const navButton of elements.settingsNavButtons) {
    navButton.addEventListener("click", () => {
      const pane = asSettingsPane(navButton.dataset.settingsPaneNav);
      if (!pane) return;
      setActiveSettingsPane(pane);
    });
  }

  for (const navButton of elements.settingsSectionButtons) {
    navButton.addEventListener("click", () => {
      const pane = settingsSectionOwner(navButton);
      const section = pane ? findSettingsSection(pane, navButton.dataset.settingsSectionNav) : null;
      if (!pane || !section) return;
      setActiveSettingsPane(pane, "settings-section-navigation", section.id as SettingsSection);
    });
  }

  setActiveSettingsPane(initial.pane, "initial-navigation");
}

export function asMainPage(value: string | undefined): MainPage | null {
  if (value === "home" || value === "history" || value === "analytics" || value === "settings") {
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

function settingsSectionOwner(navButton: HTMLButtonElement): SettingsPane | null {
  return asSettingsPane(navButton.parentElement?.dataset.settingsSectionOwner);
}

function scrollSettingsSectionIntoView(section: HTMLElement, container: HTMLElement): void {
  const sectionTop = section.getBoundingClientRect().top;
  const containerTop = container.getBoundingClientRect().top;
  container.scrollTop = Math.max(0, container.scrollTop + sectionTop - containerTop - 8);
}

export function getActivePage(): MainPage {
  return activePage;
}

export function getActiveSettingsPane(): SettingsPane {
  return activeSettingsPane;
}

export function setActivePage(next: MainPage): void {
  const wasSettings = activePage === "settings";
  const willBeSettings = next === "settings";

  if (willBeSettings && !wasSettings) {
    settingsReturnPage = activePage;
  }

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

  if (wasSettings !== willBeSettings) {
    navDeps.notifySettingsVisibilityChanged();
  }
}

export function setActiveSettingsPane(
  next: SettingsPane,
  reason = "unspecified",
  section?: SettingsSection,
): void {
  const requestedSection = section ?? activeSettingsSectionMemory[next] ?? defaultSettingsSection(next);
  const definition = findSettingsSection(next, requestedSection);
  const nextSection = (definition?.id ?? defaultSettingsSection(next)) as SettingsSection;

  navDeps.log(`[ui.settings.pane] next=${next} section=${nextSection} reason=${reason}`);

  activeSettingsPane = next;
  activeSettingsSectionMemory = { ...activeSettingsSectionMemory, [next]: nextSection };
  localStorage.setItem(ACTIVE_SETTINGS_PANE_STORAGE_KEY, next);
  localStorage.setItem(ACTIVE_SETTINGS_SECTIONS_STORAGE_KEY, JSON.stringify(activeSettingsSectionMemory));

  navElements.settingsPaneTitle.textContent = definition?.title ?? nextSection;
  navElements.settingsSectionDescription.textContent = definition?.description ?? "";

  for (const navButton of navElements.settingsNavButtons) {
    const current = navButton.dataset.settingsPaneNav === next;
    navButton.classList.toggle("is-active", current);
    navButton.setAttribute("aria-current", current ? "page" : "false");
  }

  for (const navButton of navElements.settingsSectionButtons) {
    const owner = settingsSectionOwner(navButton);
    const current = owner === next && navButton.dataset.settingsSectionNav === nextSection;
    navButton.hidden = owner !== next;
    navButton.classList.toggle("is-active", current);
    navButton.setAttribute("aria-current", current ? "page" : "false");
    const group = navButton.parentElement;
    if (group?.dataset.settingsSectionOwner) {
      group.hidden = group.dataset.settingsSectionOwner !== next;
    }
  }

  for (const panel of navElements.settingsPanels) {
    const current = panel.dataset.settingsPane === next;
    panel.classList.toggle("is-active", current);
    panel.hidden = !current;
  }

  for (const settingsSection of navElements.settingsSections) {
    const current =
      settingsSection.dataset.settingsSectionOwner === next
      && settingsSection.dataset.settingsSection === nextSection;
    settingsSection.hidden = false;
    settingsSection.classList.toggle("is-active", current);
    if (current) {
      scrollSettingsSectionIntoView(settingsSection, navElements.settingsScrollContainer);
    }
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
  setActivePage("settings");
}

export function closeSettings(): void {
  if (activePage !== "settings") {
    return;
  }

  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement && navElements.settingsMain.contains(activeElement)) {
    activeElement.blur();
  }

  setActivePage(settingsReturnPage === "settings" ? "home" : settingsReturnPage);
}

export function isSettingsOpen(): boolean {
  return activePage === "settings";
}
