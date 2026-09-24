# SlasshyWispr Decomposition Goal

This document is the persistent goal/specification for the SlasshyWispr decomposition effort. A coding agent should be able to read this file alone, without the original audit or blueprint, and understand what problem is being solved, what the desired architecture is, what order to work in, what must never be violated, and how to know the work is complete.

Source of truth: the SlasshyWispr Decomposition Blueprint (audit → plan). This file is the executable summary of that blueprint.

---

## 1. Core Objective

Decompose SlasshyWispr's oversized and overloaded modules into coherent, maintainable modules while preserving existing behavior.

This is NOT a rewrite.

> Reduce the two giant application shells into thin composition/wiring layers while establishing clear ownership boundaries for state, IPC, settings, recording, pipeline, TTS, daemons, platform integration, and UI.

The existing healthy domain modules must remain intact.

---

## 2. Current Problem

Two primary god files exist on opposite sides of the IPC boundary:

- `src/main.tsx` — ~10,140 LOC. Imperative DOM shell (`requiredElement` + `addEventListener`) that owns settings load/persist/apply (`loadSettings`, `persistSettings`, `readSettingsFromForm`, `applySettingsToForm`, `handleSettingsChange`), hotkeys/PTT, recording/audio capture (`startRecording`, `stopRecording`, `finalizeRecording`), pipeline client (`runPipeline`, `renderPipelineResponse`), STT model management (~50 functions), TTS setup, Ollama/providers, updater, windows/tray/media, selection popups, dock/voice-indicator, history/dictionary/snippets/notes/analytics. React `App` is mounted at the end but `main.tsx` remains authoritative for state. ~40 raw `invoke()` sites plus an `invokeWithTimeout` wrapper.
- `src-tauri/src/lib.rs` — ~9,704 LOC, 52 `#[tauri::command]`s. Glob-imports every pipeline/audio module, which hides the real structure. Fat bodies include `run_assistant_pipeline` (~700 lines: Piper auto-repair, STT dispatch, hallucination/noise reject, wake-word, selection-context TTL sync, orchestrator call, AI call + fallbacks, TTS synth), `download_and_install_app_update` (~400 lines), `download_local_stt_model` (~360 lines), `clone_coqui_voice` (~150 lines), `start_tts_runtime_setup` (~155 lines), `check_for_app_update` (~160 lines). No test invokes a command directly; ~75 tests cover only pure helpers.

Secondary targets:

- `src/App.tsx` — ~1,521 LOC. Six `flow-page` sections (home, history, dictionary, snippets, notes, analytics) plus row components (`HomeEntryCard`, `HistoryRow`, `DictionaryRow`, `SnippetRow`, `NoteRow`), hooks, and filtering. Only 2 raw `invoke()` calls; otherwise reads `localStorage` + `slasshywispr:store-updated` events.
- `src-tauri/src/pipeline/tts.rs` — ~1,095 LOC. Mixes pure Piper normalization (spacing, digits→words, math symbols), provisioning/validation (network + FS), synthesis (subprocess + bridge worker), voice management folded into provisioning, and 11 `AppHandle`-threaded path getters used only for `app_data_dir()`. Contains a dead stub (`ensure_coqui_bridge_script` always errors).
- `src-tauri/src/pipeline/daemon.rs` — ~948 LOC. ~150 lines of spawn/send/restart transport duplicated verbatim between the Coqui path (stay-alive, no sweeper) and the local-STT path (two-tier idle reaper: 90s trim → 15min kill, background sweeper, stats). Zero Tauri imports; takes plain paths. Correct boundary, duplicated mechanics.

Cross-cutting duplication (verified with file:line evidence in the blueprint):

- `parseJson<T>`+ storage keys duplicated across `store.ts`, `AnalyticsPage.tsx`, 10+ inline sites in `main.tsx`, and `App.tsx`.
- History loader identical in `store.ts` and `main.tsx`; settings key read fully once plus two partial readers; dictionary/snippets/notes loaders doubled; usage + analytics-session backfill verbatim doubled; `ACHIEVEMENT_DEFS` (9 rows) exact duplicate with a real divergence (unlock ignores `prev*` totals, display uses them).
- `inferLocalSttProviderFromModel` defined once in `main.tsx`, knowledge repeated as literals elsewhere.
- TTS path knowledge scattered across types, pane element IDs, and ~15 imperative sites in `main.tsx`.
- STT language/noise rules mirrored in Rust (`pipeline/stt.rs`) and Python (`local_stt_bridge.py`) with drifted thresholds.
- `AppState` selection slots mirror `pipeline::orchestration::PipelineState`; `take_pending_selection_rewrite` has no non-test caller.
- Hand-rolled `base64_encode` in `lib.rs` while the `base64` crate is already imported.

