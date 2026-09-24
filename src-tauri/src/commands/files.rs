//! Audio-file intake commands.
//!
//! Backs Explorer's "Transcribe with SlasshyWispr" verb: the frontend takes the
//! path handed over at launch and reads the bytes through here, because the
//! webview cannot open arbitrary filesystem paths.

use std::fs;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use serde::Serialize;
use tauri::State;

use crate::constants::MAX_TRANSCRIBE_FILE_BYTES;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AudioFilePayload {
    pub(crate) file_name: String,
    pub(crate) mime_type: String,
    pub(crate) base64: String,
    pub(crate) byte_length: u64,
}

/// MIME type for an audio file, by extension. `None` for anything else, so an
/// unsupported file is refused instead of being fed to STT as garbage.
pub(crate) fn audio_mime_type_for_path(file_name: &str) -> Option<&'static str> {
    let extension = file_name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())?;

    match extension.as_str() {
        "wav" => Some("audio/wav"),
        "mp3" => Some("audio/mpeg"),
        "m4a" | "mp4" => Some("audio/mp4"),
        "ogg" | "oga" => Some("audio/ogg"),
        "opus" => Some("audio/opus"),
        "flac" => Some("audio/flac"),
        "webm" => Some("audio/webm"),
        "aac" => Some("audio/aac"),
        "aiff" | "aif" => Some("audio/aiff"),
        _ => None,
    }
}

fn file_name_of(path: &str) -> String {
    path.rsplit(['\\', '/'])
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(path)
        .to_string()
}

#[tauri::command]
pub(crate) async fn take_pending_transcribe_file(
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let pending = state.take_pending_transcribe_file();
    // Handing the path over is what authorizes reading it back.
    if let Some(path) = pending.as_deref() {
        state.arm_transcribe_file(path);
    }
    Ok(pending)
}

#[tauri::command]
pub(crate) async fn read_audio_file_base64(
    state: State<'_, AppState>,
    path: String,
) -> Result<AudioFilePayload, String> {
    let trimmed = AppState::normalize_transcribe_path(&path);
    if trimmed.is_empty() {
        return Err("No file path was provided.".to_string());
    }
    // The webview may only read a path this app handed it (Explorer's verb parks
    // or forwards it), so a path it invents is refused instead of being read.
    if !state.take_armed_transcribe_file(&trimmed) {
        return Err(
            "That file was not opened through SlasshyWispr. Choose it again from Explorer's \"Transcribe with SlasshyWispr\" menu."
                .to_string(),
        );
    }

    let file_name = file_name_of(&trimmed);
    let mime_type = audio_mime_type_for_path(&file_name).ok_or_else(|| {
        format!(
            "'{file_name}' is not a supported audio file. Try WAV, MP3, M4A, OGG, FLAC or WebM."
        )
    })?;

    let metadata =
        fs::metadata(&trimmed).map_err(|error| format!("Failed to open '{file_name}': {error}"))?;
    if !metadata.is_file() {
        return Err(format!("'{file_name}' is not a file."));
    }
    if metadata.len() == 0 {
        return Err(format!("'{file_name}' is empty."));
    }
    if metadata.len() > MAX_TRANSCRIBE_FILE_BYTES {
        return Err(format!(
            "'{file_name}' is larger than the {} MB limit.",
            MAX_TRANSCRIBE_FILE_BYTES / (1024 * 1024)
        ));
    }

    let bytes =
        fs::read(&trimmed).map_err(|error| format!("Failed to read '{file_name}': {error}"))?;

    Ok(AudioFilePayload {
        file_name,
        mime_type: mime_type.to_string(),
        base64: BASE64_STANDARD.encode(&bytes),
        byte_length: bytes.len() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_common_audio_extensions() {
        assert_eq!(audio_mime_type_for_path("note.wav"), Some("audio/wav"));
        assert_eq!(audio_mime_type_for_path("note.MP3"), Some("audio/mpeg"));
        assert_eq!(audio_mime_type_for_path("note.m4a"), Some("audio/mp4"));
        assert_eq!(audio_mime_type_for_path("note.ogg"), Some("audio/ogg"));
        assert_eq!(audio_mime_type_for_path("note.flac"), Some("audio/flac"));
        assert_eq!(audio_mime_type_for_path("note.webm"), Some("audio/webm"));
    }

    #[test]
    fn every_registered_verb_extension_is_readable() {
        // The Explorer verbs and this MIME map are separate lists; a drift here
        // would show a menu entry that always fails.
        for extension in crate::constants::TRANSCRIBE_FILE_EXTENSIONS {
            let file_name = format!("sample.{extension}");
            assert!(
                audio_mime_type_for_path(&file_name).is_some(),
                "'{extension}' is offered by the shell verb but has no MIME type"
            );
        }
    }

    #[test]
    fn rejects_non_audio_extensions() {
        assert_eq!(audio_mime_type_for_path("report.pdf"), None);
        assert_eq!(audio_mime_type_for_path("script.exe"), None);
        assert_eq!(audio_mime_type_for_path("no-extension"), None);
        assert_eq!(audio_mime_type_for_path("archive.wav.zip"), None);
    }

    #[test]
    fn extracts_the_file_name_from_either_separator() {
        assert_eq!(file_name_of("C:\\Users\\me\\note.wav"), "note.wav");
        assert_eq!(file_name_of("/home/me/note.wav"), "note.wav");
        assert_eq!(file_name_of("note.wav"), "note.wav");
    }
}
