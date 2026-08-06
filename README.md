# SlasshyWispr

SlasshyWispr is a desktop voice dictation and AI assistant app.

Speak naturally, get clean transcription, generate AI responses, and hear replies with built-in TTS.






[![SlasshyWispr screenshot](./assets/slasshywispr_screenshot.png?v=3)](./assets/slasshywispr_screenshot.png?v=3)


## Key Features

- Fast voice dictation with hotkeys (supports Push-to-Talk with customizable sounds)
- Wake phrase assistant mode (for example: "Hey Jarvis...")
- Online, Offline, or Hybrid model routing
- Local STT support (Parakeet models)
- Local AI support (Ollama models)
- Clipboard/paste-friendly dictation workflow
- TTS playback for assistant responses
- Live pipeline status with STT/AI/TTS timings
- Keyboard shortcuts for quick navigation
- Auto-updates with background checking
- High-DPI and multi-resolution support
- Usage dashboard with trend tracking

## Linux (CachyOS / Arch, GNOME Wayland)

Linux development mode is supported with:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri:dev
```

Install the runtime prerequisites without letting the app modify your system:

```bash
sudo pacman -S webkit2gtk-4.1 gtk3 libayatana-appindicator librsvg patchelf gcc-libs pkg-config libsecret wtype wl-clipboard
```

GNOME Wayland uses `wl-copy` for the clipboard and `wtype` for Ctrl+V injection. On X11, the app falls back to `arboard` for clipboard writes and `xdotool` for paste; install the latter when needed:

```bash
sudo pacman -S xdotool
```

For a GNOME global shortcut, open **Settings → Keyboard → Keyboard Shortcuts → Custom Shortcuts** and add:

- Command: `slasshywispr --toggle-dictation`

In development mode, use the full executable path if `slasshywispr` is not on `PATH`. GNOME starts a second process; the running instance receives the request through the single-instance channel and toggles the existing recording pipeline.

Linux API keys use GNOME Secret Service/libsecret through the system keyring. If the keyring is unavailable, settings persistence reports an actionable error rather than writing plaintext credentials.

## Download

Get the latest Windows installer from Releases:

- https://github.com/SlasshyOverhere/SlasshyWispr/releases/latest

## Quick Setup

1. Open **Settings > Models**.
2. Choose STT runtime mode (`Online` or `Offline`).
3. Choose AI runtime mode (`Online` or `Offline`).
4. If online is enabled, add your API Base URL, API key, and model names.
5. If offline STT is enabled, download/select a local STT model.
6. If offline AI is enabled, select/pull a local Ollama model.
7. Open **Settings > General** and confirm microphone + hotkey.

## Updates

- In-app: **Settings > Update and Security**
- Manual: download from the Releases page

## Support

- Issues: https://github.com/SlasshyOverhere/SlasshyWispr/issues
