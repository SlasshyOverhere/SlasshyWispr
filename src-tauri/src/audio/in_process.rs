//! Shared lifecycle for in-process ASR engines.
//!
//! Whisper, Moonshine and SenseVoice each need the same three things from us: load
//! once, keep the model resident across dictations, and reload when the selection
//! changes. Only the engines differ, so this owns the caching and the serialization
//! and delegates the actual work to an [`InProcessEngine`] adapter.
//!
//! The cache is keyed by a caller-supplied model key rather than by directory, so a
//! config change that reuses a path (say, one repo directory holding two variants)
//! reloads instead of silently serving the wrong model.

use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// The part of an engine that the cache needs: unload, and turn samples into text.
///
/// Construction is not part of this trait — it takes engine-specific configuration,
/// so callers pass a builder closure to [`AsrEngineCache::get_or_load`].
pub(crate) trait InProcessEngine: Send + 'static {
    /// Release the model. Must be safe to call when nothing is loaded.
    fn unload(&mut self);
    /// Transcribe mono 16 kHz f32 samples.
    fn transcribe(&mut self, samples: &[f32]) -> Result<String, String>;
}

struct Loaded<E> {
    key: String,
    engine: E,
    last_used: Instant,
}

/// A single-slot, serialized cache for one engine type.
pub(crate) struct AsrEngineCache<E: InProcessEngine> {
    /// Held for the whole of a load or a transcription, so a reload cannot interleave
    /// with inference.
    operation: Mutex<()>,
    loaded: Mutex<Option<Loaded<E>>>,
}

impl<E: InProcessEngine> AsrEngineCache<E> {
    pub(crate) const fn new() -> Self {
        Self {
            operation: Mutex::new(()),
            loaded: Mutex::new(None),
        }
    }

    /// Load `key`'s model from `root` unless that same key is already resident.
    ///
    /// Returns whether the model was already loaded, matching the older Parakeet
    /// contract so callers can log it identically.
    pub(crate) fn get_or_load<F>(&self, key: &str, root: &Path, build: F) -> Result<bool, String>
    where
        F: FnOnce(&Path) -> Result<E, String>,
    {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| "ASR operation lock poisoned.".to_string())?;
        let mut slot = self
            .loaded
            .lock()
            .map_err(|_| "ASR model lock poisoned.".to_string())?;

        if let Some(current) = slot.as_mut() {
            if current.key == key {
                current.last_used = Instant::now();
                return Ok(true);
            }
            current.engine.unload();
            *slot = None;
        }

