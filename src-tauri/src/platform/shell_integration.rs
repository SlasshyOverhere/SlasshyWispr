//! Explorer context-menu integration.
//!
//! Verbs are registered per user under HKCU\Software\Classes, so enabling them
//! never needs elevation. Verb planning and command-line assembly are pure so
//! the layout stays testable without touching the registry.

use crate::constants::{
    SHELL_TRANSCRIBE_ARG, SHELL_VERB_REGISTRY_ROOT, TRANSCRIBE_FILE_EXTENSIONS,
};
use std::path::Path;

pub(crate) const TRANSCRIBE_VERB_KEY: &str = "SlasshyWispr.Transcribe";
pub(crate) const TRANSCRIBE_VERB_LABEL: &str = "Transcribe with SlasshyWispr";
pub(crate) const DICTATE_VERB_KEY: &str = "SlasshyWispr.Dictate";
pub(crate) const DICTATE_VERB_LABEL: &str = "New SlasshyWispr dictation";

/// One Explorer verb: where it hangs and what it runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ShellVerb {
    /// Path under `HKCU\Software\Classes`.
    pub key_path: String,
    pub label: &'static str,
    /// Arguments appended after the quoted executable, with Explorer's `%1`
    /// style substitutions already in place.
    pub arguments: &'static str,
    /// Explorer hands `%1` one file at a time, so multi-select must be off.
    pub single_selection: bool,
}

/// One verb per audio extension rather than a `*` verb, so the menu entry only
/// appears on files this app can actually decode.
pub(crate) fn shell_verbs() -> Vec<ShellVerb> {
    let mut verbs: Vec<ShellVerb> = TRANSCRIBE_FILE_EXTENSIONS
        .iter()
        .map(|extension| ShellVerb {
            key_path: format!(".{extension}\\shell\\{TRANSCRIBE_VERB_KEY}"),
            label: TRANSCRIBE_VERB_LABEL,
            arguments: transcribe_file_arguments(),
            single_selection: true,
        })
        .collect();

    verbs.push(ShellVerb {
        key_path: format!("Directory\\Background\\shell\\{DICTATE_VERB_KEY}"),
        label: DICTATE_VERB_LABEL,
        arguments: "",
        single_selection: false,
    });

    verbs
}

/// Explorer substitution for the selected file, quoted for paths with spaces.
pub(crate) fn transcribe_file_arguments() -> &'static str {
    "--transcribe-file \"%1\""
}

/// Parse `--transcribe-file <path>` (or `--transcribe-file=<path>`) from argv.
///
/// Explorer quotes the substituted path and a shell can leave the quotes in
/// place, so surrounding quotes are stripped. A flag with no usable value
/// yields `None`, which launches the app normally instead of failing.
pub(crate) fn parse_transcribe_file_arg(args: &[String]) -> Option<String> {
    let equals_form = format!("{SHELL_TRANSCRIBE_ARG}=");
    let mut iter = args.iter().skip(1);

    while let Some(arg) = iter.next() {
        if arg.eq_ignore_ascii_case(SHELL_TRANSCRIBE_ARG) {
            let cleaned = iter.next().map(|value| clean_file_argument(value));
            return cleaned.filter(|value| !value.is_empty());
        }
        if let Some(value) = arg.strip_prefix(&equals_form) {
            let cleaned = clean_file_argument(value);
            return if cleaned.is_empty() {
                None
            } else {
                Some(cleaned)
            };
        }
    }

    None
}

fn clean_file_argument(raw: &str) -> String {
    raw.trim().trim_matches('"').trim().to_string()
}

/// The command line Explorer runs for a verb.
pub(crate) fn shell_verb_command_line(exe_path: &str, arguments: &str) -> String {
    if arguments.is_empty() {
        format!("\"{exe_path}\"")
    } else {
        format!("\"{exe_path}\" {arguments}")
    }
}