`src-tauri/local_stt_bridge.py` (~855 LOC) must NOT currently be decomposed. It is a subprocess, never imported, driven via JSONL `--daemon` mode by `daemon.rs`, with its path embedded via `constants.rs`. Splitting it buys nothing and risks protocol drift. Allowed change: a pinned parity test for the noise-rule thresholds. Nothing else.

The problem is not merely file size. The actual problem is excessive responsibility, coupling, duplicated ownership, raw IPC boundaries, and business logic living inside application shells.

---

## 3. Target Architecture

Conceptual target, not a requirement to blindly reproduce every filename. Derive final boundaries from actual code.

### Frontend

```text
src/
  main.tsx                    # bootstrap/composition root (~200 LOC target)
  state/
    storage.ts                # parseJson, key re-exports, read/write helpers
    history.ts                # loadHistory + filter predicate (canonical)
    dictionary.ts / snippets.ts / notes.ts
    usage.ts                  # usage + analytics sessions + backfill (canonical)
    achievements.ts           # ACHIEVEMENT_DEFS + check/unlock + progress (canonical)
    settings-store.ts         # settings load/persist/coerce
  ipc/
    client.ts                 # invokeWithTimeout + per-domain typed wrappers
    commands.ts               # command-name constants + type re-exports
  settings/
    settings-service.ts       # readSettingsFromForm/applySettingsToForm/validation/diff
    panes/                    # existing 4 panes made controlled, one pane per PR
  recording/
    recording-controller.ts   # start/stop/finalize/save-audio, mic, ticker, amplitude
    audio-utils.ts            # WAV builders, mime pick, base64, decode helpers
  pipeline/
    pipeline-client.ts        # runPipeline request build + invoke + side effects
    pipeline-render.ts        # renderPipelineResponse + appendConversationEntry
  stt/
    local-stt-client.ts       # all local-STT model/download/warmup/overlay fns
    provider-inference.ts     # inferLocalSttProviderFromModel + preferredOrder
  tts/
    tts-client.ts             # setup/validate/ensure/poll fns
  updater/
    updater-client.ts         # check/install/progress/snooze
  hotkeys/
    hotkey-service.ts         # normalize/parse/match/format + capture + sync
  windows/
    dock.ts / voice-indicator.ts / selection-popup.ts / foreground.ts / media.ts
  analytics/
    analytics-service.ts      # trackUsage, updateUsageMetrics, trend
  app/
    pages/ / rows/ / hooks/   # mechanical App.tsx splits only
  utils/                      # existing utils + json helper
```

State ownership is explicit. IPC has a typed client boundary. React components do not own unrelated orchestration. `main.tsx` ends as bootstrap/composition/wiring.

### Rust

```text
src-tauri/src/
  lib.rs                      # run(), AppState construction, generate_handler! only
  commands/
    updater.rs / settings.rs / recordings.rs / input.rs / providers.rs /
    ollama.rs / local_stt.rs / tts.rs / pipeline.rs / windows.rs
  services/
    updater_service.rs        # check + download/install bodies
    stt_download_service.rs   # download task (or reuse pipeline/stt_download/)
    tts_setup_service.rs      # staged setup task + clone_voice body
    pipeline_service.rs       # piper repair + selection-TTL sync
  state/
    app_state.rs              # AppState + TTL accessors moved verbatim
  platform/
    windows/
      input.rs / registry.rs / audio.rs / foreground.rs
  pipeline/
    tts/
      normalize.rs            # pure normalization fns
      paths.rs                # dir joins, takes &Path root, no AppHandle
      piper.rs                # validate/provision/synthesize Piper
      coqui.rs                # payload/synth/voices via daemon transport
    daemon/
      mod.rs / transport.rs / coqui.rs / local_stt.rs
```

`lib.rs` ends as Tauri setup + `AppState` wiring + command registration. Commands become thin adapters. Business logic lives in services/domain/pipeline modules. Windows-specific code lives behind the platform boundary.

---

## 4. Architectural Principles

### 4.1 No rewrite

Preserve existing behavior. Prefer `move → import swap → compile → test` before `rewrite → redesign → hope`.

### 4.2 One responsibility, one owner

Duplicates converge on a single canonical owner: storage loaders, achievement definitions, storage keys, JSON parsing, STT provider inference, TTS paths. No duplicate implementations survive.

