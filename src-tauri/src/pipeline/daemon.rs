//! Daemon process infrastructure for Coqui TTS and local STT bridges.
//!
//! This module owns the lifecycle of long-running Python bridge daemons,
//! including spawning, request dispatch, retry, idle cleanup, and the
//! periodic sweeper thread.
//!
//! It is **runtime-dependent** (spawns subprocesses, uses `OnceLock` global
//! state) but has **no Tauri or AppState dependencies**.
//!
//! Facade (Phase 8): shared JSONL transport lives in `transport` and the Coqui
//! stay-alive lifecycle in `coqui`. Re-exports preserve the `pipeline::daemon::X`
//! paths used by commands, services, and `lib.rs`. No generic supervisor:
//! lifecycle policy stays separate per daemon.

pub mod coqui;
pub mod transport;

pub use coqui::{
    parse_coqui_bridge_response, run_coqui_bridge_via_daemon, stop_all_coqui_bridge_daemons,
};
