//! UIPI elevation policy for synthetic input.
//!
//! Windows blocks input injection from a lower-integrity process into a
//! higher-integrity window, so a paste keystroke aimed at an elevated app is
//! dropped with no error. Detecting that case lets the caller keep the
//! transcription on the clipboard and say so, instead of appearing to work.
//!
//! Pure — no Win32 calls, no state.

/// Why a synthetic paste cannot be delivered to the target window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PasteBlockReason {
    TargetElevated,
}

impl PasteBlockReason {
    pub(crate) fn message(self) -> &'static str {
        match self {
            PasteBlockReason::TargetElevated => {
                "the target window runs elevated, so Windows blocks synthetic input; the transcription is on your clipboard — press Ctrl+V there"
            }
        }
    }
}

/// Decide whether the paste keystroke must be skipped.
///
/// An elevated process may inject into anything, so only a lower-integrity
/// sender aimed at an elevated target is blocked. Unknown elevation is treated
/// as not-elevated so an unreadable token never wedges normal pasting.
pub(crate) fn paste_block_reason(
    target_elevated: bool,
    self_elevated: bool,
) -> Option<PasteBlockReason> {
    if target_elevated && !self_elevated {
        Some(PasteBlockReason::TargetElevated)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_paste_into_elevated_target_from_standard_process() {
        assert_eq!(
            paste_block_reason(true, false),
            Some(PasteBlockReason::TargetElevated)
        );
    }

    #[test]
    fn allows_paste_into_elevated_target_when_we_are_elevated() {
        assert_eq!(paste_block_reason(true, true), None);
    }

    #[test]
    fn allows_paste_into_standard_target() {
        assert_eq!(paste_block_reason(false, false), None);
        assert_eq!(paste_block_reason(false, true), None);
    }

    #[test]
    fn block_message_tells_the_user_the_text_is_on_the_clipboard() {
        let message = PasteBlockReason::TargetElevated.message();
        assert!(message.contains("clipboard"), "{message}");
        assert!(message.contains("elevated"), "{message}");
    }
}
