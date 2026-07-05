## 2025-02-18 — Inset Focus Rings
Learning: External focus outlines (`outline-offset: 2px`) are often visually clipped by parent containers with `overflow: hidden` (common in modals, dialogs, and scrollable panels), rendering them invisible to keyboard users.
Action: Use an inset focus outline (`outline-offset: -2px`) globally or specifically for elements inside restricted containers to guarantee keyboard focus indicators remain visible.
