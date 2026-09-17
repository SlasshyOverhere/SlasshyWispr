//! Daemon process infrastructure for Coqui TTS and local STT bridges.
//!
//! This module owns the lifecycle of long-running Python bridge daemons,
//! including spawning, request dispatch, retry, idle cleanup, and the
//! periodic sweeper thread.
//!
//! It is **runtime-dependent** (spawns subprocesses, uses `OnceLock` global
//! state) but has **no Tauri or AppState dependencies**.
//!
//! Facade (Phase 8): shared JSONL transport lives in `transport`, the Coqui
//! stay-alive lifecycle in `coqui`, and the local-STT two-tier reaper in
//! `local_stt`. Re-exports preserve the `pipeline::daemon::X` paths used by
//! commands, services, and `lib.rs`. No generic supervisor: lifecycle policy
//! stays separate per daemon.

pub mod coqui;
pub mod local_stt;
pub mod transport;

pub use coqui::{
    parse_coqui_bridge_response, run_coqui_bridge_via_daemon, stop_all_coqui_bridge_daemons,
};
pub use local_stt::{
    ensure_local_stt_daemon_idle_sweeper, run_local_stt_bridge_via_daemon,
    stop_all_local_stt_bridge_daemons, stop_all_local_stt_bridge_daemons_with_count,
    trim_all_local_stt_bridge_daemon_model_caches,
};

pub(crate) use local_stt::local_stt_daemon_stats;
