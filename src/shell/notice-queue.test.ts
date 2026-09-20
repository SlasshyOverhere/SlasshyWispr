/**
 * Notice queue tests.
 *
 * The rules that matter are the ones a reader would assume wrongly: that a
 * queued notice survives an ephemeral one, that the order is preserved, that a
 * dismiss retires the timer it interrupts, and that resuming does not depend on
 * a real clock.
 */
import { describe, expect, it } from "bun:test";
import {
  createNoticeQueue,
  type NoticeQueueDeps,
  type NoticeSlotState,
} from "./notice-queue";

interface FakeTimer {
  run: () => void;
  delayMs: number;
  live: boolean;
  fired: boolean;
}

function makeHarness(dwellMs = 1000) {
  const rendered: NoticeSlotState[] = [];
  const timers: FakeTimer[] = [];
  const deps: NoticeQueueDeps = {
    render: (state) => rendered.push(state),
    schedule: (run, delayMs) => {
      timers.push({ run, delayMs, live: true, fired: false });
    },
    dwellMs,
  };
  const queue = createNoticeQueue(deps);
  return {
    queue,
    rendered,
    lastText: () => rendered.at(-1)?.entry?.message ?? null,
    lastState: () => rendered.at(-1),
    /** Visible progression only: a drain republishes the same text with a new
     * count, and that is not a change the reader sees. */
    textSequence: () => {
      const texts = rendered.map((state) => state.entry?.message ?? null);
      return texts.filter((text, index) => text !== texts[index - 1]);
    },
    /**
     * Fire the newest outstanding timer. Only that one can still do anything:
     * a newer write or a dismiss retires the older ones, so this models the
     * generation check rather than a plain clock.
     */
    tick(): void {
      const live = timers.filter((timer) => timer.live);
      const newest = live.at(-1);
      if (!newest) {
        throw new Error("no scheduled advance to fire");
      }
      for (const timer of live) {
        timer.live = false;
      }
      newest.fired = true;
      newest.run();
    },
    /** Fire a timer a dismiss should have retired, to prove it did. */
    fireRetired(): void {
      const stale = timers.find((timer) => !timer.fired);
      if (!stale) {
        throw new Error("no earlier timer to fire");
      }
      stale.fired = true;
      stale.run();
    },
    outstandingTimers: () => timers.filter((timer) => timer.live).length,
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

  it("reports how many notices are still waiting", () => {
    const h = makeHarness();
    h.queue.enqueue("first");
    h.queue.enqueue("second");
    h.queue.enqueue("third");
    expect(h.lastState()).toEqual({
      entry: { message: "first", isError: false },
      queued: 2,
    });

    h.tick();
    expect(h.lastState()?.queued).toBe(1);
    h.tick();
    expect(h.lastState()?.queued).toBe(0);
  });

  it("leaves the last notice on screen instead of clearing it", () => {
    const h = makeHarness();
    h.queue.enqueue("only");
    h.tick();

    expect(h.lastText()).toBe("only");
  });

  it("preserves an error tone through the queue", () => {
    const h = makeHarness();
    h.queue.enqueue("soft");
    h.queue.enqueue("hard", true);
    h.tick();

    expect(h.rendered.at(-1)?.entry).toEqual({ message: "hard", isError: true });
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
    expect(h.textSequence()).toEqual(["Recording started"]);
  });

  it("suppresses a repeat of the notice already on screen", () => {
    const h = makeHarness();
    h.queue.enqueue("same");
    h.queue.enqueue("same");

    expect(h.queue.depth()).toBe(0);
    h.tick();
    expect(h.textSequence()).toEqual(["same"]);
  });

  it("suppresses a duplicate that is still waiting", () => {
    const h = makeHarness();
    h.queue.enqueue("first");
    h.queue.enqueue("second");
    h.queue.enqueue("second");

    expect(h.queue.depth()).toBe(1);
    h.tick();
    h.tick();
    expect(h.textSequence()).toEqual(["first", "second"]);
  });

  it("re-shows a message that legitimately comes around again", () => {
    const h = makeHarness();
    h.queue.enqueue("reconnect");
    h.tick();
    h.queue.present("other");
    h.tick();
    h.queue.enqueue("reconnect");
    h.tick();

    expect(h.textSequence()).toEqual(["reconnect", "other", "reconnect"]);
  });

  it("does not republish a state that has not changed", () => {
    const h = makeHarness();
    h.queue.enqueue("only");
    const afterFirstWrite = h.rendered.length;

    h.tick();
    h.queue.dismiss();
    expect(h.rendered.length).toBeGreaterThan(afterFirstWrite);

    // Every publish after the slot is empty and the queue is drained is a no-op.
    const afterDismiss = h.rendered.length;
    h.queue.dismiss();
    h.tick();
    expect(h.rendered.length).toBe(afterDismiss);
  });

  it("does not stack live advance timers while one is outstanding", () => {
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

describe("notice queue dismiss", () => {
  it("moves to the next queued notice without waiting for the dwell", () => {
    const h = makeHarness();
    h.queue.enqueue("first");
    h.queue.enqueue("second");

    h.queue.dismiss();
    expect(h.lastText()).toBe("second");
    expect(h.queue.depth()).toBe(0);
  });

  it("clears the slot once nothing is left", () => {
    const h = makeHarness();
    h.queue.enqueue("only");
    h.queue.dismiss();

    expect(h.lastState()).toEqual({ entry: null, queued: 0 });
  });

  it("dismisses a status message to reveal what was queued behind it", () => {
    const h = makeHarness();
    h.queue.enqueue("correction");
    h.queue.present("Recording started");

    h.queue.dismiss();
    expect(h.lastText()).toBe("correction");
  });

  it("retires the timer it interrupts so no notice is skipped", () => {
    const h = makeHarness();
    h.queue.enqueue("first");
    h.queue.enqueue("second");

    // Dismissing reveals "second" and schedules its own advance.
    h.queue.dismiss();
    h.queue.enqueue("third");

    // The timer armed for "first" is now stale. Without the generation check it
    // would fire and pull "third" forward past "second".
    h.fireRetired();
    expect(h.lastText()).toBe("second");
    expect(h.queue.depth()).toBe(1);

    h.tick();
    expect(h.lastText()).toBe("third");
  });

  it("is safe to dismiss an empty slot", () => {
    const h = makeHarness();
    h.queue.enqueue("only");
    h.queue.dismiss();

    expect(() => h.queue.dismiss()).not.toThrow();
    expect(h.lastState()).toEqual({ entry: null, queued: 0 });
  });
});
