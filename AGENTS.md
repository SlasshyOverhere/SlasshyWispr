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
| `bun scripts/stt-bench-record.mjs` | Local mic recorder: saves each clip and its reference transcript into `bench/manifest.json`. |
| `bun scripts/stt-bench.mjs --manifest bench/manifest.json` | Scores every clip against every model in the manifest (WER + warm/cold latency), prints a table, and diffs `bench/baseline.json` — exits 1 on a regression. Add `--results <jsonl>` to re-score without re-running. |

Single test: `bun test src/utils.test.ts` — works on any `src/**/*.test.ts` file.

Single-instance enforcement (per spec `2026-07-07-tray-window-toggle-and-single-instance-design`): `tauri_plugin_single_instance` is registered unconditionally (was previously release-only). A second `app.exe` run brings the existing window to front; `--start-in-tray` on the second run is accepted as a no-op. Dev and prod identifiers differ (`online.slasshy.slasshywispr.dev` vs `online.slasshy.slasshywispr`), so the two builds never collide on the same machine. Note the dev config does not disable the single-instance lock — the two are separated by identifier, not by gating.

## Architecture

- **Composition roots are thin.** `src/main.tsx` and `src-tauri/src/lib.rs` are wiring layers, not feature owners. Keep them that way — see `DECOMPOSITION_GOAL.md`, the persistent spec for the in-flight decomposition effort.
- **Frontend:** feature domains live under `src/` — `state/`, `ipc/`, `settings/`, `recording/`, `pipeline/`, `stt/`, `tts/`, `updater/`, `windows/`, `shell/`, `hotkeys/`, `analytics/`, `collections/`, `history/`, `app/`. React is used for `App.tsx` (shell/layout) and the settings panes under `src/components/settings/`; the rest is imperative DOM wiring.
- **IPC:** `src/ipc/commands.ts` owns the command-name strings; `src/ipc/client.ts` owns typed invocation. Call sites use these, never raw `invoke()` with a string literal. Neither the names nor the payload fields are maintained twice: command names are checked against the Rust sources by `src/ipc/command-contract.test.ts`, and payload shapes are generated from the Rust structs into `src/generated/ipc-wire-types.ts` (re-exported from `src/types.ts`), so a payload field is declared once, in Rust.
- **Rust backend:** `src-tauri/src/lib.rs` only wires modules, plugins, the tray, window events, and `generate_handler!`. Domains live in `commands/` (one module per domain), `services/`, `platform/`, `state/`, `pipeline/` (stt, tts, ai, routing, refinement, wake, selection, orchestration, daemon, stt_download), `audio/` (processing, VAD, parakeet, whisper, moonshine, sense_voice, `in_process` shared engine cache, model_layout discovery, noise suppression), `updater/`, and `security.rs`.
- **Python bridge:** `src-tauri/local_stt_bridge.py` is compiled into the binary via `include_str!` (see `constants.rs`). It is driven as a subprocess over JSONL `--daemon` mode, never imported. Do not decompose it.
- **Coqui:** `coqui_bridge.py` is *not* in the repo and is not embedded — only `local_stt_bridge.py` is. Coqui code paths exist (`pipeline/tts/coqui.rs`, `pipeline/daemon/coqui.rs`) and resolve their script at runtime.

## Tooling quirks

- Test runner is **Bun** (`bun test`); tests use `bun:test`.
- `verbatimModuleSyntax: true` — type-only imports must use `import type`.
- `src/**/*.test.ts` is excluded from type checking.
- Path alias `@/` maps to `./src/*`.
- `pretauri:dev` (`scripts/ensure-valid-dev-exe.mjs`) deletes corrupted Windows dev binaries (`app.exe`/`app.pdb`) before `tauri dev`.
- `prebuild` runs two gates: `scripts/check-backend-bounds-fallbacks.mjs` fails the build if any TS bounds fallback (`stt-timeout-bounds.ts`, `max-tokens-bounds.ts`, `temperature-bounds.ts`) stops being superseded by the backend answer over IPC (static, because the backend's bounds currently equal the fallbacks and no value comparison could tell them apart), and `scripts/generate-wire-types.mjs --check` fails if `src/generated/ipc-wire-types.ts` is not current with the Rust structs. `npm run generate:wire-types` regenerates that file.
- Native Whisper (`transcribe-cpp` → whisper.cpp) is a **Windows x86_64 only** dependency, and it needs the LunarG Vulkan SDK plus `cmake` on `PATH`. `build.rs` adds `$VULKAN_SDK/Lib` to the link search path because the SDK installer sets `VULKAN_SDK` but never `LIB`, which otherwise leaves `vulkan-1.lib` unresolvable at link time.
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
- The STT benchmark (`--stt-bench <manifest>`) drives `transcribe_audio_local`, the same call a dictation makes, so its numbers are the app's rather than a parallel implementation. It writes JSONL to `--stt-bench-out` instead of stdout because release builds are Windows GUI-subsystem binaries with no console. `bun scripts/stt-bench.mjs` is the driver, and it must run under **bun** — it imports the TypeScript scorer so WER has one implementation. The scorer normalizes case, punctuation, whitespace and 0–99 number formatting (so `3:30` equals `three thirty`); larger numbers, years and ordinals are left alone and will score as errors.
- Settings persist to `localStorage` under keys like `slasshywispr-settings-v4` (see `src/constants.ts`).
- The Rust backend stores API keys in the OS keyring (`keyring` crate), with a DPAPI fallback on Windows.
- Local STT models are downloaded as prepacked int8 tar.gz mirrors from the `SlasshyOverhere/parakeet-int8-mirror` release, not from HuggingFace: the native engine needs an istupakov-layout directory (`encoder-model.int8.onnx`, `decoder_joint-model.int8.onnx`, `nemo128.onnx`, `vocab.txt`, `config.json`), and no public export ships that. `scripts/repack-parakeet-unified-en.mjs --from <dir>` builds one; `src/stt/parakeet-archive-contract.test.ts` pins the packed file set against the Rust discovery function.
- Local Whisper downloads a single GGUF from the `handy-computer/whisper-*-gguf` mirrors (`Q5_K_M`), not a HuggingFace directory, because whisper.cpp reads one self-contained file. `Systran/faster-whisper-*` directories survive only as the pre-GGUF location and as the Python bridge fallback.
- `built_in_local_stt_model_catalog()` is the entire UI-facing model list and is **Parakeet-only**, so Whisper, Moonshine and SenseVoice paths are reachable only when a persisted `sttModel` names them — and `download_local_stt_model` rejects any id outside the catalog.
- `noUnusedLocals` and `noUnusedParameters` are enforced by tsconfig.
