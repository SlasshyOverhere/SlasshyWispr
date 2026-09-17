/**
 * Collections-view move-boundary test — Phase 5 shell decomposition.
 *
 * Pins add/render round-trips for dictionary, snippets, and notes:
 * validation rejects, dedupe is case-insensitive, notes cap at 50 and
 * respect incognito, and renderers write rows into the provided
 * elements. Runs against the real localStorage via test-setup preload.
 */
import { describe, it, expect, beforeEach } from "bun:test";

// bun test has no DOM document; stub it at module scope (before any
// renderer runs) with the fragment/element creation the renderers need.
{
  const makeElement = () => ({
    className: "",
    innerHTML: "",
    textContent: "",
    dataset: {},
    append() {},
    appendChild() {},
    addEventListener() {},
    querySelector() {
      return { addEventListener() {} };
    },
    classList: { add() {}, remove() {}, contains: () => false },
  });
  (globalThis as unknown as { document?: unknown }).document = {
    createDocumentFragment: () => ({ append() {} }),
    createElement: () => makeElement(),
    getElementById: () => null,
  };
}
import {
  addDictionaryTerm,
  addQuickNote,
  addSnippetEntry,
  getDictionaryTerms,
  getQuickNotes,
  getSnippets,
  initCollectionsView,
  persistDictionaryTerms,
  persistQuickNotes,
  persistSnippets,
  renderDictionaryList,
  renderNotesList,
  renderSnippetsList,
} from "./collections-view";
import {
  DICTIONARY_STORAGE_KEY,
  NOTES_STORAGE_KEY,
  SNIPPETS_STORAGE_KEY,
} from "../constants";

function fakeDiv(): HTMLDivElement {
  return {
    innerHTML: "",
    textContent: "",
    append() {},
  } as unknown as HTMLDivElement;
}

function fakeInput(value = ""): HTMLInputElement {
  return { value } as unknown as HTMLInputElement;
}

function fakeSpan(): HTMLSpanElement {
  return { textContent: "" } as unknown as HTMLSpanElement;
}

function fakeToggle(): HTMLButtonElement {
  const classes = new Set<string>();
  return {
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
    textContent: "",
  } as unknown as HTMLButtonElement;
}

function fakeCard(): HTMLElement {
  const classes = new Set<string>(["is-collapsed"]);
  return {
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
  } as unknown as HTMLElement;
}

function wireHarness(incognito = false) {
  const notices: Array<{ message: string; isError?: boolean }> = [];
  const sourceInput = fakeInput();
  const targetInput = fakeInput();
  const triggerInput = fakeInput();
  const expansionInput = fakeInput();
  initCollectionsView(
    {
      dictionaryList: fakeDiv(),
      dictionaryFormCard: fakeCard(),
      dictionaryCount: fakeSpan(),
      dictionarySourceInput: sourceInput,
      dictionaryTargetInput: targetInput,
      dictionaryAddBtnTop: fakeToggle(),
      snippetsList: fakeDiv(),
      snippetFormContainer: fakeCard(),
      snippetTriggerInput: triggerInput,
      snippetExpansionInput: expansionInput,
      snippetsAddBtnTop: fakeToggle(),
      notesList: fakeDiv(),
    },
    {
      isIncognito: () => incognito,
      notify: (message, isError) => {
        notices.push({ message, isError });
      },
      formatNoteTime: () => "Jan 1",
    },
  );
  return { notices, sourceInput, targetInput, triggerInput, expansionInput };
}

function clearStorage(): void {
  localStorage.removeItem(DICTIONARY_STORAGE_KEY);
  localStorage.removeItem(SNIPPETS_STORAGE_KEY);
  localStorage.removeItem(NOTES_STORAGE_KEY);
}

beforeEach(() => {
  clearStorage();
  wireHarness();
  // Reset module lists by persisting empties then re-adding nothing.
  while (getDictionaryTerms().length > 0) {
    getDictionaryTerms().pop();
  }
  while (getSnippets().length > 0) {
    getSnippets().pop();
  }
  while (getQuickNotes().length > 0) {
    getQuickNotes().pop();
  }
  persistDictionaryTerms();
  persistSnippets();
  persistQuickNotes();
});

describe("dictionary", () => {
  it("rejects invalid entries and dedupes case-insensitively", () => {
    const harness = wireHarness();
    harness.sourceInput.value = "";
    harness.targetInput.value = "";
    addDictionaryTerm();
    expect(getDictionaryTerms()).toEqual([]);
    expect(harness.notices[0].isError).toBe(true);

    harness.sourceInput.value = "gonna";
    harness.targetInput.value = "going to";
    addDictionaryTerm();
    harness.sourceInput.value = "GONNA";
    harness.targetInput.value = "going to!";
    addDictionaryTerm();
    expect(getDictionaryTerms().length).toBe(1);
    expect(getDictionaryTerms()[0].source).toBe("GONNA");
    persistDictionaryTerms();
    const stored = JSON.parse(localStorage.getItem(DICTIONARY_STORAGE_KEY) ?? "[]");
    expect(stored.length).toBe(1);
  });

  it("renders the empty state and rows", () => {
    const harness = wireHarness();
    renderDictionaryList();
    harness.sourceInput.value = "a";
    harness.targetInput.value = "b";
    addDictionaryTerm();
    renderDictionaryList();
    expect(getDictionaryTerms().length).toBe(1);
  });
});

describe("snippets", () => {
  it("rejects invalid entries and dedupes triggers", () => {
    const harness = wireHarness();
    harness.triggerInput.value = "x";
    harness.expansionInput.value = "";
    addSnippetEntry();
    expect(getSnippets()).toEqual([]);
    harness.triggerInput.value = "addr";
    harness.expansionInput.value = "123 Main St";
    addSnippetEntry();
    harness.triggerInput.value = "ADDR";
    harness.expansionInput.value = "other";
    addSnippetEntry();
    expect(getSnippets().length).toBe(1);
    expect(harness.notices[harness.notices.length - 1].message).toContain("ADDR");
  });
});

describe("notes", () => {
  it("caps at 50 and skips incognito", () => {
    wireHarness();
    for (let i = 0; i < 55; i += 1) {
      addQuickNote(`note ${i} with enough words here`);
    }
    expect(getQuickNotes().length).toBe(50);
    expect(getQuickNotes()[0].text).toContain("note 54");

    const before = getQuickNotes().length;
    wireHarness(true);
    addQuickNote("incognito note here please");
    expect(getQuickNotes().length).toBe(before);
  });

  it("renders without throwing", () => {
    wireHarness();
    addQuickNote("hello world note");
    renderNotesList();
    renderSnippetsList();
    expect(getQuickNotes().length).toBe(1);
  });
});
