//! Headless local-STT benchmark: scores the model roster against a clip manifest.
//!
//! Drives the same `transcribe_audio_local` the app calls, so decode, VAD and engine
//! dispatch are included and a number here is the number a dictation would get.
//!
//! Results go to a file rather than stdout: the release binary is a Windows GUI
//! subsystem app and has no console to write to.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::commands::files::audio_mime_type_for_path;
use crate::pipeline::routing::{canonical_local_stt_model_id, LocalSttConfig};
use crate::services::transcribe::transcribe_audio_local;
use crate::state::AppState;

pub(crate) const STT_BENCH_ARG: &str = "--stt-bench";
pub(crate) const STT_BENCH_OUT_ARG: &str = "--stt-bench-out";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BenchArgs {
    pub(crate) manifest: PathBuf,
    pub(crate) out: Option<PathBuf>,
}

#[derive(Debug, Deserialize)]
struct BenchManifest {
    models: Vec<String>,
    clips: Vec<BenchClip>,
    #[serde(default)]
    language: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BenchClip {
    id: String,
    audio: String,
    #[serde(default)]
    reference: Option<String>,
}

/// Parse `--stt-bench <manifest>` / `--stt-bench-out <path>`, each also `=value` form.
pub(crate) fn parse_bench_args(args: &[String]) -> Option<BenchArgs> {
    Some(BenchArgs {
        manifest: PathBuf::from(flag_value(args, STT_BENCH_ARG)?),
        out: flag_value(args, STT_BENCH_OUT_ARG).map(PathBuf::from),
    })
}

fn flag_value(args: &[String], flag: &str) -> Option<String> {
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if arg.eq_ignore_ascii_case(flag) {
            return iter
                .next()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
        }
        if let Some(value) = arg
            .split_once('=')
            .filter(|(name, _)| name.eq_ignore_ascii_case(flag))
            .map(|(_, value)| value)
        {
            let value = value.trim().to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

fn default_out_path(manifest_path: &Path) -> PathBuf {
    manifest_path.with_file_name("stt-bench-results.jsonl")
}

/// Relative clip paths resolve against the manifest, so a clip set moves as one unit.
fn resolve_clip_path(manifest_path: &Path, audio: &str) -> PathBuf {
    let audio = PathBuf::from(audio);
    if audio.is_absolute() {
        return audio;
    }
    manifest_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(audio)
}

pub(crate) async fn run(app: &AppHandle, args: &BenchArgs) -> Result<PathBuf, String> {
    let raw = fs::read_to_string(&args.manifest).map_err(|error| {
        format!(
            "Could not read bench manifest {}: {error}",
            args.manifest.display()
        )
    })?;
    let manifest: BenchManifest = serde_json::from_str(&raw).map_err(|error| {
        format!(
            "Invalid bench manifest {}: {error}",
            args.manifest.display()
        )
    })?;
    if manifest.models.is_empty() {
        return Err("Bench manifest lists no models.".to_string());
    }
    if manifest.clips.is_empty() {
        return Err("Bench manifest lists no clips.".to_string());
    }

    let (http, set_loaded) = {
        let state = app.state::<AppState>();
        (state.http.clone(), state.set_local_stt_runtime_loaded(true))
    };
    set_loaded?;

    let mut records = Vec::new();
    for model in &manifest.models {
        let model = canonical_local_stt_model_id(model);
        let local = LocalSttConfig {
            stt_model: model.clone(),
        };
        log::info!("[stt.bench] model={} clips={}", model, manifest.clips.len());
        for (index, clip) in manifest.clips.iter().enumerate() {
            let audio_path = resolve_clip_path(&args.manifest, &clip.audio);
            let record = run_clip(
                app,
                &http,
                &local,
                &model,
                clip,
                index,
                &audio_path,
                manifest.language.as_deref(),
            )
            .await;
            records.push(record);
        }
    }

    let out_path = args
        .out
        .clone()
        .unwrap_or_else(|| default_out_path(&args.manifest));
    let mut body = String::new();
    for record in &records {
        body.push_str(&record.to_string());
        body.push('\n');
    }
    fs::write(&out_path, body).map_err(|error| {
        format!(
            "Could not write bench results {}: {error}",
            out_path.display()
        )
    })?;
    Ok(out_path)
}

#[allow(clippy::too_many_arguments)]
async fn run_clip(
    app: &AppHandle,
    http: &reqwest::Client,
    local: &LocalSttConfig,
    model: &str,
    clip: &BenchClip,
    index: usize,
    audio_path: &Path,
    language: Option<&str>,
) -> Value {
    let mut record = json!({
        "model": model,
        "clipId": clip.id,
        "index": index,
        // The first clip of a model pays for loading it; the scorer reports it apart.
        "cold": index == 0,
        "reference": clip.reference,
        "audio": audio_path.to_string_lossy(),
    });

    let failure = |message: String| {
        let mut record = record.clone();
        record["ok"] = json!(false);
        record["error"] = json!(message);
        record
    };

    let Some(mime) = audio_mime_type_for_path(&audio_path.to_string_lossy()) else {
        return failure(format!("Unsupported audio file: {}", audio_path.display()));
    };
    let bytes = match fs::read(audio_path) {
        Ok(bytes) => bytes,
        Err(error) => {
            return failure(format!(
                "Could not read audio {}: {error}",
                audio_path.display()
            ))
        }
    };

    let started = Instant::now();
    let result = transcribe_audio_local(app, http, local, &bytes, mime, language, None).await;
    let latency_ms = started.elapsed().as_millis() as u64;

    record["ok"] = json!(result.is_ok());
    record["latencyMs"] = json!(latency_ms);
    record["audioBytes"] = json!(bytes.len());
    match result {
        Ok(text) => record["text"] = json!(text),
        Err(error) => record["error"] = json!(error),
    }
    log::info!(
        "[stt.bench] model={} clip={} ok={} latency_ms={}",
        model,
        clip.id,
        record["ok"],
        latency_ms
    );
    record
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    #[test]
    fn parses_the_separated_and_equals_forms() {
        assert_eq!(
            parse_bench_args(&args(&["app.exe", "--stt-bench", "bench.json"])),
            Some(BenchArgs {
                manifest: PathBuf::from("bench.json"),
                out: None,
            })
        );
        assert_eq!(
            parse_bench_args(&args(&["app.exe", "--stt-bench=bench.json"])),
            Some(BenchArgs {
                manifest: PathBuf::from("bench.json"),
                out: None,
            })
        );
    }

    #[test]
    fn an_absent_or_empty_flag_is_not_a_bench_run() {
        assert_eq!(parse_bench_args(&args(&["app.exe"])), None);
        assert_eq!(parse_bench_args(&args(&["app.exe", "--stt-bench"])), None);
        assert_eq!(parse_bench_args(&args(&["app.exe", "--stt-bench="])), None);
        assert_eq!(
            parse_bench_args(&args(&["app.exe", "--stt-bench", " "])),
            None
        );
    }

    #[test]
    fn the_out_path_is_optional_and_parsed_from_either_form() {
        let parsed = parse_bench_args(&args(&[
            "--stt-bench",
            "bench.json",
            "--stt-bench-out",
            "results.jsonl",
        ]))
        .unwrap();
        assert_eq!(parsed.out, Some(PathBuf::from("results.jsonl")));
        let parsed = parse_bench_args(&args(&[
            "--stt-bench-out=results.jsonl",
            "--stt-bench=m.json",
        ]))
        .unwrap();
        assert_eq!(parsed.out, Some(PathBuf::from("results.jsonl")));
    }

    #[test]
    fn results_default_beside_the_manifest() {
        assert_eq!(
            default_out_path(Path::new("bench/clips.json")),
            PathBuf::from("bench/stt-bench-results.jsonl")
        );
    }

    #[test]
    fn a_relative_clip_resolves_against_the_manifest_directory() {
        assert_eq!(
            resolve_clip_path(Path::new("bench/clips.json"), "audio/a.wav"),
            PathBuf::from("bench/audio/a.wav")
        );
    }

    #[test]
    fn an_absolute_clip_is_used_verbatim() {
        let absolute = if cfg!(windows) {
            "C:\\clips\\a.wav"
        } else {
            "/clips/a.wav"
        };
        assert_eq!(
            resolve_clip_path(Path::new("bench/clips.json"), absolute),
            PathBuf::from(absolute)
        );
    }
}
