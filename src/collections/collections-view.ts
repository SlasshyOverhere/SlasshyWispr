/**
 * Dictionary / snippets / notes collections view — Phase 5 shell
 * decomposition.
 *
 * Owns persistDictionaryTerms + persistSnippets + persistQuickNotes +
 * renderDictionaryList + addDictionaryTerm + renderSnippetsList +
 * addSnippetEntry + addQuickNote + renderNotesList. Moved verbatim from
 * main.tsx; the lists live here, and shell seams (settings, notice,
 * confirm, time format, collections state for the pipeline) arrive via
 * initCollectionsView so this module never touches main.tsx globals.
 */
import {
  DICTIONARY_STORAGE_KEY,
  NOTES_STORAGE_KEY,
  SNIPPETS_STORAGE_KEY,
} from "../constants";
import type { DictionaryTerm, QuickNoteEntry, SnippetEntry } from "../types";
import {
  confirmDestructiveAction,
  createId,
  escapeHtml,
  normalizeDictionaryEntries,
  normalizeSnippetEntries,
  validateDictionaryEntry,
  validateQuickNote,
  validateSnippetEntry,
} from "../utils";
import {
  loadDictionary as loadDictionaryFromState,
  loadNotes as loadNotesFromState,
  loadSnippets as loadSnippetsFromState,
} from "../state/collections";

export interface CollectionsViewElements {
  dictionaryList: HTMLDivElement;
  dictionaryFormCard: HTMLElement;
  dictionaryCount: HTMLSpanElement;
  dictionarySourceInput: HTMLInputElement;
  dictionaryTargetInput: HTMLInputElement;
  dictionaryAddBtnTop: HTMLButtonElement;
  snippetsList: HTMLDivElement;
  snippetFormContainer: HTMLElement;
  snippetTriggerInput: HTMLInputElement;
  snippetExpansionInput: HTMLInputElement;
  snippetsAddBtnTop: HTMLButtonElement;
  notesList: HTMLDivElement;
}

export interface CollectionsViewDeps {
  isIncognito: () => boolean;
  notify: (message: string, isError?: boolean) => void;
  formatNoteTime: (createdAt: number) => string;
}

let viewElements!: CollectionsViewElements;
let viewDeps!: CollectionsViewDeps;

let dictionaryTerms = loadDictionaryFromState();
let snippets = loadSnippetsFromState();
let quickNotes = loadNotesFromState();

export function initCollectionsView(
  elements: CollectionsViewElements,
  deps: CollectionsViewDeps,
): void {
  viewElements = elements;
  viewDeps = deps;
}

export function getDictionaryTerms(): DictionaryTerm[] {
  return dictionaryTerms;
}

export function getSnippets(): SnippetEntry[] {
  return snippets;
}

export function getQuickNotes(): QuickNoteEntry[] {
  return quickNotes;
}

export function persistDictionaryTerms(): void {
  localStorage.setItem(DICTIONARY_STORAGE_KEY, JSON.stringify(dictionaryTerms));
}

export function persistSnippets(): void {
  localStorage.setItem(SNIPPETS_STORAGE_KEY, JSON.stringify(snippets));
}

export function persistQuickNotes(): void {
  localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(quickNotes));
}

