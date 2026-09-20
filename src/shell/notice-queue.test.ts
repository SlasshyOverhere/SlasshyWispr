/**
 * Notice queue tests.
 *
 * The rules that matter are the ones a reader would assume wrongly: that a
 * queued notice survives an ephemeral one, that the order is preserved, and
 * that resuming does not depend on a real clock.
 */
import { describe, expect, it } from "bun:test";
import { createNoticeQueue, type NoticeEntry, type NoticeQueueDeps } from "./notice-queue";

function makeHarness(dwellMs = 1000) {
  const rendered: (NoticeEntry | null)[] = [];
  const timers: { run: () => void; delayMs: number; cancelled: boolean }[] = [];
  const deps: NoticeQueueDeps = {
    render: (entry) => rendered.push(entry),
    schedule: (run, delayMs) => {
      timers.push({ run, delayMs, cancelled: false });
    },
    dwellMs,
  };
  const queue = createNoticeQueue(deps);
  return {
    queue,
    rendered,
    lastText: () => rendered.at(-1)?.message ?? null,
    /** Fire the oldest outstanding timer, as the clock eventually would. */
    tick(): void {
      const next = timers.find((timer) => !timer.cancelled);
      if (!next) {
        throw new Error("no scheduled advance to fire");
      }
      next.cancelled = true;
      next.run();
    },
    outstandingTimers: () => timers.filter((timer) => !timer.cancelled).length,
  };
}

describe("notice queue", () => {
  it("shows the first notice immediately and queues the rest in order", () => {
    const h = makeHarness();
    h.queue.enqueue("first");
    h.queue.enqueue("second");
    h.queue.enqueue("third");

    expect(h.lastText()).toBe("first");
    expect(h.queue.depth()).toBe(2);

    h.tick();
    expect(h.lastText()).toBe("second");
    h.tick();
    expect(h.lastText()).toBe("third");
    expect(h.queue.depth()).toBe(0);
  });

  it("leaves the last notice on screen instead of clearing it", () => {
    const h = makeHarness();
    h.queue.enqueue("only");
    h.tick();

    expect(h.lastText()).toBe("only");
    expect(h.rendered).toHaveLength(1);
  });

  it("preserves an error tone through the queue", () => {
    const h = makeHarness();
    h.queue.enqueue("soft");
    h.queue.enqueue("hard", true);
    h.tick();

    expect(h.rendered.at(-1)).toEqual({ message: "hard", isError: true });
  });

  it("replaces immediately when nothing is queued, as status messages do today", () => {
    const h = makeHarness();
    h.queue.present("Recording started");
    h.queue.present("Processing");

    expect(h.lastText()).toBe("Processing");
    expect(h.queue.depth()).toBe(0);
  });

  it("puts a preempted queued notice back rather than dropping it", () => {
    const h = makeHarness();
    h.queue.enqueue("timeout was corrected");
    h.tick();
    h.queue.enqueue("verb registry repaired");

    // The user does something; status takes the slot.
    h.queue.present("Recording started");
    expect(h.lastText()).toBe("Recording started");
    expect(h.queue.depth()).toBe(2);

    // Both corrections resume in order, interrupted one first, once the status
    // message has had its dwell.
    h.tick();
    expect(h.lastText()).toBe("timeout was corrected");
    h.tick();
    expect(h.lastText()).toBe("verb registry repaired");
  });

  it("does not resurface an ephemeral message as if it were queued", () => {
    const h = makeHarness();
    h.queue.present("Recording started");
    h.tick();

    expect(h.queue.depth()).toBe(0);
    expect(h.rendered).toHaveLength(1);
  });

  it("suppresses a repeat of the notice already on screen", () => {
    const h = makeHarness();
    h.queue.enqueue("same");
    h.queue.enqueue("same");

    expect(h.queue.depth()).toBe(0);
    h.tick();
    expect(h.rendered).toHaveLength(1);
  });

  it("suppresses a duplicate that is still waiting", () => {
    const h = makeHarness();
    h.queue.enqueue("first");
    h.queue.enqueue("second");
    h.queue.enqueue("second");

    expect(h.queue.depth()).toBe(1);
    h.tick();
    h.tick();
    expect(h.rendered.map((entry) => entry?.message)).toEqual(["first", "second"]);
  });

  it("re-shows a message that legitimately comes around again", () => {
    const h = makeHarness();
    h.queue.enqueue("reconnect");
    h.tick();
    h.queue.present("other");
    h.tick();
    h.queue.enqueue("reconnect");
    h.tick();

    expect(h.rendered.map((entry) => entry?.message)).toEqual([
      "reconnect",
      "other",
      "reconnect",
    ]);
  });

  it("does not stack advance timers while one is outstanding", () => {
    const h = makeHarness();
    h.queue.enqueue("one");
    h.queue.enqueue("two");
    h.queue.enqueue("three");

    expect(h.outstandingTimers()).toBe(1);
  });

  it("uses the configured dwell", () => {
    const configured: number[] = [];
    const queue = createNoticeQueue({
      render: () => {},
      schedule: (_run, delayMs) => configured.push(delayMs),
      dwellMs: 42,
    });
    queue.enqueue("anything");

    expect(configured).toEqual([42]);
  });
});
