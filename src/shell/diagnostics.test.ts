/**
 * Diagnostics wiring test.
 *
 * The queue's ordering rules are covered in notice-queue.test.ts. What this
 * file pins is the seam around it: that a plain setNotice still reaches the
 * element (a regression here would silence every notice in the app at once),
 * that the dismiss control reflects and drains the queue, and that the real
 * timer resumes a queued notice.
 */
import { describe, expect, it } from "bun:test";
import { initDiagnostics, queueNotice, setNotice, type NoticeElements } from "./diagnostics";

function makeNotice(textContent = "Ready.") {
  return {
    textContent,
    dataset: {} as Record<string, string>,
  } as unknown as HTMLParagraphElement;
}

function makeDismissButton() {
  const listeners: Array<() => void> = [];
  const attributes: Array<{ name: string; value: string }> = [];
  const button = {
    dataset: {} as Record<string, string>,
    addEventListener(_type: string, listener: () => void) {
      listeners.push(listener);
    },
    removeEventListener(_type: string, listener: () => void) {
      const index = listeners.indexOf(listener);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    },
    setAttribute(name: string, value: string) {
      attributes.push({ name, value });
    },
    getAttribute(name: string) {
      return attributes.filter((entry) => entry.name === name).at(-1)?.value ?? null;
    },
    click() {
      for (const listener of [...listeners]) {
        listener();
      }
    },
    listenerCount: () => listeners.length,
  };
  return button as unknown as HTMLButtonElement & {
    click: () => void;
    listenerCount: () => number;
    getAttribute: (name: string) => string | null;
  };
}

function wire(options: { dwellMs?: number; idle?: string } = {}) {
  const notice = makeNotice(options.idle ?? "Ready.");
  const dismiss = makeDismissButton();
  const elements: NoticeElements = { notice, dismiss };
  initDiagnostics(elements, { isTauri: () => false, dwellMs: options.dwellMs ?? 10 });
  return { notice, dismiss, elements };
}

async function settle(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("diagnostics notice wiring", () => {
  // First: the module has not been initialised at this point, and boot calls
  // these from many branches that may run before the element is bound.
  it("is a no-op before init rather than throwing", () => {
    expect(() => setNotice("early")).not.toThrow();
    expect(() => queueNotice("early")).not.toThrow();
  });

  it("writes the element and tone for a status notice", () => {
    const { notice, dismiss } = wire();

    setNotice("Recording started");
    expect(notice.textContent).toBe("Recording started");
    expect(notice.dataset.tone).toBe("normal");
    expect(dismiss.dataset.available).toBe("1");

    setNotice("Something broke", true);
    expect(notice.textContent).toBe("Something broke");
    expect(notice.dataset.tone).toBe("error");
  });

  it("hides the dismiss control while there is nothing to dismiss", () => {
    const { notice, dismiss } = wire();
    expect(dismiss.dataset.available).toBeUndefined();

    setNotice("Recording started");
    expect(dismiss.dataset.available).toBe("1");

    dismiss.click();
    expect(notice.textContent).toBe("Ready.");
    expect(dismiss.dataset.available).toBeUndefined();
  });

  it("reports how many notices are waiting behind the current one", () => {
    const { dismiss } = wire();
    setNotice("first");
    expect(dismiss.getAttribute("aria-label")).toBe("Dismiss notice");

    queueNotice("second");
    expect(dismiss.getAttribute("aria-label")).toBe("Dismiss notice (1 more waiting)");

    dismiss.click();
    expect(dismiss.getAttribute("aria-label")).toBe("Dismiss notice");
  });

  it("drains the queue on dismiss rather than only clearing the text", () => {
    const { notice, dismiss } = wire();
    queueNotice("first");
    queueNotice("second");

    dismiss.click();
    expect(notice.textContent).toBe("second");
    expect(dismiss.dataset.available).toBe("1");

    dismiss.click();
    expect(notice.textContent).toBe("Ready.");
    expect(dismiss.dataset.available).toBeUndefined();
  });

  it("keeps the idle text the markup shipped", () => {
    const { notice, dismiss } = wire({ idle: "Nothing to report." });
    setNotice("Recording started");
    dismiss.click();

    expect(notice.textContent).toBe("Nothing to report.");
  });

  it("does not stack click listeners when re-initialised", () => {
    const notice = makeNotice();
    const dismiss = makeDismissButton();
    initDiagnostics({ notice, dismiss }, { isTauri: () => false, dwellMs: 10 });
    // A second init happens whenever the shell is rebuilt in dev.
    initDiagnostics({ notice, dismiss }, { isTauri: () => false, dwellMs: 10 });

    expect(dismiss.listenerCount()).toBe(1);
    queueNotice("first");
    queueNotice("second");
    dismiss.click();
    // One click must advance one notice, not skip past it.
    expect(notice.textContent).toBe("second");
  });

  it("shows a queued notice and advances to the next after the dwell", async () => {
    const { notice } = wire({ dwellMs: 10 });

    queueNotice("first");
    queueNotice("second");
    expect(notice.textContent).toBe("first");

    await settle(30);
    expect(notice.textContent).toBe("second");
  });

  it("lets status take the slot but brings the queued notice back", async () => {
    const { notice } = wire({ dwellMs: 10 });

    queueNotice("correction");
    setNotice("Recording started");
    expect(notice.textContent).toBe("Recording started");

    await settle(30);
    expect(notice.textContent).toBe("correction");
  });
});
