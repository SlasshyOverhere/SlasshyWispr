/**
 * Sidebar collapse view — Phase 5 shell decomposition.
 *
 * Owns applySidebarCollapsed + syncSidebarHoverTitles. Moved verbatim from
 * main.tsx; the toggle button, labeled buttons, and collapsed persistence
 * arrive via initSidebar so this module never touches main.tsx globals.
 */

export interface SidebarElements {
  toggleButton: HTMLButtonElement;
  labeledButtons: HTMLElement[];
}

export interface SidebarDeps {
  readCollapsed: () => boolean;
  writeCollapsed: (collapsed: boolean) => void;
}

let sidebarElements!: SidebarElements;
let sidebarDeps!: SidebarDeps;

export function initSidebar(
  elements: SidebarElements,
  deps: SidebarDeps,
): void {
  sidebarElements = elements;
  sidebarDeps = deps;
  sidebarElements.toggleButton.addEventListener("click", () => {
    const collapsed = !document.body.classList.contains("sidebar-collapsed");
    applySidebarCollapsed(collapsed);
    sidebarDeps.writeCollapsed(collapsed);
  });
}

export function applyPersistedSidebarCollapsed(): void {
  applySidebarCollapsed(sidebarDeps.readCollapsed());
}

export function applySidebarCollapsed(collapsed: boolean): void {
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  sidebarElements.toggleButton.setAttribute("aria-pressed", collapsed ? "true" : "false");
  const sidebarActionLabel = collapsed ? "Expand tabs" : "Compact tabs";
  sidebarElements.toggleButton.setAttribute("aria-label", sidebarActionLabel);
  sidebarElements.toggleButton.dataset.label = sidebarActionLabel;
  syncSidebarHoverTitles(collapsed);
}

export function syncSidebarHoverTitles(_collapsed: boolean): void {
  for (const target of sidebarElements.labeledButtons) {
    const label = target.dataset.label?.trim();
    if (!label) {
      continue;
    }

    const hotkey = target.dataset.hotkey?.trim();
    // ponytail: keyhints hidden via CSS; hotkey lives in tooltip in both states.
    target.setAttribute("title", hotkey ? `${label} (${hotkey})` : label);
  }
}
