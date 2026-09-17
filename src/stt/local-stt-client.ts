/**
 * Local-STT client — Phase 5 shell decomposition.
 *
 * Owns the local-STT model lifecycle: status/availability, ensure,
 * runtime sync, refresh, activate, warmup, deactivate, download/delete/
 * open-path, download-status polling, load/download overlays, hardware
 * advisor, and the sidebar toggle entry point. Moved verbatim from
 * main.tsx; shell seams (settings, stage/machine, catalogs, notices,
 * panes, diagnostics, action availability, overlays, assistant refresh)
 * arrive via initLocalSttClient so this module never touches main.tsx
 * module globals.
 */
import type {
  LocalSttDownloadStatusResponse,
  LocalSttHardwareAdvisorChoice,
  LocalSttHardwareAdviceResponse,
  LocalSttModelStatusResponse,
  LocalSttWarmupResponse,
  RuntimeMode,
  SettingsPane,
} from "../types";
import { asErrorMessage, escapeHtml, formatBytes } from "../utils";
import {
  deactivateLocalSttModel as ipcDeactivateLocalSttModel,
  deleteLocalSttModel as ipcDeleteLocalSttModel,
  downloadLocalSttModel as ipcDownloadLocalSttModel,
  fetchLocalSttModels as ipcFetchLocalSttModels,
  getLocalSttDownloadStatus as ipcGetLocalSttDownloadStatus,
  getLocalSttHardwareAdvice as ipcGetLocalSttHardwareAdvice,
  getLocalSttModelStatus as ipcGetLocalSttModelStatus,
  getLocalSttRuntimeState as ipcGetLocalSttRuntimeState,
  openLocalSttModelPath as ipcOpenLocalSttModelPath,
  warmupLocalSttModel as ipcWarmupLocalSttModel,
} from "../ipc/client";
import { pickDefaultLocalSttModelFromCatalog as pickDefaultLocalSttModelFromList } from "./provider-inference";
import {
  getLocalSttActionBlockReason,
  getSelectedLocalSttModel,
  hasShownLocalSttHardwareAdvisor,
  initLocalSttState,
  isLocalSttBusy,
  isSelectedLocalSttModelLoaded,
  localSttModelLabel,
  markLocalSttHardwareAdvisorShown,
  lastWarmedLocalSttModel,
  localSttDeactivateInFlight,
  localSttDeleteInFlight,
  localSttDownloadActive,
  localSttDownloadInFlight,
  localSttDownloadOverlay,
  localSttDownloadStatusPollInFlight,
  localSttDownloadStatusPollingId,
  localSttHardwareAdvisorOpen,
  localSttHardwareAdvisorResolver,
  localSttLoadOverlayStartedAt,
  localSttLoadOverlayTickerId,
  localSttRuntimeLoaded,
  localSttRuntimeStateInFlight,
  localSttSelectedModelDownloaded,
  localSttStatusChecked,
  localSttWarmupInFlight,
  pendingRuntimeModeSyncShowLoadOverlay,
  pendingRuntimeModeSyncTarget,
  runtimeModeSyncInFlight,
  setLastWarmedLocalSttModel,
  setLocalSttDeactivateInFlight,
  setLocalSttDeleteInFlight,
  setLocalSttDownloadActive,
  setLocalSttDownloadInFlight,
  setLocalSttDownloadOverlay,
  setLocalSttDownloadStatusPollInFlight,
  setLocalSttDownloadStatusPollingId,
  setLocalSttHardwareAdvisorOpen,
  setLocalSttHardwareAdvisorResolver,
  setLocalSttLoadOverlayStartedAt,
  setLocalSttLoadOverlayTickerId,
  setLocalSttRuntimeLoaded,
  setLocalSttRuntimeStateInFlight,
  setLocalSttSelectedModelDownloaded,
  setLocalSttStatusChecked,
  setLocalSttWarmupInFlight,
  setPendingRuntimeModeSyncShowLoadOverlay,
  setPendingRuntimeModeSyncTarget,
  setRuntimeModeSyncInFlight,
} from "./local-stt-state";

export interface LocalSttClientElements {
  sidebarToggleBtn: HTMLButtonElement;
  sidebarToggleGlyph: HTMLSpanElement;
  sidebarToggleLabel: HTMLSpanElement;
  loadOverlay: HTMLDivElement;
  loadModel: HTMLParagraphElement;
  loadDetail: HTMLParagraphElement;
  modelInput: HTMLInputElement;
  modelCatalogSelect: HTMLSelectElement;
  statusBadge: HTMLSpanElement;
  statusDetail: HTMLParagraphElement;
  downloadNotice: HTMLParagraphElement;
  downloadProgressBar: HTMLSpanElement;
  downloadProgressText: HTMLParagraphElement;
  downloadBtn: HTMLButtonElement;
  deleteBtn: HTMLButtonElement;
  openPathBtn: HTMLButtonElement;
  hardwareAdvisorOverlay: HTMLDivElement;
  hardwareAdvisorUseSuggestionBtn: HTMLButtonElement;
  hardwareAdvisorContinueBtn: HTMLButtonElement;
  hardwareAdvisorCancelBtn: HTMLButtonElement;
}

export interface LocalSttClientDeps {
  readSettings: () => { sttRuntimeMode: RuntimeMode; localSttModel: string; sttModelName: string };
  commitFormSettings: () => void;
  getCatalog: () => string[];
  isPipelineRunning: () => boolean;
  getStage: () => string;
  setStage: (stage: "idle" | "processing", detail: string) => void;
  notify: (message: string, isError?: boolean) => void;
  log: (message: string) => void;
  syncAvailability: () => void;
  openSettings: (reason: string) => void;
  setActiveSettingsPane: (pane: SettingsPane, reason?: string) => void;
  refreshAssistantInfo: () => Promise<void>;
  renderFetchedCatalog: (models: string[], selected: string) => void;
  checkModelFileExists: (model: string) => Promise<boolean>;
  checkPythonDependencies: (model: string) => Promise<boolean>;
  checkAvailableMemory: (model: string) => Promise<{ sufficient: boolean; availableMB?: number }>;
  showOfflineModeDiagnostic: (issue: string, details?: Record<string, unknown>) => void;
  ensureSelectedLocalSttModelForWarmup: () => Promise<string>;
  isSettingsOpen: () => boolean;
}

