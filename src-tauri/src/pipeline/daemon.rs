//! Daemon process infrastructure for Coqui TTS and local STT bridges.
//!
//! This module establishes the canonical interface for daemon operations.
//! The implementations currently live in `lib.rs` and are re-exported here.
//! Future work can move the implementations into this module to complete
//! the separation.

// Re-export all daemon functions from the crate root.
// This allows tts.rs and other pipeline modules to depend on
// `pipeline::daemon` instead of `crate::` directly.
pub use crate::{
    ensure_local_stt_daemon_idle_sweeper, local_stt_model_unload_idle_timeout_secs,
    local_stt_parakeet_unload_after_transcribe, parse_coqui_bridge_response,
    run_coqui_bridge_via_daemon, run_local_stt_bridge_via_daemon,
    stop_all_coqui_bridge_daemons, stop_all_local_stt_bridge_daemons,
    stop_all_local_stt_bridge_daemons_with_count,
    trim_all_local_stt_bridge_daemon_model_caches,
};
