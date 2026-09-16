//! Backend services — Phase 7 domain logic extracted from commands.
//!
//! Services own business logic; commands stay thin adapters.

pub mod transcribe;

pub(crate) use transcribe::{
    transcribe_audio, transcribe_audio_local,
};
