//! Post-download SHA256 verification for STT model artifacts.
//!
//! Pure helpers: hash a file and compare against an expected hex digest. The
//! pinned digests live in `constants.rs`, keyed by the archive URL the
//! downloader actually fetches.

use std::fs;
use std::path::Path;

use sha2::{Digest, Sha256};

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
    fn every_prepacked_archive_url_has_a_pinned_digest() {
        // An unpinned archive is installed unverified, so the table must cover
        // every source the downloader can actually pick.
        for source in crate::pipeline::stt_download::archive::prepacked_archive_sources() {
            assert!(
                crate::constants::parakeet_archive_expected_sha256(source.archive_url).is_some(),
                "no pinned digest for {}",
                source.archive_url
            );
        }
    }

    #[test]
    fn a_digest_mismatch_blocks_the_file() {
        // The whole point of pinning: a tampered archive is refused, not kept.
        let dir = std::env::temp_dir().join("slasshywispr-pin-test");
        fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("archive.tar.gz");
        fs::write(&path, b"original bytes").expect("write");
        let expected = sha256_hex_of_file(&path).expect("hash");

        assert!(verify_file_sha256(&path, &expected).is_ok());
        fs::write(&path, b"tampered bytes!").expect("rewrite");
        let error = verify_file_sha256(&path, &expected).expect_err("tamper must fail");
        assert!(error.contains("SHA256 mismatch"), "{error}");
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn vad_url_pins_commit_sha() {
        let url = crate::constants::silero_vad_model_url();
        assert!(
            url.contains(crate::constants::SILERO_VAD_PINNED_COMMIT),
            "{url}"
        );
        assert!(!url.contains("/master/"), "{url}");
    }
}
