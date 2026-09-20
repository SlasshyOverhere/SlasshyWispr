//! Explorer context-menu integration.
//!
//! Verbs are registered per user under HKCU\Software\Classes, so enabling them
//! never needs elevation. Verb planning and command-line assembly are pure so
//! the layout stays testable without touching the registry.

use crate::constants::SHELL_VERB_REGISTRY_ROOT;
use std::path::Path;

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
}

pub(crate) fn shell_verbs() -> Vec<ShellVerb> {
    vec![ShellVerb {
        key_path: format!("Directory\\Background\\shell\\{DICTATE_VERB_KEY}"),
        label: DICTATE_VERB_LABEL,
        arguments: "",
    }]
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

#[cfg(target_os = "windows")]
pub(crate) fn shell_integration_is_registered(exe_path: &Path) -> bool {
    use winreg::enums::*;
    use winreg::RegKey;

    let exe = exe_path.to_string_lossy().to_string();
    let expected = shell_verb_command_line(&exe, shell_verbs()[0].arguments);

    let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(format!(
        "{SHELL_VERB_REGISTRY_ROOT}\\{}",
        shell_verbs()[0].key_path
    )) else {
        return false;
    };
    let Ok(command) = key.open_subkey("command") else {
        return false;
    };
    let Ok(registered) = command.get_value::<String, _>("") else {
        return false;
    };

    registered == expected
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

    #[test]
    fn registers_a_background_dictation_verb() {
        let verbs = shell_verbs();
        assert_eq!(verbs.len(), 1);
        assert_eq!(
            verbs[0].key_path,
            "Directory\\Background\\shell\\SlasshyWispr.Dictate"
        );
        assert_eq!(verbs[0].label, "New SlasshyWispr dictation");
        assert!(verbs[0].arguments.is_empty());
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
}
