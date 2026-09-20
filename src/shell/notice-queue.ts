/**
 * Notice queue — owns the ordering policy for the single notice slot.
 *
 * The slot holds one line of text, and runtime status ("Recording started")
 * is written to it far more often than it is read. Boot-time notices are the
 * other way round: rare, and each one matters. This module gives the second
 * kind a FIFO so a queued notice cannot be lost to the next thing that
 * happens, while the first kind keeps its immediate-replace behaviour.
 *
 * Pure: rendering and scheduling arrive as seams, so the ordering rules are
 * testable without a DOM or a clock.
 */

export interface NoticeEntry {
  message: string;
  isError: boolean;
}

/** What the slot should show right now. */
export interface NoticeSlotState {
  entry: NoticeEntry | null;
  /** How many notices are waiting behind the current one. */
  queued: number;
}

export type NoticeScheduler = (run: () => void, delayMs: number) => void;

export interface NoticeQueueDeps {
  /** Write the slot to match this state. */
  render: (state: NoticeSlotState) => void;
  schedule: NoticeScheduler;
  /** How long a notice owns the slot before the next queued one follows. */
  dwellMs: number;
}

export interface NoticeQueue {
  /** Durable: shown immediately if the queue is empty, else after the others. */
  enqueue: (message: string, isError?: boolean) => void;
  /** Ephemeral status: takes the slot now; the queue resumes one dwell later. */
  present: (message: string, isError?: boolean) => void;
  /** Read and move on: the next queued notice, or an empty slot. */
  dismiss: () => void;
  depth: () => number;
  current: () => NoticeEntry | null;
}

export function createNoticeQueue(deps: NoticeQueueDeps): NoticeQueue {
  const pending: NoticeEntry[] = [];
  let current: NoticeEntry | null = null;
  let currentIsQueued = false;
  // Every write arms an advance and retires the one before it, so a timer that
  // fires late can never pull a notice forward over the one on screen.
  let advanceToken = 0;
  let published: NoticeSlotState | null = null;

  function publish(): void {
    const state: NoticeSlotState = { entry: current, queued: pending.length };
    // The queue depth is part of the slot state, so a drain is a real change and
    // has to reach the shell. A republish of the same state must not.
    if (
      published?.queued === state.queued &&
      published.entry?.message === state.entry?.message &&
      published.entry?.isError === state.entry?.isError
    ) {
      return;
    }
    published = state;
    deps.render(state);
  }

  function scheduleAdvance(): void {
    const mine = ++advanceToken;
    deps.schedule(() => {
      if (mine !== advanceToken) {
        return;
      }
      advance();
    }, deps.dwellMs);
  }

  function show(entry: NoticeEntry | null, queued: boolean): void {
    current = entry;
    currentIsQueued = queued;
    publish();
    scheduleAdvance();
  }

  function advance(): void {
    const next = pending.shift();
    if (next) {
      show(next, true);
      return;
    }
    // Nothing waiting: leave the text up rather than blanking it, matching a
    // status message. Publish anyway so the queued count stays truthful.
    publish();
  }

  function enqueue(message: string, isError = false): void {
    const entry: NoticeEntry = { message, isError };
    if (current?.message === message) {
      return;
    }
    if (pending.some((item) => item.message === message)) {
      return;
    }
    if (!current) {
      show(entry, true);
      return;
    }
    pending.push(entry);
    publish();
  }

  function present(message: string, isError = false): void {
    const entry: NoticeEntry = { message, isError };
    // A queued notice that has not finished its dwell is put back rather than
    // dropped — an ephemeral status message should not swallow a correction.
    if (currentIsQueued && current) {
      pending.unshift(current);
    }
    show(entry, false);
  }

  function dismiss(): void {
    // No separate cancellation: show() arms a fresh advance, retiring the timer
    // this interrupts even when the slot is being cleared.
    const next = pending.shift();
    show(next ?? null, next !== undefined);
  }

  return {
    enqueue,
    present,
    dismiss,
    depth: () => pending.length,
    current: () => current,
  };
}
