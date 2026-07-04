# SlasshyWispr — marketing site (digital twin)

Production website introducing the SlasshyWispr desktop app to prospective
users. The surface is intentionally a **digital twin** of the app: same
design tokens, same fonts, same accent logic. The marketing site reads like
an extension of the product, not adjacent to it.

## What's in here

```
site/
  SPEC.md                design brief locked in before any code
  README.md              this file
  index.html             single-page intro (all sections)
  styles/
    base.css             tokens, type, reset
    layout.css           page composition
    components.css       buttons, keycaps, ledger rows, mono chips
    showcase.css         the Remotion-style composition
  scripts/
    showcase.mjs         the timeline controller
  assets/
    slasshywispr_screenshot.png   the real captured screenshot of the app
    logo.png             the SlasshyWispr wordmark
    og-cover.png         social share image
    GeistMono-Variable.woff2     self-hosted mono
```

## How to view

The site is pure static. Three ways:

1. **Open directly** — `site/index.html` opens in any modern browser. All
   paths are relative, so it works as a `file://` page.
2. **Local server** — any static server. With Python:
   ```
   python -m http.server 8765
   ```
   Then open `http://127.0.0.1:8765/site/index.html`.
3. **Drop into a static host** — Netlify, Vercel, GitHub Pages, S3, nginx.
   Set `site/` as the publish directory.

## The "Remotion video as GIF" centerpiece

The site has a 9.4 s sequenced composition built as a Remotion-style
choreography, rendered live in the page using the actual app screenshot
inside a CSS-built facsimile of the same surface. Stages:

1. **0.0 s  idle**         no overlays
2. **1.2 s  hotkey**       alt+space chip fades in
3. **2.4 s  record**       scanline glow, brand dot turns amber
4. **3.6 s  wave**         24-bar waveform inside the dictation card
5. **4.8 s  transcript**   "Hello, we are back." types in
6. **6.0 s  assistant**    reply panel slides in with pipeline timings
7. **7.2 s  tts**          "PLAYING" chip animates on the assistant
8. **8.4 s  reset**        loops back to idle

The sequence auto-plays once when the composition enters the viewport. The
**REPLAY** button restarts it. Honors `prefers-reduced-motion`.

## Deploy notes

- Fraunces and Geist load from Google Fonts via CDN with `preconnect`.
- Geist Mono is self-hosted at `assets/GeistMono-Variable.woff2`.
- The OG share image lives at `assets/og-cover.png` (referenced from
  `index.html` as `assets/og-cover.png`).
- No build step. The deliverable is the `site/` directory as-is.

## Design system at a glance

Same tokens as the app:

- Surface: OKLCH-tinted near-black (`oklch(13% 0.012 250)`-ish)
- Ink: warm cream (`oklch(95% 0.012 80)`-ish)
- Accent: warm amber `oklch(74% 0.18 55)`, reserved for the live / hot /
  primary-CTA state
- Display: **Fraunces** (variable: opsz, wght, soft)
- Body: **Geist** (variable wght)
- Mono: **Geist Mono** (variable wght, self-hosted)
- Easing: `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out-quint)
- Spacing: 4 px base, eight-step scale

See `SPEC.md` for the full locked-in design brief.
