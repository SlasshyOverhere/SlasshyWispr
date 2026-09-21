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
- **Rust backend:** `src-tauri/src/lib.rs` only wires modules, plugins, the tray, window events, and `generate_handler!`. Domains live in `commands/` (one module per domain), `services/`, `platform/`, `state/`, `pipeline/` (stt, tts, ai, routing, refinement, wake, selection, orchestration, stt_download), `audio/` (processing, VAD, parakeet, whisper, moonshine, sense_voice, `in_process` shared engine cache, model_layout discovery, noise suppression), `updater/`, and `security.rs`.
- **No Python for STT.** Every local model — Parakeet, Whisper, Moonshine, SenseVoice — runs in this process through `transcribe-rs` (ONNX) or `transcribe-cpp` (whisper.cpp). There is no bridge, no venv and no `python` lookup on that path. `audio/runtimes.rs` is the one place that knows every engine, and `audio::runtimes::ensure_idle_sweeper` releases a model that has gone idle.
- **There is no Python anywhere.** Both Python surfaces were deleted: the STT bridge, and the Coqui TTS voice-cloning bridge (which was dead code — its script was never bundled, so every call errored). Nothing resolves an interpreter, builds a venv, or pip-installs, and no flag gates it.
- **Voice cloning is native too.** It runs in this process through `sherpa-onnx` (ZipVoice-Distill int8, Apache-2.0), the way Whisper runs through `transcribe-cpp`. `pipeline/tts/zipvoice.rs` owns provisioning, the voice-profile store and the cached `OfflineTts`, reusing `audio::processing` for decode/encode rather than a second WAV path. It needs a reference clip **and its exact transcript**, so a profile stores both; enrolment reads a known sentence, which makes the transcript correct by construction. The model is ~156 MB and downloads on demand from the voice-clone panel, never from a dictation.
- **sherpa-onnx must be linked in shared mode**, not static: its Windows static archive is built `/MT` while Rust MSVC and our `ort` objects are `/MD`, so the static form fails with LNK2038/LNK1169. Shared linking moves ~21 MB of runtime into DLLs, and they are **import-table** dependencies — the loader resolves them before `main`, so a missing one is not a catchable error. `scripts/sherpa-runtime-closure.mjs` derives the required set from the built exe's import table (`onnxruntime.dll`, `sherpa-onnx-c-api.dll`; the C++ wrapper and the provider library are *not* reachable), `scripts/stage-sherpa-runtime.mjs` copies them into `src-tauri/sherpa-runtime/` as `bundle.beforeBundleCommand`, and `bundle.resources` maps that onto the install root (`"."`) so the loader finds them beside the exe. The resource entry names the directory (`sherpa-runtime`, tracked via `.gitkeep`) rather than globbing `*.dll`, because Tauri's build script errors on a glob that matches nothing — and that would break `cargo check`, `cargo test` and `tauri dev` on any tree where nothing is staged. `npm run tauri:build` then chains `scripts/verify-sherpa-bundle.mjs`, which fails unless the exe's imports, the staged files and the resources map all agree. `tauri dev` needs none of this: the `sherpa-onnx-sys` build script already copies the whole DLL set into the profile directory.

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
- Local STT models are downloaded as prepacked int8 tar.gz mirrors from the `SlasshyOverhere/parakeet-int8-mirror` release, not from HuggingFace: the native engine needs an istupakov-layout directory (`encoder-model.int8.onnx`, `decoder_joint-model.int8.onnx`, `nemo128.onnx`, `vocab.txt`, `config.json`), and no public export ships that. `scripts/repack-parakeet-unified-en.mjs --from <dir>` builds one; `src/stt/parakeet-archive-contract.test.ts` pins the packed file set against the Rust discovery function. Every catalog entry must name an asset the release actually holds — a configured-but-missing asset ships a model whose download can only 404, and no offline test can tell a real URL from a plausible one. `node scripts/verify-stt-mirrors.mjs` checks each catalog URL against the release's own asset manifest and ranges it; run it after adding a model. `nvidia/parakeet-unified-en-0.6b` is packed but unpublished, so it stays out of the catalog until its archive is uploaded.
- Local Whisper downloads a single GGUF from the `handy-computer/whisper-*-gguf` mirrors (`Q5_K_M`), not a HuggingFace directory, because whisper.cpp reads one self-contained file. `Systran/faster-whisper-*` directories survive only as the pre-GGUF location and as the Python bridge fallback.
- `built_in_local_stt_model_catalog()` is the entire UI-facing model list and is **Parakeet-only**, so Whisper, Moonshine and SenseVoice paths are reachable only when a persisted `sttModel` names them — and `download_local_stt_model` rejects any id outside the catalog.
- `noUnusedLocals` and `noUnusedParameters` are enforced by tsconfig.
