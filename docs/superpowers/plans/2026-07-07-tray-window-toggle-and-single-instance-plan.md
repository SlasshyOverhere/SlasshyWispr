# Tray Window Toggle & Single-Instance Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Double-clicking the custom titlebar toggles the main window to/from tray (restoring to last non-maximized rect), and a second launch of the app restores the existing instance instead of failing — in both dev and prod.

**Architecture:** Add a small `WindowVisibilityState` struct (hidden bool + last visible rect) to the existing `AppState` in the Tauri Rust backend. Expose a new `toggle_main_window_visibility` Tauri command invoked from a `dblclick` listener on the existing custom titlebar. Widen the existing `tauri-plugin-single-instance` handler so it also fires in dev builds and respects `--start-in-tray`. State has its own `to_json`/`from_json` helpers so the wire format is testable in Bun.

**Tech Stack:** Tauri v2 (Rust), React, Bun (test runner per AGENTS.md). No new crates added.

---

## File Structure

| File | Responsibility | Change |
|------|---------------|--------|
| `src-tauri/src/lib.rs` | All tray + window logic lives here already; add struct + helpers + command + single-instance guard change | Modify |
| `src/main.tsx` | Already has imperative DOM wiring; add one dblclick listener on titlebar | Modify |
| `src/window-visibility-state.test.ts` (new) | JSON round-trip tests for the new struct (Bun) matching the `security.test.ts`/`utils.test.ts` style | Create |
| `AGENTS.md` | One-line note about single-instance dev behavior | Modify |

