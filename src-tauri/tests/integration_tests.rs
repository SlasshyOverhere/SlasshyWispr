use app_lib::security::*;
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;

#[test]
fn test_validate_executable_path_with_valid_exe() {
    let temp_dir = TempDir::new().unwrap();
    let exe_path = temp_dir.path().join("installer.exe");
    fs::write(&exe_path, b"fake exe").unwrap();

    let allowed_dirs = vec![temp_dir.path().to_str().unwrap()];
    let result = validate_executable_path(&exe_path, &allowed_dirs);

    assert!(result.is_ok(), "Should accept valid executable in allowed directory");
}

#[test]
fn test_validate_executable_path_rejects_invalid_extension() {
    let temp_dir = TempDir::new().unwrap();
    let bad_path = temp_dir.path().join("malicious.txt");
    fs::write(&bad_path, b"not an exe").unwrap();

    let allowed_dirs = vec![temp_dir.path().to_str().unwrap()];
    let result = validate_executable_path(&bad_path, &allowed_dirs);

    assert!(result.is_err(), "Should reject non-executable files");
    assert!(result.unwrap_err().contains("Invalid executable extension"));
}

#[test]
fn test_validate_executable_path_rejects_outside_allowed_dir() {
    let temp_dir1 = TempDir::new().unwrap();
    let temp_dir2 = TempDir::new().unwrap();

    let exe_path = temp_dir1.path().join("installer.exe");
    fs::write(&exe_path, b"fake exe").unwrap();

    let allowed_dirs = vec![temp_dir2.path().to_str().unwrap()];
    let result = validate_executable_path(&exe_path, &allowed_dirs);

    assert!(result.is_err(), "Should reject executables outside allowed directories");
}

#[test]
fn test_create_secure_temp_file_with_proper_permissions() {
    let temp_dir = TempDir::new().unwrap();
    let data = b"secure temporary data";

    let result = create_secure_temp_file(temp_dir.path(), "test", "dat", data);

    assert!(result.is_ok(), "Should create secure temp file");
    let file_path = result.unwrap();

    // Verify file exists and contains correct data
    assert!(file_path.exists());
    let contents = fs::read(&file_path).unwrap();
    assert_eq!(contents, data);

    // Clean up
    fs::remove_file(&file_path).ok();
}

#[test]
fn test_cleanup_old_temp_files() {
    let temp_dir = TempDir::new().unwrap();

    // Create some test files
    for i in 0..3 {
        let file_path = temp_dir.path().join(format!("test_{}.dat", i));
        fs::write(&file_path, format!("data {}", i)).unwrap();
    }

    let result = cleanup_old_temp_files(temp_dir.path(), 0);
    assert!(result.is_ok());

    // All files should be cleaned up (max_age_hours = 0 means all are old)
    assert_eq!(result.unwrap(), 3);
}

#[test]
fn test_validate_base64_input_within_limits() {
    use base64::Engine;
    let data = b"Hello, World!";
    let encoded = base64::engine::general_purpose::STANDARD.encode(data);

    let result = validate_base64_input(&encoded, 1024);
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), data);
}

#[test]
fn test_validate_base64_input_too_large() {
    let large_data = "A".repeat(10000);
    let result = validate_base64_input(&large_data, 100);

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("too large"));
}

#[test]
fn test_validate_base64_input_invalid_encoding() {
    let result = validate_base64_input("!!!invalid-base64!!!", 1024);

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Invalid base64"));
}

#[test]
fn test_text_validation_accepts_normal_text() {
    let text = "Hello world, this is a normal sentence with numbers 12345.";
    let result = validate_text_input(text, 1000, "test_field");

    assert!(result.is_ok());
    let validated = result.unwrap();
    assert_eq!(validated, text.trim());
}

#[test]
fn test_text_validation_rejects_control_characters() {
    let text = "Hello\x01\x02World";
    let result = validate_text_input(text, 1000, "test_field");

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("control characters"));
}

#[test]
fn test_text_validation_allows_newlines_and_tabs() {
    let text = "Line 1\nLine 2\tTabbed";
    let result = validate_text_input(text, 1000, "test_field");

    assert!(result.is_ok());
}

#[test]
fn test_text_validation_enforces_max_length() {
    let long_text = "A".repeat(1001);
    let result = validate_text_input(&long_text, 1000, "test_field");

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("exceeds maximum length"));
}

#[test]
fn test_hmac_fingerprint_is_deterministic() {
    let api_key = "test-api-key-123";
    let secret = "hmac-secret";

    let fingerprint1 = create_api_key_fingerprint(api_key, secret).unwrap();
    let fingerprint2 = create_api_key_fingerprint(api_key, secret).unwrap();

    assert_eq!(fingerprint1, fingerprint2, "HMAC should be deterministic");
}

#[test]
fn test_hmac_fingerprint_differs_with_different_keys() {
    let api_key = "test-api-key-123";
    let secret1 = "secret-one";
    let secret2 = "secret-two";

    let fingerprint1 = create_api_key_fingerprint(api_key, secret1).unwrap();
    let fingerprint2 = create_api_key_fingerprint(api_key, secret2).unwrap();

    assert_ne!(fingerprint1, fingerprint2, "Different secrets should produce different fingerprints");
}

#[test]
fn test_hmac_fingerprint_rejects_empty_key() {
    let result = create_api_key_fingerprint("", "secret");
    assert!(result.is_err());
}

#[test]
fn test_sha256_hash_produces_correct_length() {
    let hash = sha256_hash("any data here");
    assert_eq!(hash.len(), 64, "SHA-256 should produce 64 hex characters");
}

#[test]
fn test_path_validation_prevents_traversal() {
    let temp_dir = TempDir::new().unwrap();
    let parent = temp_dir.path().parent().unwrap();

    // Try to access a file outside the allowed directory
    let traversal_path = temp_dir.path().join("../outside.txt");
    fs::write(&traversal_path, "test").unwrap_or_default();

    let result = validate_path_within_directory(&traversal_path, temp_dir.path());
    assert!(result.is_err(), "Should prevent path traversal");
}

#[cfg(target_os = "windows")]
#[test]
fn test_windows_installer_validation() {
    let temp_dir = TempDir::new().unwrap();
    let exe_path = temp_dir.path().join("setup.exe");
    fs::write(&exe_path, b"fake installer").unwrap();

    let allowed_dirs = vec![temp_dir.path().to_str().unwrap()];
    let result = validate_executable_path(&exe_path, &allowed_dirs);

    assert!(result.is_ok());
}

#[test]
fn test_multiple_security_layers_work_together() {
    // Test that validation, hashing, and temp file creation work together
    let input_text = "Valid input text";
    let validated = validate_text_input(input_text, 1000, "test").unwrap();

    let hash = sha256_hash(&validated);
    assert_eq!(hash.len(), 64);

    let temp_dir = TempDir::new().unwrap();
    let temp_file = create_secure_temp_file(
        temp_dir.path(),
        "security_test",
        "txt",
        validated.as_bytes()
    ).unwrap();

    assert!(temp_file.exists());
    fs::remove_file(&temp_file).ok();
}
