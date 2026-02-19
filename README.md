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
- Floating dock with live recording state
- Pipeline status view with STT/AI/TTS latency
- Text-to-speech playback with Piper and Coqui profiles
- Coqui voice cloning and preview tools
- Tray behavior:
  - close-to-tray
  - startup-to-tray (when launch at login is enabled)
  - tray actions for opening dashboard and copying last transcript/response
- Foreground game input blocking to avoid accidental activation while gaming

## Tech Stack

- Tauri (Rust backend)
- Vite + TypeScript (frontend)

## Requirements

- Node.js + npm
- Rust + Cargo
- Tauri prerequisites for your OS

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
2. Enter your provider API key, API base URL, STT model, and AI model.
3. Open **Settings > TTS** and complete runtime setup.
4. Open **Settings > General** and confirm microphone + hotkeys.
5. Start dictating.

## Release Workflow

This repo includes a GitHub Actions workflow that creates a Windows `.exe` release when you push a version tag like:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow validates that the tag version matches `src-tauri/tauri.conf.json` before publishing.
Release notes are generated automatically from commits between the previous tag and the new tag, grouped by type (features, fixes, CI, etc.), and attached to the release body.

Updater source defaults:

- Repository owner: `SlasshyOverhere`
- Repository name: `SlasshyWispr`

Optional environment overrides for packaged/dev app runtime:

- `SLASSHY_UPDATE_REPOSITORY_OWNER`
- `SLASSHY_UPDATE_REPOSITORY_NAME`
- `SLASSHY_UPDATE_GITHUB_TOKEN` (required if releases are private)
