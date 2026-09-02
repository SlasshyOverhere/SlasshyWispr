//! Updater validation, version comparison, installer detection, and URL safety.
//!
//! This module owns the logic for:
//! - Comparing semantic versions
//! - Detecting and scoring Windows installer assets
//! - Validating downloaded installer files (magic bytes)
//! - Sanitizing installer filenames
//! - Validating update download URLs against a trusted repository
//!
//! It is pure — no Tauri, no network, no application state.
//! Filesystem access is limited to `std::fs` for installer validation.

use crate::constants::*;
use reqwest::Url;
use serde::Deserialize;
use std::fs;
use std::io::Read;
use std::path::Path;

// ===== Types =====

/// Windows installer file kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowsInstallerKind {
    Exe,
    Msi,
}

/// A parsed semantic version with optional prerelease tag.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedVersion {
    pub numeric_parts: Vec<u64>,
    pub prerelease: Option<String>,
}

/// A GitHub release asset (name + download URL).
#[derive(Debug, Deserialize)]
pub struct GithubReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
}

/// A GitHub latest-release response (subset of fields used by the updater).
#[derive(Debug, Deserialize)]
pub struct GithubLatestReleaseResponse {
    pub tag_name: String,
    pub name: Option<String>,
    pub body: Option<String>,
    pub draft: bool,
    pub prerelease: bool,
    pub published_at: Option<String>,
    pub html_url: Option<String>,
    pub assets: Vec<GithubReleaseAsset>,
}

// ===== Version normalization =====

/// Strip the leading `v` prefix and trim whitespace from a version tag.
pub fn normalize_release_version(tag: &str) -> String {
    tag.trim().trim_start_matches('v').trim().to_string()
}

// ===== Installer kind detection =====

/// Detect whether a filename is a Windows installer (EXE or MSI).
pub fn windows_installer_kind_from_name(name: &str) -> Option<WindowsInstallerKind> {
    let lower = name.trim().to_ascii_lowercase();
    if lower.ends_with(".exe") && !lower.ends_with(".exe.sig") {
        return Some(WindowsInstallerKind::Exe);
    }
    if lower.ends_with(".msi") {
        return Some(WindowsInstallerKind::Msi);
    }
    None
}

/// Whether an EXE installer supports silent/NSIS mode.
pub fn exe_installer_supports_silent_mode(name: &str) -> bool {
    let lower = name.trim().to_ascii_lowercase();
    lower.contains("setup") || lower.contains("installer") || lower.contains("nsis")
}

/// Whether a filename is a Windows installer asset.
pub fn is_windows_installer_asset(name: &str) -> bool {
    windows_installer_kind_from_name(name).is_some()
}

// ===== Installer scoring & selection =====

/// Score an installer asset for preference. Higher is better.
pub fn windows_installer_score(name: &str, release_version: &str) -> i32 {
    let lower = name.to_ascii_lowercase();
    let mut score = 0_i32;
    match windows_installer_kind_from_name(name) {
        Some(WindowsInstallerKind::Exe) => score += 8,
        Some(WindowsInstallerKind::Msi) => score += 5,
        None => {}
    }
    if lower.contains("slasshywispr") {
        score += 10;
    }
    let normalized_version = normalize_release_version(release_version).to_ascii_lowercase();
    if !normalized_version.is_empty() && lower.contains(&normalized_version) {
        score += 8;
    }
    if lower.contains("setup") {
        score += 6;
    }
    if lower.contains("installer") {
        score += 4;
    }
    if lower.contains("nsis") {
        score += 3;
    }
    if lower.contains("msi") {
        score += 1;
    }
    if lower.contains("x64") || lower.contains("amd64") {
        score += 1;
    }
    if lower.contains("portable") || lower.contains("debug") || lower.contains("symbols") {
        score -= 8;
    }
    if lower.contains("arm64") || lower.contains("aarch64") || lower.contains("x86") || lower.contains("ia32") {
        score -= 6;
    }
    score
}

/// Select the best Windows installer asset from a GitHub release.
pub fn select_windows_installer_asset<'a>(
    release: &'a GithubLatestReleaseResponse,
) -> Option<&'a GithubReleaseAsset> {
    release
        .assets
        .iter()
        .filter(|asset| is_windows_installer_asset(&asset.name))
        .max_by_key(|asset| {
            (
                windows_installer_score(&asset.name, &release.tag_name),
                asset.name.len(),
            )
        })
}

