/**
 * Pane-facing updater facade — Phase 4 per-pane conversion.
 *
 * UpdateSecurity pane reads the auto-check flag from here and sends
 * changes back through APP_UPDATE_AUTO_CHECK_CHANGED_EVENT, which
 * main.tsx owns (persist + reschedule + notice). Same seam shape as
 * the settings patch event: React owns the input, shell owns effects.
 */
export { readAppUpdateAutoCheckEnabled } from "./updater-client";

export const APP_UPDATE_AUTO_CHECK_CHANGED_EVENT = "slasshywispr:update-auto-check-changed";

export function requestAppUpdateAutoCheckChange(enabled: boolean): void {
  window.dispatchEvent(
    new CustomEvent(APP_UPDATE_AUTO_CHECK_CHANGED_EVENT, { detail: enabled }),
  );
}