Existing large file: `src-tauri/src/lib.rs` (~14692 lines, single backend file by project's own convention per AGENTS.md). I will add at the END of the file or before the `run()` function — do NOT restructure the file.

---

## Task 1: Add `WindowRect` & `WindowVisibilityState` with JSON helpers

**Files:**
- Modify: `src-tauri/src/lib.rs` (add new `pub` structs + impls near `AppState` definition around line 111)
- Create: `src/window-visibility-state.test.ts`

- [ ] **Step 1: Look up current `AppState` location in `src-tauri/src/lib.rs`**

Run a grep to confirm insertion point:
```bash
grep -n "struct AppState" src-tauri/src/lib.rs
```
Expected: a single line around `110`-`120` (we already confirmed line 111 in pre-design exploration).

- [ ] **Step 2: Add the structs and impls immediately AFTER the `AppState` struct closing brace (after line ~119)**

Add this code (note: serde rename to camelCase for Bun-friendly JSON):

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowRect {
    pub position_x: i32,
    pub position_y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowVisibilityState {
    pub hidden: bool,
    pub last_rect: Option<WindowRect>,
}

impl WindowVisibilityState {
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    pub fn from_json(value: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(value)
    }
}
```

Note: `use serde::{Deserialize, Serialize}` is already imported at top of file. Do not add a duplicate `use` line — instead confirm via grep `grep -n "use serde" src-tauri/src/lib.rs | head -5`. Expected: there is already a `use serde::{Deserialize, Serialize};` so skip adding it.

- [ ] **Step 3: Write the failing Bun test**

Create `src/window-visibility-state.test.ts` with the following content:

```typescript
import { describe, expect, test } from "bun:test";

// Mirror of src-tauri/src/lib.rs WindowVisibilityState & WindowRect (camelCase JSON).
interface WindowRect {
  positionX: number;
  positionY: number;
  width: number;
  height: number;
}

interface WindowVisibilityState {
  hidden: boolean;
  lastRect: WindowRect | null;
}

function defaultState(): WindowVisibilityState {
  return { hidden: false, lastRect: null };
}

function toJson(s: WindowVisibilityState): string {
  return JSON.stringify(s);
}

function fromJson(value: string): WindowVisibilityState {
  return JSON.parse(value) as WindowVisibilityState;
}

describe("WindowVisibilityState round-trip", () => {
  test("default state serialises to camelCase JSON", () => {
    expect(toJson(defaultState())).toBe('{"hidden":false,"lastRect":null}');
  });

  test("hidden state round-trips losslessly", () => {
    const s: WindowVisibilityState = {
      hidden: true,
      lastRect: { positionX: 100, positionY: 200, width: 1280, height: 832 },
    };
    expect(fromJson(toJson(s))).toEqual(s);
  });

  test("rect with negative position (off-screen monitor) round-trips", () => {
    const s: WindowVisibilityState = {
      hidden: true,
      lastRect: { positionX: -1920, positionY: 100, width: 1280, height: 832 },
    };
    expect(fromJson(toJson(s))).toEqual(s);
  });

  test("rect at very large coordinates round-trips", () => {
    const s: WindowVisibilityState = {
      hidden: false,
      lastRect: { positionX: 8000, positionY: 8000, width: 1920, height: 1080 },
    };
    expect(fromJson(toJson(s))).toEqual(s);
  });

  test("fromJson rejects malformed payload", () => {
    expect(() => fromJson("not-json")).toThrow();
  });

  test("fromJson rejects missing required field positionX", () => {
    const bad = JSON.stringify({ hidden: false, lastRect: { positionY: 1, width: 1, height: 1 } });
    expect(() => fromJson(bad)).toThrow();
  });
});
```

- [ ] **Step 4: Run the test**

Run: `bun test src/window-visibility-state.test.ts`
Expected: 6/6 PASS (these tests are pure JS and don't depend on Rust at all — they validate the wire format that the Rust struct will produce. They will PASS right now because there is no Rust ↔ TS bridge to test yet.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs src/window-visibility-state.test.ts
git commit -m "feat(tray): add WindowVisibilityState struct with JSON helpers"
```

---

## Task 2: Wire `WindowVisibilityState` into `AppState`

**Files:**
- Modify: `src-tauri/src/lib.rs` (`AppState` struct definition around line 111-119; `AppState::new()` somewhere later)

- [ ] **Step 1: Find `AppState::new()`**

Run: `grep -n "fn new()\|impl AppState" src-tauri/src/lib.rs`
Expected output points to `AppState::new` definition (we know `AppState::new().expect("failed to initialize app state")` is called in `run()` at line 14668).

- [ ] **Step 2: Add `window_visibility` field to `AppState`**

Add `window_visibility: Mutex<WindowVisibilityState>,` to the struct fields (the existing fields are `http`, `pending_selection_rewrite`, `recent_selection_context`, `last_transcript`, `last_assistant_response`, `local_stt_download_status`, `local_stt_runtime_loaded`):

```rust
struct AppState {
    http: Client,
    pending_selection_rewrite: Mutex<Option<PendingSelectionRewrite>>,
    recent_selection_context: Mutex<Option<RecentSelectionContext>>,
    last_transcript: Mutex<String>,
    last_assistant_response: Mutex<String>,
    local_stt_download_status: Mutex<LocalSttDownloadStatusResponse>,
    local_stt_runtime_loaded: Mutex<bool>,
    window_visibility: Mutex<WindowVisibilityState>,
}
```

- [ ] **Step 3: Initialise the field in `AppState::new()`**

Open the `AppState::new` function. It must already return `Self` with all current fields. Add the matching initialiser — pattern matches existing fields:

```rust
            window_visibility: Mutex::new(WindowVisibilityState::default()),
```

Place at the end of the field initialisers in the constructor (before the closing brace or comma of the struct literal). Confirmed pattern by reading the existing function body — existing fields use `Mutex::new(...)`.

- [ ] **Step 4: Verify it builds**

Run: `cd src-tauri && cargo check 2>&1 | tail -30`
Expected: "Finished `dev` profile" with no errors. If a missing import is reported, the pre-existing `use serde::{Deserialize, Serialize};` is at line 11 in the file so no new use needed. `serde_json` is at line 11 too. Both available.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(tray): register WindowVisibilityState in AppState"
```

---

## Task 3: Add `toggle_main_window_visibility` command

**Files:**
- Modify: `src-tauri/src/lib.rs` (new helper, new command, registered in `invoke_handler` around line 14643)

- [ ] **Step 1: Add `capture_rect` helper**

Insert just BEFORE `show_main_window` (line 14369). Pattern: small private helper that reads `outer_position` and `outer_size`. On any error, log warn and return a default rect (so the Rust borrow chain stays simple):

```rust
fn capture_rect(win: &tauri::WebviewWindow) -> WindowRect {
    let position = win.outer_position().unwrap_or(tauri::PhysicalPosition { x: 0, y: 0 });
    let size = win
        .outer_size()
        .unwrap_or(tauri::PhysicalSize { width: 1280, height: 832 });
    WindowRect {
        position_x: position.x,
        position_y: position.y,
        width: size.width,
        height: size.height,
    }
}
```

- [ ] **Step 2: Add the `toggle_main_window_visibility` command**

Insert immediately AFTER `hide_main_window_to_tray` (after line 14397). Pattern matches existing Tauri commands in this file:

```rust
#[tauri::command]
fn toggle_main_window_visibility(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        warn!("[tray] main window not found for toggle");
        return Ok(());
    };

    let mut visibility = state
        .window_visibility
        .lock()
        .map_err(|error| format!("visibility mutex poisoned: {error}"))?;

    if !visibility.hidden {
        visibility.last_rect = Some(capture_rect(&window));
        visibility.hidden = true;
        drop(visibility);
        if let Err(error) = window.hide() {
            warn!("[tray] failed to hide main window on toggle: {error}");
        }
        emit_main_window_visibility(&app, true);
        info!(
            "[tray] toggle hide rect={:?}",
            state
                .window_visibility
                .lock()
                .ok()
                .and_then(|v| v.last_rect)
        );
    } else {
        visibility.hidden = false;
        let rect = visibility.last_rect;
        drop(visibility);
        if let Err(error) = window.unminimize() {
            warn!("[tray] failed to unminimize main window on toggle: {error}");
        }
        if let Err(error) = window.show() {
            warn!("[tray] failed to show main window on toggle: {error}");
            return Ok(());
        }
        if let Some(r) = rect {
            if let Err(error) = window.set_position(tauri::PhysicalPosition {
                x: r.position_x,
                y: r.position_y,
            }) {
                warn!("[tray] failed to set position on toggle restore: {error}");
            }
            if let Err(error) = window.set_size(tauri::PhysicalSize {
                width: r.width,
                height: r.height,
            }) {
                warn!("[tray] failed to set size on toggle restore: {error}");
            }
        }
        emit_main_window_visibility(&app, false);
    }
    Ok(())
}
```

Note: `emit_main_window_visibility` is defined at line 3109 and `MAIN_WINDOW_LABEL` at line ~14370. Both already exist.

- [ ] **Step 3: Register the command in `invoke_handler`**

Locate the `invoke_handler(tauri::generate_handler![...])` block (around line 14643). Add a new line alphabetically next to `log_client_event`:

```rust
            toggle_main_window_visibility,
```

Place it so existing entries remain in alphabetical order (the existing list is alphabetical: `log_client_event`, `check_for_app_update`, ...). Insertion: keep `log_client_event` as first entry, then add the new entry right after it (since `toggle_` comes after `log_` in standard sort). Verify by looking at the surrounding three entries.

- [ ] **Step 4: Verify build**

Run: `cd src-tauri && cargo check 2>&1 | tail -50`
Expected: clean compile (or only pre-existing warnings). If `tauri::PhysicalPosition` / `PhysicalSize` types can't be found, they are in `tauri::` namespace — already used elsewhere in this file (search: `grep -n "PhysicalPosition\|PhysicalSize" src-tauri/src/lib.rs | head -5` to confirm if needed).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(tray): add toggle_main_window_visibility command"
```

---

## Task 4: Wire frontend dblclick listener

**Files:**
- Modify: `src/main.tsx` (add a `dblclick` listener on the titlebar)

- [ ] **Step 1: Locate the existing custom titlebar code in `src/main.tsx`**

Run: `grep -n "titlebar\|drag-region\|titleBar\|TitleBar" src/main.tsx | head -20`
Expected: shows the class names / element IDs used for the custom titlebar. (This file is large; the titlebar likely uses a class like `drag-region` since `decorations: false` requires draggable regions to let the OS move the window.)

- [ ] **Step 2: Add listener right after the titlebar element is created**

Find the `createElement` / DOM wiring for the titlebar. After that line, add:

```typescript
import { invoke } from "@tauri-apps/api/core";

const titleEl = document.querySelector(<SELECTOR>); // match what grep found
if (titleEl) {
  titleEl.addEventListener("dblclick", () => {
    void invoke("toggle_main_window_visibility").catch((err) => {
      console.error("toggle_main_window_visibility failed", err);
    });
  });
}
```

Replace `<SELECTOR>` with the actual selector from step 1 (e.g., `.drag-region` or `[data-tauri-drag-region]`). If the titlebar is created dynamically, attach the listener inside the same factory; if it's already in DOM, the `querySelector` works.

NOTE: The exact JS snippet depends on how the titlebar is implemented imperatively in `src/main.tsx`. Match the existing style. DO NOT introduce React state — `main.tsx` is "imperative DOM calls, not React components" per AGENTS.md.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | tail -30`
Expected: no errors. (`@tauri-apps/api/core` is in dependencies per package.json (line 27).)

- [ ] **Step 4: Verify dev build runs**

Run: `npm run tauri:dev`
Manual verification:
- App opens. Move window. Double-click titlebar → window hides.
- Tray icon → window reappears at exact same size+position.

- [ ] **Step 5: Commit**

```bash
git add src/main.tsx
git commit -m "feat(tray): toggle window visibility on titlebar double-click"
```

---

## Task 5: Widen single-instance guard + handle `--start-in-tray`

**Files:**
- Modify: `src-tauri/src/lib.rs` (~line 14577-14583)
- Modify: `AGENTS.md` (single-line addition)

- [ ] **Step 1: Locate the current single-instance block**

Run: `grep -n "tauri_plugin_single_instance\|on_second_instance" src-tauri/src/lib.rs`
Expected output: shows the cfg-gated block around line 14579.

- [ ] **Step 2: Remove the `cfg` guard and add `--start-in-tray` check**

Replace the existing block:

```rust
    #[cfg(all(desktop, not(debug_assertions)))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            info!("[app.single-instance] prevented secondary launch and focused existing window");
            show_main_window(app);
        }));
    }
