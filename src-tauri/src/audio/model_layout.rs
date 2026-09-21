//! On-disk layout discovery for in-process ASR engines.
//!
//! Every engine wants its files at the root of the directory it is handed, but a
//! downloaded HuggingFace snapshot keeps the repo's own nesting (`onnx/…`), so the
//! snapshot root is usually one level too high. These find the directory that
//! actually holds an engine's file set.

use std::fs;
use std::path::{Path, PathBuf};

use crate::pipeline::fs::file_exists_with_content;

/// Find the shallowest directory under `root` that contains every name in `required`.
///
/// Shallowest wins so a snapshot shipping a quantized copy inside the fp32 folder
/// cannot shadow it, and ties break on path so the choice is deterministic rather
/// than dependent on directory iteration order.
pub(crate) fn find_directory_containing(root: &Path, required: &[&str]) -> Result<PathBuf, String> {
    if !root.exists() {
        return Err(format!(
            "Local STT model directory does not exist: {}",
            root.display()
        ));
    }

    let mut matches: Vec<(usize, PathBuf)> = Vec::new();
    let mut frontier: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    while let Some((dir, depth)) = frontier.pop() {
        if required
            .iter()
            .all(|name| file_exists_with_content(&dir.join(name)))
        {
            matches.push((depth, dir.clone()));
        }
        let entries = fs::read_dir(&dir).map_err(|error| {
            format!(
                "Failed to inspect local STT directory '{}': {error}",
                dir.display()
            )
        })?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                frontier.push((path, depth + 1));
            }
        }
    }

    matches.sort();
    matches
        .into_iter()
        .next()
        .map(|(_, path)| path)
        .ok_or_else(|| {
            format!(
                "No directory under '{}' contains all of: {}.",
                root.display(),
                required.join(", ")
            )
        })
}

