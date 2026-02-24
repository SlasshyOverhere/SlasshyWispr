## 2026-02-18 - Audio Visualization Throttling
**Learning:** `requestAnimationFrame` runs at the monitor's refresh rate (e.g., 144Hz+), which can cause excessive CPU usage for audio visualization logic that only updates at a lower rate (e.g., 60Hz or less).
**Action:** Explicitly throttle visualization ticks (e.g., check `delta > 16ms`) inside the animation frame loop to decouple logic frequency from render frequency, especially for background/peripheral visualizers.

## 2026-02-18 - Audio PCM Conversion Optimization
**Learning:** The synchronous `audioBufferToWavBlob` function runs on the main thread and can block UI during large file processing (e.g., 45s of stereo audio ~4.3M samples).
**Action:** Replaced `Math.round` and conditional branching with symmetric scaling (`0x7FFF`) and implicit truncation. For future optimizations, consider moving this heavy conversion to a Web Worker or passing raw floats to the Rust backend to avoid main-thread blocking entirely.