let clientElements!: LocalSttClientElements;
let clientDeps!: LocalSttClientDeps;
let lastLocalSttDownloadStatus: LocalSttDownloadStatusResponse | null = null;

export function initLocalSttClient(
  elements: LocalSttClientElements,
  deps: LocalSttClientDeps,
): void {
  clientElements = elements;
  clientDeps = deps;
  initLocalSttState({
    readSettings: () => clientDeps.readSettings(),
    getCatalogSelection: () => elements.modelCatalogSelect.value,
    isPipelineRunning: () => deps.isPipelineRunning(),
    getStage: () => deps.getStage(),
    renderSidebarToggle: () => renderSidebarLocalSttToggle(),
    renderSettingsStatus: () => renderLocalSttSettingsStatus(),
  });

  elements.sidebarToggleBtn.addEventListener("click", () => {
    void handleSidebarToggleClick();
  });
  elements.downloadBtn.addEventListener("click", () => {
    void downloadLocalSttModel();
  });
  elements.deleteBtn.addEventListener("click", () => {
    void deleteLocalSttModel();
  });
  elements.openPathBtn.addEventListener("click", () => {
    void openLocalSttModelPath();
  });
  // Note: the catalog <select> change listener stays in main.tsx — its
  // version also resets the downloaded/status flags, re-renders, and
  // refreshes availability, which this module cannot do without new seams.
  elements.hardwareAdvisorOverlay.addEventListener("click", (event) => {
    if (event.target === elements.hardwareAdvisorOverlay) {
      resolveLocalSttHardwareAdvisorChoice("cancel");
    }
  });
  elements.hardwareAdvisorUseSuggestionBtn.addEventListener("click", () => {
    resolveLocalSttHardwareAdvisorChoice("suggestion");
  });
  elements.hardwareAdvisorContinueBtn.addEventListener("click", () => {
    resolveLocalSttHardwareAdvisorChoice("selected");
  });
  elements.hardwareAdvisorCancelBtn.addEventListener("click", () => {
    resolveLocalSttHardwareAdvisorChoice("cancel");
  });
}

export function isLocalSttHardwareAdvisorOpen(): boolean {
  return localSttHardwareAdvisorOpen;
}

export function handleLocalSttAdvisorEscape(): boolean {
  if (!localSttHardwareAdvisorOpen) {
    return false;
  }
  resolveLocalSttHardwareAdvisorChoice("cancel");
  return true;
}

function syncLocalSttDownloadOverlayVisibility(): void {
  if (!localSttDownloadOverlay) {
    return;
  }
  const shouldShow =
    lastLocalSttDownloadStatus !== null &&
    lastLocalSttDownloadStatus.active &&
    !clientDeps.isSettingsOpen();
  localSttDownloadOverlay.hidden = !shouldShow;
}

export function notifySettingsOverlayVisibilityChanged(): void {
  syncLocalSttDownloadOverlayVisibility();
}

export { isLocalSttBusy };

export function reportBlockedLocalSttAction(action: string): boolean {
  const reason = getLocalSttActionBlockReason();
  if (!reason) {
    return false;
  }
  clientDeps.notify(`${action} unavailable right now. ${reason}`, true);
  return true;
}

export async function getLocalSttModelStatus(
  model: string,
  options: { quiet?: boolean } = {},
): Promise<LocalSttModelStatusResponse | null> {
  const normalizedModel = model.trim();
  if (!normalizedModel) {
    setLocalSttSelectedModelDownloaded(false);
    setLocalSttStatusChecked(true);
    renderSidebarLocalSttToggle();
    return null;
  }

  try {
    const response = await ipcGetLocalSttModelStatus(
      { model: normalizedModel },
      `Timed out while checking local STT files for "${normalizedModel}".`,
    );
    setLocalSttSelectedModelDownloaded(response.exists);
    return response;
  } catch (error) {
    setLocalSttSelectedModelDownloaded(false);
    if (!options.quiet) {
      clientDeps.notify(`Unable to inspect local STT model files: ${asErrorMessage(error)}`, true);
    }
    return null;
  } finally {
    setLocalSttStatusChecked(true);
    renderSidebarLocalSttToggle();
  }
}

export function markCatalogSelectionCleared(): void {
  setLocalSttSelectedModelDownloaded(false);
  setLocalSttStatusChecked(true);
  renderSidebarLocalSttToggle();
  renderLocalSttSettingsStatus();
}

export function markCatalogSelectionChanged(): void {
  setLocalSttStatusChecked(false);
}

export async function refreshSelectedLocalSttModelAvailability(
  options: { quiet?: boolean } = {},
): Promise<boolean> {
  const model = getSelectedLocalSttModel();
  const response = await getLocalSttModelStatus(model, options);
  setLocalSttSelectedModelDownloaded(response?.exists === true);
  renderLocalSttSettingsStatus();
  return localSttSelectedModelDownloaded;
}

async function applyCatalogFallbackToForm(
  catalog: string[],
): Promise<string> {
  const fallbackModel = pickDefaultLocalSttModelFromList(catalog);
  if (fallbackModel) {
    clientElements.modelInput.value = fallbackModel;
    if (catalog.includes(fallbackModel)) {
      clientElements.modelCatalogSelect.value = fallbackModel;
    }
    clientDeps.commitFormSettings();
    await refreshSelectedLocalSttModelAvailability({ quiet: true });
  }
  return fallbackModel;
}

