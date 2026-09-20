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

export type NoticeScheduler = (run: () => void, delayMs: number) => void;

export interface NoticeQueueDeps {
  /** Write the slot. `null` clears it. */
  render: (entry: NoticeEntry | null) => void;
  schedule: NoticeScheduler;
  /** How long a notice owns the slot before the next queued one follows. */
  dwellMs: number;
}

export interface NoticeQueue {
  /** Durable: shown immediately if the queue is empty, else after the others. */
  enqueue: (message: string, isError?: boolean) => void;
  /** Ephemeral status: takes the slot now; the queue resumes one dwell later. */
  present: (message: string, isError?: boolean) => void;
  depth: () => number;
  current: () => NoticeEntry | null;
}

export function createNoticeQueue(deps: NoticeQueueDeps): NoticeQueue {
  const pending: NoticeEntry[] = [];
  let current: NoticeEntry | null = null;
  let currentIsQueued = false;
  let advancePending = false;

  function scheduleAdvance(): void {
    if (advancePending) {
      return;
    }
    advancePending = true;
    deps.schedule(() => {
      advancePending = false;
      advance();
    }, deps.dwellMs);
  }

  function show(entry: NoticeEntry, queued: boolean): void {
    current = entry;
    currentIsQueued = queued;
    deps.render(entry);
    scheduleAdvance();
  }

  function advance(): void {
    const next = pending.shift();
    if (!next) {
      // Nothing queued: whatever is on screen stays, matching status behaviour.
      return;
    }
    show(next, true);
  }

  function enqueue(message: string, isError = false): void {
    const entry: NoticeEntry = { message, isError };
    if (current && current.message === message) {
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

  return {
    enqueue,
    present,
    depth: () => pending.length,
    current: () => current,
  };
}
