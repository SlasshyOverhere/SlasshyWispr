/**
 * Local-STT shared state — Phase 5 shell decomposition.
 *
 * Owns the local-STT module state (catalog, in-flight flags, warmed-model
 * tracking, overlays, hardware-advisor session) plus the small pure
 * helpers (model label, selected-model loaded check, action block reason,
 * advisor storage flag). Moved verbatim from main.tsx; shell seams
 * (settings reads, stage/pipeline probes, DOM renders) arrive via
 * initLocalSttState so this module never touches main.tsx module globals.
 */
import { LOCAL_STT_HARDWARE_ADVISOR_STORAGE_KEY, LOCAL_STT_MODEL_SIZE_LABELS } from "../constants";
import type { LocalSttHardwareAdvisorChoice, RuntimeMode } from "../types";

export interface LocalSttStateDeps {
  readSettings: () => { sttRuntimeMode: RuntimeMode; localSttModel: string };
  getCatalogSelection: () => string;
  isPipelineRunning: () => boolean;
  getStage: () => string;
  renderSidebarToggle: () => void;
  renderSettingsStatus: () => void;
}

export interface LocalSttStateElements {
  downloadOverlayHost?: () => HTMLElement;
}

let stateDeps!: LocalSttStateDeps;

export let localSttDownloadInFlight = false;
export let localSttDeleteInFlight = false;
export let localSttDeactivateInFlight = false;
export let localSttDownloadActive = false;
export let localSttDownloadStatusPollingId: number | null = null;
export let localSttDownloadStatusPollInFlight = false;
export let localSttWarmupInFlight = false;
export let lastWarmedLocalSttModel = "";
export let localSttRuntimeLoaded = false;
export let localSttSelectedModelDownloaded = false;
export let localSttStatusChecked = false;
export let localSttRuntimeStateInFlight = false;
export let runtimeModeSyncInFlight = false;
export let pendingRuntimeModeSyncTarget: RuntimeMode | null = null;
export let pendingRuntimeModeSyncShowLoadOverlay = false;
export let localSttLoadOverlayTickerId: number | null = null;
export let localSttLoadOverlayStartedAt = 0;
export let localSttDownloadOverlay: HTMLDivElement | null = null;
export let localSttHardwareAdvisorOpen = false;
export let localSttHardwareAdvisorResolver: ((choice: LocalSttHardwareAdvisorChoice) => void) | null = null;

export function initLocalSttState(deps: LocalSttStateDeps): void {
  stateDeps = deps;
}

export function setLocalSttDownloadInFlight(next: boolean): void {
  localSttDownloadInFlight = next;
}
export function setLocalSttDeleteInFlight(next: boolean): void {
  localSttDeleteInFlight = next;
}
export function setLocalSttDeactivateInFlight(next: boolean): void {
  localSttDeactivateInFlight = next;
}
export function setLocalSttDownloadActive(next: boolean): void {
  localSttDownloadActive = next;
}
export function setLocalSttDownloadStatusPollingId(next: number | null): void {
  localSttDownloadStatusPollingId = next;
}
export function setLocalSttDownloadStatusPollInFlight(next: boolean): void {
  localSttDownloadStatusPollInFlight = next;
}
export function setLocalSttWarmupInFlight(next: boolean): void {
  localSttWarmupInFlight = next;
}
export function setLastWarmedLocalSttModel(next: string): void {
  lastWarmedLocalSttModel = next;
}
export function setLocalSttRuntimeLoaded(next: boolean): void {
  localSttRuntimeLoaded = next;
}
export function setLocalSttSelectedModelDownloaded(next: boolean): void {
  localSttSelectedModelDownloaded = next;
}
export function setLocalSttStatusChecked(next: boolean): void {
  localSttStatusChecked = next;
}
export function setLocalSttRuntimeStateInFlight(next: boolean): void {
  localSttRuntimeStateInFlight = next;
}
export function setRuntimeModeSyncInFlight(next: boolean): void {
  runtimeModeSyncInFlight = next;
}
export function setPendingRuntimeModeSyncTarget(next: RuntimeMode | null): void {
  pendingRuntimeModeSyncTarget = next;
}
export function setPendingRuntimeModeSyncShowLoadOverlay(next: boolean): void {
  pendingRuntimeModeSyncShowLoadOverlay = next;
}
export function setLocalSttLoadOverlayTickerId(next: number | null): void {
  localSttLoadOverlayTickerId = next;
}
export function setLocalSttLoadOverlayStartedAt(next: number): void {
  localSttLoadOverlayStartedAt = next;
}
export function setLocalSttDownloadOverlay(next: HTMLDivElement | null): void {
  localSttDownloadOverlay = next;
}
export function setLocalSttHardwareAdvisorOpen(next: boolean): void {
  localSttHardwareAdvisorOpen = next;
}
export function setLocalSttHardwareAdvisorResolver(
  next: ((choice: LocalSttHardwareAdvisorChoice) => void) | null,
): void {
  localSttHardwareAdvisorResolver = next;
}

export function getSelectedLocalSttModel(): string {
  const activeSettings = stateDeps.readSettings();
  return activeSettings.localSttModel.trim() || stateDeps.getCatalogSelection().trim();
}

export function isSelectedLocalSttModelLoaded(): boolean {
  const selectedModel = getSelectedLocalSttModel();
  if (!selectedModel || !localSttRuntimeLoaded) {
    return false;
  }
  return lastWarmedLocalSttModel.trim() === selectedModel;
}

export function localSttModelLabel(model: string): string {
  const normalized = model.trim();
  if (!normalized) {
    return "-";
  }
  return LOCAL_STT_MODEL_SIZE_LABELS[normalized] || normalized;
}

export function getLocalSttActionBlockReason(): string | null {
  if (stateDeps.isPipelineRunning()) {
    return "Finish the current pipeline run first.";
  }
  if (stateDeps.getStage() === "recording") {
    return "Stop recording before changing offline STT setup.";
  }
  if (localSttDownloadInFlight || localSttDownloadActive) {
    return "A local STT download is already running.";
  }
  if (localSttDeleteInFlight) {
    return "A local STT delete is already running.";
  }
  if (localSttDeactivateInFlight) {
    return "Local STT is currently unloading.";
  }
  if (localSttWarmupInFlight) {
    return "Local STT is currently loading.";
  }
  if (localSttRuntimeStateInFlight) {
    return "Local STT status is still refreshing.";
  }
  if (localSttHardwareAdvisorOpen) {
    return "Close the hardware advisor before continuing.";
  }
  return null;
}

export function isLocalSttBusy(): boolean {
  return (
    localSttDownloadInFlight ||
    localSttDeleteInFlight ||
    localSttDeactivateInFlight ||
    localSttWarmupInFlight ||
    localSttRuntimeStateInFlight ||
    localSttDownloadActive
  );
}

export function hasShownLocalSttHardwareAdvisor(): boolean {
  return localStorage.getItem(LOCAL_STT_HARDWARE_ADVISOR_STORAGE_KEY) === "1";
}

export function markLocalSttHardwareAdvisorShown(): void {
  localStorage.setItem(LOCAL_STT_HARDWARE_ADVISOR_STORAGE_KEY, "1");
}