export async function ensureSelectedLocalSttModel(options: { quiet?: boolean } = {}): Promise<string> {
  const quiet = options.quiet === true;
  const activeSettings = clientDeps.readSettings();
  const catalog = clientDeps.getCatalog();
  let selected = activeSettings.localSttModel.trim() || clientElements.modelCatalogSelect.value.trim();
  if (selected) {
    return selected;
  }

  if (catalog.length === 0) {
    await fetchLocalSttModels({ quiet: true, autoSelect: true });
    selected = clientDeps.readSettings().localSttModel.trim() || clientElements.modelCatalogSelect.value.trim();
    if (selected) {
      return selected;
    }
  }

  const fallbackModel = await applyCatalogFallbackToForm(clientDeps.getCatalog());
  if (fallbackModel) {
    if (!quiet) {
      clientDeps.notify(`Selected local STT model "${localSttModelLabel(fallbackModel)}".`);
    }
    return fallbackModel;
  }

  if (!quiet) {
    clientDeps.notify("No local STT models are available yet. Open Settings > Models and refresh the catalog.", true);
    clientDeps.openSettings("local-stt-model-required");
    clientDeps.setActiveSettingsPane("models", "local-stt-model-required");
  }
  return "";
}

export function requestLocalSttRuntimeSyncForMode(
  targetMode: RuntimeMode,
  options: { showLoadOverlay?: boolean } = {},
): void {
  setPendingRuntimeModeSyncTarget(targetMode);
  if (targetMode === "local" && options.showLoadOverlay === true) {
    setPendingRuntimeModeSyncShowLoadOverlay(true);
  }
  if (runtimeModeSyncInFlight) {
    return;
  }

  setRuntimeModeSyncInFlight(true);
  void (async () => {
    try {
      while (pendingRuntimeModeSyncTarget) {
        const nextTarget = pendingRuntimeModeSyncTarget;
        const nextShowLoadOverlay =
          nextTarget === "local" && pendingRuntimeModeSyncShowLoadOverlay;
        setPendingRuntimeModeSyncTarget(null);
        setPendingRuntimeModeSyncShowLoadOverlay(false);
        try {
          await syncLocalSttRuntimeForMode(nextTarget, { showLoadOverlay: nextShowLoadOverlay });
        } catch (error) {
          clientDeps.notify(`Unable to switch local STT runtime: ${asErrorMessage(error)}`, true);
        }
      }
    } finally {
      setRuntimeModeSyncInFlight(false);
    }
  })();
}

export async function syncLocalSttRuntimeForMode(
  mode: RuntimeMode,
  options: { showLoadOverlay?: boolean } = {},
): Promise<void> {
  if (mode === "local") {
    let model = clientDeps.readSettings().localSttModel.trim() || clientElements.modelCatalogSelect.value.trim();
    if (!model) {
      const fallbackModel = pickDefaultLocalSttModelFromList(clientDeps.getCatalog());
      if (fallbackModel) {
        clientElements.modelInput.value = fallbackModel;
        if (clientDeps.getCatalog().includes(fallbackModel)) {
          clientElements.modelCatalogSelect.value = fallbackModel;
        }
        clientDeps.commitFormSettings();
        await refreshSelectedLocalSttModelAvailability({ quiet: true });
        model = fallbackModel;
      }
    }

    const showLoadOverlay = options.showLoadOverlay === true && Boolean(model);
    if (showLoadOverlay) {
      showLocalSttLoadOverlay(model);
      setLocalSttNotice(`Loading local STT model "${model}"...`);
      clientDeps.notify(`Loading local STT model "${model}"...`);
    }

    try {
      await refreshLocalSttRuntimeState({ quiet: true });
      if (isSelectedLocalSttModelLoaded()) {
        return;
      }

      await warmupActiveLocalSttModel({ quiet: true, force: true, explicit: true });
      await refreshLocalSttRuntimeState({ quiet: true });
      if (isSelectedLocalSttModelLoaded()) {
        return;
      }

      const selectedModel =
        clientDeps.readSettings().localSttModel.trim() || clientElements.modelCatalogSelect.value.trim();
      if (!selectedModel) {
        clientDeps.notify(
          "Local STT runtime is active but no local STT model is selected. Open Settings > Models and select a model, then click Load STT.",
          true,
        );
      } else if (!(await clientDeps.checkModelFileExists(selectedModel))) {
        clientDeps.notify(
          `Local STT model "${selectedModel}" is not downloaded yet. Open Settings > Models and download it first.`,
          true,
        );
      } else {
        clientDeps.notify(
          `Local STT runtime is active but local STT model "${selectedModel}" could not be loaded. Open Settings > Models and click Load STT.`,
          true,
        );
      }
      clientDeps.setActiveSettingsPane("models");
      return;
    } finally {
      if (showLoadOverlay) {
        hideLocalSttLoadOverlay();
      }
    }
  }

  await refreshLocalSttRuntimeState({ quiet: true });
  if (!localSttRuntimeLoaded) {
    return;
  }

  const modelToUnload =
    clientDeps.readSettings().localSttModel.trim() ||
    clientElements.modelCatalogSelect.value.trim() ||
    lastWarmedLocalSttModel.trim();
  try {
    const response = await ipcDeactivateLocalSttModel(
      { model: modelToUnload || null },
      "Local STT unload timed out. You can keep using Online mode and retry unloading later.",
    );
    setLocalSttNotice(response.details, response.deactivated ? "normal" : "error");
    if (response.deactivated) {
      setLastWarmedLocalSttModel("");
    }
  } catch (error) {
    clientDeps.notify(`Unable to unload local STT runtime: ${asErrorMessage(error)}`, true);
  } finally {
    await refreshLocalSttRuntimeState({ quiet: true });
  }
}

