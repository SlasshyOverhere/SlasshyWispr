## 2025-02-19 - [CRITICAL] Arbitrary Executable Download in Update Mechanism
**Vulnerability:** The `download_and_install_app_update` Tauri command accepted an arbitrary `download_url` from the frontend and executed the downloaded file as a Windows installer/MSI without validating the domain or origin.
**Learning:** Never trust URLs provided by the client/frontend for sensitive operations like downloading and executing binaries. Even if the URL was originally provided by the backend to the frontend, the frontend state can be manipulated or the command can be invoked directly if the frontend is compromised (XSS).
**Prevention:** Validate the `download_url` against a strict allowlist of trusted domains (e.g., `github.com`, `objects.githubusercontent.com`) in the backend before proceeding with the download and execution. Ideally, re-verify the update metadata or sign the update artifacts.

## 2025-02-19 - Missing Input Validation on User-Configurable Binary Paths
**Vulnerability:** `resolve_coqui_python_path` and `resolve_piper_path` accepted any string as a binary path, which was subsequently used in `Command::new`. This could allow arbitrary command execution if a malicious path (e.g., to a different binary or script) was provided.
**Learning:** Always verify that security-critical validation functions referenced in design/memory are actually present and called in the codebase.
**Prevention:** Implement strict allowlist validation for binary names when allowing user-configurable executables. Use `validate_python_binary_path` and `validate_piper_binary_path` patterns.

## 2025-02-20 - [SECURITY] Overly Permissive CSP Connect-Src
**Vulnerability:** The `connect-src` directive in `tauri.conf.json` allowed `http:` and `https:`, potentially enabling data exfiltration via XSS to arbitrary external servers.
**Learning:** Even if the frontend application logic does not use `fetch` or `XMLHttpRequest`, a permissive CSP leaves the door open for injected malicious scripts to communicate with attacker-controlled servers. Since all legitimate external communication is routed through the Tauri backend (IPC), the frontend does not need direct internet access.
**Prevention:** Tighten `connect-src` to minimal required schemes (`self`, `ws:`, `wss:`, `asset:`). Verify frontend code for absence of direct network calls (`fetch`, `xhr`) before locking down.
