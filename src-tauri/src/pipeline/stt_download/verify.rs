//! Post-download SHA256 verification for STT model artifacts.
//!
//! Pure helpers: hash a file, compare against an expected hex digest, and
//! look up the expected archive digest for a repo (`constants.rs` owns the
//! table).

use std::fs;
use std::path::Path;

use sha2::{Digest, Sha256};

pub(crate) fn expected_archive_sha256(repo_id: &str) -> Option<&'static str> {
    crate::constants::local_stt_archive_expected_sha256(repo_id)
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
    fn vad_model_is_pinned_and_hashed() {
        let url = crate::constants::silero_vad_model_url();
        assert!(
            url.contains(crate::constants::SILERO_VAD_PINNED_COMMIT),
            "{url}"
        );
        assert!(!url.contains("/master/"), "{url}");
        assert!(!crate::constants::SILERO_VAD_MODEL_EXPECTED_SHA256.is_empty());
    }

    #[test]
    fn every_catalog_archive_has_a_hash() {
        for model in crate::pipeline::routing::built_in_local_stt_model_catalog() {
            assert!(
                crate::constants::local_stt_archive_expected_sha256(&model).is_some(),
                "catalog model '{model}' has no archive SHA256"
            );
        }
    }
}
