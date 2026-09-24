# SlasshyWispr

> [!NOTE]
> **Development is temporarily paused.** The project is on hold while the author focuses on other work. The app remains usable as-is, and existing Issues and Releases are still available, but new development may be slow or sporadic for now.
>
> Piper-only TTS. Windows-only releases. Offline models download on demand.

SlasshyWispr is a Windows desktop voice dictation app.

Speak naturally, get clean transcription, generate AI responses, and hear replies with built-in Piper TTS.

![Windows only](https://img.shields.io/badge/platform-Windows%20only-blue)
[![SlasshyWispr screenshot](./assets/slasshywispr_screenshot.png?v=4)](./assets/slasshywispr_screenshot.png?v=4)

## Key Features

- Fast voice dictation with hotkeys (supports Push-to-Talk with customizable sounds)
- Wake phrase assistant mode (for example: "Hey Jarvis...")
- Online, Offline, or Hybrid model routing
- Local STT support (Parakeet models)
- Local AI support (Ollama models)
- Clipboard/paste-friendly dictation workflow
- Piper TTS playback for assistant responses (only engine; Coqui is disabled)
- Live pipeline status with STT/AI/TTS timings
- Keyboard shortcuts for quick navigation
- Auto-updates with background checking
- High-DPI and multi-resolution support
- Usage dashboard with trend tracking

## Download

Windows only. Get the latest Windows installer from Releases:

- https://github.com/SlasshyOverhere/SlasshyWispr/releases/latest

## Offline models

| Model | Size | Notes |
| --- | --- | --- |
| Parakeet v3 (`nvidia/parakeet-tdt-0.6b-v3`) | 478 MB | Default offline STT model |
| Parakeet v2 (`nvidia/parakeet-tdt_ctc-110m`) | 473 MB | Smaller/faster fallback |

Downloads happen on demand when you click download in Settings, over your current connection (metered connections will use data). Models are cached locally after the first download. SHA256 verification runs when hash constants are configured.

Note: Coqui TTS is disabled in this build. Piper is the only TTS engine.

## Hotkeys and modes

| Action | Default | Notes |
| --- | --- | --- |
| Dictate (push-to-talk) | Ctrl+Space | Hold to record, release to transcribe |
| Assistant command | Ctrl+Shift+Space | Assistant mode when addressed directly |
| Capture mode | Push-to-talk | Single-tap also available in Settings |

## Quick Setup

1. Open **Settings > Models**.
2. Choose STT runtime mode (`Online` or `Offline`).
3. Choose AI runtime mode (`Online` or `Offline`).
4. If online is enabled, add your API Base URL, API key, and model names.
5. If offline STT is enabled, download/select a local STT model (478 MB for v3, 473 MB for v2).
6. If offline AI is enabled, select/pull a local Ollama model.
7. Open **Settings > General** and confirm microphone + hotkey.

## Updates

- In-app: **Settings > Update and Security**
- Manual: download from the Releases page

## Development

Windows only. The toolchain is Node, Rust (MSVC), the VS 2022 Build Tools, the LunarG Vulkan SDK, and CMake.

```sh
npm install
npm run setup      # verify the toolchain, install CMake if it is missing
npm run tauri:dev
```

`npm run setup` reports what it found for every requirement, then offers to install CMake (pinned to a verified version) when it is missing. A non-interactive run prints the command instead of prompting, so it never hangs.

Windows only hands a process its `PATH` when it launches and never re-reads it, so a terminal opened before CMake was installed keeps failing with `is cmake not installed?` no matter how many times you retry. `npm run tauri:dev` and `npm run tauri:build` run through `scripts/with-toolchain.mjs`, which reconciles against the registry first. No terminal restart is needed.

## Support

- Issues: https://github.com/SlasshyOverhere/SlasshyWispr/issues