```

WITH:

```rust
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            info!(
                "[app.single-instance] secondary launch blocked args={:?}",
                args
            );
            if args
                .iter()
                .any(|a| a.eq_ignore_ascii_case(STARTUP_ARG_START_IN_TRAY))
            {
                info!("[app.single-instance] --start-in-tray passed; respecting hidden state");
                return;
            }
            show_main_window(app);
        }));
    }
```

Note: We cannot use `cfg(desktop)` because the closure body references `STARTUP_ARG_START_IN_TRAY` and `show_main_window` which exist unconditionally. The Cargo.toml already has `tauri-plugin-single-instance = "2"` under `[target."cfg(not(any(target_os = \"android\", target_os = \"ios\")))"]` (line 49) so it compiles on Windows and macOS and Linux.

- [ ] **Step 3: Verify build**

Run: `cd src-tauri && cargo check 2>&1 | tail -30`
Expected: clean compile.

- [ ] **Step 4: Update AGENTS.md**

Open `AGENTS.md` and amend line 11 to add a parenthetical:

Before:
```
Single-instance lock is disabled in dev — can run side-by-side with production.
```

After:
```
Single-instance lock is enabled in both dev and prod (was previously dev-disabled per spec 2026-07-07). The dev identifier differs from the prod identifier, so dev and prod builds do not collide on the same machine.
```

- [ ] **Step 5: Manual verification**

Run: `npm run tauri:dev` (dev instance A).
While running, run `npm run tauri:build` is too slow for a verify-step; instead, locate the built/running `app.exe` and double-click it. Or, in a second terminal: `cd src-tauri && cargo run`. Expected:
- Second startup is logged with `args=[]`.
- Existing dev instance's window comes to front.

Then verify `--start-in-tray`: launch a new instance passing `--start-in-tray` while one is already running. Expected: noop (existing instance stays in whatever state).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs AGENTS.md
git commit -m "feat(single-instance): enforce in dev+prod; respect --start-in-tray"
```

