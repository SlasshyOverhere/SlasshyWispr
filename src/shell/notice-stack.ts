/**
 * Notice stack — owns the list of messages the notice area shows.
 *
 * Two kinds of message share the surface and behave differently, because they
 * are read differently. Status is live and self-replacing ("Recording started"
 * supersedes the last one). Notices are rare and each one needs reading, so
 * they stack and stay put until dismissed — nothing is hidden behind anything
 * else, and nothing has to be waited for.
 *
 * Pure: the render seam arrives as a dependency, so the rules are testable
 * without a DOM or a clock.
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
}

export interface NoticeStack {
  /** A notice: stacks, and waits to be read. */
  enqueue: (message: string, isError?: boolean, action?: NoticeAction) => void;
  /** Status: takes the status line, leaving notices untouched. */
  present: (message: string, isError?: boolean) => void;
  dismiss: (id: number) => void;
  items: () => NoticeItem[];
}

export function createNoticeStack(deps: NoticeStackDeps): NoticeStack {
  const items: NoticeItem[] = [];
  let nextId = 1;

  function publish(): void {
    deps.render([...items]);
  }

  function enqueue(message: string, isError = false, action?: NoticeAction): void {
    // The same message twice is the same problem reported twice.
    if (items.some((item) => item.message === message)) {
      return;
    }
    items.push({ id: nextId, message, isError, transient: false, action });
    nextId += 1;
    publish();
  }

  function present(message: string, isError = false): void {
    const index = items.findIndex((item) => item.transient);
    if (index === -1) {
      items.push({ id: nextId, message, isError, transient: true });
      nextId += 1;
    } else {
      // Replaced in place, keeping its id and position, so the renderer updates
      // one row instead of removing and re-adding it.
      items[index] = { id: items[index].id, message, isError, transient: true };
    }
    publish();
  }

  function dismiss(id: number): void {
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) {
      return;
    }
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
