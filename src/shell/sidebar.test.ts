/**
 * Sidebar move-boundary test — Phase 5 shell decomposition.
 *
 * Pins applySidebarCollapsed (body class, aria state, action label,
 * hover-title sync) and applyPersistedSidebarCollapsed (read/write
 * persistence round-trip). Runs against stub elements and a stubbed
 * document.body.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import {
  initSidebar,
  applySidebarCollapsed,
  applyPersistedSidebarCollapsed,
} from "./sidebar";

{
  const classes = new Set<string>();
  (globalThis as unknown as { document?: unknown }).document = {
    body: {
      classList: {
        toggle(name: string, force?: boolean) {
          if (force === undefined) {
            if (classes.has(name)) classes.delete(name);
            else classes.add(name);
            return;
          }
          if (force) classes.add(name);
          else classes.delete(name);
        },
        contains(name: string) {
          return classes.has(name);
        },
        clear() {
          classes.clear();
        },
      },
    },
    querySelector: () => null,
  };
}

function isCollapsed(): boolean {
  return (
    globalThis as unknown as {
      document: { body: { classList: { contains: (n: string) => boolean } } };
    }
  ).document.body.classList.contains("sidebar-collapsed");
}

function fakeToggleButton(): HTMLButtonElement {
  const attrs = new Map<string, string>();
  return {
    dataset: {} as DOMStringMap,
    setAttribute(name: string, value: string) {
      attrs.set(name, value);
    },
    getAttribute(name: string) {
      return attrs.get(name) ?? null;
    },
    addEventListener() {},
  } as unknown as HTMLButtonElement;
}

function fakeLabeledButton(label?: string, hotkey?: string): HTMLElement {
  const attrs = new Map<string, string>();
  const el = {
    dataset: { label, hotkey } as unknown as DOMStringMap,
    setAttribute(name: string, value: string) {
      attrs.set(name, value);
    },
    getAttribute(name: string) {
      return attrs.get(name) ?? null;
    },
    removeAttribute(name: string) {
      attrs.delete(name);
    },
  } as unknown as HTMLElement;
  (el as unknown as { __attrs: Map<string, string> }).__attrs = attrs;
  return el;
}

function attrsOf(el: HTMLElement): Map<string, string> {
  return (el as unknown as { __attrs: Map<string, string> }).__attrs;
}

function wireHarness(options: { collapsed?: boolean; buttons?: HTMLElement[] } = {}) {
  const toggleButton = fakeToggleButton();
  const labeledButtons = options.buttons ?? [fakeLabeledButton("Library", "Ctrl+L"), fakeLabeledButton()];
  let stored: boolean | null = options.collapsed ?? null;
  const writes: boolean[] = [];
  initSidebar(
    { toggleButton, labeledButtons },
    {
      readCollapsed: () => stored ?? false,
      writeCollapsed: (collapsed) => {
        stored = collapsed;
        writes.push(collapsed);
      },
    },
  );
  return { toggleButton, labeledButtons, writes, setStored: (v: boolean) => { stored = v; }, getStored: () => stored };
}

function clearBody() {
  (
    globalThis as unknown as {
      document: { body: { classList: { clear: () => void } } };
    }
  ).document.body.classList.clear();
}

beforeEach(() => {
  clearBody();
  wireHarness();
});

describe("applySidebarCollapsed", () => {
  it("collapses with expanded action label and hotkey titles", () => {
    const harness = wireHarness();
    applySidebarCollapsed(true);
    expect(isCollapsed()).toBe(true);
    expect(harness.toggleButton.getAttribute("aria-pressed")).toBe("true");
    expect(harness.toggleButton.getAttribute("aria-label")).toBe("Expand tabs");
    expect(attrsOf(harness.labeledButtons[0]).get("title")).toBe("Library (Ctrl+L)");
  });

  it("expands and keeps hover titles", () => {
    const harness = wireHarness();
    applySidebarCollapsed(true);
    applySidebarCollapsed(false);
    expect(isCollapsed()).toBe(false);
    expect(harness.toggleButton.getAttribute("aria-pressed")).toBe("false");
    expect(harness.toggleButton.getAttribute("aria-label")).toBe("Compact tabs");
    expect(attrsOf(harness.labeledButtons[0]).get("title")).toBe("Library (Ctrl+L)");
  });
});

describe("applyPersistedSidebarCollapsed", () => {
  it("applies the stored value", () => {
    const harness = wireHarness({ collapsed: true });
    applyPersistedSidebarCollapsed();
    expect(isCollapsed()).toBe(true);
    expect(harness.getStored()).toBe(true);
  });
});