/// Select the latest stable (non-draft, non-prerelease) release from a list.
pub fn select_latest_stable_release<'a>(
    releases: &'a [GithubLatestReleaseResponse],
) -> Option<&'a GithubLatestReleaseResponse> {
    releases
        .iter()
        .find(|release| !release.draft && !release.prerelease)
}

// ===== Version parsing & comparison =====

/// Parse a version string into numeric parts and optional prerelease tag.
pub fn parse_version_triplet(version: &str) -> Option<ParsedVersion> {
    let normalized = normalize_release_version(version);
    let without_build = normalized.split_once('+').map(|(value, _)| value).unwrap_or(&normalized);
    let (core, prerelease) = without_build
        .split_once('-')
        .map(|(value, tag)| (value.trim(), Some(tag.trim().to_ascii_lowercase())))
        .unwrap_or((without_build.trim(), None));
    if core.is_empty() {
        return None;
    }

    let mut numeric_parts = Vec::new();
    for part in core.split('.') {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            return None;
        }
        numeric_parts.push(trimmed.parse::<u64>().ok()?);
    }
    if numeric_parts.is_empty() {
        return None;
    }

    Some(ParsedVersion {
        numeric_parts,
        prerelease: prerelease.filter(|value| !value.is_empty()),
    })
}

/// Whether `latest` is newer than `current`.
pub fn is_newer_version(current: &str, latest: &str) -> bool {
    match (parse_version_triplet(current), parse_version_triplet(latest)) {
        (Some(current_parts), Some(latest_parts)) => {
            let max_len = current_parts
                .numeric_parts
                .len()
                .max(latest_parts.numeric_parts.len());
            for index in 0..max_len {
                let current_part = current_parts.numeric_parts.get(index).copied().unwrap_or(0);
                let latest_part = latest_parts.numeric_parts.get(index).copied().unwrap_or(0);
                match latest_part.cmp(&current_part) {
                    std::cmp::Ordering::Greater => return true,
                    std::cmp::Ordering::Less => return false,
                    std::cmp::Ordering::Equal => {}
                }
            }

            match (&current_parts.prerelease, &latest_parts.prerelease) {
                (Some(_), None) => true,
                (None, Some(_)) => false,
                (Some(current_tag), Some(latest_tag)) => latest_tag > current_tag,
                (None, None) => false,
            }
        }
        _ => false,
    }
}

// ===== Filename sanitization =====

/// Sanitize an installer filename: replace unsafe characters, ensure valid extension.
pub fn sanitize_installer_file_name(name: &str) -> Option<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut sanitized = String::with_capacity(trimmed.len() + 4);
    for character in trimmed.chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
            sanitized.push(character);
        } else {
            sanitized.push('_');
        }
    }

    if sanitized.is_empty() {
        return None;
    }

    if windows_installer_kind_from_name(&sanitized).is_none() {
        return None;
    }

    Some(sanitized)
}

// ===== URL handling =====

/// Extract the version from a GitHub release download URL.
pub fn extract_version_from_download_url(url: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    let segments: Vec<&str> = parsed.path_segments()?.collect();
    // URL: /{owner}/{name}/releases/download/{tag}/{filename}
    // segments[0..5] = [owner, name, "releases", "download", tag]
    let tag = *segments.get(4)?;
    let version = normalize_release_version(tag);
    if version.is_empty() { None } else { Some(version) }
}

/// Resolve the installer filename from asset name or download URL.
pub fn resolve_installer_file_name(
    asset_name: Option<&str>,
    download_url: &str,
    _current_version: &str,
) -> String {
    if let Some(from_asset) = asset_name.and_then(sanitize_installer_file_name) {
        return from_asset;
    }

    if let Some(last_segment) = download_url.rsplit('/').next() {
        if let Some(from_url) = sanitize_installer_file_name(last_segment) {
            return from_url;
        }
    }

    let target_version = extract_version_from_download_url(download_url)
        .unwrap_or_else(|| String::from("unknown"));
    format!("SlasshyWispr-{target_version}-update.exe")
}