/// Split a verb key path into `(parent, leaf)` so the leaf can be deleted.
pub(crate) fn split_parent_key(key_path: &str) -> Option<(String, String)> {
    let (parent, leaf) = key_path.rsplit_once('\\')?;
    if parent.is_empty() || leaf.is_empty() {
        return None;
    }
    Some((parent.to_string(), leaf.to_string()))
}

#[cfg(target_os = "windows")]
pub(crate) fn register_shell_integration(exe_path: &Path) -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let exe = exe_path.to_string_lossy().to_string();
    let classes = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(SHELL_VERB_REGISTRY_ROOT)
        .map_err(|error| format!("Failed to open shell verb registry root: {error}"))?
        .0;

    for verb in shell_verbs() {
        let (key, _) = classes
            .create_subkey(&verb.key_path)
            .map_err(|error| format!("Failed to create shell verb '{}': {error}", verb.key_path))?;
        key.set_value("", &verb.label)
            .map_err(|error| format!("Failed to label shell verb '{}': {error}", verb.key_path))?;

        if verb.single_selection {
            key.set_value("MultiSelectModel", &"Single")
                .map_err(|error| {
                    format!(
                        "Failed to set shell verb selection model '{}': {error}",
                        verb.key_path
                    )
                })?;
        }

        let (command, _) = key
            .create_subkey("command")
            .map_err(|error| format!("Failed to create shell verb command: {error}"))?;
        command
            .set_value("", &shell_verb_command_line(&exe, verb.arguments))
            .map_err(|error| format!("Failed to set shell verb command: {error}"))?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
pub(crate) fn unregister_shell_integration() -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    for verb in shell_verbs() {
        let Some((parent, leaf)) = split_parent_key(&verb.key_path) else {
            continue;
        };
        let full_parent = format!("{SHELL_VERB_REGISTRY_ROOT}\\{parent}");
        let Ok(key) = hkcu.open_subkey_with_flags(&full_parent, KEY_ALL_ACCESS) else {
            continue;
        };
        // Already absent is success; the verb is gone either way.
        let _ = key.delete_subkey_all(&leaf);
    }

    Ok(())
}

