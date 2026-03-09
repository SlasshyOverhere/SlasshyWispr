## 2026-02-18 - Audio Visualization Throttling
**Learning:** `requestAnimationFrame` runs at the monitor's refresh rate (e.g., 144Hz+), which can cause excessive CPU usage for audio visualization logic that only updates at a lower rate (e.g., 60Hz or less).
**Action:** Explicitly throttle visualization ticks (e.g., check `delta > 16ms`) inside the animation frame loop to decouple logic frequency from render frequency, especially for background/peripheral visualizers.

## 2026-02-18 - IPC Overhead in Visualization
**Learning:** Sending high-frequency updates via `BroadcastChannel` (e.g., 60fps) adds significant serialization and context-switching overhead.
**Action:** Throttle peripheral visualizers to ~30fps (33ms) to halve IPC traffic without noticeably degrading the user experience.

## 2026-03-03 - Hoisting Static Arrays and Maps
**Learning:** Functions that frequently run (e.g. keyboard event listeners, input validators) shouldn't recreate static arrays and maps on every execution, as this causes unnecessary memory allocation and garbage collection.
**Action:** Extract these literal arrays and objects out of the function scope and into module-level constants. Convert lookup arrays to `Set`s for O(1) lookups instead of O(n) `.includes()`.

## 2026-03-09 - Hoisting Intl.DateTimeFormat Objects
**Learning:** `new Intl.DateTimeFormat(...)` (or implicitly calling `.toLocaleString` / `.toLocaleTimeString` / `.toLocaleDateString` on dates) is computationally expensive because it instantiates a new formatter object every time.
**Action:** Extract formatters into module-level constants and use their `.format(timestamp)` methods when rendering large lists or items inside hot paths (e.g. `HomeHistoryEntry` logs, note times).
