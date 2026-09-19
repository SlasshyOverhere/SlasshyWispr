/**
 * Canonical Ollama model-pick helpers — Phase 5f extraction from main.tsx.
 * Pure, no DOM, no invoke. Catalog passed explicitly.
 */

export const EMBEDDING_MARKERS = [
  "embed",
  "embedding",
  "nomic-embed",
  "bge-",
  "e5-",
  "minilm",
];

export function containsAnyFragment(text: string, fragments: readonly string[]): boolean {
  for (const fragment of fragments) {
    if (text.includes(fragment)) {
      return true;
    }
  }
  return false;
}

export function isEmbeddingOnlyNormalizedModel(normalizedModel: string): boolean {
  return normalizedModel.length > 0 && containsAnyFragment(normalizedModel, EMBEDDING_MARKERS);
}

export function looksLikeEmbeddingOnlyOllamaModel(model: string): boolean {
  return isEmbeddingOnlyNormalizedModel(model.trim().toLowerCase());
}

export const PREFERRED_CHAT_FAMILIES = [
  "llama",
  "qwen",
  "mistral",
  "gemma",
  "phi",
  "deepseek",
  "command-r",
];

export function pickDefaultLocalOllamaModelFromCatalog(catalog: readonly string[]): string {
  if (catalog.length === 0) {
    return "";
  }
  let firstNonEmbeddingModel = "";
  for (const model of catalog) {
    const normalized = model.trim().toLowerCase();
    if (isEmbeddingOnlyNormalizedModel(normalized)) {
      continue;
    }
    if (!firstNonEmbeddingModel) {
      firstNonEmbeddingModel = model;
    }
    if (containsAnyFragment(normalized, PREFERRED_CHAT_FAMILIES)) {
      return model;
    }
  }
  return firstNonEmbeddingModel || catalog[0] || "";
}