/// Registered only when every verb points at this exact executable, so a moved
/// or re-installed build does not look enabled while Explorer calls the old path.
#[cfg(target_os = "windows")]
pub(crate) fn shell_integration_is_registered(exe_path: &Path) -> bool {
    use winreg::enums::*;
    use winreg::RegKey;

    let exe = exe_path.to_string_lossy().to_string();
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    shell_verbs().iter().all(|verb| {
        let Ok(key) = hkcu.open_subkey(format!("{SHELL_VERB_REGISTRY_ROOT}\\{}", verb.key_path))
        else {
            return false;
        };
        let Ok(command) = key.open_subkey("command") else {
            return false;
        };
        let Ok(registered) = command.get_value::<String, _>("") else {
            return false;
        };
        registered == shell_verb_command_line(&exe, verb.arguments)
    })
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn register_shell_integration(_exe_path: &Path) -> Result<(), String> {
    Err("Shell integration is currently implemented for Windows builds only.".to_string())
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn unregister_shell_integration() -> Result<(), String> {
    Err("Shell integration is currently implemented for Windows builds only.".to_string())
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn shell_integration_is_registered(_exe_path: &Path) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(items: &[&str]) -> Vec<String> {
        std::iter::once("app.exe")
            .chain(items.iter().copied())
            .map(str::to_string)
            .collect()
    }

    #[test]
    fn registers_a_file_verb_for_each_supported_extension() {
        let verbs = shell_verbs();
        assert_eq!(verbs.len(), TRANSCRIBE_FILE_EXTENSIONS.len() + 1);
        assert_eq!(verbs[0].key_path, ".wav\\shell\\SlasshyWispr.Transcribe");
        assert_eq!(verbs[0].label, "Transcribe with SlasshyWispr");
        assert_eq!(verbs[0].arguments, "--transcribe-file \"%1\"");
        assert!(verbs[0].single_selection);
    }

    #[test]
    fn file_verbs_never_target_every_file_type() {
        // A `*` verb would offer transcription for PDFs and executables too.
        let verbs = shell_verbs();
        assert!(verbs.iter().all(|verb| !verb.key_path.starts_with("*\\")));

        let (file_verbs, background) = verbs.split_at(TRANSCRIBE_FILE_EXTENSIONS.len());
        assert!(file_verbs.iter().all(|verb| verb.key_path.starts_with('.')));
        assert_eq!(background.len(), 1);
        assert!(background[0].key_path.starts_with("Directory\\"));
    }

    #[test]
    fn registers_a_background_dictation_verb_last() {
        let verbs = shell_verbs();
        let last = verbs.last().expect("background verb");
        assert_eq!(
            last.key_path,
            "Directory\\Background\\shell\\SlasshyWispr.Dictate"
        );
        assert!(last.arguments.is_empty());
        assert!(!last.single_selection);
    }

    #[test]
    fn command_line_quotes_the_executable() {
        let line = shell_verb_command_line("C:\\Program Files\\SlasshyWispr\\app.exe", "");
        assert_eq!(line, "\"C:\\Program Files\\SlasshyWispr\\app.exe\"");
    }

    #[test]
    fn command_line_appends_arguments_after_the_executable() {
        let line =
            shell_verb_command_line("C:\\app.exe", "--transcribe-file \"C:\\my recording.wav\"");
        assert_eq!(
            line,
            "\"C:\\app.exe\" --transcribe-file \"C:\\my recording.wav\""
        );
    }

    #[test]
    fn splits_a_verb_key_into_parent_and_leaf() {
        assert_eq!(
            split_parent_key("Directory\\Background\\shell\\SlasshyWispr.Dictate"),
            Some((
                "Directory\\Background\\shell".to_string(),
                "SlasshyWispr.Dictate".to_string()
            ))
        );
    }

    #[test]
    fn rejects_key_paths_without_a_parent() {
        assert_eq!(split_parent_key("SlasshyWispr.Dictate"), None);
        assert_eq!(split_parent_key("a\\"), None);
    }

    #[test]
    fn parses_the_separated_file_argument() {
        assert_eq!(
            parse_transcribe_file_arg(&args(&["--transcribe-file", "C:\\audio\\note.wav"])),
            Some("C:\\audio\\note.wav".to_string())
        );
    }

    #[test]
    fn parses_the_equals_form() {
        assert_eq!(
            parse_transcribe_file_arg(&args(&["--transcribe-file=C:\\a.wav"])),
            Some("C:\\a.wav".to_string())
        );
    }

    #[test]
    fn strips_surrounding_quotes_from_the_path() {
        assert_eq!(
            parse_transcribe_file_arg(&args(&[
                "--transcribe-file",
                "\"C:\\My Recordings\\note.wav\""
            ])),
            Some("C:\\My Recordings\\note.wav".to_string())
        );
    }

    #[test]
    fn parses_the_argument_alongside_other_flags() {
        assert_eq!(
            parse_transcribe_file_arg(&args(&[
                "--start-in-tray",
                "--transcribe-file",
                "C:\\a.wav"
            ])),
            Some("C:\\a.wav".to_string())
        );
    }

    #[test]
    fn ignores_a_flag_without_a_value() {
        assert_eq!(
            parse_transcribe_file_arg(&args(&["--transcribe-file"])),
            None
        );
        assert_eq!(
            parse_transcribe_file_arg(&args(&["--transcribe-file", ""])),
            None
        );
        assert_eq!(
            parse_transcribe_file_arg(&args(&["--transcribe-file="])),
            None
        );
    }

    #[test]
    fn does_not_match_a_similarly_named_flag() {
        // A prefix match here would launch a transcription for an unrelated flag.
        assert_eq!(
            parse_transcribe_file_arg(&args(&["--transcribe-files", "C:\\a.wav"])),
            None
        );
    }

    #[test]
    fn returns_none_when_no_file_flag_is_present() {
        assert_eq!(parse_transcribe_file_arg(&args(&["--start-in-tray"])), None);
        assert_eq!(parse_transcribe_file_arg(&args(&[])), None);
    }
}
