## 2026-07-03 — Prevent Focus Ring Clipping
Learning: Positive outline offsets can cause focus rings to be clipped in containers with `overflow: hidden` or at viewport edges.
Action: Apply an inset focus ring using `outline-offset: -2px;` alongside `outline: 2px solid <color>;` for `:focus-visible` states to ensure visibility.
