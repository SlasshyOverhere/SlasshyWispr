/* =====================================================================
 * SlasshyWispr — marketing site
 * showcase.mjs   drives the Remotion-style sequenced composition
 *
 * Sequence (≈ 9.4s total, then loops after a brief pause):
 *   0.0s  IDLE         dim baseline, no overlays
 *   1.2s  HOTKEY       alt+space chip fades in
 *   2.4s  RECORD       scanline glows, brand dot turns amber
 *   3.6s  WAVE         waveform bars animate
 *   4.8s  TRANSCRIPT   "Hello, we are back." types in letter by letter
 *   6.0s  ASSISTANT    side panel slides up with reply
 *   7.2s  TTS          playback pill pulses
 *   8.4s  IDLE         hold briefly, then loop
 * ===================================================================== */

const STAGES = [
  { id: "idle",       start: 0,    hold: 1200 },
  { id: "hotkey",     start: 1200, hold: 1200 },
  { id: "record",     start: 2400, hold: 1200 },
  { id: "wave",       start: 3600, hold: 1200 },
  { id: "transcript", start: 4800, hold: 1200 },
  { id: "assistant",  start: 6000, hold: 1200 },
  { id: "tts",        start: 7200, hold: 1200 },
  { id: "idle",       start: 8400, hold: 1000 }, // loop settle
];

const TARGET_TEXT = "Hello, we are back.";

// State
let scheduled = null;
let startedAt = null;
let rafId = null;
let typewriterArmed = false;

function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function bindComposition() {
  const composition = $("#composition");
  if (!composition) return null;
  const typedEl = $(".dict__typed", composition);
  const caretEl = $(".dict__caret", composition);
  const replayBtn = $(".btn-replay");
  const playLabel = $(".composition__play-label");
  const waveformBars = $all(".overlay-waveform .bar", composition);
  return { composition, typedEl, caretEl, replayBtn, playLabel, waveformBars };
}

function resetToIdle(state) {
  state.composition.dataset.stage = "idle";
  state.typedEl.textContent = TARGET_TEXT;
  state.caretEl.style.opacity = "0";
  typewriterArmed = false;
  state.waveformBars.forEach((b) => (b.style.animationPlayState = "paused"));
  if (state.playLabel) state.playLabel.textContent = "READY · 9.4s LOOP";
}

function applyStage(state, stageId, elapsed) {
  state.composition.dataset.stage = stageId;

  // Wave animation: only after 'wave' onward
  const liveStages = ["wave", "transcript", "assistant", "tts"];
  const shouldAnimateBars = liveStages.includes(stageId);
  state.waveformBars.forEach((b) => {
    b.style.animationPlayState = shouldAnimateBars ? "running" : "paused";
  });

  // Typewriter kick-in once on entering 'transcript'
  if (stageId === "transcript" && !typewriterArmed) {
    typewriterArmed = true;
    typewriterType(state, TARGET_TEXT);
  }

  // Labels
  if (state.playLabel) {
    const labels = {
      idle: "IDLE · waiting for hotkey",
      hotkey: "HOTKEY · alt + space captured",
      record: "RECORD · live capture",
      wave: "WAVE · waveform drawn",
      transcript: "TRANSCRIPT · streaming text",
      assistant: "ASSISTANT · synthesizing reply",
      tts: "TTS · playing back",
    };
    state.playLabel.textContent = labels[stageId] || "READY · 9.4 s LOOP";
  }
}

function typewriterType(state, text) {
  let i = 0;
  state.caretEl.style.opacity = "1";
  const tick = () => {
    if (i > text.length) {
      return;
    }
    state.typedEl.textContent = text.slice(0, i);
    i += 1;
    setTimeout(tick, 70);
  };
  tick();
}

function tick(state) {
  // QA path: when goto() has captured a static state, do not auto-advance.
  if (window.slashwisprShowcase?.isLocked?.()) {
    rafId = null;
    return;
  }

  const now = performance.now();
  const elapsed = now - startedAt;

  // find which stage we are in based on start time
  // stages after first 'idle' end are also 'idle' (loop settle)
  const active = STAGES.reduce((acc, s) => (elapsed >= s.start ? s : acc), STAGES[0]);

  // Detect stage transitions explicitly so we don't reset typewriter prematurely
  const prev = state.composition.dataset.stage || active.id;
  if (prev !== active.id) {
    applyStage(state, active.id, elapsed);
  }

  // Loop: when total cycle (9400) is reached, start fresh
  const cycle = 9400;
  if (elapsed >= cycle) {
    cancelAnimationFrame(rafId);
    rafId = null;
    scheduled = null;
    resetToIdle(state);
    if (state.playLabel) state.playLabel.textContent = "READY · LOOP COMPLETE";
    scheduled = setTimeout(() => play(state), 600);
  } else {
    rafId = requestAnimationFrame(() => tick(state));
  }
}

function play(state) {
  if (scheduled) clearTimeout(scheduled);
  if (rafId) cancelAnimationFrame(rafId);
  resetToIdle(state);
  startedAt = performance.now();
  applyStage(state, "idle", 0);
  rafId = requestAnimationFrame(() => tick(state));
}

function pause(state) {
  if (rafId) cancelAnimationFrame(rafId);
  if (scheduled) clearTimeout(scheduled);
  rafId = null;
  scheduled = null;
  resetToIdle(state);
}

function bindVisibility(state) {
  if (!state.composition) return;
  let playedOnce = false;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRatio >= 0.20 && !playedOnce) {
          playedOnce = true;
          play(state);
          io.disconnect();
        }
      }
    },
    { threshold: [0, 0.15, 0.20, 0.45, 0.85] }
  );
  io.observe(state.composition);
}

function bindReplay(state) {
  if (!state.replayBtn) return;
  state.replayBtn.addEventListener("click", () => play(state));
}

function bindReducedMotion(state) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    // Render only the final stage statically
    applyStage(state, "tts", 99999);
    typewriterType(state, TARGET_TEXT);
    state.composition.dataset.stage = "assistant";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const state = bindComposition();
  if (!state) return;
  bindReducedMotion(state);
  bindVisibility(state);
  bindReplay(state);

  // QA helper exposed on window for manual stage-capture during dev/QA.
  // Production users won't see it; it does not affect the autoplay.
  let locked = false;
  window.slashwisprShowcase = {
    pause: () => { locked = true; pause(state); },
    play: () => { locked = false; play(state); },
    goto: (stage, opts = {}) => {
      locked = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (scheduled) clearTimeout(scheduled);
      rafId = null;
      scheduled = null;
      state.composition.dataset.stage = stage;
      if (opts.text != null) state.typedEl.textContent = opts.text;
      state.caretEl.style.opacity = /record|wave|transcript|assistant|tts/.test(stage) ? "1" : "0";
      const labels = {
        idle: "IDLE · waiting for hotkey",
        hotkey: "HOTKEY · alt + space captured",
        record: "RECORD · live capture",
        wave: "WAVE · waveform drawn",
        transcript: "TRANSCRIPT · streaming text",
        assistant: "ASSISTANT · synthesizing reply",
        tts: "TTS · playing back",
      };
      const playLabel = state.playLabel;
      if (playLabel) playLabel.textContent = labels[stage] || "READY · loop complete";
    },
    isLocked: () => locked,
  };
});