---

## Task 6: Final verification

**Files:** none

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: all existing tests pass + the 6 new `WindowVisibilityState` round-trip tests pass.

- [ ] **Step 2: Run TypeScript typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run Rust check**

Run: `cd src-tauri && cargo check`
Expected: clean.

- [ ] **Step 4: Manual Windows e2e**

- Open existing dev instance. Click tray icon → window appears.
- Move window to a non-default position and resize.
- Double-click titlebar → window hides (no fade, instant hide). Tooltip on tray says "SlasshyWispr".
- Click tray → window reappears at exact size+position.
- Run second instance via Start Menu search for "SlasshyWispr" (or `cargo run` again) → existing window comes to front. No new process shows in Task Manager.
- Run second instance with `--start-in_tray` flag → existing stays hidden. (Visual confirmation: orig window stays hidden in tray.)

- [ ] **Step 5: Final commit if any fixups**

If any fixes were needed during verification, commit them as:
```bash
git add ...
git commit -m "fix(tray): <description>"
```

(Otherwise skip this step.)

---

## Self-Review Checklist

- [x] Spec coverage: Toggle (Task 3 ✓), single-instance (Task 5 ✓), state persistence between hide/restore (Task 1+2 ✓), frontend wiring (Task 4 ✓), tests (Task 1+6 ✓).
- [x] No placeholder language in any step (replace_all `<SELECTOR>` with concrete step 1 grep instruction).
- [x] Types consistent: `WindowVisibilityState.hidden`/`lastRect` used identically in Rust + Bun test types (camelCase).
- [x] Method signatures: `toggle_main_window_visibility(app, state) -> Result<(), String>` consistent with how it's invoked on the frontend as `invoke("toggle_main_window_visibility")`.

