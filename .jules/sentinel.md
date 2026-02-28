## 2025-02-19 - [CRITICAL] Arbitrary Executable Download in Update Mechanism
**Vulnerability:** The `download_and_install_app_update` Tauri command accepted an arbitrary `download_url` from the frontend and executed the downloaded file as a Windows installer/MSI without validating the domain or origin.
**Learning:** Never trust URLs provided by the client/frontend for sensitive operations like downloading and executing binaries. Even if the URL was originally provided by the backend to the frontend, the frontend state can be manipulated or the command can be invoked directly if the frontend is compromised (XSS).
**Prevention:** Validate the `download_url` against a strict allowlist of trusted domains (e.g., `github.com`, `objects.githubusercontent.com`) in the backend before proceeding with the download and execution. Ideally, re-verify the update metadata or sign the update artifacts.

## 2025-02-19 - Missing Input Validation on User-Configurable Binary Paths
**Vulnerability:** `resolve_coqui_python_path` and `resolve_piper_path` accepted any string as a binary path, which was subsequently used in `Command::new`. This could allow arbitrary command execution if a malicious path (e.g., to a different binary or script) was provided.
**Learning:** Always verify that security-critical validation functions referenced in design/memory are actually present and called in the codebase.
**Prevention:** Implement strict allowlist validation for binary names when allowing user-configurable executables. Use `validate_python_binary_path` and `validate_piper_binary_path` patterns.

## 2025-02-28 - Restrictive Content Security Policy (CSP) for Desktop Apps
**Vulnerability:** The `connect-src` in `src-tauri/tauri.conf.json` previously allowed connections to `http:` and `https:`, which is overly permissive for a desktop app that communicates exclusively via Tauri IPC (`invoke`) and has no need to fetch resources via frontend fetch/XHR calls.
**Learning:** In Tauri applications where the frontend's sole purpose is UI rendering and all network/system operations are handled by the Rust backend, removing `http:` and `https:` from `connect-src` significantly reduces the risk of data exfiltration or malicious API requests if an XSS vulnerability occurs.
**Prevention:** Default to the most restrictive CSP possible. For offline-first or IPC-heavy apps, restrict `connect-src` to `ws: wss: asset:` (for development and local assets) and block external HTTP traffic.