Exception: storage keys remain canonically owned by `src/constants.ts`. Do not create a second ownership layer by moving constants around; re-export them.

### 4.3 Preserve healthy modules

Do NOT split modules merely because they are large. Preserve unless actual evidence appears:

- `recording-state-machine.ts` (+ tests)
- `pipeline/orchestration.rs` (+ tests)
- `pipeline/stt_download/*` (treat as the decomposition pattern to follow)
- `audio/*` (including native Parakeet runtime)
- `security.rs`
- `updater/mod.rs`
- `pipeline/routing.rs`, `stt.rs`, `selection.rs`, `process.rs`, `fs.rs`, `log.rs`

### 4.4 Do not optimize for file count

No dozens of tiny modules. A module represents a meaningful responsibility or architectural boundary.

### 4.5 Do not genericize for aesthetics

Similar-looking code does not automatically belong behind a generic abstraction. Do NOT create a generic daemon supervisor: Coqui (stay-alive, latency-sensitive) and local-STT (two-tier VRAM reaper) have irreconcilably different lifecycle policies. Share transport primitives (`daemon/transport.rs`); keep lifecycle policy separate.

### 4.6 Preserve IPC wire compatibility

Never casually change command names, serde shapes, argument names, response shapes, or camelCase/snake_case contracts. Typed wrappers initially emit exactly the same commands and arguments as the raw `invoke()` calls they replace.

### 4.7 Preserve AppState initially

Move `AppState` structurally into `state/app_state.rs` before redesigning it. Do not split fields for size. Ownership improves later once command/service boundaries exist.

---

## 5. Refactoring Order

### Phase 0 — Boundary tests

Pin behavior before high-risk moves: persistence loader equivalence, IPC request shapes, pipeline-client request construction, recording-state-machine oracles (already exist), Rust/Python STT noise-rule parity. No architectural changes.

### Phase 1 — Safe ownership cleanup

Lowest-risk duplication first: storage helpers, achievement definitions, duplicated loaders, JSON helpers, dead `base64_encode` deletion, small pure-helper extraction. Goal: duplicate implementations → single canonical owner → all consumers use owner. Do NOT touch recording, AppState, daemons, or IPC architecture here.

### Phase 2 — Typed IPC

Create `src/ipc/client.ts` + `src/ipc/commands.ts` (move `invokeWithTimeout` verbatim). Wrap incrementally starting with updater, settings, recordings, then domain-by-domain. No wire changes.

### Phase 3 — React decomposition

Decompose `App.tsx` mechanically: pages, row components, hooks, home components, analytics presentation. No behavior change. `App.tsx` becomes page composition. Do not extract the dblclick visibility toggle or hidden runtime nodes (shell concerns).

### Phase 4 — Settings ownership

Target: React owns settings UI state and behavior, with a dedicated store/service and typed IPC. Extract the service behind existing IDs first, then convert pane-by-pane (General → Models → Pipeline → UpdateSecurity). Per pane: convert → delete its imperative refs → delete its listeners → verify persistence → verify reload → run tests. Never leave a permanently half-controlled architecture.

### Phase 5 — Frontend shell decomposition

Decompose `main.tsx` into audio utilities, recording controller, pipeline client/render, STT/TTS/updater clients, hotkeys, windows, selection/dock/indicator, diagnostics. The chain `startRecording → stopRecording → finalizeRecording → runPipeline → renderPipelineResponse` shares `pipelineRunning`, `stage`, fresh settings reads, `lastSavedRecordingId`, and command-mode state: treat it as one cohesive execution unit, extracted together, not broken apart for line count. End state: `main.tsx` is bootstrap/composition/wiring. Requires settings-service landed first.

### Phase 6 — Backend command extraction

Move commands verbatim into `commands/*.rs` + `platform/windows/*` + `state/app_state.rs` (fields NOT split). Fix the `validate_coqui` command-to-command call with a shared helper in its PR. Keep `generate_handler!` registration untouched until adapters land. Mechanical moves only; no business-logic redesign in the same PR.

### Phase 7 — Backend service/pipeline decomposition

Thin `run_assistant_pipeline` to an adapter over `orchestration.rs` + `pipeline_service` (Piper repair + selection-TTL sync moved out). Split `tts.rs` into `normalize/paths/piper/coqui`; resolve `app_data_dir()` once at call sites so pipeline code takes `&Path` (removes the `AppHandle` leak; deletes the `Manager` import); delete the dead Coqui stub. Fix `ai.rs` `std::thread::sleep`-in-async to `tokio::time::sleep` in an isolated change.

### Phase 8 — Daemon transport

