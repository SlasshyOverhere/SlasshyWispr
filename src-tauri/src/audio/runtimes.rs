//! One place that knows every in-process local STT engine.
//!
//! The paths that release models (deleting a model, deactivating local STT, the idle
//! sweep) all need the same answer, and each engine holds a model in a different
//! module. Listing them here means adding an engine is one edit rather than four
//! call sites that each have to remember it.

use std::time::Duration;

use log::info;

/// Engines that can hold a local STT model resident in this process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LocalSttEngine {
    Parakeet,
    Moonshine,
    SenseVoice,
    Whisper,
}

impl LocalSttEngine {
    pub(crate) const ALL: [LocalSttEngine; 4] = [
        LocalSttEngine::Parakeet,
        LocalSttEngine::Moonshine,
        LocalSttEngine::SenseVoice,
        LocalSttEngine::Whisper,
    ];

    pub(crate) fn label(&self) -> &'static str {
        match self {
            LocalSttEngine::Parakeet => "parakeet",
            LocalSttEngine::Moonshine => "moonshine",
            LocalSttEngine::SenseVoice => "sense_voice",
            LocalSttEngine::Whisper => "whisper",
        }
    }
}

/// The engine that serves a provider, if it runs in this process at all.
pub(crate) fn engine_for_provider(provider: &str) -> Option<LocalSttEngine> {
    match provider.trim().to_ascii_lowercase().as_str() {
        "parakeet" => Some(LocalSttEngine::Parakeet),
        "moonshine" => Some(LocalSttEngine::Moonshine),
        "sensevoice" | "sense_voice" => Some(LocalSttEngine::SenseVoice),
        "whisper" => Some(LocalSttEngine::Whisper),
        _ => None,
    }
}

/// Whisper's native engine is `transcribe-cpp`, which we only build for Windows x86_64.
/// Off that target the engine has no runtime, so these answer as if nothing is resident.
/// The three bodies are identical by construction, which is why they share one cfg each.
fn whisper_runtime_loaded() -> Option<bool> {
    #[cfg(all(windows, target_arch = "x86_64"))]
    {
        crate::audio::whisper::runtime_loaded()
    }
    #[cfg(not(all(windows, target_arch = "x86_64")))]
    {
        Some(false)
    }
}

fn unload_whisper_runtime() -> bool {
    #[cfg(all(windows, target_arch = "x86_64"))]
    {
        crate::audio::whisper::unload_runtime().unwrap_or(false)
    }
    #[cfg(not(all(windows, target_arch = "x86_64")))]
    {
        false
    }
}

fn unload_idle_whisper_runtime(max_idle: Duration) -> Option<String> {
    #[cfg(all(windows, target_arch = "x86_64"))]
    {
        crate::audio::whisper::unload_idle_runtime(max_idle)
    }
    #[cfg(not(all(windows, target_arch = "x86_64")))]
    {
        let _ = max_idle;
        None
    }
}

fn unload_engine(engine: LocalSttEngine) -> bool {
    match engine {
        LocalSttEngine::Parakeet => {
            crate::audio::parakeet::unload_native_parakeet_runtime("unload-all").unwrap_or(false)
        }
        LocalSttEngine::Moonshine => crate::audio::moonshine::unload_runtime().unwrap_or(false),
        LocalSttEngine::SenseVoice => crate::audio::sense_voice::unload_runtime().unwrap_or(false),
        LocalSttEngine::Whisper => unload_whisper_runtime(),
    }
}

fn unload_idle_engine(engine: LocalSttEngine, max_idle: Duration) -> Option<String> {
    match engine {
        // Parakeet's sweep lives with its own runtime; it reports through the same
        // idle-timeout path in `pipeline::daemon::local_stt`.
        LocalSttEngine::Parakeet => None,
        LocalSttEngine::Moonshine => crate::audio::moonshine::unload_idle_runtime(max_idle),
        LocalSttEngine::SenseVoice => crate::audio::sense_voice::unload_idle_runtime(max_idle),
        LocalSttEngine::Whisper => unload_idle_whisper_runtime(max_idle),
    }
}

/// Release every resident in-process model. Returns the engines that had one.
pub(crate) fn unload_all() -> Vec<&'static str> {
    LocalSttEngine::ALL
        .into_iter()
        .filter(|engine| unload_engine(*engine))
        .map(|engine| engine.label())
        .collect()
}

/// Release models idle for at least `max_idle`. Returns the engines that released one.
pub(crate) fn unload_idle(max_idle: Duration) -> Vec<&'static str> {
    let mut released = Vec::new();
    for engine in LocalSttEngine::ALL {
        if let Some(key) = unload_idle_engine(engine, max_idle) {
            info!(
                "[local.stt.idle] released idle in-process model engine={} key={}",
                engine.label(),
                crate::pipeline::log::clip_text(&key, 220)
            );
            released.push(engine.label());
        }
    }
    released
}

/// `name=state` for every engine, where state is `true`/`false`/`busy`.
pub(crate) fn states() -> Vec<(&'static str, &'static str)> {
    LocalSttEngine::ALL
        .into_iter()
        .map(|engine| {
            let state = match engine {
                LocalSttEngine::Parakeet => {
                    crate::audio::parakeet::native_parakeet_runtime_loaded()
                }
                LocalSttEngine::Moonshine => crate::audio::moonshine::runtime_loaded(),
                LocalSttEngine::SenseVoice => crate::audio::sense_voice::runtime_loaded(),
                LocalSttEngine::Whisper => whisper_runtime_loaded(),
            };
            let label = match state {
                Some(true) => "true",
                Some(false) => "false",
                None => "busy",
            };
            (engine.label(), label)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn providers_map_onto_engines_and_unknown_ones_do_not() {
        assert_eq!(
            engine_for_provider("parakeet"),
            Some(LocalSttEngine::Parakeet)
        );
        assert_eq!(
            engine_for_provider("Moonshine"),
            Some(LocalSttEngine::Moonshine)
        );
        assert_eq!(
            engine_for_provider("sensevoice"),
            Some(LocalSttEngine::SenseVoice)
        );
        assert_eq!(
            engine_for_provider("sense_voice"),
            Some(LocalSttEngine::SenseVoice)
        );
        assert_eq!(
            engine_for_provider("whisper"),
            Some(LocalSttEngine::Whisper)
        );
        assert_eq!(engine_for_provider("openai/whisper-small"), None);
    }

    #[test]
    fn every_engine_is_listed_exactly_once_with_a_distinct_label() {
        let mut labels: Vec<&str> = LocalSttEngine::ALL.iter().map(|e| e.label()).collect();
        let total = labels.len();
        labels.sort_unstable();
        labels.dedup();
        assert_eq!(
            labels.len(),
            total,
            "duplicate engine label in LocalSttEngine::ALL"
        );
    }

    #[test]
    fn states_cover_every_engine() {
        let states = states();
        assert_eq!(states.len(), LocalSttEngine::ALL.len());
        for (label, state) in states {
            assert!(
                ["true", "false", "busy"].contains(&state),
                "{label}={state}"
            );
        }
    }
}
