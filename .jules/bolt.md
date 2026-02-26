## 2026-02-18 - Audio Visualization Throttling
**Learning:** `requestAnimationFrame` runs at the monitor's refresh rate (e.g., 144Hz+), which can cause excessive CPU usage for audio visualization logic that only updates at a lower rate (e.g., 60Hz or less).
**Action:** Explicitly throttle visualization ticks (e.g., check `delta > 16ms`) inside the animation frame loop to decouple logic frequency from render frequency, especially for background/peripheral visualizers.

## 2026-02-19 - IPC Overhead in Visualization
**Learning:** High-frequency IPC messages (e.g., 60fps) for secondary UI elements like dock visualizers can cause excessive main-thread CPU usage.
**Action:** Reduce update frequency for non-critical visualizers to 30fps (33ms) or lower to balance smoothness with IPC overhead.
