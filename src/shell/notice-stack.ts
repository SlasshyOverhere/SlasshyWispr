/**
 * Notice stack — owns the list of messages the notice area shows.
 *
 * Two kinds of message share the surface and behave differently, because they
 * are read differently. Status is live and self-replacing ("Recording started"
 * supersedes the last one). Notices are rare, so they stack — nothing is hidden
 * behind anything else — and everything here leaves on its own after a few
 * seconds, or sooner if it is dismissed.
 *
 * Pure: the render seam and the clock arrive as dependencies, so the rules are
 * testable without a DOM or a real timer.
 */

export interface NoticeAction {
  /** Button text, short enough to sit in a row. */
  label: string;
  run: () => void;
}

export interface NoticeItem {
  /** Stable for the item's life, so a dismiss can name exactly one row. */
  id: number;
  message: string;
  isError: boolean;
  /** Status: replaces the previous status line instead of stacking. */
  transient: boolean;
  /** Optional call to action. The row waits to be dismissed either way. */
  action?: NoticeAction;
}

export interface NoticeStackDeps {
  render: (items: NoticeItem[]) => void;
  /** Injectable clock, so tests drive expiry instead of waiting for it. */
  schedule?: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancelScheduled?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface NoticeStack {
  /** A notice: stacks, then goes on its own. */
  enqueue: (message: string, isError?: boolean, action?: NoticeAction) => void;
  /** Status: takes the status line, leaving notices untouched. */
  present: (message: string, isError?: boolean) => void;
  dismiss: (id: number) => void;
  items: () => NoticeItem[];
}

/// How long a message holds the area before it clears itself. Errors linger
/// longer: those are the ones worth reading twice.
export const NOTICE_TTL_MS = 6000;
export const NOTICE_ERROR_TTL_MS = 10_000;

export function createNoticeStack(deps: NoticeStackDeps): NoticeStack {
  const items: NoticeItem[] = [];
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const schedule =
    deps.schedule ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const cancelScheduled =
    deps.cancelScheduled ??
    ((handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));
  let nextId = 1;

  function publish(): void {
    deps.render([...items]);
  }

  function disarm(id: number): void {
    const handle = timers.get(id);
    if (handle === undefined) {
      return;
    }
    cancelScheduled(handle);
    timers.delete(id);
  }

  function arm(id: number, isError: boolean): void {
    timers.set(
      id,
      schedule(() => dismiss(id), isError ? NOTICE_ERROR_TTL_MS : NOTICE_TTL_MS),
    );
  }

  function enqueue(message: string, isError = false, action?: NoticeAction): void {
    // The same message twice is the same problem reported twice.
    if (items.some((item) => item.message === message)) {
      return;
    }
    const id = nextId;
    nextId += 1;
    items.push({ id, message, isError, transient: false, action });
    arm(id, isError);
    publish();
  }

  function present(message: string, isError = false): void {
    const index = items.findIndex((item) => item.transient);
    if (index === -1) {
      const id = nextId;
      nextId += 1;
      items.push({ id, message, isError, transient: true });
      arm(id, isError);
    } else {
      // Replaced in place, keeping its id and position, so the renderer updates
      // one row instead of removing and re-adding it. The clock restarts too:
      // the newest status is the one worth showing.
      const id = items[index].id;
      disarm(id);
      items[index] = { id, message, isError, transient: true };
      arm(id, isError);
    }
    publish();
  }

  function dismiss(id: number): void {
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) {
      return;
    }
    disarm(id);
    items.splice(index, 1);
    publish();
  }

  return {
    enqueue,
    present,
    dismiss,
    items: () => [...items],
  };
}
