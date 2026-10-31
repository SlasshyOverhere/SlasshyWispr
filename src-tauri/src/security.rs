// Input, path and artifact validation helpers.
//
// Wired into the command paths: `validate_text_input`, `validate_base64_input`,
// `create_api_key_fingerprint`, `verify_file_sha256` (via pipeline::fs and the
// STT download), and the temp-file helpers (Piper's WAV, swept at startup).
//
// A test that proves a helper works is not evidence it is called, so this list
// is the thing to check before relying on anything here.

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

type HmacSha256 = Hmac<Sha256>;

/// Securely creates HMAC-SHA256 fingerprint for API keys
pub fn create_api_key_fingerprint(api_key: &str, secret_key: &str) -> Result<String, String> {
    if api_key.is_empty() {
        return Err("API key cannot be empty".to_string());
    }

    let mut mac = HmacSha256::new_from_slice(secret_key.as_bytes())
        .map_err(|e| format!("Failed to create HMAC: {}", e))?;

    mac.update(api_key.as_bytes());
    let result = mac.finalize();

    Ok(format!("{:x}", result.into_bytes()))
}

/// SHA-256 hash for sensitive data
pub fn sha256_hash(data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Verifies a downloaded file against an expected SHA-256 hex digest.
/// Empty expected digest = no pin published yet -> caller decides (warn, not pass).
/// Returns Ok(()) only on exact match. Streams the file (no whole-file read).
pub fn verify_file_sha256(path: &Path, expected_hex: &str) -> Result<(), String> {
    use std::io::Read;
    let expected = expected_hex.trim().to_ascii_lowercase();
    if expected.is_empty() {
        return Err("no expected SHA-256 pin published for this artifact".to_string());
    }
    if expected.len() != 64 || !expected.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("expected SHA-256 pin is malformed (want 64 hex chars)".to_string());
    }
    let mut file =
        fs::File::open(path).map_err(|e| format!("cannot open file for hash verify: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("cannot read file for hash verify: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let computed = format!("{:x}", hasher.finalize());
    if computed != expected {
        return Err(format!(
            "SHA-256 mismatch (expected={expected} computed={computed})"
        ));
    }
    Ok(())
}

/// Validates input length and content
pub fn validate_text_input(
    text: &str,
    max_length: usize,
    field_name: &str,
) -> Result<String, String> {
    if text.len() > max_length {
        return Err(format!(
            "{} exceeds maximum length of {} characters (got {})",
            field_name,
            max_length,
            text.len()
        ));
    }

    // Reject control characters except newline and tab
    if text
        .chars()
        .any(|c| c.is_control() && c != '\n' && c != '\t' && c != '\r')
    {
        return Err(format!(
            "{} contains invalid control characters",
            field_name
        ));
    }

    Ok(text.trim().to_string())
}

/// Validates base64 input with size limits
pub fn validate_base64_input(base64_str: &str, max_size_bytes: usize) -> Result<Vec<u8>, String> {
    // Check encoded size before decoding
    if base64_str.len() > max_size_bytes * 4 / 3 + 100 {
        return Err(format!(
            "Base64 input too large: {} bytes (max {})",
            base64_str.len(),
            max_size_bytes * 4 / 3 + 100
        ));
    }

    // Decode
    let decoded = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, base64_str)
        .map_err(|e| format!("Invalid base64 encoding: {}", e))?;

    // Check decoded size
    if decoded.len() > max_size_bytes {
        return Err(format!(
            "Decoded data too large: {} bytes (max {})",
            decoded.len(),
            max_size_bytes
        ));
    }

    Ok(decoded)
}

/// Creates a secure temporary file with restricted permissions
/// A private temp file for a subprocess to write into.
///
/// Exclusive create under a UUID name, so nothing else on the machine can
/// pre-create or symlink the path between choosing it and the child writing.
pub fn create_secure_temp_file(
    dir: &Path,
    prefix: &str,
    suffix: &str,
    data: &[u8],
) -> Result<PathBuf, String> {
    use std::io::Write;

    fs::create_dir_all(dir).map_err(|e| format!("Failed to create temp directory: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata =
            fs::metadata(dir).map_err(|e| format!("Cannot read directory metadata: {}", e))?;
        let mut perms = metadata.permissions();
        perms.set_mode(0o700); // Owner-only access
        fs::set_permissions(dir, perms)
            .map_err(|e| format!("Cannot set directory permissions: {}", e))?;
    }

    // Exclusive create, so a name collision (or a planted symlink) fails rather
    // than writing through it.
    let temp_path = dir.join(format!("{}_{}.{}", prefix, uuid::Uuid::new_v4(), suffix));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp_path)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    file.write_all(data)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    // Set restrictive permissions
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata = fs::metadata(&temp_path)
            .map_err(|e| format!("Cannot read temp file metadata: {}", e))?;
        let mut perms = metadata.permissions();
        perms.set_mode(0o600); // Owner read/write only
        fs::set_permissions(&temp_path, perms)
            .map_err(|e| format!("Cannot set temp file permissions: {}", e))?;
    }

    Ok(temp_path)
}