const ICON_DOWNLOAD = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
const ICON_POWER = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>`;
const ICON_PLAY = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;

export function renderSidebarLocalSttToggle(): void {
  const activeSettings = clientDeps.readSettings();
  const isLocalMode = activeSettings.sttRuntimeMode === "local";

  // Hide the button completely when STT mode is Online or when initial status is not yet checked
  if (!isLocalMode || !localSttStatusChecked) {
    clientElements.sidebarToggleBtn.hidden = true;
    return;
  }

  // Only show button in Local mode after status check
  clientElements.sidebarToggleBtn.hidden = false;
  clientElements.sidebarToggleBtn.dataset.sttState = "ready";

  const loaded = isSelectedLocalSttModelLoaded();
  const hasModel = !!activeSettings.localSttModel.trim();

  if (!hasModel || !localSttSelectedModelDownloaded) {
    clientElements.sidebarToggleGlyph.innerHTML = ICON_DOWNLOAD;
    clientElements.sidebarToggleLabel.textContent = "Download Model";
    const actionText = "Download offline model first";
    clientElements.sidebarToggleBtn.setAttribute("data-label", actionText);
    clientElements.sidebarToggleBtn.setAttribute("aria-label", `${actionText} (Alt+D)`);
    clientElements.sidebarToggleBtn.title = hasModel
      ? `Model files missing for ${activeSettings.localSttModel}. Click to download.`
      : "No offline model selected yet. Click to choose and download one.";
    clientElements.sidebarToggleBtn.dataset.sttState = "download";
  } else if (loaded) {
    // Model is loaded
    clientElements.sidebarToggleGlyph.innerHTML = ICON_POWER;
    clientElements.sidebarToggleLabel.textContent = "Unload STT";
    const actionText = "Unload local STT model";
    clientElements.sidebarToggleBtn.setAttribute("data-label", actionText);
    clientElements.sidebarToggleBtn.setAttribute("aria-label", `${actionText} (Alt+D)`);
    clientElements.sidebarToggleBtn.title = `Local STT model loaded: ${activeSettings.localSttModel}`;
    clientElements.sidebarToggleBtn.dataset.sttState = "loaded";
  } else {
    // Model exists but not loaded yet
    clientElements.sidebarToggleGlyph.innerHTML = ICON_PLAY;
    clientElements.sidebarToggleLabel.textContent = "Load STT";
    const actionText = "Load local STT model";
    clientElements.sidebarToggleBtn.setAttribute("data-label", actionText);
    clientElements.sidebarToggleBtn.setAttribute("aria-label", `${actionText} (Alt+D)`);
    clientElements.sidebarToggleBtn.title = `Load model: ${activeSettings.localSttModel || 'Select from Settings'}`;
    clientElements.sidebarToggleBtn.dataset.sttState = "ready";
  }
}

export function setLocalSttNotice(
  message: string,
  tone: "normal" | "error" | "success" = "normal",
): void {
  clientElements.downloadNotice.textContent = message;
  clientElements.downloadNotice.dataset.tone = tone;
}

export function renderLocalSttSettingsStatus(): void {
  const activeSettings = clientDeps.readSettings();
  const selectedModel = activeSettings.localSttModel.trim() || clientElements.modelCatalogSelect.value.trim();

  if (activeSettings.sttRuntimeMode !== "local") {
    clientElements.statusBadge.dataset.state = "offline";
    clientElements.statusBadge.textContent = "Online mode";
    clientElements.statusDetail.textContent = "Offline STT is disabled because STT runtime mode is currently set to Online.";
    return;
  }

  if (localSttDownloadInFlight || localSttDeleteInFlight || localSttDeactivateInFlight || localSttWarmupInFlight || localSttRuntimeStateInFlight || localSttDownloadActive) {
    clientElements.statusBadge.dataset.state = "busy";
    if (localSttDeleteInFlight) {
      clientElements.statusBadge.textContent = "Deleting";
      clientElements.statusDetail.textContent = selectedModel
        ? `Removing local files for ${localSttModelLabel(selectedModel)}.`
        : "Removing local STT model files.";
      return;
    }
    if (localSttDeactivateInFlight) {
      clientElements.statusBadge.textContent = "Unloading";
      clientElements.statusDetail.textContent = selectedModel
        ? `Unloading ${localSttModelLabel(selectedModel)} from memory.`
        : "Unloading offline STT runtime from memory.";
      return;
    }
    if (localSttWarmupInFlight || localSttRuntimeStateInFlight) {
      clientElements.statusBadge.textContent = "Loading";
      clientElements.statusDetail.textContent = selectedModel
        ? `Preparing ${localSttModelLabel(selectedModel)} for offline transcription.`
        : "Preparing offline STT runtime.";
      return;
    }
    clientElements.statusBadge.textContent = "Downloading";
    clientElements.statusDetail.textContent = selectedModel
      ? `Downloading ${localSttModelLabel(selectedModel)} to local storage.`
      : "Downloading offline STT model files.";
    return;
  }

  if (!selectedModel) {
    clientElements.statusBadge.dataset.state = "idle";
    clientElements.statusBadge.textContent = "Not selected";
    clientElements.statusDetail.textContent = "Select a local STT model to download and use it offline.";
    return;
  }

  if (!localSttSelectedModelDownloaded) {
    clientElements.statusBadge.dataset.state = "missing";
    clientElements.statusBadge.textContent = "Not downloaded";
    clientElements.statusDetail.textContent = `${localSttModelLabel(selectedModel)} is selected, but its local files are missing.`;
    return;
  }

  if (isSelectedLocalSttModelLoaded()) {
    clientElements.statusBadge.dataset.state = "active";
    clientElements.statusBadge.textContent = "Loaded";
    clientElements.statusDetail.textContent = `${localSttModelLabel(selectedModel)} is downloaded and currently loaded in memory.`;
    return;
  }

  clientElements.statusBadge.dataset.state = "ready";
  clientElements.statusBadge.textContent = "Downloaded";
  clientElements.statusDetail.textContent = `${localSttModelLabel(selectedModel)} is downloaded locally and ready to load.`;
}

export function resolveLocalSttHardwareAdvisorChoice(choice: LocalSttHardwareAdvisorChoice): void {
  if (localSttHardwareAdvisorResolver) {
    const resolver = localSttHardwareAdvisorResolver;
    setLocalSttHardwareAdvisorResolver(null);
    setLocalSttHardwareAdvisorOpen(false);
    clientElements.hardwareAdvisorOverlay.hidden = true;
    clientDeps.syncAvailability();
    resolver(choice);
    return;
  }
  setLocalSttHardwareAdvisorOpen(false);
  clientElements.hardwareAdvisorOverlay.hidden = true;
  clientDeps.syncAvailability();
}

export async function suggestLocalSttModelForHardwareIfNeeded(selectedModel: string): Promise<string | null> {
  if (hasShownLocalSttHardwareAdvisor()) {
    return selectedModel;
  }

  let advice: LocalSttHardwareAdviceResponse;
  try {
    advice = await ipcGetLocalSttHardwareAdvice({ selectedModel });
  } catch (error) {
    markLocalSttHardwareAdvisorShown();
    clientDeps.notify(
      `Hardware recommendation check failed. Continuing with selected model: ${asErrorMessage(error)}`,
      true,
    );
    return selectedModel;
  }

  const suggestionModel = advice.slasshySuggestionModel?.trim() || selectedModel;
  markLocalSttHardwareAdvisorShown();

  if (suggestionModel && suggestionModel !== selectedModel) {
    clientDeps.notify(
      `Using recommended local STT model for your hardware: ${localSttModelLabel(suggestionModel)}.`,
    );
    return suggestionModel;
  }

  return selectedModel;
}

export function updateLocalSttLoadOverlayDetail(): void {
  if (clientElements.loadOverlay.hidden) {
    return;
  }
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - localSttLoadOverlayStartedAt) / 1000));
  let phase = "Starting local STT runtime...";
  if (elapsedSeconds >= 8 && elapsedSeconds < 24) {
    phase = "Loading model into memory...";
  } else if (elapsedSeconds >= 24) {
    phase = "Still loading. Larger models and slower hardware take longer.";
  }
  clientElements.loadDetail.textContent = `${phase} (${elapsedSeconds}s elapsed). Time depends on your CPU/GPU, RAM, and selected model size.`;
}

export function showLocalSttLoadOverlay(model: string): void {
  setLocalSttLoadOverlayStartedAt(Date.now());
  clientElements.loadModel.textContent = `Model: ${model}`;
  clientElements.loadOverlay.hidden = false;
  updateLocalSttLoadOverlayDetail();
  if (localSttLoadOverlayTickerId !== null) {
    window.clearInterval(localSttLoadOverlayTickerId);
  }
  setLocalSttLoadOverlayTickerId(window.setInterval(() => {
    updateLocalSttLoadOverlayDetail();
  }, 350));
}

export function hideLocalSttLoadOverlay(): void {
  if (localSttLoadOverlayTickerId !== null) {
    window.clearInterval(localSttLoadOverlayTickerId);
  }
  setLocalSttLoadOverlayTickerId(null);
  clientElements.loadOverlay.hidden = true;
}

export function ensureLocalSttDownloadOverlay(): HTMLDivElement {
  if (localSttDownloadOverlay) {
    return localSttDownloadOverlay;
  }

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;right:20px;bottom:20px;z-index:10001;width:min(360px,calc(100vw - 32px));" +
    "padding:14px 16px;border-radius:14px;background:rgba(8, 10, 15, 0.95);color:#fff;" +
    "box-shadow:0 20px 50px rgba(0, 0, 0, 0.5);border:1px solid rgba(255, 255, 255, 0.1);backdrop-filter:blur(12px);" +
    "transition: opacity 0.2s ease, transform 0.2s ease;";
  overlay.hidden = true;
  document.body.appendChild(overlay);
  setLocalSttDownloadOverlay(overlay);
  return overlay;
}

export function showLocalSttDownloadOverlay(status: LocalSttDownloadStatusResponse): void {
  const overlay = ensureLocalSttDownloadOverlay();
  const modelLabel = localSttModelLabel(status.model || getSelectedLocalSttModel());
  const boundedPercent = Math.max(0, Math.min(100, Number(status.progressPercent) || 0));
  const stage = status.stage?.trim() || "Downloading local STT model...";
  const detail = status.currentFile?.trim() || status.message?.trim() || "Preparing files...";

  overlay.style.background = "rgba(0, 0, 0, 0.95)";
  overlay.style.border = "1px solid var(--border-subtle)";
  overlay.style.boxShadow = "var(--shadow-modal)";

  overlay.innerHTML = `
    <div style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px;">Offline STT Download</div>
    <div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">${escapeHtml(modelLabel)}</div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;line-height:1.4;">${escapeHtml(stage)}</div>
    <div style="height:6px;border-radius:999px;background:rgba(255, 255, 255, 0.08);overflow:hidden;margin-bottom:10px;">
      <div style="position:absolute;left:0;top:0;height:100%;width:100%;background:var(--text-secondary);transform:scaleX(${boundedPercent/100});transform-origin:left center;transition:transform 0.3s ease-out;"></div>
    </div>
    <div style="font-size:12px;color:var(--text-muted);line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(detail)}</div>
  `;

  syncLocalSttDownloadOverlayVisibility();
}

export function hideLocalSttDownloadOverlay(): void {
  if (localSttDownloadOverlay) {
    localSttDownloadOverlay.hidden = true;
  }
}

export async function refreshLocalSttRuntimeState(options: { quiet?: boolean } = {}): Promise<void> {
  if (localSttRuntimeStateInFlight) {
    return;
  }
  setLocalSttRuntimeStateInFlight(true);
  clientDeps.syncAvailability();
  try {
    const response = await ipcGetLocalSttRuntimeState("Timed out while checking local STT status.");
    setLocalSttRuntimeLoaded(response.loaded);
    if (!response.loaded) {
      setLastWarmedLocalSttModel("");
    }
    renderSidebarLocalSttToggle();
    renderLocalSttSettingsStatus();
  } catch (error) {
    if (!options.quiet) {
      clientDeps.notify(`Unable to check local STT runtime state: ${asErrorMessage(error)}`, true);
    }
  } finally {
    setLocalSttRuntimeStateInFlight(false);
    clientDeps.syncAvailability();
  }
}

export async function activateSelectedLocalSttModel(): Promise<void> {
  if (reportBlockedLocalSttAction("Load STT")) {
    return;
  }

  const readSettings = clientDeps.readSettings();

  // DIAGNOSTIC #1: Check if STT mode is set to local
  if (readSettings.sttRuntimeMode !== "local") {
    clientDeps.showOfflineModeDiagnostic('wrong-stt-mode', {
      model: readSettings.localSttModel || undefined
    });
    return;
  }

  // Get selected model
  let model = readSettings.localSttModel.trim() || clientElements.modelCatalogSelect.value.trim();
  if (!model) {
    model = await ensureSelectedLocalSttModel({ quiet: true });
  }

  // DIAGNOSTIC #2: Check if a model is selected
  if (!model) {
    clientDeps.showOfflineModeDiagnostic('no-model-downloaded');
    return;
  }

  clientElements.modelInput.value = model;
  if (clientDeps.getCatalog().includes(model)) {
    clientElements.modelCatalogSelect.value = model;
  }
  clientDeps.commitFormSettings();
  setLocalSttNotice("Loading model...");
  clientDeps.notify("Loading model...");
  showLocalSttLoadOverlay(model);
  clientDeps.syncAvailability();

  try {
    // DIAGNOSTIC #3: Check if model file exists before attempting to load
    const modelExists = await clientDeps.checkModelFileExists(model);
    if (!modelExists) {
      hideLocalSttLoadOverlay();
      setLocalSttNotice(`Model files missing for ${localSttModelLabel(model)}.`, "error");
      clientDeps.showOfflineModeDiagnostic('model-file-missing', { model });
      return;
    }

    // DIAGNOSTIC #4: Check Python dependencies
    const pythonReady = await clientDeps.checkPythonDependencies(model);
    if (!pythonReady) {
      hideLocalSttLoadOverlay();
      clientDeps.showOfflineModeDiagnostic('python-deps-missing', { model });
      return;
    }

    // DIAGNOSTIC #5: Check available memory
    const memoryOk = await clientDeps.checkAvailableMemory(model);
    if (!memoryOk.sufficient) {
      hideLocalSttLoadOverlay();
      clientDeps.showOfflineModeDiagnostic('insufficient-memory', {
        model,
        availableMemory: memoryOk.availableMB
      });
      return;
    }

    // All checks passed, attempt to warmup
    const warmup = await warmupActiveLocalSttModel({ quiet: true, force: true, explicit: true });
    await refreshLocalSttRuntimeState({ quiet: true });
    const selectedModelLoaded = isSelectedLocalSttModelLoaded();
    if (selectedModelLoaded) {
      setLocalSttNotice("Model loaded.", "success");
      clientDeps.notify("Model loaded.");
    } else {
      setLocalSttNotice("Unable to load model.", "error");
      const warmupDetails = warmup?.details || "";
      const normalizedDetails = warmupDetails.toLowerCase();
      if (normalizedDetails.includes("not downloaded yet")) {
        clientDeps.showOfflineModeDiagnostic('model-file-missing', { model });
      } else if (
        normalizedDetails.includes("python") ||
        normalizedDetails.includes("nemo") ||
        normalizedDetails.includes("module") ||
        normalizedDetails.includes("zero-python")
      ) {
        clientDeps.showOfflineModeDiagnostic('python-deps-missing', { model });
      } else if (normalizedDetails.includes("timed out") || normalizedDetails.includes("timeout")) {
        clientDeps.showOfflineModeDiagnostic('load-timeout', { model });
      } else {
        clientDeps.showOfflineModeDiagnostic(warmupDetails || 'load-timeout', { model });
      }
    }
  } catch (error) {
    const message = asErrorMessage(error);
    setLocalSttNotice(`Load failed: ${message}`, "error");
    clientDeps.showOfflineModeDiagnostic(message, { model });
  } finally {
    hideLocalSttLoadOverlay();
    clientDeps.syncAvailability();
  }
}

export async function warmupActiveLocalSttModel(
  options: { quiet?: boolean; force?: boolean; explicit?: boolean } = {},
): Promise<LocalSttWarmupResponse | null> {
  if (localSttWarmupInFlight) {
    return null;
  }

  const readSettings = clientDeps.readSettings();
  const explicit = options.explicit === true;
  if (!explicit && readSettings.sttRuntimeMode !== "local") {
    return null;
  }

  let model = readSettings.localSttModel.trim() || clientElements.modelCatalogSelect.value.trim();
  if (!model) {
    model = await clientDeps.ensureSelectedLocalSttModelForWarmup();
  }
  if (!model) {
    return null;
  }

  const force = options.force === true;
  if (!force && localSttRuntimeLoaded && lastWarmedLocalSttModel === model) {
    return null;
  }

  setLocalSttWarmupInFlight(true);
  clientDeps.syncAvailability();
  const quiet = options.quiet === true;
  try {
    const response = await ipcWarmupLocalSttModel(
      { model },
      undefined,
      `Local STT model "${model}" took too long to load. Switch back to Online mode or retry after checking the model files.`,
    );
    if (response.warmed) {
      setLastWarmedLocalSttModel(response.model);
      setLocalSttRuntimeLoaded(true);
      setLocalSttSelectedModelDownloaded(true);
      renderSidebarLocalSttToggle();
      if (!quiet) {
        clientDeps.notify(response.details || `Local STT model warmed: ${response.model}.`);
      }
    } else if (!quiet) {
      clientDeps.notify(response.details || `Local STT model warmup skipped: ${response.model}.`, true);
    }
    return response;
  } catch (error) {
    if (!quiet) {
      clientDeps.notify(`Local STT warmup failed: ${asErrorMessage(error)}`, true);
    }
    throw error;
  } finally {
    setLocalSttWarmupInFlight(false);
    void refreshLocalSttRuntimeState({ quiet: true });
    void refreshSelectedLocalSttModelAvailability({ quiet: true });
    clientDeps.syncAvailability();
  }
}

export async function deactivateLocalSttModel(): Promise<void> {
  if (reportBlockedLocalSttAction("Unload STT")) {
    return;
  }

  const activeSettings = clientDeps.readSettings();
  const model =
    activeSettings.localSttModel.trim() ||
    clientElements.modelCatalogSelect.value.trim() ||
    lastWarmedLocalSttModel.trim();

  setLocalSttDeactivateInFlight(true);
  clientDeps.syncAvailability();
  try {
    const response = await ipcDeactivateLocalSttModel(
      { model: model || null },
      "Local STT unload timed out. You can keep using Online mode and retry unloading later.",
    );
    if (response.deactivated) {
      setLastWarmedLocalSttModel("");
      setLocalSttRuntimeLoaded(false);
      renderSidebarLocalSttToggle();
      setLocalSttNotice(response.details, "success");
      clientDeps.notify(response.details);
    } else {
      setLocalSttNotice(response.details, "error");
      clientDeps.notify(response.details, true);
    }
  } catch (error) {
    const message = asErrorMessage(error);
    clientDeps.notify(`Unable to deactivate local STT model: ${message}`, true);
  } finally {
    setLocalSttDeactivateInFlight(false);
    void refreshLocalSttRuntimeState({ quiet: true });
    void refreshSelectedLocalSttModelAvailability({ quiet: true });
    clientDeps.syncAvailability();
  }
}

export function applyLocalSttDownloadStatus(status: LocalSttDownloadStatusResponse): void {
  lastLocalSttDownloadStatus = status;
  const rawPercent = Number.isFinite(status.progressPercent) ? status.progressPercent : 0;
  const boundedPercent = Math.max(
    0,
    Math.min(100, status.completed && status.success ? 100 : rawPercent),
  );
  setLocalSttDownloadActive(status.active);
  clientElements.downloadProgressBar.style.setProperty("--p", String(boundedPercent / 100));
  const progressTrack = clientElements.downloadProgressBar.parentElement;
  progressTrack?.setAttribute("aria-valuenow", boundedPercent.toFixed(1));

  const filesSegment =
    status.filesTotal > 0 ? `${status.filesCompleted}/${status.filesTotal} files` : "Preparing";
  const bytesSegment =
    status.totalBytes > 0
      ? `${formatBytes(status.downloadedBytes)} / ${formatBytes(status.totalBytes)}`
      : `${formatBytes(status.downloadedBytes)}`;

  if (status.active) {
    clientElements.downloadProgressText.textContent =
      `${status.stage || "Downloading..."} ${boundedPercent.toFixed(1)}% • ${filesSegment} • ${bytesSegment}`;
    showLocalSttDownloadOverlay(status);
    renderLocalSttSettingsStatus();
    return;
  }

  if (status.completed) {
    clientElements.downloadProgressText.textContent = status.success
      ? "Model loaded."
      : status.message || status.stage || "Download finished.";
    hideLocalSttDownloadOverlay();
    renderLocalSttSettingsStatus();
    return;
  }

  clientElements.downloadProgressText.textContent =
    status.message || "No local STT download in progress.";
  hideLocalSttDownloadOverlay();
  renderLocalSttSettingsStatus();
}

export function stopLocalSttDownloadStatusPolling(): void {
  const pollingId = localSttDownloadStatusPollingId;
  if (pollingId !== null) {
    window.clearInterval(pollingId);
    setLocalSttDownloadStatusPollingId(null);
  }
}

export function startLocalSttDownloadStatusPolling(): void {
  if (localSttDownloadStatusPollingId !== null) {
    return;
  }
  setLocalSttDownloadStatusPollingId(window.setInterval(() => {
    void pollLocalSttDownloadStatusOnce({ quiet: true });
  }, 240));
}

export async function pollLocalSttDownloadStatusOnce(options: { quiet?: boolean } = {}): Promise<void> {
  if (localSttDownloadStatusPollInFlight) {
    return;
  }
  setLocalSttDownloadStatusPollInFlight(true);
  const wasActive = localSttDownloadActive;

  try {
    const status = await ipcGetLocalSttDownloadStatus();
    applyLocalSttDownloadStatus(status);
    if (status.active) {
      startLocalSttDownloadStatusPolling();
    } else {
      stopLocalSttDownloadStatusPolling();
    }

    const justFinished = status.completed && !status.active && (wasActive || localSttDownloadInFlight);
    if (justFinished) {
      const completionMessage =
        status.success ? "Model loaded." : status.message || "Local STT model download failed.";
      setLocalSttNotice(completionMessage, status.success ? "success" : "error");
      if (status.success) {
        if (status.model.trim()) {
          setLastWarmedLocalSttModel(status.model.trim());
        }
        setLocalSttSelectedModelDownloaded(true);
        clientDeps.notify(completionMessage);
        await fetchLocalSttModels({ quiet: true });
        await refreshSelectedLocalSttModelAvailability({ quiet: true });
      } else {
        setLocalSttSelectedModelDownloaded(false);
        clientDeps.notify(completionMessage, true);
      }
    }
  } catch (error) {
    stopLocalSttDownloadStatusPolling();
    if (!options.quiet) {
      clientDeps.notify(`Unable to poll local STT download status: ${asErrorMessage(error)}`, true);
    }
  } finally {
    setLocalSttDownloadStatusPollInFlight(false);
    clientDeps.syncAvailability();
  }
}

export async function downloadLocalSttModel(): Promise<void> {
  if (reportBlockedLocalSttAction("Download STT model")) {
    return;
  }
  let model = await ensureSelectedLocalSttModel({ quiet: true });
  if (!model) {
    clientDeps.showOfflineModeDiagnostic('no-model-downloaded');
    return;
  }

  const advisedModel = await suggestLocalSttModelForHardwareIfNeeded(model);
  if (!advisedModel) {
    return;
  }
  model = advisedModel.trim();
  if (!model) {
    clientDeps.notify("Select a local STT model from catalog first.", true);
    return;
  }
  if (clientElements.modelInput.value.trim() !== model) {
    clientElements.modelInput.value = model;
  }
  if (clientDeps.getCatalog().includes(model)) {
    clientElements.modelCatalogSelect.value = model;
  }
  clientDeps.commitFormSettings();

  setLocalSttDownloadInFlight(true);
  clientDeps.syncAvailability();

  try {
    const response = await ipcDownloadLocalSttModel({ model });
    clientElements.modelInput.value = response.model;
    clientDeps.commitFormSettings();
    setLocalSttSelectedModelDownloaded(false);
    setLocalSttNotice("Downloading model...");
    if (!clientDeps.isSettingsOpen()) {
      clientDeps.notify("Downloading offline model...");
    }
    showLocalSttDownloadOverlay({
      active: true,
      completed: false,
      success: false,
      model: response.model,
      repoId: "",
      stage: "Starting local STT download...",
      message: response.details || "Preparing download...",
      currentFile: "",
      downloadedBytes: 0,
      totalBytes: 0,
      filesCompleted: 0,
      filesTotal: 0,
      progressPercent: 0,
      updatedAtMs: Date.now(),
    });
    startLocalSttDownloadStatusPolling();
    await pollLocalSttDownloadStatusOnce({ quiet: true });
  } catch (error) {
    const message = asErrorMessage(error);
    clientDeps.notify(`Unable to download local STT model: ${message}`, true);
    setLocalSttNotice(`Download failed: ${message}`, "error");
    hideLocalSttDownloadOverlay();
  } finally {
    setLocalSttDownloadInFlight(false);
    clientDeps.syncAvailability();
  }
}

export async function deleteLocalSttModel(): Promise<void> {
  if (reportBlockedLocalSttAction("Delete STT model")) {
    return;
  }

  const model = await ensureSelectedLocalSttModel({ quiet: true });
  if (!model) {
    clientDeps.showOfflineModeDiagnostic('no-model-downloaded');
    return;
  }

  setLocalSttDeleteInFlight(true);
  clientDeps.syncAvailability();

  try {
    const response = await ipcDeleteLocalSttModel({ model });
    setLocalSttNotice(response.details, response.removed ? "success" : "error");
    if (response.removed) {
      setLastWarmedLocalSttModel("");
      setLocalSttRuntimeLoaded(false);
      renderSidebarLocalSttToggle();
      if (clientElements.modelInput.value.trim() === model) {
        clientElements.modelInput.value = "";
        clientElements.modelCatalogSelect.value = "";
        clientDeps.commitFormSettings();
      }
      setLocalSttSelectedModelDownloaded(false);
      clientDeps.notify(`Deleted local STT model "${response.model}".`);
      await refreshLocalSttRuntimeState({ quiet: true });
      await fetchLocalSttModels({ quiet: true, autoSelect: true });
      await refreshSelectedLocalSttModelAvailability({ quiet: true });
    } else {
      clientDeps.notify(response.details, true);
    }
  } catch (error) {
    const message = asErrorMessage(error);
    clientDeps.notify(`Unable to delete local STT model: ${message}`, true);
  } finally {
    setLocalSttDeleteInFlight(false);
    clientDeps.syncAvailability();
  }
}

export async function openLocalSttModelPath(): Promise<void> {
  if (reportBlockedLocalSttAction("Open STT model folder")) {
    return;
  }

  const model = await ensureSelectedLocalSttModel({ quiet: true });

  // DIAGNOSTIC: Check if a model is selected first
  if (!model) {
    clientDeps.showOfflineModeDiagnostic('no-model-downloaded');
    return;
  }

  try {
    const response = await ipcOpenLocalSttModelPath({ model });

    if (response.opened) {
      setLocalSttNotice(`Opened: ${response.localPath}`, "success");
      clientDeps.notify(`✅ Opened model folder successfully!`);
    } else {
      // Model path doesn't exist - offer to download
      setLocalSttNotice(response.details || "Model not found", "error");
      clientDeps.showOfflineModeDiagnostic('model-file-missing', {
        model,
        expectedPath: response.localPath
      });
    }
  } catch (error) {
    const message = asErrorMessage(error);
    setLocalSttNotice(`Failed to open: ${message}`, "error");

    // Check if it's a backend command not found error
    if (message.includes("command not found") || message.includes("not implemented")) {
      clientDeps.notify("⚠️ Open folder feature not available in this version. Please use Online mode for now.", true);
    } else {
      clientDeps.notify(`Unable to open model folder: ${message}`, true);
    }
  }
}

export async function handleSidebarToggleClick(): Promise<void> {
  const activeSettings = clientDeps.readSettings();
  if (activeSettings.sttRuntimeMode !== "local") {
    try {
      await syncLocalSttRuntimeForMode("online");
    } catch (error) {
      clientDeps.notify(`Unable to switch local STT runtime: ${asErrorMessage(error)}`, true);
      return;
    }
    const onlineSttModel = activeSettings.sttModelName.trim() || "the configured online STT model";
    clientDeps.notify(
      `STT runtime is Online. Using ${onlineSttModel}. Switch STT to Offline in Settings > Models to load a local STT model.`,
    );
    return;
  }

  const selectedModel = await ensureSelectedLocalSttModel({ quiet: true });
  if (!selectedModel) {
    clientDeps.showOfflineModeDiagnostic('no-model-downloaded');
    return;
  }

  const modelDownloaded = await refreshSelectedLocalSttModelAvailability({ quiet: true });
  if (!modelDownloaded) {
    await downloadLocalSttModel();
    return;
  }

  await refreshLocalSttRuntimeState({ quiet: true });
  if (isSelectedLocalSttModelLoaded()) {
    await deactivateLocalSttModel();
  } else {
    await activateSelectedLocalSttModel();
  }
  await refreshLocalSttRuntimeState({ quiet: true });
}

export async function fetchLocalSttModels(
  options: { quiet?: boolean; autoSelect?: boolean } = {},
): Promise<void> {
  if (clientDeps.isPipelineRunning() || clientDeps.getStage() === "recording") {
    return;
  }
  const activeSettings = clientDeps.readSettings();
  const quiet = options.quiet === true;
  const autoSelect = options.autoSelect === true;

  if (!quiet) {
    clientDeps.setStage("processing", "Loading local STT model catalog...");
  }
  try {
    const response = await ipcFetchLocalSttModels();
    clientDeps.renderFetchedCatalog(response.models, activeSettings.localSttModel);
    const refreshedSettings = clientDeps.readSettings();
    if (autoSelect && !refreshedSettings.localSttModel.trim() && response.models.length > 0) {
      const fallback = await applyCatalogFallbackToForm(clientDeps.getCatalog());
      if (fallback && !quiet) {
        clientDeps.notify(`Auto-selected local STT model "${localSttModelLabel(fallback)}".`);
      }
    } else if (!quiet) {
      clientDeps.notify(`Loaded ${response.models.length} local STT models.`);
    }
    await refreshSelectedLocalSttModelAvailability({ quiet: true });
    if (!quiet) {
      clientDeps.setStage("idle", "Local STT model list loaded.");
    }
  } catch (error) {
    if (!quiet) {
      clientDeps.notify(`Unable to load local STT model catalog: ${asErrorMessage(error)}`, true);
      clientDeps.setStage("idle", "Local STT model list unavailable.");
    }
  } finally {
    clientDeps.syncAvailability();
  }
}
