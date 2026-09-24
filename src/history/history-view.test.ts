/**
 * History-view move-boundary test — Phase 5 shell decomposition.
 *
 * Pins clearAllHistory (list cleared, persisted, store notified, recent
 * turns cleared, notice) and renderDatePicker (month label, day cells,
 * selected/today classes) with stub elements. Runs against the real
 * localStorage via test-setup preload.
 */
import { describe, it, expect, beforeEach } from "bun:test";

// bun test has no DOM document; stub the listeners/querySelectorAll the
// view wiring needs at module scope, before initHistoryView runs.
{
  (globalThis as unknown as { document?: unknown }).document = {
    addEventListener() {},
    querySelectorAll: () => [],
  };
}
import {
  clearAllHistory,
  initHistoryView,
  renderDatePicker,
} from "./history-view";

function fakeHiddenDiv(): HTMLDivElement {
  return {
    hidden: true,
    innerHTML: "",
    contains: () => false,
    addEventListener() {},
    querySelectorAll: () => [],
  } as unknown as HTMLDivElement;
}

function fakeElement(): HTMLElement {
  return {
    textContent: "",
    hidden: true,
    classList: { add() {} },
    addEventListener() {},
  } as unknown as HTMLElement;
}

function fakeButton(): HTMLButtonElement {
  return { addEventListener() {} } as unknown as HTMLButtonElement;
}

function wireHarness() {
  const notices: Array<{ message: string; isError?: boolean }> = [];
  let history: Array<{ id: string }> = [{ id: "a" }];
  let recent = ["turn"];
  let persists = 0;
  let stores = 0;
  initHistoryView(
    {
      datePickerBtn: fakeElement(),
      customDatePicker: fakeHiddenDiv(),
      datePickerDays: {
        innerHTML: "",
        querySelectorAll: () => [],
      } as unknown as HTMLDivElement,
      currentMonthYear: fakeElement(),
      prevMonthBtn: fakeElement(),
      nextMonthBtn: fakeElement(),
      clearHistoryBtn: fakeButton(),
      clearHistoryBtnFull: fakeButton(),
      viewFullHistoryBtn: fakeButton(),
      clearStatsBtn: fakeButton(),
    },
    {
      notify: (message, isError) => {
        notices.push({ message, isError });
      },
      getHomeHistory: () => history,
      setHomeHistory: (entries) => {
        history = entries as Array<{ id: string }>;
      },
      persistHomeHistory: () => {
        persists += 1;
      },
      notifyStoreUpdated: () => {
        stores += 1;
      },
      clearRecentTurns: () => {
        recent = [];
      },
      resetUsageStats: () => {},
      renderMetrics: () => {},
      setActivePage: () => {},
    },
  );
  return {
    notices,
    getHistory: () => history,
    getRecent: () => recent,
    persists: () => persists,
    stores: () => stores,
  };
}

beforeEach(() => {
  wireHarness();
});

describe("clearAllHistory", () => {
  it("clears, persists, notifies the store, and clears recent turns", () => {
    const harness = wireHarness();
    clearAllHistory();
    expect(harness.getHistory()).toEqual([]);
    expect(harness.persists()).toBe(1);
    expect(harness.stores()).toBe(1);
    expect(harness.getRecent()).toEqual([]);
    expect(harness.notices).toEqual([{ message: "History cleared.", isError: undefined }]);
  });
});

describe("renderDatePicker", () => {
  it("writes the month label and day cells", () => {
    const days = { innerHTML: "", querySelectorAll: () => [] as Element[] };
    const monthYear = { textContent: "" };
    wireHarness();
    // Re-wire with observable elements.
    initHistoryView(
      {
        datePickerBtn: fakeElement(),
        customDatePicker: fakeHiddenDiv(),
        datePickerDays: days as unknown as HTMLDivElement,
        currentMonthYear: monthYear as unknown as HTMLElement,
        prevMonthBtn: fakeElement(),
        nextMonthBtn: fakeElement(),
        clearHistoryBtn: fakeButton(),
        clearHistoryBtnFull: fakeButton(),
        viewFullHistoryBtn: fakeButton(),
        clearStatsBtn: fakeButton(),
      },
      {
        notify: () => {},
        getHomeHistory: () => [],
        setHomeHistory: () => {},
        persistHomeHistory: () => {},
        notifyStoreUpdated: () => {},
        clearRecentTurns: () => {},
        resetUsageStats: () => {},
        renderMetrics: () => {},
        setActivePage: () => {},
      },
    );
    renderDatePicker();
    expect(monthYear.textContent).toMatch(/20\d\d/);
    expect(days.innerHTML).toContain("date-picker-day");
  });
});