        let engine = build(root)?;
        *slot = Some(Loaded {
            key: key.to_string(),
            engine,
            last_used: Instant::now(),
        });
        Ok(false)
    }

    /// Transcribe with the resident model, or report that nothing is loaded.
    pub(crate) fn transcribe(&self, samples: &[f32]) -> Result<String, String> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| "ASR operation lock poisoned.".to_string())?;
        let mut slot = self
            .loaded
            .lock()
            .map_err(|_| "ASR model lock poisoned.".to_string())?;
        let loaded = slot
            .as_mut()
            .ok_or_else(|| "In-process ASR model is not loaded.".to_string())?;
        loaded.last_used = Instant::now();
        loaded.engine.transcribe(samples)
    }

    /// Drop the resident model. Returns whether anything was loaded.
    pub(crate) fn unload(&self) -> Result<bool, String> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| "ASR operation lock poisoned.".to_string())?;
        let mut slot = self
            .loaded
            .lock()
            .map_err(|_| "ASR model lock poisoned.".to_string())?;
        match slot.take() {
            Some(mut loaded) => {
                loaded.engine.unload();
                Ok(true)
            }
            None => Ok(false),
        }
    }

    /// Tri-state: `None` when an operation holds the lock, so the answer is unknown.
    pub(crate) fn is_loaded(&self) -> Option<bool> {
        match self.loaded.try_lock() {
            Ok(slot) => Some(slot.is_some()),
            Err(std::sync::TryLockError::WouldBlock) => None,
            Err(std::sync::TryLockError::Poisoned(_)) => Some(false),
        }
    }

    /// Drop the resident model when it has been idle for at least `max_idle`.
    ///
    /// Returns the key it released. An in-flight transcription means "not idle", so
    /// this skips rather than waiting on it — the sweep runs on a timer and must never
    /// block dictation.
    pub(crate) fn unload_if_idle(&self, max_idle: Duration) -> Option<String> {
        let _operation = self.operation.try_lock().ok()?;
        let mut slot = self.loaded.try_lock().ok()?;
        let idle = slot
            .as_ref()
            .map(|loaded| loaded.last_used.elapsed() >= max_idle)
            .unwrap_or(false);
        if !idle {
            return None;
        }
        let mut loaded = slot.take()?;
        loaded.engine.unload();
        Some(loaded.key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[derive(Default)]
    struct Counters {
        loads: AtomicUsize,
        unloads: AtomicUsize,
        transcriptions: AtomicUsize,
    }

    struct FakeEngine {
        counters: Arc<Counters>,
        text: String,
    }

    impl FakeEngine {
        fn build(
            counters: &Arc<Counters>,
            text: &str,
        ) -> impl FnOnce(&Path) -> Result<Self, String> {
            let counters = Arc::clone(counters);
            let text = text.to_string();
            move |_root| {
                counters.loads.fetch_add(1, Ordering::SeqCst);
                Ok(Self { counters, text })
            }
        }
    }

    impl InProcessEngine for FakeEngine {
        fn unload(&mut self) {
            self.counters.unloads.fetch_add(1, Ordering::SeqCst);
        }

        fn transcribe(&mut self, samples: &[f32]) -> Result<String, String> {
            self.counters.transcriptions.fetch_add(1, Ordering::SeqCst);
            Ok(format!("{}{}", self.text, samples.len()))
        }
    }

    fn cache() -> AsrEngineCache<FakeEngine> {
        AsrEngineCache::new()
    }

    #[test]
    fn reloads_only_when_the_model_key_changes() {
        let counters = Arc::new(Counters::default());
        let cache = cache();
        let root = Path::new("/models");
        assert!(!cache
            .get_or_load("a", root, FakeEngine::build(&counters, "a"))
            .unwrap());
        assert!(cache
            .get_or_load("a", root, FakeEngine::build(&counters, "a"))
            .unwrap());
        assert_eq!(counters.loads.load(Ordering::SeqCst), 1);

        assert!(!cache
            .get_or_load("b", root, FakeEngine::build(&counters, "b"))
            .unwrap());
        assert_eq!(counters.loads.load(Ordering::SeqCst), 2);
        assert_eq!(
            counters.unloads.load(Ordering::SeqCst),
            1,
            "the old model is released"
        );
        assert_eq!(
            cache.transcribe(&[0.0; 2]).unwrap(),
            "b2",
            "the new model is the one in use"
        );
    }

    #[test]
    fn transcribe_reuses_the_resident_model() {
        let counters = Arc::new(Counters::default());
        let cache = cache();
        cache
            .get_or_load(
                "a",
                Path::new("/models"),
                FakeEngine::build(&counters, "->"),
            )
            .unwrap();

        assert_eq!(cache.transcribe(&[0.0; 3]).unwrap(), "->3");
        assert_eq!(cache.transcribe(&[0.0; 5]).unwrap(), "->5");
        assert_eq!(counters.loads.load(Ordering::SeqCst), 1);
        assert_eq!(counters.transcriptions.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn transcribing_without_a_loaded_model_is_an_error_not_a_panic() {
        let counters = Arc::new(Counters::default());
        let cache: AsrEngineCache<FakeEngine> = cache();
        let error = cache.transcribe(&[0.0]).unwrap_err();
        assert!(error.contains("not loaded"), "{error}");
        assert_eq!(counters.transcriptions.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn unload_releases_the_model_and_is_idempotent() {
        let counters = Arc::new(Counters::default());
        let cache = cache();
        cache
            .get_or_load("a", Path::new("/models"), FakeEngine::build(&counters, "x"))
            .unwrap();

        assert!(cache.unload().unwrap());
        assert!(!cache.unload().unwrap());
        assert_eq!(
            counters.unloads.load(Ordering::SeqCst),
            1,
            "unloaded exactly once"
        );
        assert_eq!(cache.is_loaded(), Some(false));
        assert!(cache.transcribe(&[0.0]).is_err());
    }

    #[test]
    fn a_failed_load_leaves_the_cache_empty() {
        let counters = Arc::new(Counters::default());
        let cache = cache();
        cache
            .get_or_load("a", Path::new("/models"), FakeEngine::build(&counters, "x"))
            .unwrap();

        let error = cache
            .get_or_load("b", Path::new("/models"), |_root| {
                Err("missing file".to_string())
            })
            .unwrap_err();
        assert_eq!(error, "missing file");
        assert_eq!(
            cache.is_loaded(),
            Some(false),
            "the previous model is gone and nothing took its place"
        );
        assert!(cache.transcribe(&[0.0]).is_err());
    }

    #[test]
    fn is_loaded_reports_unknown_while_inference_holds_the_model() {
        let counters = Arc::new(Counters::default());
        let cache = cache();
        cache
            .get_or_load("a", Path::new("/models"), FakeEngine::build(&counters, "x"))
            .unwrap();

        // Inference runs holding the model lock, so the answer is genuinely unknown
        // rather than "not loaded" — reporting false here would read as a missing model.
        let in_flight = cache.loaded.lock().unwrap();
        assert_eq!(cache.is_loaded(), None);
        drop(in_flight);
        assert_eq!(cache.is_loaded(), Some(true));
    }

    #[test]
    fn idle_unload_releases_only_a_model_that_is_actually_idle() {
        let counters = Arc::new(Counters::default());
        let cache = cache();
        cache
            .get_or_load("a", Path::new("/models"), FakeEngine::build(&counters, "x"))
            .unwrap();

        assert_eq!(cache.unload_if_idle(Duration::from_secs(3600)), None);
        assert_eq!(cache.is_loaded(), Some(true));

        // `elapsed() >= 0` always holds, so a zero budget models "idle for ages".
        assert_eq!(cache.unload_if_idle(Duration::ZERO).as_deref(), Some("a"));
        assert_eq!(cache.is_loaded(), Some(false));
        assert_eq!(
            cache.unload_if_idle(Duration::ZERO),
            None,
            "nothing left to release"
        );
    }

    #[test]
    fn idle_unload_skips_rather_than_blocks_an_in_flight_operation() {
        let counters = Arc::new(Counters::default());
        let cache = cache();
        cache
            .get_or_load("a", Path::new("/models"), FakeEngine::build(&counters, "x"))
            .unwrap();

        let in_flight = cache.loaded.lock().unwrap();
        assert_eq!(cache.unload_if_idle(Duration::ZERO), None);
        drop(in_flight);
        assert_eq!(cache.is_loaded(), Some(true));
    }

    #[test]
    fn transcribing_keeps_the_model_from_looking_idle() {
        let counters = Arc::new(Counters::default());
        let cache = cache();
        cache
            .get_or_load("a", Path::new("/models"), FakeEngine::build(&counters, "x"))
            .unwrap();

        cache.transcribe(&[0.0]).unwrap();
        // A generous budget means the just-used model is not treated as idle.
        assert_eq!(cache.unload_if_idle(Duration::from_secs(3600)), None);
        assert_eq!(cache.is_loaded(), Some(true));
    }
}