// ===== Update repository resolution =====

/// Resolve the update repository owner and name from environment variables or defaults.
pub fn resolve_update_repository() -> (String, String) {
    let owner = std::env::var(UPDATE_REPOSITORY_OWNER_ENV)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| UPDATE_REPOSITORY_OWNER.to_string());
    let name = std::env::var(UPDATE_REPOSITORY_NAME_ENV)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| UPDATE_REPOSITORY_NAME.to_string());
    (owner, name)
}

/// Whether the given URL is a safe update download from the trusted repository.
pub fn is_safe_update_url(url: &str) -> bool {
    let Ok(parsed_url) = Url::parse(url) else {
        return false;
    };

    if parsed_url.scheme() != "https" {
        return false;
    }

    if parsed_url.host_str() != Some("github.com") {
        return false;
    }

    let (owner, name) = resolve_update_repository();
    let expected_path_prefix = format!("/{owner}/{name}/releases/download/");
    let normalized = parsed_url
        .path_segments()
        .map(|segments| format!("/{}", segments.collect::<Vec<_>>().join("/")))
        .unwrap_or_default();

    normalized
        .to_ascii_lowercase()
        .starts_with(&expected_path_prefix.to_ascii_lowercase())
}

// ===== Installer validation =====

/// Validate a downloaded installer file by checking magic bytes.
pub fn validate_downloaded_installer_file(
    installer_path: &Path,
    installer_kind: WindowsInstallerKind,
) -> Result<(), String> {
    let metadata = fs::metadata(installer_path)
        .map_err(|error| format!("Failed to read downloaded installer metadata: {error}"))?;
    if !metadata.is_file() {
        return Err(format!(
            "Downloaded update path '{}' is not a file.",
            installer_path.display()
        ));
    }
    if metadata.len() == 0 {
        return Err("Downloaded installer file is empty.".to_string());
    }

    let mut file = fs::File::open(installer_path)
        .map_err(|error| format!("Failed to open downloaded installer: {error}"))?;
    let mut header = [0_u8; 8];
    let bytes_read = file
        .read(&mut header)
        .map_err(|error| format!("Failed to read downloaded installer header: {error}"))?;
    match installer_kind {
        WindowsInstallerKind::Exe => {
            if bytes_read < 2 || &header[..2] != b"MZ" {
                return Err(format!(
                    "Downloaded file '{}' is not a valid Windows executable.",
                    installer_path.display()
                ));
            }
        }
        WindowsInstallerKind::Msi => {
            const MSI_MAGIC: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
            if bytes_read < MSI_MAGIC.len() || header != MSI_MAGIC {
                return Err(format!(
                    "Downloaded file '{}' is not a valid Windows MSI package.",
                    installer_path.display()
                ));
            }
        }
    }

    Ok(())
}

// ===== Tests =====

#[cfg(test)]
mod tests {
    use super::*;

    // ===== is_safe_update_url =====

    #[test]
    fn validates_safe_update_urls() {
        let (owner, name) = resolve_update_repository();
        let valid_prefix = format!("https://github.com/{owner}/{name}/");
        let valid_url = format!("{valid_prefix}releases/download/v1.0/app.exe");

        assert!(is_safe_update_url(&valid_url));
        assert!(is_safe_update_url(&valid_url.to_ascii_uppercase())); // Case insensitive check

        // Untrusted repositories on GitHub must be rejected
        assert!(!is_safe_update_url(
            "https://github.com/Attacker/MalwareRepo/releases/download/v1.0/app.exe"
        ));

        // Path traversal should be rejected
        assert!(!is_safe_update_url(
            "https://github.com/SlasshyOverhere/SlasshyWispr/../../Attacker/MalwareRepo/releases/download/v1.0/app.exe"
        ));

        // Arbitrary attachments in the trusted repo must be rejected
        assert!(!is_safe_update_url(
            "https://github.com/SlasshyOverhere/SlasshyWispr/issues/1/attachments/12345"
        ));

        // Direct objects links are now rejected to enforce repo trust
        assert!(!is_safe_update_url(
            "https://objects.githubusercontent.com/github-production-release-asset-2e65be/123"
        ));

        // Other domains and protocols
        assert!(!is_safe_update_url("https://evil.com/app.exe"));
        assert!(!is_safe_update_url("http://github.com/user/repo"));
        assert!(!is_safe_update_url("ftp://github.com/user/repo"));
    }

