/**
 * Ollama provider client — Phase 5 shell decomposition.
 *
 * Owns provider-model fetch, Ollama status/install/fetch/pull, model
 * selection, and the catalog-select apply buttons. Moved verbatim from
 * main.tsx; shell seams (settings read, stage guards, catalog renders,
 * notice/stage/log, availability, settings pane) arrive via
 * initOllamaClient so this module never touches main.tsx module globals.
 */
import {
  fetchOllamaModels as ipcFetchOllamaModels,
  fetchProviderModels as ipcFetchProviderModels,
  getOllamaStatus as ipcGetOllamaStatus,
  installOllama as ipcInstallOllama,
  pullOllamaModel as ipcPullOllamaModel,
} from "../ipc/client";
import type { OllamaStatusResponse, PersistedSettings } from "../types";
import { asErrorMessage } from "../utils";
import {
  looksLikeEmbeddingOnlyOllamaModel,
  pickDefaultLocalOllamaModelFromCatalog as pickDefaultLocalOllamaModelFromList,
} from "./ollama-pick";

export interface OllamaClientDeps {
  readSettings: () => PersistedSettings;
  commitSettings: () => void;
  isBusy: () => boolean;
  isInstallBusy: () => boolean;
  isPullBusy: () => boolean;
  setStatusBusy: (busy: boolean) => void;
  setInstallBusy: (busy: boolean) => void;
  setPullBusy: (busy: boolean) => void;
  getCatalog: () => string[];
  setCatalogInput: (value: string) => void;
  getCatalogInput: () => string;
  getCatalogSelection: () => string;
  setCatalogSelection: (value: string) => void;
  renderProviderCatalog: (models: string[], selected: string) => void;
  renderOllamaCatalog: (models: string[], selected: string) => void;
  renderStatus: (status: OllamaStatusResponse) => void;
  setNotice: (message: string, isError?: boolean) => void;
  setStage: (stage: "idle" | "processing" | "speaking" | "error", detail: string) => void;
  syncAvailability: () => void;
  openModelsPane: () => void;
}

export interface OllamaClientElements {
  statusNotice: HTMLParagraphElement;
  providerCatalogSelect: HTMLSelectElement;
  localOllamaCatalogSelect: HTMLSelectElement;
  fetchProviderModelsBtn: HTMLButtonElement;
  checkOllamaStatusBtn: HTMLButtonElement;
  installOllamaBtn: HTMLButtonElement;
  fetchOllamaModelsBtn: HTMLButtonElement;
  useOllamaModelBtn: HTMLButtonElement;
  pullOllamaModelBtn: HTMLButtonElement;
  applyModelToAiBtn: HTMLButtonElement;
  applyModelToSttBtn: HTMLButtonElement;
}

let ollamaElements!: OllamaClientElements;
let ollamaDeps!: OllamaClientDeps;

export function initOllamaClient(elements: OllamaClientElements, deps: OllamaClientDeps): void {
  ollamaElements = elements;
  ollamaDeps = deps;

  elements.fetchProviderModelsBtn.addEventListener("click", () => {
    void fetchProviderModels();
  });
  elements.checkOllamaStatusBtn.addEventListener("click", () => {
    void refreshOllamaStatus();
  });
  elements.installOllamaBtn.addEventListener("click", () => {
    void installOllama();
  });
  elements.fetchOllamaModelsBtn.addEventListener("click", () => {
    void fetchOllamaModels();
  });
  elements.useOllamaModelBtn.addEventListener("click", () => {
    const selected = elements.localOllamaCatalogSelect.value.trim();
    if (!selected) {
      deps.setNotice("Select an Ollama model from catalog first.", true);
      return;
    }
    deps.setCatalogInput(selected);
    deps.commitSettings();
  });
  elements.pullOllamaModelBtn.addEventListener("click", () => {
    void pullOllamaModel();
  });
  elements.applyModelToAiBtn.addEventListener("click", () => {
    const selected = elements.providerCatalogSelect.value.trim();
    if (!selected) {
      deps.setNotice("Select a model from catalog first.", true);
      return;
    }
    deps.setCatalogInput(selected);
    deps.commitSettings();
  });
  elements.applyModelToSttBtn.addEventListener("click", () => {
    const selected = elements.providerCatalogSelect.value.trim();
    if (!selected) {
      deps.setNotice("Select a model from catalog first.", true);
      return;
    }
    deps.setCatalogInput(selected);
    deps.commitSettings();
  });
  elements.providerCatalogSelect.addEventListener("change", () => {
    const selected = elements.providerCatalogSelect.value.trim();
    if (!selected) {
      return;
    }
    deps.setCatalogInput(selected);
    deps.commitSettings();
  });
  elements.localOllamaCatalogSelect.addEventListener("change", () => {
    const selected = elements.localOllamaCatalogSelect.value.trim();
    if (!selected) {
      return;
    }
    deps.setCatalogInput(selected);
    deps.commitSettings();
  });
}

