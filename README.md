# SlasshyWispr

SlasshyWispr is a desktop voice dictation and AI assistant app.

Speak, transcribe, get AI responses, and hear replies back with built-in text-to-speech.

## What The App Does

- Voice dictation with hotkeys (push-to-talk or single-tap)
- Wake-name based assistant mode (for example: "Hey Lily ...")
- Transcript refinement controls:
  - backtrack corrections
  - filler word cleanup
  - auto punctuation
  - auto numbered lists
- Selected-text context — highlight text anywhere on screen before recording and the AI uses it as primary context
- Floating dock with live recording state
- Pipeline status view with STT/AI/TTS latency
- Text-to-speech playback with Piper and Coqui profiles
- Coqui voice cloning and preview tools
- Tray behavior:
  - close-to-tray
  - startup-to-tray (when launch at login is enabled)
  - tray actions for opening dashboard and copying last transcript/response
- Foreground game input blocking to avoid accidental activation while gaming
- Built-in auto-updater that checks GitHub releases on launch

## Providers

### Speech-to-Text (STT)

**Online** — any OpenAI-compatible transcription API (set base URL, API key, and model in Settings).

**Local** — models downloaded and run on-device:

| Model | Size | Engine |
|---|---|---|
| Parakeet v3 (`nvidia/parakeet-tdt-0.6b-v3`) | 478 MB | Native (no Python) |
| Parakeet v2 (`nvidia/parakeet-tdt_ctc-110m`) | 473 MB | Native (no Python) |

Parakeet models ship with INT8-quantised weights, run natively via ONNX Runtime, and require no Python install.

### AI / LLM

- **Online** — any OpenAI-compatible chat API (set base URL, API key, and model in Settings)
- **Local** — Ollama (the app can detect, install, and manage Ollama on Windows)

### Text-to-Speech (TTS)

- **Piper** — fast local TTS, downloaded and run automatically; default voice is `en_US-hfc_female-medium`
- **Coqui XTTS v2** — local neural TTS with voice cloning from a reference audio clip (requires Python runtime)

## Tech Stack

- Tauri 2 (Rust backend)
- Vite + TypeScript (frontend)
- `transcribe-rs` + ONNX Runtime for native Parakeet inference
- Piper binary for fast local TTS
- Coqui TTS (`xtts_v2`) via an embedded Python bridge

## Requirements

- Node.js + npm
- Rust + Cargo
- Tauri prerequisites for your OS
- Python 3 (required only for Coqui TTS; bootstrapped automatically at runtime)

## Run In Development

```bash
npm install
npm run tauri:dev
```

## Build

```bash
npm run tauri:build
```

## First-Time Setup

1. Open **Settings > System**.
2. Choose your STT mode:
   - **Online** — enter your provider API key, API base URL, and STT model.
   - **Local** — download a Parakeet model from the Models panel.
3. Choose your AI mode:
   - **Online** — enter your provider API key, API base URL, and AI model.
   - **Local** — install and start Ollama, then select a model.
4. Open **Settings > TTS** and complete runtime setup (downloads Piper binary and default voice model).
5. Open **Settings > General** and confirm microphone + hotkeys.
6. Start dictating.

## Environment Variables

The following environment variables tune runtime behavior of the packaged or dev app:

### Local STT

| Variable | Default | Description |
|---|---|---|
| `SLASSHY_STT_MODEL_UNLOAD_IDLE_TIMEOUT_SECS` | `90` | Seconds of inactivity before the in-process Parakeet model is unloaded from memory |
| `SLASSHY_STT_PARAKEET_UNLOAD_AFTER_TRANSCRIBE` | — | Set to `1` to unload the Parakeet model from memory after every transcription |
| `SLASSHY_STT_PARAKEET_CPU_INT8` | — | Set to `1` to force CPU INT8 execution for Parakeet (overrides GPU selection) |
| `SLASSHY_STT_PARAKEET_FORCE_CPU` | — | Set to `1` to force CPU execution for Parakeet regardless of available GPU |
| `SLASSHY_STT_ARCHIVE_PARALLEL_CHUNKS` | `4` | Number of parallel HTTP chunks used when downloading Parakeet model archives; values above 8 are clamped to 8 |
| `SLASSHY_ZERO_PYTHON_MODE` | — | Set to `1` to disable all Python-based features (disables Coqui TTS; Piper TTS will be used instead) |

### Auto-updater

| Variable | Default | Description |
|---|---|---|
| `SLASSHY_UPDATE_REPOSITORY_OWNER` | `SlasshyOverhere` | GitHub repository owner to check for updates |
| `SLASSHY_UPDATE_REPOSITORY_NAME` | `SlasshyWispr` | GitHub repository name to check for updates |
| `SLASSHY_UPDATE_GITHUB_TOKEN` | — | GitHub personal access token (required when releases are private) |

## Release Workflow

This repo includes a GitHub Actions workflow that creates a Windows `.exe` release when you push a version tag like:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow validates that the tag version matches both `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` before building. Release notes are generated automatically from GitHub commit/PR history and attached to the release body along with the installer and a SHA-256 checksum file.