    // ===== Version comparison =====

    #[test]
    fn compares_versions_without_false_positive_fallbacks() {
        assert!(is_newer_version("1.0.0", "1.0.1"));
        assert!(is_newer_version("1.0.0-beta.1", "1.0.0"));
        assert!(!is_newer_version("1.0.1", "1.0.0"));
        assert!(!is_newer_version("1.0.0", "1.0.0-beta.1"));
        assert!(!is_newer_version("1.0.0", "release-candidate"));
    }

    #[test]
    fn is_newer_version_handles_multi_digit_parts() {
        assert!(is_newer_version("1.9.9", "1.10.0"));
        assert!(is_newer_version("1.0.0", "2.0.0"));
        assert!(!is_newer_version("2.0.0", "1.9.9"));
    }

    #[test]
    fn is_newer_version_handles_uneven_part_counts() {
        assert!(is_newer_version("1.0", "1.0.1"));
        assert!(is_newer_version("1.0.1", "1.0.2"));
        assert!(!is_newer_version("1.0.1", "1.0"));
    }

    #[test]
    fn is_newer_version_handles_prerelease_transitions() {
        // stable > prerelease when numeric parts equal
        assert!(is_newer_version("1.0.0-beta.1", "1.0.0"));
        // prerelease < stable when numeric parts equal
        assert!(!is_newer_version("1.0.0", "1.0.0-beta.1"));
        // same version → not newer
        assert!(!is_newer_version("1.0.0", "1.0.0"));
        // different prerelease tags compared lexicographically
        assert!(is_newer_version("1.0.0-alpha", "1.0.0-beta"), "beta > alpha lexicographically");
        assert!(!is_newer_version("1.0.0-alpha", "1.0.0-alpha"));
    }

    #[test]
    fn is_newer_version_returns_false_for_unparseable_inputs() {
        assert!(!is_newer_version("not-a-version", "1.0.0"));
        assert!(!is_newer_version("1.0.0", "not-a-version"));
        assert!(!is_newer_version("", ""));
    }

    // ===== parse_version_triplet =====

    #[test]
    fn parse_version_triplet_handles_various_formats() {
        let parsed = parse_version_triplet("1.2.3").unwrap();
        assert_eq!(parsed.numeric_parts, vec![1, 2, 3]);
        assert!(parsed.prerelease.is_none());

        let parsed = parse_version_triplet("v1.2.3-alpha").unwrap();
        assert_eq!(parsed.numeric_parts, vec![1, 2, 3]);
        assert_eq!(parsed.prerelease.as_deref(), Some("alpha"));

        let parsed = parse_version_triplet("1.2.3+build.42").unwrap();
        assert_eq!(parsed.numeric_parts, vec![1, 2, 3]);

        let parsed = parse_version_triplet("10.20.30-rc.2").unwrap();
        assert_eq!(parsed.numeric_parts, vec![10, 20, 30]);
        assert_eq!(parsed.prerelease.as_deref(), Some("rc.2"));
    }

    #[test]
    fn parse_version_triplet_rejects_empty_or_invalid() {
        assert!(parse_version_triplet("").is_none());
        assert!(parse_version_triplet("abc").is_none());
        assert!(parse_version_triplet("1.2.abc").is_none());
    }

    // ===== normalize_release_version =====

    #[test]
    fn normalize_release_version_strips_v_prefix() {
        assert_eq!(normalize_release_version("v1.0.3"), "1.0.3");
        assert_eq!(normalize_release_version("v1.0.3-beta"), "1.0.3-beta");
        assert_eq!(normalize_release_version("1.0.3"), "1.0.3");
        assert_eq!(normalize_release_version(""), "");
    }

    // ===== Windows installer detection =====

    #[test]
    fn windows_installer_asset_detection_supports_exe_and_msi() {
        assert!(is_windows_installer_asset("SlasshyWispr_0.1.1_x64-setup.exe"));
        assert!(is_windows_installer_asset("SlasshyWispr_0.1.1_x64.msi"));
        assert!(!is_windows_installer_asset("checksums.txt"));
        assert!(!is_windows_installer_asset("SlasshyWispr_0.1.1_x64-setup.exe.sig"));
    }

