## 2026-02-18 - Audio Visualization Throttling
**Learning:** `requestAnimationFrame` runs at the monitor's refresh rate (e.g., 144Hz+), which can cause excessive CPU usage for audio visualization logic that only updates at a lower rate (e.g., 60Hz or less).
**Action:** Explicitly throttle visualization ticks (e.g., check `delta > 16ms`) inside the animation frame loop to decouple logic frequency from render frequency, especially for background/peripheral visualizers.
