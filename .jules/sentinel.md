## 2025-02-18 - [Tauri CSP Configuration]
**Vulnerability:** Missing Content Security Policy (CSP) in `src-tauri/tauri.conf.json`. The configuration was set to `"csp": null`, which disables CSP protections.
**Learning:** Even desktop applications built with web technologies (Tauri, Electron) require strict CSP to prevent XSS and other injection attacks. The default null value is insecure.
**Prevention:** Always configure a strict CSP in `tauri.conf.json` that whitelists only necessary sources (e.g., `'self'`, specific API endpoints) and disallows unsafe inline scripts/eval.
