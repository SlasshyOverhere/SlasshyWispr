/**
 * Canonical STT provider inference — Phase 5d extraction from main.tsx.
 * Pure, no DOM, no invoke. preferredOrder kept with the inference it serves.
 */

/** English is the primary dictation language, so the multilingual 0.6B leads. */
export const PREFERRED_LOCAL_STT_MODELS = [
  "nvidia/parakeet-tdt-0.6b-v3",
  "nvidia/parakeet-tdt_ctc-110m",
];

export function inferLocalSttProviderFromModel(model: string): string {
  const normalized = model.trim().toLowerCase();
  if (normalized.startsWith("nvidia/") || normalized.includes("parakeet")) {
    return "parakeet";
  }
  if (normalized.includes("sensevoice")) {
    return "sensevoice";
  }
  if (normalized.includes("moonshine")) {
    return "moonshine";
  }
  return normalized ? "whisper" : "";
}

export function pickDefaultLocalSttModelFromCatalog(catalog: readonly string[]): string {
  if (catalog.length === 0) {
    return "";
  }
  for (const candidate of PREFERRED_LOCAL_STT_MODELS) {
    if (catalog.includes(candidate)) {
      return candidate;
    }
  }
  return catalog[0] ?? "";
}
