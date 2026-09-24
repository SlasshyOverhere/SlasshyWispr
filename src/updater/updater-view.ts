/**
 * Updater panel view — Phase 5 shell decomposition.
 *
 * Owns all updater DOM writes: status pill/text, version fields, release
 * card, install progress, manual-download row, buttons, last-checked
 * text, and panel init. Moved verbatim from main.tsx; elements and shell
 * seams (tauri probe, browser open, storage reads, date/url format)
 * arrive via initUpdaterView so this module never touches main.tsx
 * module globals.
 */
import { GITHUB_RELEASES_PAGE_URL } from "../constants";
import {
  formatPublishedDate,
  isSafeGithubReleasePageUrl,
  readAppUpdateAutoCheckEnabled,
  readLastAppUpdateCheckedAtMs,
} from "./updater-client";

export interface UpdaterViewDeps {
  isTauri: () => boolean;
  openExternal: (url: string) => void;
}

export interface UpdaterViewElements {
  statusPill: HTMLDivElement;
  statusText: HTMLParagraphElement;
  currentVersion: HTMLElement;
  latestVersion: HTMLElement;
  publishedAt: HTMLElement;
  lastCheckedText: HTMLParagraphElement;
  releaseCard: HTMLDivElement;
  releaseName: HTMLParagraphElement;
  releaseNotes: HTMLParagraphElement;
  releaseLink: HTMLAnchorElement;
  installProgressWrap: HTMLDivElement;
  installProgressTrack: HTMLDivElement;
  installProgressBar: HTMLSpanElement;
  installProgressText: HTMLParagraphElement;
  manualDownloadRow: HTMLDivElement;
  manualDownloadText: HTMLParagraphElement;
  openGithubReleasesBtn: HTMLButtonElement;
  autoCheckUpdatesToggle: HTMLInputElement;
}

let viewElements!: UpdaterViewElements;
let viewDeps!: UpdaterViewDeps;

export function initUpdaterView(elements: UpdaterViewElements, deps: UpdaterViewDeps): void {
  viewElements = elements;
  viewDeps = deps;
}

export function refreshUpdateLastCheckedText(): void {
  const lastCheckedAt = readLastAppUpdateCheckedAtMs();
  if (lastCheckedAt <= 0) {
    viewElements.lastCheckedText.textContent = "Last checked: Never.";
    return;
  }

  viewElements.lastCheckedText.textContent = `Last checked: ${new Date(lastCheckedAt).toLocaleString()}.`;
}

export function setUpdaterStatus(
  stage: "idle" | "processing" | "speaking" | "error",
  message: string,
): void {
  viewElements.statusPill.dataset.stage = stage;
  if (stage === "idle") {
    viewElements.statusPill.textContent = "Idle";
  } else if (stage === "processing") {
    viewElements.statusPill.textContent = "Checking";
  } else if (stage === "speaking") {
    viewElements.statusPill.textContent = "Available";
  } else {
    viewElements.statusPill.textContent = "Error";
  }
  viewElements.statusText.textContent = message;
}

export function setUpdateInstallProgress(
  percent: number,
  message: string,
  detail = "",
  visible = true,
): void {
  viewElements.installProgressWrap.hidden = !visible;
  const normalizedPercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  viewElements.installProgressBar.style.setProperty("--p", String(normalizedPercent / 100));
  const progressText = detail ? `${message} ${detail}` : message;
  viewElements.installProgressTrack.setAttribute("aria-valuenow", String(Math.round(normalizedPercent)));
  viewElements.installProgressTrack.setAttribute("aria-valuetext", progressText);
  viewElements.installProgressText.textContent = progressText;
}

export function showManualDownloadFallback(detail: string): void {
  viewElements.manualDownloadText.textContent = `Download the latest version from GitHub Releases instead.`;
  viewElements.manualDownloadRow.hidden = false;
  setUpdaterStatus("error", detail);
}

export interface UpdateCheckResultView {
  currentVersion: string;
  latestVersion: string;
  publishedAt: string;
  releaseName?: string | null;
  releaseNotes?: string | null;
  releaseUrl?: string | null;
  available: boolean;
  installerDownloadUrl?: string | null;
}

