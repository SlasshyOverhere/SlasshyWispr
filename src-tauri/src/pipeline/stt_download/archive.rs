//! Prepacked Parakeet archive handling.
//!
//! Owns the prepacked archive source catalog (`LocalParakeetArchiveSource`)
//! and the on-disk model-root discovery used to validate extracted packages.

use std::fs;
use std::path::PathBuf;

use crate::constants::*;
use crate::pipeline::fs::file_exists_with_content;

/// Source metadata for a prepacked (mirrored) Parakeet int8 archive.
#[derive(Debug, Clone, Copy)]
pub(crate) struct LocalParakeetArchiveSource {
    pub(crate) archive_url: &'static str,
    pub(crate) expected_root_dir: &'static str,
}

/// Archive source for a repo id, if a prepacked mirror is configured.
pub(crate) fn local_parakeet_archive_source(repo_id: &str) -> Option<LocalParakeetArchiveSource> {
    match repo_id {
        "nvidia/parakeet-tdt_ctc-110m" => Some(LocalParakeetArchiveSource {
            archive_url: PARAKEET_V2_INT8_ARCHIVE_URL,
            expected_root_dir: PARAKEET_V2_INT8_ROOT_DIR,
        }),
        "nvidia/parakeet-tdt-0.6b-v3" => Some(LocalParakeetArchiveSource {
            archive_url: PARAKEET_V3_INT8_ARCHIVE_URL,
            expected_root_dir: PARAKEET_V3_INT8_ROOT_DIR,
        }),
        _ => None,
    }
}

/// Whether a directory looks like a compiled Parakeet int8 model root.
fn is_parakeet_model_directory(path: &std::path::Path) -> bool {
    let encoder_fp32 = path.join("encoder-model.onnx");
    let encoder_int8 = path.join("encoder-model.int8.onnx");
    let decoder_fp32 = path.join("decoder_joint-model.onnx");
    let decoder_int8 = path.join("decoder_joint-model.int8.onnx");
    let nemo128 = path.join("nemo128.onnx");
    let vocab = path.join("vocab.txt");
    let config = path.join("config.json");

    (file_exists_with_content(&encoder_fp32) || file_exists_with_content(&encoder_int8))
        && (file_exists_with_content(&decoder_fp32) || file_exists_with_content(&decoder_int8))
        && file_exists_with_content(&nemo128)
        && file_exists_with_content(&vocab)
        && file_exists_with_content(&config)
}

/// Locate the best compiled Parakeet model root under `root`.
pub(crate) fn find_local_parakeet_model_root(root: &std::path::Path) -> Result<PathBuf, String> {
    if !root.exists() {
        return Err(format!(
            "Local STT model directory does not exist: {}",
            root.display()
        ));
    }

    let mut stack = vec![root.to_path_buf()];
    let mut best: Option<(PathBuf, u64)> = None;
    let mut saw_legacy_nemo_file = false;
    while let Some(current) = stack.pop() {
        if is_parakeet_model_directory(&current) {
            let score = [
                "encoder-model.int8.onnx",
                "encoder-model.onnx",
                "decoder_joint-model.int8.onnx",
                "decoder_joint-model.onnx",
                "nemo128.onnx",
                "vocab.txt",
                "config.json",
            ]
            .iter()
            .map(|name| {
                fs::metadata(current.join(name))
                    .map(|meta| meta.len())
                    .unwrap_or(0)
            })
            .fold(0_u64, |acc, value| acc.saturating_add(value));

            match &best {
                Some((_, best_size)) if *best_size >= score => {}
                _ => best = Some((current.clone(), score)),
            }
        }

        let entries = fs::read_dir(&current).map_err(|error| {
            format!(
                "Failed to inspect local STT directory '{}': {error}",
                current.display()
            )
        })?;

        for entry in entries {
            let entry = entry.map_err(|error| {
                format!(
                    "Failed to inspect local STT directory entry in '{}': {error}",
                    current.display()
                )
            })?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let is_nemo = path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case("nemo"))
                .unwrap_or(false);
            if is_nemo {
                saw_legacy_nemo_file = true;
            }
        }
    }

    if let Some((path, _)) = best {
        return Ok(path);
    }

    if saw_legacy_nemo_file {
        return Err(format!(
            "Found legacy Parakeet *.nemo artifact in '{}', but native int8 runtime expects ONNX model directories. Re-download the selected Parakeet model from Settings > Models.",
            root.display()
        ));
    }

    Err(format!(
        "No compatible local Parakeet model directory found in '{}'.",
        root.display()
    ))
}