/// Find the shallowest file with `extension` under `root`.
///
/// Whisper ships one self-contained GGUF whose name carries the quantization, so the
/// caller cannot name the file up front the way [`find_directory_containing`] does.
/// When several quantizations are present the one containing `prefer` wins, then the
/// shallowest, then lexical order — so the choice never depends on directory order.
pub(crate) fn find_file_with_extension(
    root: &Path,
    extension: &str,
    prefer: &str,
) -> Result<PathBuf, String> {
    if !root.exists() {
        return Err(format!(
            "Local STT model directory does not exist: {}",
            root.display()
        ));
    }

    let suffix = format!(
        ".{}",
        extension.trim_start_matches('.').to_ascii_lowercase()
    );
    let mut matches: Vec<(usize, PathBuf)> = Vec::new();
    let mut frontier: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    while let Some((dir, depth)) = frontier.pop() {
        let entries = fs::read_dir(&dir).map_err(|error| {
            format!(
                "Failed to inspect local STT directory '{}': {error}",
                dir.display()
            )
        })?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                frontier.push((path, depth + 1));
                continue;
            }
            let named = path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.to_ascii_lowercase())
                .is_some_and(|name| name.ends_with(&suffix));
            if named && file_exists_with_content(&path) {
                matches.push((depth, path));
            }
        }
    }

    matches.sort();
    let preferred = matches
        .iter()
        .find(|(_, path)| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.contains(prefer))
        })
        .map(|(_, path)| path.clone());

    preferred
        .or_else(|| matches.into_iter().next().map(|(_, path)| path))
        .ok_or_else(|| format!("No '{suffix}' model file under '{}'.", root.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;

    /// Non-empty on purpose: a zero-byte file is what an interrupted download leaves
    /// behind, and the discovery helper deliberately ignores those.
    fn write(path: &Path, name: &str) {
        use std::io::Write;
        let mut file = File::create(path.join(name)).unwrap();
        file.write_all(b"x").unwrap();
    }

    fn temp_root(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("slasshywispr-layout-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn finds_a_complete_set_at_the_root() {
        let root = temp_root("flat");
        write(&root, "model.onnx");
        write(&root, "tokens.txt");

        assert_eq!(
            find_directory_containing(&root, &["model.onnx", "tokens.txt"]).unwrap(),
            root
        );
    }

    #[test]
    fn descends_into_a_nested_snapshot_directory() {
        let root = temp_root("nested");
        let nested = root.join("onnx");
        fs::create_dir_all(&nested).unwrap();
        write(&nested, "encoder_model.onnx");
        write(&nested, "decoder_model_merged.onnx");
        write(&nested, "tokenizer.json");

        assert_eq!(
            find_directory_containing(
                &root,
                &[
                    "encoder_model.onnx",
                    "decoder_model_merged.onnx",
                    "tokenizer.json"
                ]
            )
            .unwrap(),
            nested
        );
    }

    #[test]
    fn prefers_the_shallowest_directory_that_qualifies() {
        let root = temp_root("shallowest");
        write(&root, "model.onnx");
        write(&root, "tokens.txt");
        let deeper = root.join("int8");
        fs::create_dir_all(&deeper).unwrap();
        write(&deeper, "model.onnx");
        write(&deeper, "tokens.txt");

        assert_eq!(
            find_directory_containing(&root, &["model.onnx", "tokens.txt"]).unwrap(),
            root
        );
    }

    #[test]
    fn a_partial_set_does_not_qualify() {
        let root = temp_root("partial");
        write(&root, "model.onnx");

        let error = find_directory_containing(&root, &["model.onnx", "tokens.txt"]).unwrap_err();
        assert!(error.contains("tokens.txt"), "{error}");
    }

    #[test]
    fn a_missing_root_names_the_directory_it_looked_in() {
        let missing = std::env::temp_dir().join("slasshywispr-layout-absent-dir");
        let _ = fs::remove_dir_all(&missing);

        let error = find_directory_containing(&missing, &["model.onnx"]).unwrap_err();
        assert!(error.contains(&missing.display().to_string()), "{error}");
    }

    #[test]
    fn finds_a_model_file_by_extension() {
        let root = temp_root("extension");
        let nested = root.join("snapshot");
        fs::create_dir_all(&nested).unwrap();
        write(&nested, "whisper-small-Q5_K_M.gguf");

        assert_eq!(
            find_file_with_extension(&root, ".gguf", "Q5_K_M").unwrap(),
            nested.join("whisper-small-Q5_K_M.gguf")
        );
    }

    #[test]
    fn a_preferred_quantization_beats_a_shallower_one() {
        let root = temp_root("quantization");
        write(&root, "whisper-small-Q8_0.gguf");
        let deeper = root.join("quantized");
        fs::create_dir_all(&deeper).unwrap();
        write(&deeper, "whisper-small-Q5_K_M.gguf");

        assert_eq!(
            find_file_with_extension(&root, "gguf", "Q5_K_M").unwrap(),
            deeper.join("whisper-small-Q5_K_M.gguf")
        );
    }

    #[test]
    fn a_zero_byte_model_file_is_not_a_model() {
        let root = temp_root("gguf-empty");
        write(&root, "whisper-small-Q8_0.gguf");
        File::create(root.join("whisper-small-Q5_K_M.gguf")).unwrap();

        assert_eq!(
            find_file_with_extension(&root, "gguf", "Q5_K_M").unwrap(),
            root.join("whisper-small-Q8_0.gguf")
        );
    }

    #[test]
    fn no_matching_file_names_the_extension_it_wanted() {
        let root = temp_root("gguf-absent");
        write(&root, "model.onnx");

        let error = find_file_with_extension(&root, "gguf", "Q5_K_M").unwrap_err();
        assert!(error.contains(".gguf"), "{error}");
    }

    #[test]
    fn an_interrupted_download_does_not_look_like_a_model() {
        let root = temp_root("empty");
        write(&root, "model.onnx");
        File::create(root.join("tokens.txt")).unwrap(); // zero bytes

        let error = find_directory_containing(&root, &["model.onnx", "tokens.txt"]).unwrap_err();
        assert!(error.contains("tokens.txt"), "{error}");
    }
}