export function applyUpdateCheckResultView(result: UpdateCheckResultView, silent: boolean): void {
  viewElements.currentVersion.textContent = result.currentVersion || "-";
  viewElements.latestVersion.textContent = result.latestVersion || "-";
  viewElements.publishedAt.textContent = formatPublishedDate(result.publishedAt);
  viewElements.releaseName.textContent =
    result.releaseName?.trim() || result.latestVersion || "Release information unavailable";
  viewElements.releaseNotes.textContent =
    result.releaseNotes?.trim() || "Release notes are unavailable for this build.";
  const hasReleaseDetails = Boolean(
    result.releaseName?.trim() ||
      result.releaseNotes?.trim() ||
      (result.releaseUrl ? isSafeGithubReleasePageUrl(result.releaseUrl) : false),
  );
  viewElements.releaseCard.hidden = !hasReleaseDetails;
  if (result.releaseUrl && isSafeGithubReleasePageUrl(result.releaseUrl)) {
    viewElements.releaseLink.href = result.releaseUrl;
    viewElements.releaseLink.hidden = false;
  } else {
    viewElements.releaseLink.href = "https://github.com";
    viewElements.releaseLink.hidden = true;
  }

  if (result.available && result.installerDownloadUrl) {
    setUpdaterStatus(
      "speaking",
      `Update ${result.latestVersion} is available. Click "Download & install".`,
    );
    return;
  }

  if (result.latestVersion && result.latestVersion !== result.currentVersion) {
    setUpdaterStatus(
      "error",
      "A newer release exists, but no Windows installer package was detected for auto-update.",
    );
    return;
  }

  setUpdaterStatus(
    "idle",
    silent ? "You are already on the latest version." : "You are already on the latest version.",
  );
}

export interface UpdaterButtonState {
  isTauri: boolean;
  checkInFlight: boolean;
  installInFlight: boolean;
  result: {
    available: boolean;
    latestVersion: string;
    installerDownloadUrl?: string | null;
  } | null;
}

export interface UpdaterButtonElements {
  checkUpdatesBtn: HTMLButtonElement;
  installUpdateBtn: HTMLButtonElement;
  skipUpdateVersionBtn: HTMLButtonElement;
  snoozeUpdateBtn: HTMLButtonElement;
}

export function syncUpdaterButtonsView(
  buttons: UpdaterButtonElements,
  state: UpdaterButtonState,
): void {
  if (!state.isTauri) {
    buttons.checkUpdatesBtn.disabled = true;
    buttons.installUpdateBtn.disabled = true;
    return;
  }

  buttons.checkUpdatesBtn.disabled = state.checkInFlight || state.installInFlight;
  buttons.installUpdateBtn.disabled =
    state.checkInFlight ||
    state.installInFlight ||
    !state.result?.available ||
    !state.result.installerDownloadUrl;
  buttons.installUpdateBtn.textContent = state.result?.available
    ? `Download & install ${state.result.latestVersion || "update"}`
    : "Download & install";
  buttons.skipUpdateVersionBtn.disabled =
    state.checkInFlight || state.installInFlight || !state.result?.available;
  buttons.snoozeUpdateBtn.disabled = state.checkInFlight || state.installInFlight;
}

export function initializeUpdaterPanel(): void {
  viewElements.currentVersion.textContent = "-";
  viewElements.latestVersion.textContent = "-";
  viewElements.publishedAt.textContent = "-";
  viewElements.releaseCard.hidden = true;
  viewElements.releaseName.textContent = "-";
  viewElements.releaseNotes.textContent = "Release notes are unavailable for this build.";
  viewElements.releaseLink.href = "https://github.com";
  viewElements.releaseLink.hidden = true;
  viewElements.releaseLink.addEventListener("click", (event) => {
    if (!viewDeps.isTauri()) {
      return;
    }
    event.preventDefault();
    viewDeps.openExternal(viewElements.releaseLink.href);
  });
  viewElements.installProgressWrap.hidden = true;
  viewElements.installProgressBar.style.setProperty("--p", "0");
  viewElements.installProgressTrack.setAttribute("aria-valuenow", "0");
  viewElements.installProgressTrack.setAttribute(
    "aria-valuetext",
    "Waiting to start update download.",
  );
  viewElements.installProgressText.textContent = "Waiting to start update download.";
  viewElements.manualDownloadRow.hidden = true;
  viewElements.openGithubReleasesBtn.addEventListener("click", () => {
    viewDeps.openExternal(GITHUB_RELEASES_PAGE_URL);
  });
  viewElements.autoCheckUpdatesToggle.checked = readAppUpdateAutoCheckEnabled();
  refreshUpdateLastCheckedText();
  setUpdaterStatus("idle", "Check to see if a new version is available.");

  if (!viewDeps.isTauri()) {
    setUpdaterStatus("error", "Updater works only inside the desktop app build.");
  }
}