    #[test]
    fn windows_installer_kind_from_name_detects_exe() {
        assert!(matches!(windows_installer_kind_from_name("setup.exe"), Some(WindowsInstallerKind::Exe)));
    }

    #[test]
    fn windows_installer_kind_from_name_detects_msi() {
        assert!(matches!(windows_installer_kind_from_name("package.msi"), Some(WindowsInstallerKind::Msi)));
    }

    #[test]
    fn windows_installer_kind_from_name_rejects_sig() {
        assert!(windows_installer_kind_from_name("setup.exe.sig").is_none());
    }

    #[test]
    fn windows_installer_kind_from_name_rejects_txt() {
        assert!(windows_installer_kind_from_name("readme.txt").is_none());
    }

    #[test]
    fn exe_installer_supports_silent_mode_detects_setup() {
        assert!(exe_installer_supports_silent_mode("SlasshyWispr_1.0_x64-setup.exe"));
        assert!(exe_installer_supports_silent_mode("installer.exe"));
        assert!(exe_installer_supports_silent_mode("app-nsis.exe"));
    }

    #[test]
    fn exe_installer_supports_silent_mode_rejects_portable() {
        assert!(!exe_installer_supports_silent_mode("SlasshyWispr_portable.exe"));
        assert!(!exe_installer_supports_silent_mode("helper.exe"));
    }

    // ===== Installer selection =====

    #[test]
    fn select_windows_installer_asset_prefers_exe_setup_when_available() {
        let release = GithubLatestReleaseResponse {
            tag_name: "v0.1.1".to_string(),
            name: Some("v0.1.1".to_string()),
            body: None,
            draft: false,
            prerelease: false,
            published_at: None,
            html_url: None,
            assets: vec![
                GithubReleaseAsset {
                    name: "SlasshyWispr_0.1.1_x64.msi".to_string(),
                    browser_download_url: "https://example.com/SlasshyWispr_0.1.1_x64.msi".to_string(),
                },
                GithubReleaseAsset {
                    name: "SlasshyWispr_0.1.1_x64-setup.exe".to_string(),
                    browser_download_url: "https://example.com/SlasshyWispr_0.1.1_x64-setup.exe".to_string(),
                },
            ],
        };

        let selected = select_windows_installer_asset(&release)
            .expect("expected installer asset to be selected");
        assert_eq!(selected.name, "SlasshyWispr_0.1.1_x64-setup.exe");
    }

    #[test]
    fn select_windows_installer_asset_avoids_portable_or_mismatched_builds() {
        let release = GithubLatestReleaseResponse {
            tag_name: "v1.0.0".to_string(),
            name: None, body: None, draft: false, prerelease: false,
            published_at: None, html_url: None,
            assets: vec![
                GithubReleaseAsset {
                    name: "helper-installer.exe".to_string(),
                    browser_download_url: "https://example.com/helper-installer.exe".to_string(),
                },
                GithubReleaseAsset {
                    name: "SlasshyWispr_1.0.1_x64-setup.exe".to_string(),
                    browser_download_url: "https://example.com/SlasshyWispr_1.0.1_x64-setup.exe".to_string(),
                },
            ],
        };

        let selected = select_windows_installer_asset(&release)
            .expect("expected installer asset to be selected");
        assert_eq!(selected.name, "SlasshyWispr_1.0.1_x64-setup.exe");
    }

    #[test]
    fn select_windows_installer_asset_returns_none_for_empty_assets() {
        let release = GithubLatestReleaseResponse {
            tag_name: "v1.0.0".to_string(),
            name: None,
            body: None,
            draft: false,
            prerelease: false,
            published_at: None,
            html_url: None,
            assets: vec![],
        };
        assert!(select_windows_installer_asset(&release).is_none());
    }

