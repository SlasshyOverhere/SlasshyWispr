/**
 * Notice stack tests.
 *
 * The rules that matter are the ones a stack makes easy to get wrong: that
 * every notice stays visible instead of waiting its turn, that a dismiss names
 * exactly one item, and that status replaces itself rather than piling up
 * behind the notices.
 */
import { describe, expect, it } from "bun:test";
import { createNoticeStack, type NoticeItem } from "./notice-stack";

function makeHarness() {
  const renders: NoticeItem[][] = [];
  const stack = createNoticeStack({ render: (items) => renders.push(items) });
  return {
    stack,
    renders,
    /** What the area shows, in order. */
    texts: () => stack.items().map((item) => item.message),
    lastRender: () => renders.at(-1) ?? [],
  };
}

describe("notice stack", () => {
  it("keeps every notice visible at once instead of one at a time", () => {
    const h = makeHarness();
    h.stack.enqueue("timeout corrected");
    h.stack.enqueue("verb registry repaired");
    h.stack.enqueue("piper runtime incomplete");

    expect(h.texts()).toEqual([
      "timeout corrected",
      "verb registry repaired",
      "piper runtime incomplete",
    ]);
  });

  it("gives each item its own id", () => {
    const h = makeHarness();
    h.stack.enqueue("first");
    h.stack.enqueue("second");

    const ids = h.stack.items().map((item) => item.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("dismisses exactly the item asked for and keeps the rest in order", () => {
    const h = makeHarness();
    h.stack.enqueue("first");
    h.stack.enqueue("second");
    h.stack.enqueue("third");
    const middle = h.stack.items()[1].id;

    h.stack.dismiss(middle);
    expect(h.texts()).toEqual(["first", "third"]);
  });

  it("ignores a dismiss for an id that is gone", () => {
    const h = makeHarness();
    h.stack.enqueue("only");
    const id = h.stack.items()[0].id;

    h.stack.dismiss(id);
    h.stack.dismiss(id);

    expect(h.texts()).toEqual([]);
    expect(h.renders).toHaveLength(2);
  });

  it("renders a copy, so a reader cannot mutate the stack", () => {
    const h = makeHarness();
    h.stack.enqueue("first");
    h.lastRender().push({
      id: 999,
      message: "injected",
      isError: false,
      transient: false,
    });

    expect(h.stack.items()).toHaveLength(1);
    expect(h.texts()).toEqual(["first"]);
  });

  it("does not stack the same message twice", () => {
    const h = makeHarness();
    h.stack.enqueue("same problem");
    h.stack.enqueue("same problem");

    expect(h.texts()).toEqual(["same problem"]);
  });

  it("carries the error tone on the item", () => {
    const h = makeHarness();
    h.stack.enqueue("soft");
    h.stack.enqueue("hard", true);

    expect(h.stack.items().map((item) => item.isError)).toEqual([false, true]);
  });
});

describe("notice stack status line", () => {
  it("replaces itself in place rather than stacking every update", () => {
    const h = makeHarness();
    h.stack.present("Recording started");
    h.stack.present("Processing");
    h.stack.present("Ready to paste");

    expect(h.texts()).toEqual(["Ready to paste"]);
  });

  it("keeps its id and position when replaced", () => {
    const h = makeHarness();
    h.stack.present("Recording started");
    const id = h.stack.items()[0].id;

    h.stack.present("Processing");
    expect(h.stack.items()[0].id).toBe(id);
  });

  it("sits alongside notices without displacing them", () => {
    const h = makeHarness();
    h.stack.present("Recording started");
    h.stack.enqueue("timeout corrected");
    h.stack.present("Processing");

    expect(h.texts()).toEqual(["Processing", "timeout corrected"]);
    expect(h.stack.items()[1].transient).toBe(false);
  });

  it("appends after a dismiss, rather than reusing the removed id", () => {
    const h = makeHarness();
    h.stack.present("Recording started");
    const first = h.stack.items()[0].id;
    h.stack.dismiss(first);

    h.stack.present("Processing");
    expect(h.stack.items()).toHaveLength(1);
    expect(h.stack.items()[0].id).not.toBe(first);
  });

  it("leaves notices alone when the status line is dismissed", () => {
    const h = makeHarness();
    h.stack.present("Recording started");
    h.stack.enqueue("timeout corrected");
    const status = h.stack.items()[0].id;

    h.stack.dismiss(status);
    expect(h.texts()).toEqual(["timeout corrected"]);
  });
});