export async function fetchProviderModels(): Promise<void> {
  if (ollamaDeps.isBusy()) {
    return;
  }
  const activeSettings = ollamaDeps.readSettings();
  const anyOnlineRuntime =
    activeSettings.sttRuntimeMode === "online" || activeSettings.aiRuntimeMode === "online";
  if (!anyOnlineRuntime) {
    ollamaDeps.setNotice("Enable online STT or online AI mode to fetch provider models.", true);
    return;
  }
  if (!activeSettings.apiKey) {
    ollamaDeps.setNotice("API key is required to fetch model catalog.", true);
    ollamaDeps.openModelsPane();
    return;
  }

  ollamaDeps.setStage("processing", "Loading provider model catalog...");
  try {
    const response = await ipcFetchProviderModels({
      apiKey: activeSettings.apiKey,
      apiBaseUrl: activeSettings.apiBaseUrl || null,
    });
    ollamaDeps.renderProviderCatalog(response.models, activeSettings.aiModelName || activeSettings.sttModelName);
    ollamaDeps.setStage("idle", "Provider model list loaded.");
  } catch (error) {
    ollamaDeps.setNotice(`Unable to load provider model catalog: ${asErrorMessage(error)}`, true);
    ollamaDeps.setStage("idle", "Provider model list unavailable.");
  } finally {
    ollamaDeps.syncAvailability();
  }
}

export function renderOllamaStatus(status: OllamaStatusResponse): void {
  const versionSuffix = status.version ? ` (${status.version})` : "";
  if (status.installed && status.running) {
    ollamaElements.statusNotice.textContent = `Ollama is ready${versionSuffix}. ${status.details || ""}`.trim();
    return;
  }
  if (status.installed) {
    ollamaElements.statusNotice.textContent =
      `Ollama is installed${versionSuffix} but the local service is not reachable. ` +
      (status.details || "Start Ollama to enable local AI models.");
    return;
  }
  ollamaElements.statusNotice.textContent = status.details || "Ollama is not installed.";
}

export async function refreshOllamaStatus(options: { quiet?: boolean } = {}): Promise<void> {
  if (ollamaDeps.isBusy()) {
    return;
  }

  const quiet = options.quiet === true;
  const activeSettings = ollamaDeps.readSettings();
  ollamaDeps.setStatusBusy(true);
  ollamaDeps.syncAvailability();
  if (!quiet) {
    ollamaDeps.setStage("processing", "Checking Ollama status...");
  }

  try {
    const status = await ipcGetOllamaStatus({
      baseUrl: activeSettings.localOllamaBaseUrl || null,
    });
    renderOllamaStatus(status);
    if (!quiet) {
      ollamaDeps.setStage("idle", "Ollama status checked.");
    }
  } catch (error) {
    const message = asErrorMessage(error);
    ollamaElements.statusNotice.textContent = `Unable to determine Ollama status: ${message}`;
    if (!quiet) {
      ollamaDeps.setNotice(`Unable to determine Ollama status: ${message}`, true);
      ollamaDeps.setStage("idle", "Ollama status unavailable.");
    }
  } finally {
    ollamaDeps.setStatusBusy(false);
    ollamaDeps.syncAvailability();
  }
}

export async function installOllama(): Promise<void> {
  if (ollamaDeps.isInstallBusy()) {
    return;
  }

  ollamaDeps.setInstallBusy(true);
  ollamaDeps.syncAvailability();
  ollamaDeps.setStage("processing", "Installing Ollama...");

  try {
    const status = await ipcInstallOllama();
    renderOllamaStatus(status);
    if (status.running) {
      ollamaDeps.setNotice("Ollama installation completed and service is reachable.");
      ollamaDeps.setStage("idle", "Ollama installed.");
      await fetchOllamaModels();
    } else if (status.installed) {
      ollamaDeps.setNotice(
        "Ollama installer finished. Start Ollama once to bring up the local service endpoint.",
      );
      ollamaDeps.setStage("idle", "Ollama install finished.");
    } else {
      ollamaDeps.setNotice(status.details || "Ollama install did not complete yet.", true);
      ollamaDeps.setStage("idle", "Ollama install needs attention.");
    }
  } catch (error) {
    ollamaDeps.setNotice(`Unable to install Ollama from app: ${asErrorMessage(error)}`, true);
    ollamaDeps.setStage("idle", "Ollama install failed.");
  } finally {
    ollamaDeps.setInstallBusy(false);
    ollamaDeps.syncAvailability();
  }
}

