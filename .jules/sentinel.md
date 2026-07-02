## 2026-07-02 - [Fix XSS in confirmDestructiveAction]
**Vulnerability:** The `message` parameter in `confirmDestructiveAction` was directly interpolated into `innerHTML` without sanitization, leading to a potential Cross-Site Scripting (XSS) vulnerability.
**Learning:** Directly assigning user-controlled strings to `innerHTML` creates an XSS vulnerability.
**Prevention:** Use an HTML escaping utility (like the `escapeHtml` function defined in the codebase) to sanitize any user-controlled inputs before interpolating them into HTML strings that are set via `innerHTML`. Or, better yet, construct the DOM nodes using `document.createElement` and set their text using `textContent`.
