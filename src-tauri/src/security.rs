use std::path::{Path, PathBuf};
use sha2::{Sha256, Digest};
use hmac::{Hmac, Mac};
use std::fs;

type HmacSha256 = Hmac<Sha256>;

/// Validates that a path is within an allowed directory and canonicalizes it
pub fn validate_path_within_directory(path: &Path, allowed_root: &Path) -> Result<PathBuf, String> {
    let canonical = path.canonicalize()
        .map_err(|e| format!("Invalid path {}: {}", path.display(), e))?;

    if !canonical.starts_with(allowed_root) {
        return Err(format!(
            "Path traversal detected: {} is not within {}",
            canonical.display(),
            allowed_root.display()
        ));
    }

    Ok(canonical)
}

/// Validates executable paths against an allowlist
pub fn validate_executable_path(path: &Path, allowed_dirs: &[&str]) -> Result<PathBuf, String> {
    // Ensure path exists
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    // Check extension
    if let Some(ext) = path.extension() {
        let ext_str = ext.to_string_lossy().to_lowercase();
        if !["exe", "msi", "bat", "cmd"].contains(&ext_str.as_str()) {
            return Err(format!("Invalid executable extension: {}", ext_str));
        }
    } else {
        return Err("Executable must have a valid extension (.exe, .msi, etc.)".to_string());
    }

    // Canonicalize and validate
    let canonical = path.canonicalize()
        .map_err(|e| format!("Cannot resolve path: {}", e))?;

    // Check against allowed directories
    for allowed_dir in allowed_dirs {
        let allowed_path = Path::new(allowed_dir);
        if canonical.starts_with(allowed_path) {
            return Ok(canonical);
        }
    }

    Err(format!(
        "Executable {} is not in an allowed directory",
        canonical.display()
    ))
}

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

/// Validates input length and content
pub fn validate_text_input(text: &str, max_length: usize, field_name: &str) -> Result<String, String> {
    if text.len() > max_length {
        return Err(format!(
            "{} exceeds maximum length of {} characters (got {})",
            field_name, max_length, text.len()
        ));
    }

    // Reject control characters except newline and tab
    if text.chars().any(|c| c.is_control() && c != '\n' && c != '\t' && c != '\r') {
        return Err(format!("{} contains invalid control characters", field_name));
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
pub fn create_secure_temp_file(
    dir: &Path,
    prefix: &str,
    suffix: &str,
    data: &[u8],
) -> Result<PathBuf, String> {
    use std::io::Write;

    // Ensure directory exists with proper permissions
    fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata = fs::metadata(dir)
            .map_err(|e| format!("Cannot read directory metadata: {}", e))?;
        let mut perms = metadata.permissions();
        perms.set_mode(0o700); // Owner-only access
        fs::set_permissions(dir, perms)
            .map_err(|e| format!("Cannot set directory permissions: {}", e))?;
    }

    // Create temp file with unique name
    let temp_path = dir.join(format!("{}_{}.{}", prefix, uuid::Uuid::new_v4(), suffix));

    // Write data
    let mut file = fs::File::create(&temp_path)
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

/// Cleans up old temporary files
pub fn cleanup_old_temp_files(dir: &Path, max_age_hours: u64) -> Result<usize, String> {
    if !dir.exists() {
        return Ok(0);
    }

    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(max_age_hours * 3600))
        .ok_or("Failed to calculate time cutoff")?;

    let mut cleaned = 0;
    for entry in fs::read_dir(dir)
        .map_err(|e| format!("Failed to read temp directory: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();

        if path.is_file() {
            let metadata = fs::metadata(&path)
                .map_err(|e| format!("Cannot read file metadata: {}", e))?;

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
    fn test_validate_path_within_directory() {
        let temp_dir = TempDir::new().unwrap();
        let allowed = temp_dir.path();
        let valid_file = allowed.join("test.txt");
        fs::write(&valid_file, "test").unwrap();

        let result = validate_path_within_directory(&valid_file, allowed);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_path_traversal_attempt() {
        let temp_dir = TempDir::new().unwrap();
        let allowed = temp_dir.path();
        let outside_file = temp_dir.path().parent().unwrap().join("outside.txt");
        fs::write(&outside_file, "test").unwrap();

        let result = validate_path_within_directory(&outside_file, allowed);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Path traversal"));
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
    fn test_sha256_hash_consistency() {
        let hash1 = sha256_hash("test data");
        let hash2 = sha256_hash("test data");
        assert_eq!(hash1, hash2);
        assert_eq!(hash1.len(), 64); // SHA-256 produces 256 bits = 64 hex chars
    }
}
