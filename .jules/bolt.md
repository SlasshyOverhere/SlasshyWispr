## 2026-02-18 - Audio Visualization Throttling
**Learning:** `requestAnimationFrame` runs at the monitor's refresh rate (e.g., 144Hz+), which can cause excessive CPU usage for audio visualization logic that only updates at a lower rate (e.g., 60Hz or less).
**Action:** Explicitly throttle visualization ticks (e.g., check `delta > 16ms`) inside the animation frame loop to decouple logic frequency from render frequency, especially for background/peripheral visualizers.

## 2026-02-18 - IPC Overhead in Visualization
**Learning:** Sending high-frequency updates via `BroadcastChannel` (e.g., 60fps) adds significant serialization and context-switching overhead.
**Action:** Throttle peripheral visualizers to ~30fps (33ms) to halve IPC traffic without noticeably degrading the user experience.

## 2026-03-02 - Object Allocation in Hot Paths (Keyboard Event Listeners)
**Learning:** Instantiating large mapping objects inside functions that are called frequently (like keydown event listeners) causes unnecessary memory allocation and garbage collection overhead on every keystroke.
**Action:** Extract static lookup maps (e.g., key aliases) to module-level constants to ensure they are created only once.
