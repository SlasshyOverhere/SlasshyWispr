# SlasshyWispr

Desktop voice dictation & AI assistant. Tauri v2 (Rust) + React 19 + Vite 8 + Tailwind CSS 4.

## Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Vite dev server only |
| `npm run build` | `tsc && vite build` (typecheck then bundle) |
| `npm run tauri:dev` | Full Tauri dev — runs `pretauri:dev` first, then `tauri dev --config src-tauri/tauri.conf.dev.json`. Uses separate identifier `online.slasshy.slasshywispr.dev` and window title "SlasshyWispr Dev" so it runs independently from the installed production build. Single-instance lock is disabled in dev — can run side-by-side with production. |
| `npm run tauri:build` | Production build (NSIS installer on Windows). Uses default `tauri.conf.json`. |
| `npm run test` | `bun test` (NOT vitest/jest) |
| `npm run preview` | `vite preview` |

Single test: `bun test src/utils.test.ts` — works on any `src/**/*.test.ts` file.

## Architecture

- **Entrypoint:** `src/main.tsx` — mounts `<App />` via `flushSync`, then does heavy imperative DOM wiring. NOT a pure React app; many components live in `main.tsx` as imperative DOM calls, not React components. React is used only for `App.tsx` (shell/layout) and the settings panes under `src/components/settings/`.
- **Rust backend:** `src-tauri/src/lib.rs` — single-file backend with all Tauri commands, daemon management (Coqui, local STT), audio processing, and update logic.
- **Python bridge scripts** (`coqui_bridge.py`, `local_stt_bridge.py`) compiled into the Rust binary via `include_str!` — not shipped as separate files.

## Tooling quirks

- Test runner is **Bun** (`bun test`). Tests use `bun:test`, not `vitest` or `jest`.
- tsconfig has `verbatimModuleSyntax: true` — must use `import type` for type-only imports.
- tsconfig excludes `src/**/*.test.ts` from type checking.
- Path alias `@/` maps to `./src/*`.
- `ZERO_PYTHON_MODE = true` in `src/constants.ts` — Coqui TTS is disabled by default; only Piper TTS works at runtime.
- `pretauri:dev` script (`scripts/ensure-valid-dev-exe.mjs`) checks for corrupted Windows dev binaries and deletes stale `app.exe`/`app.pdb` before `tauri dev`.
- Tauri v2 dev URL: `http://localhost:1421` (hardcoded in `vite.config.ts`).
- Window is non-resizable, non-maximizable, non-minimizable with custom titlebar (`decorations: false`).

## CI / Release

- **`release-windows.yml`** — triggered by `v*.*.*` tags. Validates version matches across `tauri.conf.json` and `Cargo.toml` before building. Generates release notes from conventional commit messages. Only Windows NSIS builds are supported.

## Notable conventions

- Security tests in `src/security.test.ts` and `src/utils-enhanced.test.ts` test inline helper functions, not imports from production code — these are standalone validation tests.
- Settings are persisted to `localStorage` under keys like `slasshy-desktop-assistant-settings-v4` (see `src/constants.ts`).
- Rust backend stores API keys in the OS keyring (`keyring` crate) with DPAPI fallback on Windows.
- `noUnusedLocals` and `noUnusedParameters` are enforced by tsconfig.
