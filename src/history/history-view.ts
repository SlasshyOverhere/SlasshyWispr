/**
 * History view — Phase 5 shell decomposition.
 *
 * Owns renderDatePicker + clearAllHistory + the date-picker state and
 * the history clear/date/filter listener wiring. Moved verbatim from
 * main.tsx; shell seams (home-history list, recent turns, notice,
 * confirm, full-history dispatch) arrive via initHistoryView so this
 * module never touches main.tsx module globals.
 */
import { confirmDestructiveAction } from "../utils";
import { renderFullHistory } from "../state/persist";

export interface HistoryViewElements {
  datePickerBtn: HTMLElement;
  customDatePicker: HTMLDivElement;
  datePickerDays: HTMLDivElement;
  currentMonthYear: HTMLElement;
  prevMonthBtn: HTMLElement;
  nextMonthBtn: HTMLElement;
  clearHistoryBtn: HTMLButtonElement;
  clearHistoryBtnFull: HTMLButtonElement;
  viewFullHistoryBtn: HTMLButtonElement;
  clearStatsBtn: HTMLButtonElement;
}

export interface HistoryViewDeps {
  notify: (message: string, isError?: boolean) => void;
  getHomeHistory: () => unknown[];
  setHomeHistory: (entries: never[]) => void;
  persistHomeHistory: () => void;
  notifyStoreUpdated: () => void;
  clearRecentTurns: () => void;
  resetUsageStats: () => void;
  renderMetrics: () => void;
  setActivePage: (page: "history" | "analytics") => void;
}

let historyElements!: HistoryViewElements;
let historyDeps!: HistoryViewDeps;

let currentPickerDate = new Date();
let selectedDate: string | null = null;

export function initHistoryView(
  elements: HistoryViewElements,
  deps: HistoryViewDeps,
): void {
  historyElements = elements;
  historyDeps = deps;

  elements.clearHistoryBtn.addEventListener("click", async () => {
    if (await confirmDestructiveAction("Clear all transcription history from this device?")) {
      clearAllHistory();
    }
  });

  elements.clearHistoryBtnFull.addEventListener("click", async () => {
    if (await confirmDestructiveAction("Clear all transcription history from this device?")) {
      clearAllHistory();
    }
  });

  elements.viewFullHistoryBtn.addEventListener("click", () => {
    deps.setActivePage("history");
  });

  elements.clearStatsBtn.addEventListener("click", async () => {
    if (!await confirmDestructiveAction("Reset all usage statistics for this device?")) {
      return;
    }
    deps.resetUsageStats();
    deps.renderMetrics();
    deps.notifyStoreUpdated();
    deps.notify("Statistics have been reset.");
  });

  elements.datePickerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    elements.customDatePicker.hidden = !elements.customDatePicker.hidden;
    renderDatePicker();
  });

  document.addEventListener("click", (e) => {
    if (!elements.customDatePicker.contains(e.target as Node) && e.target !== elements.datePickerBtn) {
      elements.customDatePicker.hidden = true;
    }
  });

  elements.prevMonthBtn.addEventListener("click", () => {
    currentPickerDate = new Date(currentPickerDate.getFullYear(), currentPickerDate.getMonth() - 1, 1);
    renderDatePicker();
  });

  elements.nextMonthBtn.addEventListener("click", () => {
    currentPickerDate = new Date(currentPickerDate.getFullYear(), currentPickerDate.getMonth() + 1, 1);
    renderDatePicker();
  });

  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const filter = btn.getAttribute("data-filter") as "all" | "day" | "week" | "month";
      renderFullHistory(filter);
    });
  });
}

export function renderDatePicker(): void {
  const year = currentPickerDate.getFullYear();
  const month = currentPickerDate.getMonth();
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  historyElements.currentMonthYear.textContent = `${monthNames[month]} ${year}`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  let html = "";
  for (let i = 0; i < firstDay; i++) {
    html += '<div class="date-picker-day empty"></div>';
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const isSelected = selectedDate === dateStr;
    const isToday = dateStr === todayStr;
    const classes = ["date-picker-day"];
    if (isSelected) classes.push("selected");
    if (isToday) classes.push("today");
    html += `<div class="${classes.join(" ")}" data-date="${dateStr}">${day}</div>`;
  }
  historyElements.datePickerDays.innerHTML = html;

  historyElements.datePickerDays.querySelectorAll(".date-picker-day:not(.empty)").forEach(dayEl => {
    dayEl.addEventListener("click", () => {
      selectedDate = dayEl.getAttribute("data-date");
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      historyElements.datePickerBtn.classList.add("active");
      renderFullHistory("all", selectedDate!);
      historyElements.customDatePicker.hidden = true;
      renderDatePicker();
    });
  });
}

export function clearAllHistory(): void {
  historyDeps.setHomeHistory([]);
  historyDeps.persistHomeHistory();
  // Notify React to re-render with cleared history.
  historyDeps.notifyStoreUpdated();
  historyDeps.clearRecentTurns();
  historyDeps.notify("History cleared.");
}
