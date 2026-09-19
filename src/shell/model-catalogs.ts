/**
 * Model catalog renders — Phase 5 shell decomposition.
 *
 * Owns renderProviderModelCatalog + renderLocalOllamaModelCatalog +
 * renderLocalSttModelCatalog. Moved verbatim from main.tsx; selects,
 * catalog stores, and fallbacks arrive via initModelCatalogs so this
 * module never touches main.tsx module globals.
 */
import { LOCAL_STT_MODEL_SIZE_LABELS } from "../constants";
import { escapeHtml } from "../utils";

export interface ModelCatalogDeps {
  getAiModelInput: () => string;
  getSttModelInput: () => string;
  getAiModelName: () => string;
  getSttModelName: () => string;
  getLocalOllamaModelInput: () => string;
  getLocalOllamaModelName: () => string;
  getLocalSttModelInput: () => string;
  setProviderCatalog: (models: string[]) => void;
  setLocalOllamaCatalog: (models: string[]) => void;
  setLocalSttCatalog: (models: string[]) => void;
  setLocalSttModelInput: (value: string) => void;
}

export interface ModelCatalogElements {
  providerSelect: HTMLSelectElement;
  localOllamaSelect: HTMLSelectElement;
  localSttSelect: HTMLSelectElement;
}

let catalogElements!: ModelCatalogElements;
let catalogDeps!: ModelCatalogDeps;

export function initModelCatalogs(
  elements: ModelCatalogElements,
  deps: ModelCatalogDeps,
): void {
  catalogElements = elements;
  catalogDeps = deps;
}

export function renderProviderModelCatalog(models: string[], selectedModel = ""): void {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    const trimmed = model.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      next.push(trimmed);
    }
  }
  const normalized = next.sort();
  const fallbackModel =
    selectedModel.trim() ||
    catalogDeps.getAiModelInput().trim() ||
    catalogDeps.getSttModelInput().trim() ||
    catalogDeps.getAiModelName().trim() ||
    catalogDeps.getSttModelName().trim();
  const finalModels =
    normalized.length > 0
      ? normalized
      : fallbackModel
        ? [fallbackModel]
        : [];
  catalogDeps.setProviderCatalog(finalModels);

  if (finalModels.length === 0) {
    catalogElements.providerSelect.innerHTML = '<option value="">No models available</option>';
    return;
  }

  const selected = finalModels.includes(selectedModel)
    ? selectedModel
    : finalModels.includes(fallbackModel)
      ? fallbackModel
      : "";
  const options = ['<option value="">Select a model...</option>'];
  for (const model of finalModels) {
    const active = model === selected ? " selected" : "";
    options.push(`<option value="${escapeHtml(model)}"${active}>${escapeHtml(model)}</option>`);
  }
  catalogElements.providerSelect.innerHTML = options.join("");
  catalogElements.providerSelect.value = selected;
}

export function renderLocalOllamaModelCatalog(models: string[], selectedModel = ""): void {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    const trimmed = model.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      next.push(trimmed);
    }
  }
  const normalized = next.sort();
  const fallbackModel =
    selectedModel.trim() ||
    catalogDeps.getLocalOllamaModelInput().trim() ||
    catalogDeps.getLocalOllamaModelName().trim();
  const finalModels =
    normalized.length > 0
      ? normalized
      : fallbackModel
        ? [fallbackModel]
        : [];
  catalogDeps.setLocalOllamaCatalog(finalModels);

  if (finalModels.length === 0) {
    catalogElements.localOllamaSelect.innerHTML = '<option value="">No models available</option>';
    return;
  }

  const selected = finalModels.includes(selectedModel)
    ? selectedModel
    : finalModels.includes(fallbackModel)
      ? fallbackModel
      : "";
  const options = ['<option value="">Select a model...</option>'];
  for (const model of finalModels) {
    const active = model === selected ? " selected" : "";
    options.push(`<option value="${escapeHtml(model)}"${active}>${escapeHtml(model)}</option>`);
  }
  catalogElements.localOllamaSelect.innerHTML = options.join("");
  catalogElements.localOllamaSelect.value = selected;
}

/** Download-state-aware catalog label: `Parakeet v3 (478 MB)` + ` — downloaded` / ` — not downloaded`. */
export function formatLocalSttCatalogLabel(model: string, downloaded: boolean): string {
  const base = LOCAL_STT_MODEL_SIZE_LABELS[model] || model.trim() || "Unknown model";
  return downloaded ? `${base} — downloaded` : `${base} — not downloaded`;
}

export function renderLocalSttModelCatalog(models: string[], selectedModel = ""): void {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    const trimmed = model.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      next.push(trimmed);
    }
  }
  const normalized = next;
  catalogDeps.setLocalSttCatalog(normalized);

  if (normalized.length === 0) {
    catalogElements.localSttSelect.innerHTML = '<option value="">No models available</option>';
    return;
  }

  const selected = normalized.includes(selectedModel.trim()) ? selectedModel.trim() : "";
  const currentInputModel = catalogDeps.getLocalSttModelInput().trim();
  const selectedOrCurrent = selected || (normalized.includes(currentInputModel) ? currentInputModel : "");
  if (currentInputModel && !normalized.includes(currentInputModel)) {
    catalogDeps.setLocalSttModelInput("");
  }
  const options = ['<option value="">Select a model...</option>'];
  for (const model of normalized) {
    const active = model === selectedOrCurrent ? " selected" : "";
    const label = LOCAL_STT_MODEL_SIZE_LABELS[model] || model;
    options.push(`<option value="${escapeHtml(model)}"${active}>${escapeHtml(label)}</option>`);
  }
  catalogElements.localSttSelect.innerHTML = options.join("");
  catalogElements.localSttSelect.value = selectedOrCurrent;
}