    #[test]
    fn select_windows_installer_asset_uses_name_length_as_tiebreaker() {
        let release = GithubLatestReleaseResponse {
            tag_name: "v1.0.0".to_string(),
            name: None, body: None, draft: false, prerelease: false,
            published_at: None, html_url: None,
            assets: vec![
                GithubReleaseAsset {
                    name: "a.exe".to_string(),
                    browser_download_url: "https://example.com/a.exe".to_string(),
                },
                GithubReleaseAsset {
                    name: "longer-name.exe".to_string(),
                    browser_download_url: "https://example.com/longer-name.exe".to_string(),
                },
            ],
        };
        let selected = select_windows_installer_asset(&release)
            .expect("should pick one");
        assert_eq!(selected.name, "longer-name.exe", "longer name wins on tie");
    }

    // ===== Installer scoring =====

    #[test]
    fn windows_installer_score_prefers_nsis_setup_over_msi() {
        let setup_score = windows_installer_score("SlasshyWispr_1.0.3_x64-setup.exe", "v1.0.3");
        let msi_score = windows_installer_score("SlasshyWispr_1.0.3_x64.msi", "v1.0.3");
        assert!(setup_score > msi_score, "EXE setup should score higher than MSI");
    }

    #[test]
    fn windows_installer_score_penalizes_portable_and_debug() {
        let portable_score = windows_installer_score("SlasshyWispr_1.0.3_portable.exe", "v1.0.3");
        let normal_score = windows_installer_score("SlasshyWispr_1.0.3_x64-setup.exe", "v1.0.3");
        assert!(normal_score > portable_score, "normal installer should score higher than portable");
    }

    #[test]
    fn windows_installer_score_rejects_arm_and_x86() {
        let arm_score = windows_installer_score("SlasshyWispr_1.0.3_arm64-setup.exe", "v1.0.3");
        let x86_score = windows_installer_score("SlasshyWispr_1.0.3_x86-setup.exe", "v1.0.3");
        let x64_score = windows_installer_score("SlasshyWispr_1.0.3_x64-setup.exe", "v1.0.3");
        assert!(x64_score > arm_score, "x64 should score higher than arm64");
        assert!(x64_score > x86_score, "x64 should score higher than x86");
    }

    // ===== select_latest_stable_release =====

    #[test]
    fn select_latest_stable_release_skips_draft_and_prerelease() {
        let releases = vec![
            GithubLatestReleaseResponse {
                tag_name: "v1.0.0-rc.1".to_string(),
                name: None, body: None, draft: false, prerelease: true,
                published_at: None, html_url: None, assets: vec![],
            },
            GithubLatestReleaseResponse {
                tag_name: "v0.9.0".to_string(),
                name: None, body: None, draft: false, prerelease: false,
                published_at: None, html_url: None, assets: vec![],
            },
        ];
        let selected = select_latest_stable_release(&releases);
        assert_eq!(selected.map(|r| &r.tag_name), Some(&"v0.9.0".to_string()));
    }

    #[test]
    fn select_latest_stable_release_returns_none_when_all_draft() {
        let releases = vec![
            GithubLatestReleaseResponse {
                tag_name: "v1.0.0".to_string(),
                name: None, body: None, draft: true, prerelease: false,
                published_at: None, html_url: None, assets: vec![],
            },
        ];
        assert!(select_latest_stable_release(&releases).is_none());
    }

    // ===== Filename sanitization =====

    #[test]
    fn sanitize_installer_file_name_rejects_non_installer_extensions() {
        assert!(sanitize_installer_file_name("checksums.txt").is_none());
        assert!(sanitize_installer_file_name("readme.md").is_none());
        assert!(sanitize_installer_file_name("").is_none());
    }

    #[test]
    fn sanitize_installer_file_name_sanitizes_spaces_and_special_chars() {
        let result = sanitize_installer_file_name("SlasshyWispr 1.0.3 (x64) setup.exe");
        assert!(result.is_some());
        let name = result.unwrap();
        assert!(!name.contains(' '));
        assert!(!name.contains('('));
        assert!(!name.contains(')'));
        assert!(name.ends_with(".exe"));
    }

    // ===== extract_version_from_download_url =====

    #[test]
    fn extract_version_from_download_url_parses_github_url() {
        let url = "https://github.com/SlasshyOverhere/SlasshyWispr/releases/download/v1.0.3/SlasshyWispr_1.0.3_x64-setup.exe";
        assert_eq!(extract_version_from_download_url(url).as_deref(), Some("1.0.3"));
    }

