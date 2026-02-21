## 2025-02-18 - [Validate External Binary Paths]
**Vulnerability:** User-configurable executable paths (e.g., Python path) were not validated, allowing potential arbitrary command execution if an attacker could modify the settings file.
**Learning:** `Command::new(path)` executes whatever path is provided. When the path comes from user configuration (persisted to disk), it must be validated to ensure it matches the expected application (e.g., verifying the filename contains "python").
**Prevention:** Always validate user-provided executable paths against an allowlist of expected filenames (e.g. "python", "python3") and check for dangerous characters before passing them to `Command::new`.
