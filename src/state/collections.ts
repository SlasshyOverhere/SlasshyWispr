import {
  DICTIONARY_STORAGE_KEY,
  NOTES_STORAGE_KEY,
  SNIPPETS_STORAGE_KEY,
} from "../constants";
import type { DictionaryTerm, QuickNoteEntry, SnippetEntry } from "../types";
import { normalizeDictionaryEntries, normalizeSnippetEntries } from "../utils";
import { parseJson } from "./storage";

/**
 * Canonical dictionary / snippets / notes loaders.
 *
 * Single owner — these were duplicated between store.ts and main.tsx.
 * Predicates preserved verbatim: dictionary/snippets go through the shared
 * normalizers; notes keeps the `item && item.text` truthiness check.
 */
export function loadDictionary(): DictionaryTerm[] {
  const parsed = parseJson<DictionaryTerm[]>(DICTIONARY_STORAGE_KEY, []);
  return normalizeDictionaryEntries(Array.isArray(parsed) ? parsed : []);
}

export function loadSnippets(): SnippetEntry[] {
  const parsed = parseJson<SnippetEntry[]>(SNIPPETS_STORAGE_KEY, []);
  return normalizeSnippetEntries(Array.isArray(parsed) ? parsed : []);
}

export function loadNotes(): QuickNoteEntry[] {
  const parsed = parseJson<QuickNoteEntry[]>(NOTES_STORAGE_KEY, []);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((item) => item && item.text);
}
