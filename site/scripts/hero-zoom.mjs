const HOVER_DELAY_MS = 1000;

const $ = (sel, root = document) => root.querySelector(sel);

function init() {
  const frame = $("#hero-frame");
  const overlay = $("#frame-zoom");
  const closeBtn = $("#frame-zoom-close");
  if (!frame || !overlay || !closeBtn) return;

  let hoverTimer = null;
  let isOpen = false;
  let isReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function open() {
    if (isOpen) return;
    isOpen = true;
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("frame-zoom-locked");
    frame.setAttribute("aria-expanded", "true");
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("frame-zoom-locked");
    frame.setAttribute("aria-expanded", "false");
  }

  function scheduleOpen() {
    if (isOpen) return;
    hoverTimer = setTimeout(open, HOVER_DELAY_MS);
  }

  function cancelOpen() {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
  }

  function isCursorOverElement(el, e) {
    const rect = el.getBoundingClientRect();
    return e.clientX >= rect.left && e.clientX <= rect.right &&
           e.clientY >= rect.top && e.clientY <= rect.bottom;
  }

  frame.addEventListener("mouseenter", scheduleOpen);
  frame.addEventListener("mouseleave", cancelOpen);

  document.addEventListener("mousemove", (e) => {
    if (!isOpen) return;
    if (isCursorOverElement(overlay, e)) return;
    close();
  });

  frame.addEventListener("click", () => { if (!isOpen) open(); });

  frame.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!isOpen) open();
    }
  });

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) close();
  });

  if (isReducedMotion) {
    frame.addEventListener("focus", open);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
