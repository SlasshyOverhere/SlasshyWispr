//! Post-download SHA256 verification for STT model artifacts.
//!
//! Pure helpers: hash a file, compare against an expected hex digest, and
//! look up the expected digest for a repo. The hash table itself is owned by
//! Agent 1 (`constants.rs`); this module consumes it verbatim once landed.

use std::fs;
use std::path::Path;

use sha2::{Digest, Sha256};

/// Reference VAD URL builder pinned to the `snakers4/silero-vad` HEAD commit
/// at time of writing. Consumed by the VAD pin test below; Agent 1's
/// `SILERO_VAD_PINNED_COMMIT` in `constants.rs` is the shipped constant —
/// propose this same commit value for it (see report).
#[allow(dead_code)]
pub(crate) const PINNED_SILERO_VAD_COMMIT: &str = "60b7ffa243625ebdc1070275a29f18c87843786a";

/// VAD model URL pinned to [`PINNED_SILERO_VAD_COMMIT`] instead of `master`.
#[allow(dead_code)]
pub(crate) fn pinned_silero_vad_url() -> String {
    format!(
        "https://github.com/snakers4/silero-vad/raw/{PINNED_SILERO_VAD_COMMIT}/files/silero_vad.onnx"
    )
}

// Consumes Agent 1's hash table verbatim (`constants.rs` READ-ONLY).
pub(crate) fn expected_sha256_for_repo(repo_id: &str) -> Option<&'static str> {
    crate::constants::local_stt_model_expected_sha256(repo_id)
}

/// Lowercase hex SHA256 of in-memory bytes.
pub(crate) fn sha256_hex_of_bytes(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

/// Lowercase hex SHA256 of a file's full contents.
pub(crate) fn sha256_hex_of_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| {
        format!(
            "Failed to read file for hashing '{}': {error}",
            path.display()
        )
    })?;
    Ok(sha256_hex_of_bytes(&bytes))
}

/// Reject the file when its SHA256 does not match `expected_hex`.
/// Never deletes; the caller removes the artifact on `Err`.
pub(crate) fn verify_file_sha256(path: &Path, expected_hex: &str) -> Result<(), String> {
    let actual = sha256_hex_of_file(path)?;
    if actual.eq_ignore_ascii_case(expected_hex.trim()) {
        return Ok(());
    }
    Err(format!(
        "SHA256 mismatch for '{}' (expected={} actual={}). File rejected.",
        path.display(),
        expected_hex.trim(),
        actual
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matching_hash_passes() {
        let bytes = b"parakeet model bytes";
        let expected = sha256_hex_of_bytes(bytes);
        let dir = std::env::temp_dir();
        let path = dir.join("slasshywispr-verify-ok.bin");
        fs::write(&path, bytes).unwrap();
        assert!(verify_file_sha256(&path, &expected).is_ok());
        assert!(verify_file_sha256(&path, &expected.to_ascii_uppercase()).is_ok());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn tampered_byte_rejected() {
        let bytes = b"parakeet model bytes";
        let expected = sha256_hex_of_bytes(bytes);
        let dir = std::env::temp_dir();
        let path = dir.join("slasshywispr-verify-tampered.bin");
        let mut tampered = bytes.to_vec();
        tampered[0] ^= 0x01;
        fs::write(&path, tampered).unwrap();
        let error = verify_file_sha256(&path, &expected).unwrap_err();
        assert!(error.contains("SHA256 mismatch"), "{error}");
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn vad_url_pins_commit_sha() {
        let url = pinned_silero_vad_url();
        assert!(url.contains(PINNED_SILERO_VAD_COMMIT), "{url}");
        assert!(!url.contains("/master/"), "{url}");
    }
}
