# SlasshyWispr

Desktop voice dictation. Tauri v2 (Rust) + React 19 + Vite 8 + Tailwind CSS 4.

## Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Vite dev server only |
| `npm run build` | `prebuild` gate, then `tsc && vite build` (typecheck then bundle) |
| `npm run tauri:dev` | Full Tauri dev — runs `pretauri:dev`, then `tauri dev --config src-tauri/tauri.conf.dev.json`. Uses identifier `online.slasshy.slasshywispr.dev` and window title "SlasshyWispr Dev", so it runs independently of the installed production build. |
| `npm run tauri:build` | Production build (NSIS installer on Windows), using the default `tauri.conf.json`. |
| `npm run test` | `bun test` (NOT vitest/jest) |
| `npm run preview` | `vite preview` |

Single test: `bun test src/utils.test.ts` — works on any `src/**/*.test.ts` file.

Single-instance enforcement (per spec `2026-07-07-tray-window-toggle-and-single-instance-design`): `tauri_plugin_single_instance` is registered unconditionally (was previously release-only). A second `app.exe` run brings the existing window to front; `--start-in-tray` on the second run is accepted as a no-op. Dev and prod identifiers differ (`online.slasshy.slasshywispr.dev` vs `online.slasshy.slasshywispr`), so the two builds never collide on the same machine. Note the dev config does not disable the single-instance lock — the two are separated by identifier, not by gating.

## Architecture

- **Composition roots are thin.** `src/main.tsx` and `src-tauri/src/lib.rs` are wiring layers, not feature owners. Keep them that way — see `DECOMPOSITION_GOAL.md`, the persistent spec for the in-flight decomposition effort.
- **Frontend:** feature domains live under `src/` — `state/`, `ipc/`, `settings/`, `recording/`, `pipeline/`, `stt/`, `tts/`, `updater/`, `windows/`, `shell/`, `hotkeys/`, `analytics/`, `collections/`, `history/`, `app/`. React is used for `App.tsx` (shell/layout) and the settings panes under `src/components/settings/`; the rest is imperative DOM wiring.
- **IPC:** `src/ipc/commands.ts` owns the command-name strings; `src/ipc/client.ts` owns typed invocation. Call sites use these, never raw `invoke()` with a string literal.
- **Rust backend:** `src-tauri/src/lib.rs` only wires modules, plugins, the tray, window events, and `generate_handler!`. Domains live in `commands/` (one module per domain), `services/`, `platform/`, `state/`, `pipeline/` (stt, tts, ai, routing, refinement, wake, selection, orchestration, daemon, stt_download), `audio/` (processing, VAD, parakeet, noise suppression), `updater/`, and `security.rs`.
- **Python bridge:** `src-tauri/local_stt_bridge.py` is compiled into the binary via `include_str!` (see `constants.rs`). It is driven as a subprocess over JSONL `--daemon` mode, never imported. Do not decompose it.
- **Coqui:** `coqui_bridge.py` is *not* in the repo and is not embedded — only `local_stt_bridge.py` is. Coqui code paths exist (`pipeline/tts/coqui.rs`, `pipeline/daemon/coqui.rs`) and resolve their script at runtime.

## Tooling quirks

- Test runner is **Bun** (`bun test`); tests use `bun:test`.
- `verbatimModuleSyntax: true` — type-only imports must use `import type`.
- `src/**/*.test.ts` is excluded from type checking.
- Path alias `@/` maps to `./src/*`.
- `pretauri:dev` (`scripts/ensure-valid-dev-exe.mjs`) deletes corrupted Windows dev binaries (`app.exe`/`app.pdb`) before `tauri dev`.
- `prebuild` (`scripts/check-backend-bounds-fallbacks.mjs`) fails the build if any TS bounds fallback (`stt-timeout-bounds.ts`, `max-tokens-bounds.ts`) stops being superseded by the backend answer over IPC — the one thing that stops those constants becoming a second source of truth. Static, because the backend's bounds currently equal the fallbacks and no value comparison could tell them apart.
- Tauri v2 dev URL `http://localhost:1421` is hardcoded in `vite.config.ts`.
- Window is non-resizable, non-maximizable, non-minimizable, with a custom titlebar (`decorations: false`).

## CI / Release

- **`release-windows.yml`** — triggered by `v*.*.*` tags. Validates the version matches across `tauri.conf.json` and `Cargo.toml` before building, and generates release notes from conventional commit messages. Only Windows NSIS builds are supported.
- **`rust-tests.yml`** — `cargo check` + `cargo test` on Windows, plus a production CSP gate and a debug-redaction gate. Only triggers on `src-tauri/**` changes.
- **`frontend-tests.yml`** — `bun test` + `tsc --noEmit`, plus the STT timeout fallback gate. The TS suite runs nowhere else. Also triggers on `src-tauri/**` because contract tests under `src/` read Rust sources.

## Code comments

- Comment only where the code genuinely can't explain itself. Few and short.
- TLDR style: one line, straight to the point. No long prose, no restating what the code already says, no per-function banners.
- Never write a comment that just narrates the next line.

## Commits

- Commit each fix or feature on its own, immediately after it's done — one commit per issue, not one big commit at the end. If five issues are found and fixed, that's five commits.
- Conventional commits, matching what `release-windows.yml` parses for release notes: `fix(scope): short description`, `feat(scope): short description`.
- Subject and body both stay short and concise. No long explanations.
- **No git attributions.** Never add `Co-Authored-By`, `Generated with ...`, or any other trailer or attribution line to a commit message.
- **Commit, never push.** Pushing is off-limits at any cost unless the user explicitly asks for it.

## Notable conventions

- `src/security.test.ts` and `src/utils-enhanced.test.ts` test inline helper functions rather than production imports — they are standalone validation tests.
- Settings persist to `localStorage` under keys like `slasshywispr-settings-v4` (see `src/constants.ts`).
- The Rust backend stores API keys in the OS keyring (`keyring` crate), with a DPAPI fallback on Windows.
- `noUnusedLocals` and `noUnusedParameters` are enforced by tsconfig.