export async function fetchOllamaModels(
  options: { quiet?: boolean; autoSelect?: boolean } = {},
): Promise<void> {
  if (ollamaDeps.isBusy()) {
    return;
  }
  const quiet = options.quiet === true;
  const autoSelect = options.autoSelect === true;
  const activeSettings = ollamaDeps.readSettings();
  if (!quiet) {
    ollamaDeps.setStage("processing", "Loading Ollama model catalog...");
  }
  try {
    const response = await ipcFetchOllamaModels({
      baseUrl: activeSettings.localOllamaBaseUrl || null,
    });
    ollamaDeps.renderOllamaCatalog(response.models, activeSettings.localOllamaModel);
    if (
      autoSelect &&
      !activeSettings.localOllamaModel.trim() &&
      response.models.length > 0
    ) {
      const fallback = pickDefaultLocalOllamaModelFromList(ollamaDeps.getCatalog());
      if (fallback) {
        ollamaDeps.setCatalogInput(fallback);
        ollamaDeps.commitSettings();
      }
    }
    if (!quiet) {
      ollamaDeps.setStage("idle", "Ollama model list loaded.");
    }
  } catch (error) {
    if (!quiet) {
      ollamaDeps.setNotice(`Unable to load Ollama model catalog: ${asErrorMessage(error)}`, true);
      ollamaDeps.setStage("idle", "Ollama model list unavailable.");
    }
  } finally {
    ollamaDeps.syncAvailability();
  }
}

export async function ensureLocalOllamaModelSelected(options: { quiet?: boolean } = {}): Promise<string> {
  const quiet = options.quiet === true;
  const activeSettings = ollamaDeps.readSettings();
  let selected = activeSettings.localOllamaModel.trim() || ollamaDeps.getCatalogSelection().trim();
  if (selected && !looksLikeEmbeddingOnlyOllamaModel(selected)) {
    return selected;
  }

  await fetchOllamaModels({ quiet: true, autoSelect: true });
  const refreshed = ollamaDeps.readSettings();
  selected = refreshed.localOllamaModel.trim() || ollamaDeps.getCatalogSelection().trim();
  if (selected && looksLikeEmbeddingOnlyOllamaModel(selected)) {
    const fallback = pickDefaultLocalOllamaModelFromList(ollamaDeps.getCatalog());
    if (fallback && fallback !== selected) {
      ollamaDeps.setCatalogInput(fallback);
      ollamaDeps.commitSettings();
      selected = fallback;
    }
  }
  if (selected && looksLikeEmbeddingOnlyOllamaModel(selected) && !quiet) {
    ollamaDeps.setNotice(
      `Selected Ollama model "${selected}" appears embedding-only. Choose a chat model (for example llama, qwen, mistral, gemma).`,
      true,
    );
    ollamaDeps.openModelsPane();
  }
  if (!selected && !quiet) {
    ollamaDeps.setNotice(
      "No local Ollama model is selected. Open Settings > Models and pull/download a model.",
      true,
    );
    ollamaDeps.openModelsPane();
  }
  return selected;
}

export async function pullOllamaModel(): Promise<void> {
  if (ollamaDeps.isPullBusy()) {
    return;
  }
  const activeSettings = ollamaDeps.readSettings();
  const model = activeSettings.localOllamaModel.trim() || ollamaDeps.getCatalogSelection().trim();
  if (!model) {
    ollamaDeps.setNotice("Enter or select an Ollama model to pull/download.", true);
    ollamaDeps.openModelsPane();
    return;
  }

  ollamaDeps.setStage("processing", `Pulling Ollama model "${model}"...`);
  ollamaDeps.setPullBusy(true);
  ollamaDeps.syncAvailability();

  try {
    const response = await ipcPullOllamaModel({
      baseUrl: activeSettings.localOllamaBaseUrl || null,
      model,
    });
    ollamaDeps.setCatalogInput(response.model);
    ollamaDeps.commitSettings();
    ollamaDeps.setNotice(`Ollama pull complete: ${response.status || response.model}.`);
    await fetchOllamaModels();
  } catch (error) {
    ollamaDeps.setNotice(`Unable to pull Ollama model: ${asErrorMessage(error)}`, true);
    ollamaDeps.setStage("idle", "Ollama pull failed.");
  } finally {
    ollamaDeps.setPullBusy(false);
    ollamaDeps.syncAvailability();
  }
}
