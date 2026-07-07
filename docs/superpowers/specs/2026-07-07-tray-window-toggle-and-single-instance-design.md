# Spec: Tray window toggle (taskbar double-click) and single-instance restore-on-second-launch

**Date**: 2026-07-07
**Status**: Draft (pending user spec review)

## Goal

Make the SlasshyWispr tray app behave like a normal Windows desktop app for two specific user flows:

1. **Taskbar double-click toggles the main window.**
   When the application is visible, double-clicking the app's titlebar (which is our custom titlebar because `decorations: false`) hides the window to the tray. Double-clicking again restores the window to its **previous (non-maximized) size and position**, not to a maximized state.

2. **Single-instance restore-on-second-launch works in both dev and prod.**
   When the user double-clicks the app's `.exe` (or runs it again from Start Menu / search) while an instance is already running, the existing instance is brought to the front and its window is shown — never silently failing, never spawning a duplicate.

## Non-Goals

- Maximize / minimize via the OS titlebar (window config: `maximizable: false, minimizable: false, decorations: false`).
- Tray icon double-click behavior (unchanged: left-click shows, right-click opens menu).
- Auto-snapshot of rect on every OS-driven minimize.
- Cleaning up the duplicate `tauri-plugin-window-state` registration (separate ticket).
- Animation / fade on show / hide.
- Per-monitor DPI re-scaling on restore.

## Architecture Overview

Two narrow, isolated changes to the existing Tauri Rust backend plus one frontend line. Not using `tauri-plugin-window-state`'s `save_window_state()` / `restore_state()` — we manage the rect ourselves so behavior is testable and decoupled from the OS chrome.

### Single boolean: `WindowVisibilityState`

Tracks only what we need:

```
pub struct WindowVisibilityState {
    pub hidden: bool,
    pub last_rect: Option<WindowRect>, // last non-maximized rect while visible
}

pub struct WindowRect {
    pub position_x: i32,  // physical pixels
    pub position_y: i32,
    pub width: u32,
    pub height: u32,
}
```

Lives in `AppState` as a new `Mutex<WindowVisibilityState>`, alongside existing fields.

### Components

**Rust** (in `src-tauri/src/lib.rs`):

- `WindowVisibilityState` + `WindowRect` plus their `to_json()` / `from_json()` helpers. The JSON layer is `#[serde(rename_all = "camelCase")]` so default state is `{"hidden":false,"lastRect":null}` — matchable in Bun tests.
- `capture_rect(win) -> WindowRect` — reads `win.outer_position()` (returns `PhysicalPosition<i32>`) and `win.outer_size()` (returns `PhysicalSize<u32>`).
- `is_hidden_state(state) -> bool` — wrapper used by other call sites.
- `#[tauri::command] toggle_main_window_visibility(app, state)` — main toggle path described below.
- Updated single-instance handler (no `cfg` guard, `--start-in-tray` aware).

**Frontend** (in `src/main.tsx`):

- One `dblclick` listener on the custom titlebar region invoking `toggle_main_window_visibility`. (Titlebar already exists per AGENTS.md.)

**Tests**:

- `src/window-visibility-state.test.ts` (Bun) — JSON round-trip tests for `WindowVisibilityState` + `WindowRect`.

## Data Flow

### Flow A — Toggle from titlebar dblclick

```
[User double-clicks custom titlebar]
   ↓
[src/main.tsx] invoke('toggle_main_window_visibility')
   ↓
[Rust command] reads state.window_visibility
   ↓
branch on s.hidden
   ↓ visible:
       rect = capture_rect(&window)
       s.last_rect = Some(rect)
       window.hide()
       s.hidden = true
       emit(APP_EVENT_MAIN_WINDOW_VISIBILITY, { hidden: true })
   ↓ hidden:
       window.unminimize()
       window.show()
       if let Some(rect) = s.last_rect.clone() {
           let _ = window.set_position(rect);    // best effort; warn on fail
           let _ = window.set_size(rect);        // best effort; warn on fail
       }
       s.hidden = false
       emit(APP_EVENT_MAIN_WINDOW_VISIBILITY, { hidden: false })
```

### Flow B — Second launch while running

```
[User double-clicks app.exe (or runs via Start Menu / search)]
   ↓
[OS spawns new process; OS-level mutex detects existing instance]
   ↓
[tauri-plugin-single-instance] callback fires in the *existing* process
   ↓
args check: any arg equals "--start-in-tray" (case-insensitive)?
   ↓ yes: noop (already in tray, user knows what they did)
   ↓ no:  show_main_window(app) — calls existing unminimize + show + set_focus
```

## Error Handling

| Failure | Behavior |
|---------|----------|
| `get_webview_window(MAIN_WINDOW_LABEL)` returns None | warn + return (matches existing pattern in `show_main_window` / `hide_main_window_to_tray`) |
| `outer_position()` / `outer_size()` returns Err | swallow + warn; on next hide the rect won't update, but app keeps working |
| `set_position` / `set_size` fails on restore (e.g., monitor unplugged) | warn; window still reappears at default size rather than silently failing |
| `Mutex<WindowVisibilityState>` poisoned | unwrap_or_else to default (matches existing unwrap convention in this file) |
| JSON deserialisation in tests | throw with descriptive message — Bun `expect().toThrow()` covers this |

## Testing Strategy

### `src/window-visibility-state.test.ts` (new, Bun)

For Rust struct + helpers only (no Tauri runtime needed):

- `WindowVisibilityState::default()` → `{"hidden":false,"lastRect":null}` in camelCase.
- After hidden cycle (write JSON `{hidden:true,lastRect:{positionX:100,positionY:200,width:1280,height:832}}`) → matches in-memory state.
- Three fixtures will round-trip:
  - normal rect `(100, 100, 1280, 832)`
  - off-screen-left `(-1920, 100, 1280, 832)`
  - very-large `(8000, 8000, 1920, 1080)`

### Manual Windows verification

- Build dev (`npm run tauri:dev`).
- Click tray left icon → window appears.
- Double-click titlebar → window hides (tray icon visible, no taskbar button).
- Tray left click → window reappears at 1280×832 default (first show, no snapshot).
- Move window to arbitrary position/size, double-click titlebar → hides.
- Tray left click → window restores to that exact position/size.
- With one instance running, double-click `.exe` → existing instance shows (no new process spawn).

## Files Touched

| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | Add `WindowRect`, `WindowVisibilityState`, `capture_rect`, `toggle_main_window_visibility` command; widen single-instance guard; register command in `invoke_handler` |
| `src/main.tsx` | Add `dblclick` listener on titlebar invoking `toggle_main_window_visibility` |
| `src/window-visibility-state.test.ts` | New — JVM-style JSON round-trip tests for the struct |
| `AGENTS.md` | One-line update noting single-instance now also active in dev |

## Compatibility / Risks

- **Existing `tauri-plugin-window-state` registered twice**: out of scope here, but the new `set_position` / `set_size` paths could theoretically conflict with later auto-restore. Documented separately. Spec does NOT touch this.
- **`--start-in-tray` re-launch**: if a user manually relaunches with `--start-in-tray` while running, noop is the right behavior — they intentionally want it to stay in tray.
- **`tauri-plugin-single-instance` activates in dev now**: per your decision, accepting that. The dev identifier in `tauri.conf.dev.json` is `online.slasshy.slasshywispr.dev` vs prod `online.slasshy.slasshywispr`, so dev and prod installs do NOT collide on Windows — safe to enable in dev.
- **Tauri v2 default: `focus` may steal focus unexpectedly**: existing `show_main_window` already calls `set_focus()`; no change.