/// Reserve a private, empty temp path for a child process to write into.
///
/// The file is created exclusively and then closed, so the name is taken but
/// the child still sees an empty file. Piper writes its WAV to this path, which
/// makes a predictable name in a shared temp directory a real hazard: anything
/// running as the same user could pre-create it and have its bytes played back.
pub fn reserve_secure_temp_path(dir: &Path, prefix: &str, suffix: &str) -> Result<PathBuf, String> {
    create_secure_temp_file(dir, prefix, suffix, b"")
}

/// Remove temp files this app created that are older than `max_age_hours`.
///
/// Scoped to `prefix` on purpose: the app sweeps the shared system temp
/// directory, and an unfiltered sweep there would delete every other
/// application's leftovers too.
pub fn cleanup_old_temp_files(
    dir: &Path,
    prefix: &str,
    max_age_hours: u64,
) -> Result<usize, String> {
    if !dir.exists() {
        return Ok(0);
    }

    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(max_age_hours * 3600))
        .ok_or("Failed to calculate time cutoff")?;

    let mut cleaned = 0;
    for entry in fs::read_dir(dir).map_err(|e| format!("Failed to read temp directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();

        // Only our own leftovers. Everything else in a shared temp directory
        // belongs to another program.
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with(prefix) {
            continue;
        }

        if path.is_file() {
            let metadata =
                fs::metadata(&path).map_err(|e| format!("Cannot read file metadata: {}", e))?;

            if let Ok(modified) = metadata.modified() {
                if modified < cutoff {
                    fs::remove_file(&path)
                        .map_err(|e| format!("Failed to remove old temp file: {}", e))?;
                    cleaned += 1;
                }
            }
        }
    }

    Ok(cleaned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn a_reserved_temp_path_is_exclusive_and_empty() {
        let temp_dir = TempDir::new().unwrap();
        let path = reserve_secure_temp_path(temp_dir.path(), "sw-test", "wav").expect("reserve");

        // Created exclusively, so the name is taken...
        assert!(path.exists());
        // ...and empty, which is what a child process writing into it needs.
        assert_eq!(fs::metadata(&path).expect("metadata").len(), 0);
        // A second reservation cannot land on the same name.
        let other = reserve_secure_temp_path(temp_dir.path(), "sw-test", "wav").expect("reserve");
        assert_ne!(path, other);
    }

    #[test]
    fn the_temp_sweep_only_removes_our_own_stale_files() {
        let temp_dir = TempDir::new().unwrap();
        let ours =
            reserve_secure_temp_path(temp_dir.path(), "slasshywispr-tts", "wav").expect("reserve");
        // Somebody else's file in the same directory. The app sweeps the shared
        // system temp directory, so this one must survive.
        let foreign = temp_dir.path().join("someone-elses-file.tmp");
        fs::write(&foreign, b"not ours").expect("write");

        // Age zero makes every file stale, so this is about scope, not age.
        let removed =
            cleanup_old_temp_files(temp_dir.path(), "slasshywispr-tts", 0).expect("sweep");
        assert_eq!(removed, 1, "only our own file should be swept");
        assert!(!ours.exists(), "our stale file should be gone");
        assert!(
            foreign.exists(),
            "another program's file must never be touched"
        );
    }

    #[test]
    fn a_sweep_that_is_not_yet_due_removes_nothing() {
        let temp_dir = TempDir::new().unwrap();
        let path =
            reserve_secure_temp_path(temp_dir.path(), "slasshywispr-tts", "wav").expect("reserve");

        let removed =
            cleanup_old_temp_files(temp_dir.path(), "slasshywispr-tts", 24).expect("sweep");
        assert_eq!(removed, 0);
        assert!(path.exists(), "a file inside the window must be kept");
    }

    #[test]
    fn test_validate_text_input() {
        let result = validate_text_input("Hello world", 100, "test");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "Hello world");
    }

    #[test]
    fn test_validate_text_input_too_long() {
        let long_text = "a".repeat(101);
        let result = validate_text_input(&long_text, 100, "test");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("exceeds maximum length"));
    }

    #[test]
    fn test_validate_text_input_control_chars() {
        let result = validate_text_input("Hello\x01World", 100, "test");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("control characters"));
    }

    #[test]
    fn test_create_api_key_fingerprint() {
        let key = "secret-api-key-12345";
        let secret = "hmac-secret-key";
        let result = create_api_key_fingerprint(key, secret);
        assert!(result.is_ok());
        // Should be 64 hex chars for SHA-256
        assert_eq!(result.unwrap().len(), 64);
    }

    #[test]
    fn corrupted_file_hash_rejected() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("model.bin");
        fs::write(&file, b"genuine-bytes").unwrap();
        let good = sha256_hash("genuine-bytes");
        assert!(verify_file_sha256(&file, &good).is_ok());
        fs::write(&file, b"tampered-bytes").unwrap();
        let err = verify_file_sha256(&file, &good).expect_err("tamper must fail");
        assert!(err.contains("mismatch"), "{err}");
        assert!(verify_file_sha256(&file, "").is_err());
        assert!(verify_file_sha256(&file, "xyz").is_err());
    }

    #[test]
    fn test_sha256_hash_consistency() {
        let hash1 = sha256_hash("test data");
        let hash2 = sha256_hash("test data");
        assert_eq!(hash1, hash2);
        assert_eq!(hash1.len(), 64); // SHA-256 produces 256 bits = 64 hex chars
    }
}