export function renderDictionaryList(): void {
  const filtered = dictionaryTerms;
  viewElements.dictionaryCount.textContent = `${filtered.length} term${filtered.length === 1 ? "" : "s"}`;

  if (filtered.length === 0) {
    viewElements.dictionaryList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path></svg>
        </div>
        <h4>No terms yet</h4>
        <p>Your dictionary is currently empty. Start by adding a term above to improve transcription accuracy.</p>
      </div>
    `;
    return;
  }

  viewElements.dictionaryList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const term of filtered) {
    const card = document.createElement("div");
    card.className = "dictionary-item-card";

    card.innerHTML = `
      <div class="dict-item-content">
        <div class="dict-term spoken">
          <span class="term-label">Spoken</span>
          <span class="term-value">${escapeHtml(term.source)}</span>
        </div>
        <div class="dict-connector">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </div>
        <div class="dict-term correct">
          <span class="term-label">Correct</span>
          <span class="term-value">${escapeHtml(term.target)}</span>
        </div>
      </div>
      <div class="dict-item-actions">
        <button type="button" class="icon-delete-btn" title="Delete term" data-dictionary-delete="${term.id}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
        </button>
      </div>
    `;

    const deleteBtn = card.querySelector(".icon-delete-btn") as HTMLButtonElement;
    deleteBtn.addEventListener("click", async () => {
      if (!await confirmDestructiveAction(`Delete dictionary term "${term.source}"?`)) {
        return;
      }
      dictionaryTerms = dictionaryTerms.filter((entry) => entry.id !== term.id);
      persistDictionaryTerms();
      renderDictionaryList();
    });

    fragment.append(card);
  }
  viewElements.dictionaryList.append(fragment);
}

export function addDictionaryTerm(): void {
  const source = viewElements.dictionarySourceInput.value.trim();
  const target = viewElements.dictionaryTargetInput.value.trim();
  const validationError = validateDictionaryEntry(source, target);
  if (validationError) {
    viewDeps.notify(validationError, true);
    return;
  }

  dictionaryTerms = normalizeDictionaryEntries([
    {
      id: createId(),
      source,
      target,
      createdAt: Date.now(),
    },
    ...dictionaryTerms.filter(
      (entry) => entry.source.trim().toLocaleLowerCase() !== source.toLocaleLowerCase(),
    ),
  ]);
  persistDictionaryTerms();
  renderDictionaryList();

  viewElements.dictionarySourceInput.value = "";
  viewElements.dictionaryTargetInput.value = "";

  viewElements.dictionaryFormCard.classList.add("is-collapsed");
  viewElements.dictionaryAddBtnTop.classList.remove("is-active");
  viewDeps.notify(`Dictionary term added: ${source} → ${target}`);
}

export function renderSnippetsList(): void {
  const filtered = snippets;

  const snippetsCountBadge = document.getElementById("snippetsCountBadge");
  if (snippetsCountBadge) {
    snippetsCountBadge.textContent = `${filtered.length} snippet${filtered.length === 1 ? "" : "s"}`;
  }

  if (filtered.length === 0) {
    viewElements.snippetsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
        </div>
        <h4>No snippets yet</h4>
        <p>Save time by creating your first text expansion shortcut.</p>
      </div>
    `;
    return;
  }

  viewElements.snippetsList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const snippet of filtered) {
    const row = document.createElement("div");
    row.className = "managed-row snippet-row";

    const mainEl = document.createElement("div");
    mainEl.className = "managed-row-main";
    const triggerEl = document.createElement("strong");
    triggerEl.className = "snippet-trigger";
    triggerEl.textContent = snippet.trigger;
    const expansionEl = document.createElement("span");
    expansionEl.className = "snippet-expansion";
    expansionEl.textContent = snippet.expansion;
    mainEl.append(triggerEl, expansionEl);

    const actionsEl = document.createElement("div");
    actionsEl.className = "managed-row-actions";
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "delete-btn";
    deleteBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
      <span>Delete</span>
    `;
    deleteBtn.dataset.snippetDelete = snippet.id;
    deleteBtn.addEventListener("click", async () => {
      if (!await confirmDestructiveAction(`Delete snippet "${snippet.trigger}"?`)) {
        return;
      }
      snippets = snippets.filter((entry) => entry.id !== snippet.id);
      persistSnippets();
      renderSnippetsList();
    });
    actionsEl.append(deleteBtn);

    row.append(mainEl, actionsEl);
    fragment.append(row);
  }
  viewElements.snippetsList.append(fragment);
}

export function addSnippetEntry(): void {
  const trigger = viewElements.snippetTriggerInput.value.trim();
  const expansion = viewElements.snippetExpansionInput.value.trim();
  const validationError = validateSnippetEntry(trigger, expansion);
  if (validationError) {
    viewDeps.notify(validationError, true);
    return;
  }

  snippets = normalizeSnippetEntries([
    {
      id: createId(),
      trigger,
      expansion,
      createdAt: Date.now(),
    },
    ...snippets.filter(
      (entry) => entry.trigger.trim().toLocaleLowerCase() !== trigger.toLocaleLowerCase(),
    ),
  ]);
  persistSnippets();
  renderSnippetsList();
  viewElements.snippetTriggerInput.value = "";
  viewElements.snippetExpansionInput.value = "";

  viewElements.snippetFormContainer.classList.add("is-collapsed");
  viewElements.snippetsAddBtnTop.classList.remove("is-active");
  viewElements.snippetsAddBtnTop.textContent = "Add new";
  viewDeps.notify(`Snippet added: ${trigger}`);
}

export function addQuickNote(text: string): void {
  const clean = text.trim();
  const validationError = validateQuickNote(clean);
  if (validationError || viewDeps.isIncognito()) {
    if (validationError && !viewDeps.isIncognito()) {
      viewDeps.notify(validationError, true);
    }
    return;
  }

  quickNotes.unshift({
    id: createId(),
    text: clean,
    createdAt: Date.now(),
  });
  quickNotes = quickNotes.slice(0, 50);
  persistQuickNotes();
  renderNotesList();
  if (quickNotes.length >= 50) {
    viewDeps.notify("Quick note saved. The list keeps the 50 most recent notes.");
  }
}

export function renderNotesList(): void {
  if (quickNotes.length === 0 || viewDeps.isIncognito()) {
    viewElements.notesList.innerHTML = "";
    return;
  }

  viewElements.notesList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const note of quickNotes) {
    const row = document.createElement("article");
    row.className = "managed-row managed-row-grid managed-row-note";
    const time = viewDeps.formatNoteTime(note.createdAt);

    const mainEl = document.createElement("p");
    mainEl.className = "managed-row-main";
    const strongEl = document.createElement("strong");
    strongEl.textContent = "Quick note";
    const spanEl = document.createElement("span");
    spanEl.textContent = note.text;
    mainEl.append(strongEl, spanEl);

    const metaEl = document.createElement("span");
    metaEl.className = "managed-row-meta";
    metaEl.textContent = time;

    const actionsEl = document.createElement("div");
    actionsEl.className = "managed-row-actions";
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "inline-link";
    deleteBtn.dataset.noteDelete = note.id;
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
      if (!await confirmDestructiveAction("Delete this quick note?")) {
        return;
      }
      quickNotes = quickNotes.filter((entry) => entry.id !== note.id);
      persistQuickNotes();
      renderNotesList();
    });
    actionsEl.append(deleteBtn);

    row.append(mainEl, metaEl, actionsEl);
    fragment.append(row);
  }
  viewElements.notesList.append(fragment);
}
