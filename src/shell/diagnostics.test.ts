/**
 * Diagnostics wiring test.
 *
 * The stack's rules are covered in notice-stack.test.ts. What this file pins is
 * the rendering seam around it, against a fake DOM: that a plain setNotice
 * still reaches the area (a regression there would silence every notice in the
 * app at once), that each row's button dismisses its own row and no other, and
 * that rows appear in list order.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { initDiagnostics, queueNotice, setNotice } from "./diagnostics";

class FakeElement {
  className = "";
  title = "";
  type = "";
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  parent: FakeElement | null = null;

  private text = "";
  private attributes: Record<string, string> = {};
  private listeners: Array<() => void> = [];

  constructor(readonly tagName: string) {}

  get textContent(): string {
    return this.text;
  }

  set textContent(value: string) {
    this.text = value;
    // Assigning text replaces children, as the real DOM does.
    this.children = [];
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parent) {
      return;
    }
    this.parent.children = this.parent.children.filter((node) => node !== this);
    this.parent = null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  addEventListener(_type: string, listener: () => void): void {
    this.listeners.push(listener);
  }

  removeEventListener(_type: string, listener: () => void): void {
    this.listeners = this.listeners.filter((entry) => entry !== listener);
  }

  click(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

function wire() {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tagName: string) => new FakeElement(tagName),
  };
  const area = new FakeElement("div");
  initDiagnostics(area as unknown as HTMLElement, { isTauri: () => false });
  return area;
}

/** Row text of each rendered row, in DOM order. */
function rowTexts(area: FakeElement): string[] {
  return area.children.map((row) => row.children[0].textContent);
}

function dismissButton(area: FakeElement, index: number): FakeElement {
  // Always the last control in the row, so an action button cannot displace it.
  return area.children[index].children.at(-1) as FakeElement;
}

function actionButton(area: FakeElement, index: number): FakeElement {
  return area.children[index].children[1];
}

describe("diagnostics notice rendering", () => {
  beforeEach(() => {
    (globalThis as unknown as { document?: unknown }).document = undefined;
  });

  it("is a no-op before init rather than throwing", () => {
    expect(() => setNotice("early")).not.toThrow();
    expect(() => queueNotice("early")).not.toThrow();
  });

  it("writes the status line", () => {
    const area = wire();
    setNotice("Recording started");

    expect(rowTexts(area)).toEqual(["Recording started"]);
  });

  it("stacks notices so all of them are visible at once", () => {
    const area = wire();
    queueNotice("timeout corrected");
    queueNotice("verb registry repaired");

    expect(rowTexts(area)).toEqual(["timeout corrected", "verb registry repaired"]);
  });

  it("dismisses only the row whose button was clicked", () => {
    const area = wire();
    queueNotice("first");
    queueNotice("second");
    queueNotice("third");

    dismissButton(area, 1).click();

    expect(rowTexts(area)).toEqual(["first", "third"]);
  });

  it("keeps rows in list order as items come and go", () => {
    const area = wire();
    queueNotice("first");
    queueNotice("second");
    dismissButton(area, 0).click();
    queueNotice("third");

    expect(rowTexts(area)).toEqual(["second", "third"]);
  });

  it("leaves the area empty once everything is dismissed", () => {
    const area = wire();
    queueNotice("only");
    dismissButton(area, 0).click();

    expect(rowTexts(area)).toEqual([]);
    expect(area.children).toHaveLength(0);
  });

  it("updates the status row in place instead of adding a row", () => {
    const area = wire();
    setNotice("Recording started");
    setNotice("Processing");

    expect(rowTexts(area)).toEqual(["Processing"]);
    expect(area.children).toHaveLength(1);
  });

  it("marks an error row with its tone", () => {
    const area = wire();
    queueNotice("soft");
    queueNotice("hard", true);

    expect(area.children.map((row) => row.dataset.tone)).toEqual(["normal", "error"]);
  });

  it("names the notice each button dismisses", () => {
    const area = wire();
    queueNotice("timeout corrected");

    expect(dismissButton(area, 0).getAttribute("aria-label")).toBe(
      "Dismiss notice: timeout corrected",
    );
  });

  it("runs the action, and keeps the row so it can still be read", () => {
    const area = wire();
    let runs = 0;
    queueNotice("Update 1.2.3 is available.", false, {
      label: "Open Updates",
      run: () => {
        runs += 1;
      },
    });

    actionButton(area, 0).click();

    expect(runs).toBe(1);
    expect(rowTexts(area)).toEqual(["Update 1.2.3 is available."]);
  });

  it("omits the action button on a plain notice", () => {
    const area = wire();
    queueNotice("timeout corrected");

    expect(area.children[0].children).toHaveLength(2);
  });

  it("labels the action button with its own text", () => {
    const area = wire();
    queueNotice("Update 1.2.3 is available.", false, { label: "Open Updates", run: () => {} });

    expect(actionButton(area, 0).textContent).toBe("Open Updates");
  });

  it("starts from an empty area when re-initialised", () => {
    const area = wire();
    queueNotice("stale");
    initDiagnostics(area as unknown as HTMLElement, { isTauri: () => false });

    expect(area.children).toHaveLength(0);
    queueNotice("fresh");
    expect(rowTexts(area)).toEqual(["fresh"]);
  });
});
