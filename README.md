# SlasshyWispr (Tauri)

A desktop voice assistant pipeline:

`STT (Whisper) -> AI (Llama) -> TTS (Piper or Coqui)`

## Stack

- Desktop framework: Tauri + Vite + TypeScript
- STT endpoint: `https://ai.slasshy.online/v1/audio/transcriptions`
  - model: `whisper-large-v3-turbo`
- AI endpoint: `https://ai.slasshy.online/v1/chat/completions`
  - model: `llama-3.1-8b-instant`
- TTS engines:
  - Piper (`en_US-hfc_female-medium`)
  - Coqui TTS (configurable model, voice cloning, quality/speed/emotion controls)

## What is implemented

- Microphone capture from the desktop app (start/stop recording).
- Rust backend command pipeline for performance:
  - reuses a shared HTTP client
  - sends recorded audio to STT
  - sends transcript to LLM
  - synthesizes response with Piper
- In-app runtime setup:
  - one-click download + extraction of Piper (`piper_windows_amd64.zip`) from GitHub releases
  - one-click download of ONNX + JSON voice files from Hugging Face
  - stores runtime under app data directory
  - auto-detects installed `piper.exe`
- Additional in-app controls:
  - API key input
  - microphone selection (for multi-mic setups)
  - configurable push-to-talk hotkey
  - optional Piper path override
  - dedicated TTS settings pane with engine switcher
  - profile-based TTS UI (separate Piper and Coqui profiles)
  - single bootstrap setup button when runtime is incomplete
  - live setup status + logs while downloading/installing runtimes
  - Coqui runtime setup/validation
  - Coqui model catalog refresh and manual model selection
  - Coqui voice cloning from uploaded reference sample (up to 10 seconds)
  - Coqui quality/speed/emotion tuning
  - Piper validation button
  - voice-only download button
  - system prompt, temperature, max tokens
  - latency stats (STT/AI/TTS/total)
  - transcript + response + turn history
  - playback of generated WAV

## Prerequisites

- Node.js + npm
- Rust + Cargo
- Tauri prerequisites for your OS

## Install

```bash
npm install
```

## Run (dev)

```bash
npm run tauri:dev
```

## Build

```bash
npm run tauri:build
```

## First-run usage

1. Open the app.
2. Paste your API key into `API Key`.
3. Click `Auto Setup Runtime` (downloads Piper + voice model from inside the app).
4. Optionally click `Validate Piper`.
5. Choose your microphone and hotkey in Configuration.
6. Click `Start Recording` (or press the hotkey), speak, then stop.

## Notes

- API base URL and models are hardcoded to your requested values in `src-tauri/src/lib.rs`.
- API key is provided manually in UI. If "Remember API key" is unchecked, it is not persisted in local storage.
- TTS is generated as WAV and played in-app.
- Auto Piper download in this build is implemented for Windows (`piper_windows_amd64.zip`).
