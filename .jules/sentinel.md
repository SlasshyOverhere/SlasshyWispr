## 2025-02-27 - [DOM-based XSS in Error Diagnostics]
**Vulnerability:** Interpolation of unescaped variables into an `innerHTML` assignment (`dialog.innerHTML`) in `src/main.tsx`'s `showOfflineModeDiagnostic` function. Variables originating from `details` objects and other unvalidated sources.
**Learning:** Even diagnostic and error-display components that aren't handling core user data can be vectors for XSS if they reflect unvalidated parameters or details without proper HTML escaping.
**Prevention:** Always use `escapeHtml()` on dynamic parts before interpolating into template strings intended for `innerHTML`, or prefer programmatic DOM creation methods like `textContent`.