    #[test]
    fn extract_version_from_download_url_handles_missing_tag_segment() {
        let url = "https://github.com/SlasshyOverhere/releases";
        assert!(extract_version_from_download_url(url).is_none());
    }

    #[test]
    fn extract_version_from_download_url_handles_invalid_url() {
        assert!(extract_version_from_download_url("not-a-url").is_none());
    }

    // ===== resolve_installer_file_name =====

    #[test]
    fn resolve_installer_file_name_keeps_supported_extension() {
        let from_asset = resolve_installer_file_name(
            Some("SlasshyWispr_0.1.2_x64.msi"),
            "https://example.com/download",
            "0.1.1",
        );
        assert_eq!(from_asset, "SlasshyWispr_0.1.2_x64.msi");

        let from_url = resolve_installer_file_name(
            None,
            "https://example.com/SlasshyWispr_0.1.2_x64-setup.exe",
            "0.1.1",
        );
        assert_eq!(from_url, "SlasshyWispr_0.1.2_x64-setup.exe");
    }

    #[test]
    fn resolve_installer_file_name_fallback_uses_target_version_from_url() {
        let url = "https://github.com/SlasshyOverhere/SlasshyWispr/releases/download/v1.0.3/SlasshyWispr_1.0.3_x64-setup.exe";
        let name = resolve_installer_file_name(None, url, "0.1.1");
        assert_eq!(name, "SlasshyWispr_1.0.3_x64-setup.exe");
    }

    #[test]
    fn resolve_installer_file_name_fallback_url_unknown_version() {
        // URL whose last path segment isn't a valid installer name —
        // should fall through to the version-extraction fallback.
        let url = "https://example.com/download/no-extension";
        let name = resolve_installer_file_name(None, url, "0.1.1");
        assert_eq!(name, "SlasshyWispr-unknown-update.exe");
    }

    // ===== validate_downloaded_installer_file =====

    #[test]
    fn validates_downloaded_installer_header_magic() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let exe_path = temp_dir.path().join("installer.exe");
        std::fs::write(&exe_path, b"MZ\x90\0\x03\0\0\0payload").expect("write exe");
        assert!(validate_downloaded_installer_file(&exe_path, WindowsInstallerKind::Exe).is_ok());

        let bad_exe_path = temp_dir.path().join("bad-installer.exe");
        std::fs::write(&bad_exe_path, b"<!DOCTYPE html>").expect("write bad exe");
        assert!(
            validate_downloaded_installer_file(&bad_exe_path, WindowsInstallerKind::Exe).is_err()
        );
    }

    #[test]
    fn validate_downloaded_installer_file_rejects_empty_exe() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let exe_path = temp_dir.path().join("empty.exe");
        std::fs::write(&exe_path, b"").expect("write empty");
        assert!(validate_downloaded_installer_file(&exe_path, WindowsInstallerKind::Exe).is_err());
    }

    #[test]
    fn validate_downloaded_installer_file_validates_msi_magic() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let msi_path = temp_dir.path().join("package.msi");
        const MSI_MAGIC: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
        std::fs::write(&msi_path, &MSI_MAGIC).expect("write msi");
        assert!(validate_downloaded_installer_file(&msi_path, WindowsInstallerKind::Msi).is_ok());

        let bad_path = temp_dir.path().join("bad.msi");
        std::fs::write(&bad_path, b"<package>").expect("write bad msi");
        assert!(validate_downloaded_installer_file(&bad_path, WindowsInstallerKind::Msi).is_err());
    }

    // ===== is_windows_installer_asset (comprehensive) =====

    #[test]
    fn is_windows_installer_asset_detects_known_formats() {
        assert!(is_windows_installer_asset("installer.exe"));
        assert!(is_windows_installer_asset("setup.msi"));
        assert!(is_windows_installer_asset("SlasshyWispr_1.0.3_x64-setup.exe"));
        assert!(!is_windows_installer_asset("SlasshyWispr_1.0.3_x64-setup.exe.sig"));
        assert!(!is_windows_installer_asset("checksums.txt"));
        assert!(!is_windows_installer_asset(""));
    }
}