Extract `daemon/transport.rs` (spawn, JSONL send, read-line loop, noisy-output recovery, kill-restart-retry, key fn, stderr pump). Keep `daemon/coqui.rs` thin and `daemon/local_stt.rs` supervised as separate types. No generic supervisor. Python: parity test only, no split.

---

## 6. Risk Rules

- **Low risk:** pure function extraction, JSX movement, import swaps, duplicate deletion, helper extraction, test relocation.
- **Medium risk:** settings migration, TTS provisioning extraction, backend command movement, IPC wrapper migration.
- **High risk:** recording lifecycle, pipeline orchestration, AppState changes, daemon lifecycle, IPC contract changes, concurrent state/lock changes.

High-risk changes require tests before extraction. Never combine rename + behavior change + IPC change + state redesign in one PR.

---

## 7. Testing Requirements

Every decomposition must prove behavior is preserved. Run the appropriate existing tests after each extraction:

- `recording-state-machine.test.ts` (transition table + PTT guards — oracle for Phase 5)
- `store.test.ts` (`matchHistoryToRecordings`, `loadHistory`)
- `pipeline-config.test.ts` (settings shape, load cycle)
- `ipc-contract.test.ts` (8 camelCase shapes, no `snake_case` leakage) + Rust mirror tests
- `pipeline/orchestration/tests.rs` + Rust `resolve_pipeline_mode` matrix
- Rust TTS normalize, transcript-noise, hardware-tier, foreground-policy tests
- `src-tauri/tests/integration_tests.rs`

Do not chase coverage percentages. Add focused regression tests at move boundaries instead: loader-equivalence test (Phase 0), pipeline request-shape test (Phase 0/5), wrapper round-trip test asserting identical command strings + args (Phase 2), per-pane input tests (Phase 4), daemon transport + Python parity tests (Phase 8).

---

## 8. Definition of Done

### Frontend

- `main.tsx` is primarily bootstrap/composition/wiring.
- Application domains no longer live in one giant imperative module.
- Settings ownership is explicit (one architecture, no hybrid).
- Raw `invoke()` calls are replaced by typed clients.
- Storage has canonical ownership (`constants.ts` owns keys).
- `App.tsx` is primarily composition.
- Recording behavior remains governed by the existing state machine.

### Backend

- `lib.rs` is primarily Tauri setup/state/command registration.
- Command handlers are thin adapters.
- Business logic is outside command adapters (services/domain/pipeline).
- Windows implementation is isolated behind platform modules.
- TTS has coherent engine/runtime boundaries with no `AppHandle` leak.
- Daemon transport is shared while lifecycle policies remain independent.
- `AppState` ownership is explicit.

### General

- No meaningful duplicated ownership remains.
- Healthy modules were not split unnecessarily.
- IPC wire compatibility is preserved.
- Existing functionality is intact; tests are green.
- No unnecessary dependencies were introduced.
- No giant rewrite PR exists; changes are small, independent, reviewable PRs.

---

## 9. Implementation Discipline

1. Inspect the current source before changing anything.
2. Identify the smallest applicable phase and work only within it.
3. Prefer mechanical extraction.
4. Do not mix extraction with unrelated feature work.
5. Keep commits/PRs small (`refactor(<scope>): <mechanical move>`).
6. Run tests after each meaningful move.
7. Stop if the planned boundary does not match the actual source.
8. Update this goal document only if the architecture is intentionally changed.
9. Never optimize for LOC alone.

The goal is not "make the files smaller." The goal is "make responsibilities explicit, establish single ownership, reduce coupling, and turn the application shells into thin composition layers without changing behavior."

---

## 10. Current Starting Point

First implementation task: `refactor(state): canonicalize storage helpers and achievement defs`.

Low-risk, behavior-preserving: canonical storage helper ownership, canonical achievement definition ownership, duplicate removal, `constants.ts` kept as key owner, import/consumer updates, existing tests run, no unrelated architectural changes.

Do NOT begin with `main.tsx`. Do NOT begin with `lib.rs`. Those are later phases.

---

## 11. Non-Goals

This effort will NOT: rewrite the application; replace Tauri, React, the STT architecture, or the AI pipeline; introduce a new state-management framework or DI everywhere; invent unnecessary abstractions; split every large file; split `local_stt_bridge.py` without concrete need; redesign the IPC protocol, the recording state machine, or the core pipeline decision architecture.

---

## 12. Success Criterion

A developer unfamiliar with the historical code can answer "Where does this responsibility live?" without searching a 10,000-line frontend file or a 10,000-line Rust file.
