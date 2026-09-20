/**
 * Diagnostics wiring test.
 *
 * The queue's ordering rules are covered in notice-queue.test.ts. What this
 * file pins is the seam around it: that a plain setNotice still reaches the
 * element (a regression here would silence every notice in the app at once),
 * and that the real timer actually resumes a queued notice.
 */
import { describe, expect, it } from "bun:test";
import { initDiagnostics, queueNotice, setNotice } from "./diagnostics";

function makeElement() {
  return {
    textContent: "",
    dataset: {} as Record<string, string>,
  } as unknown as HTMLParagraphElement;
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
    const element = makeElement();
    initDiagnostics(element, { isTauri: () => false });

    setNotice("Recording started");
    expect(element.textContent).toBe("Recording started");
    expect(element.dataset.tone).toBe("normal");

    setNotice("Something broke", true);
    expect(element.textContent).toBe("Something broke");
    expect(element.dataset.tone).toBe("error");
  });

  it("shows a queued notice and advances to the next after the dwell", async () => {
    const element = makeElement();
    initDiagnostics(element, { isTauri: () => false, dwellMs: 10 });

    queueNotice("first");
    queueNotice("second");
    expect(element.textContent).toBe("first");

    await settle(30);
    expect(element.textContent).toBe("second");
  });

  it("lets status take the slot but brings the queued notice back", async () => {
    const element = makeElement();
    initDiagnostics(element, { isTauri: () => false, dwellMs: 10 });

    queueNotice("correction");
    setNotice("Recording started");
    expect(element.textContent).toBe("Recording started");

    await settle(30);
    expect(element.textContent).toBe("correction");
  });
});
