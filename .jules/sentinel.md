## 2025-02-19 - [CRITICAL] Arbitrary Executable Download in Update Mechanism
**Vulnerability:** The `download_and_install_app_update` Tauri command accepted an arbitrary `download_url` from the frontend and executed the downloaded file as a Windows installer/MSI without validating the domain or origin.
**Learning:** Never trust URLs provided by the client/frontend for sensitive operations like downloading and executing binaries. Even if the URL was originally provided by the backend to the frontend, the frontend state can be manipulated or the command can be invoked directly if the frontend is compromised (XSS).
**Prevention:** Validate the `download_url` against a strict allowlist of trusted domains (e.g., `github.com`, `objects.githubusercontent.com`) in the backend before proceeding with the download and execution. Ideally, re-verify the update metadata or sign the update artifacts.

## 2025-02-19 - Missing Input Validation on User-Configurable Binary Paths
**Vulnerability:** `resolve_coqui_python_path` and `resolve_piper_path` accepted any string as a binary path, which was subsequently used in `Command::new`. This could allow arbitrary command execution if a malicious path (e.g., to a different binary or script) was provided.
**Learning:** Always verify that security-critical validation functions referenced in design/memory are actually present and called in the codebase.
**Prevention:** Implement strict allowlist validation for binary names when allowing user-configurable executables. Use `validate_python_binary_path` and `validate_piper_binary_path` patterns.

## 2025-02-19 - [MEDIUM] DoS via Unbounded TTS Input
**Vulnerability:** The `synthesize_with_piper` and `synthesize_with_coqui` functions accepted arbitrarily long strings for text-to-speech generation. This could allow an attacker or a malfunctioning frontend to consume excessive CPU/Memory resources (Denial of Service) by requesting synthesis of a massive text payload.
**Learning:** Always validate input length for resource-intensive operations like TTS or AI processing, even if the input comes from an authenticated user or internal component.
**Prevention:** Implemented `validate_tts_input_length` which enforces a strict character limit (`MAX_TTS_INPUT_LENGTH = 2000`) on all TTS requests.

## 2025-03-07 - [CRITICAL] Path Traversal in Update URL Validation
**Vulnerability:** The `is_safe_update_url` function relied on a simple string `starts_with` check (`lower.starts_with("https://github.com/owner/repo/")`) to validate update URLs. This was susceptible to path traversal attacks (e.g., `https://github.com/owner/repo/../../attacker/repo/releases/download/...`), allowing downloads from unintended repositories.
**Learning:** String prefix matching is insufficient for URL validation because it does not account for path normalization rules (like `.` and `..`) applied by HTTP clients during resolution.
**Prevention:** Use a robust URL parsing library (like `Url` from the `reqwest` or `url` crate) to parse the URL and explicitly validate its normalized components (scheme, host, path) rather than the raw string.

## 2025-03-08 - [CRITICAL] Untrusted File Download via Trusted Repository Attachments
**Vulnerability:** The `is_safe_update_url` function validated that download URLs belonged to `github.com` and matched the repository's path (`/{owner}/{name}/`). However, this allowed any file uploaded as an issue/PR attachment in that repository (e.g., `https://github.com/owner/name/files/123/malware.exe`) to be trusted and executed by the updater.
**Learning:** Checking that a URL belongs to a trusted repository is not enough if the hosting provider allows public users to upload unreviewed content (like issue attachments) to that same repository namespace.
**Prevention:** Make the URL validation strict enough to only allow downloads from paths that require repository write access to publish (e.g., `/{owner}/{name}/releases/download/`).
