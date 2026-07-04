#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import Counter
import gc
import json
import logging
import os
import sys
import warnings
from pathlib import Path
from typing import Any


MODEL_CACHE: dict[str, Any] = {}
TORCH_RUNTIME_CONFIGURED = False

# Reduce noisy runtime warnings in daemon stderr output.
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("TRANSFORMERS_NO_ADVISORY_WARNINGS", "1")
# Prefer HF_HOME and avoid deprecated TRANSFORMERS_CACHE warnings from inherited env.
os.environ.pop("TRANSFORMERS_CACHE", None)

warnings.filterwarnings(
    "ignore",
    message=r".*load_with_torchcodec.*",
    category=UserWarning,
)
warnings.filterwarnings(
    "ignore",
    message=r".*Using `TRANSFORMERS_CACHE` is deprecated.*",
    category=FutureWarning,
)


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    value = str(raw).strip().lower()
    if value in {"1", "true", "yes", "y", "on"}:
        return True
    if value in {"0", "false", "no", "n", "off"}:
        return False
    return default


PARAKEET_FORCE_CPU = _env_flag("SLASSHY_STT_PARAKEET_FORCE_CPU", False)
PARAKEET_CPU_INT8 = _env_flag("SLASSHY_STT_PARAKEET_CPU_INT8", True)


def _compact_memory(force_cuda_empty_cache: bool = False) -> None:
    gc.collect()
    if not force_cuda_empty_cache:
        return
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def _evict_model_cache_except(keep_key: str) -> None:
    stale_keys = [key for key in list(MODEL_CACHE.keys()) if key != keep_key]
    if not stale_keys:
        return
    for key in stale_keys:
        MODEL_CACHE.pop(key, None)
    _compact_memory(force_cuda_empty_cache=True)


def _error(message: str) -> dict[str, Any]:
    return {"ok": False, "error": message}


def _success(result: dict[str, Any]) -> dict[str, Any]:
    return {"ok": True, "result": result}


def _extract_transcript(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (list, tuple)):
        for item in value:
            transcript = _extract_transcript(item)
            if transcript:
                return transcript
        return ""
    if isinstance(value, dict):
        for key in ("text", "pred_text", "transcript", "preds", "chunks"):
            candidate = value.get(key)
            transcript = _extract_transcript(candidate)
            if transcript:
                return transcript
        return ""
    for attr in ("text", "pred_text", "transcript", "preds", "chunks"):
        if hasattr(value, attr):
            transcript = _extract_transcript(getattr(value, attr))
            if transcript:
                return transcript
    candidate = str(value).strip()
    if candidate and candidate.lower() not in {"none", "nan"}:
        return candidate
    return ""


def _load_nemo_module():
    logging.getLogger().setLevel(logging.ERROR)
    import nemo.collections.asr as nemo_asr  # type: ignore

    return nemo_asr


def _configure_torch_runtime() -> None:
    global TORCH_RUNTIME_CONFIGURED
    if TORCH_RUNTIME_CONFIGURED:
        return

    try:
        import torch

        torch.set_grad_enabled(False)
        if torch.cuda.is_available():
            try:
                torch.backends.cuda.matmul.allow_tf32 = True
            except Exception:
                pass
            try:
                torch.backends.cudnn.allow_tf32 = True
            except Exception:
                pass
            try:
                torch.backends.cudnn.benchmark = True
            except Exception:
                pass
    except Exception:
        pass

    TORCH_RUNTIME_CONFIGURED = True


def _pick_device() -> str:
    if PARAKEET_FORCE_CPU:
        return "cpu"
    _configure_torch_runtime()
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def _hf_device_index() -> tuple[int, str]:
    _configure_torch_runtime()
    try:
        import torch

        if torch.cuda.is_available():
            return 0, "cuda"
    except Exception:
        pass
    return -1, "cpu"


def _try_quantize_parakeet_cpu_int8(model: Any) -> tuple[Any, str]:
    if not PARAKEET_CPU_INT8:
        return model, "fp32"

    try:
        import torch
    except Exception:
        return model, "fp32"

    candidate_apis = []
    try:
        candidate_apis.append(torch.ao.quantization.quantize_dynamic)  # type: ignore[attr-defined]
    except Exception:
        pass
    try:
        candidate_apis.append(torch.quantization.quantize_dynamic)  # type: ignore[attr-defined]
    except Exception:
        pass

    for quantize_dynamic in candidate_apis:
        try:
            quantized = quantize_dynamic(model, {torch.nn.Linear}, dtype=torch.qint8)
            return quantized, "int8-dynamic"
        except Exception:
            continue

    return model, "fp32"


def _preview_object(value: Any, max_chars: int = 320) -> str:
    try:
        text = json.dumps(value, ensure_ascii=True, default=str)
    except Exception:
        text = str(value)
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "..."


def _normalize_language_hint(raw: Any) -> str | None:
    value = str(raw or "").strip().lower()
    if not value:
        return None

    value = value.replace("_", "-")
    if value in {"auto", "auto-detect", "auto-detection", "none", "null"}:
        return None

    aliases = {
        "english": "en",
        "spanish": "es",
        "french": "fr",
        "german": "de",
        "italian": "it",
        "portuguese": "pt",
        "hindi": "hi",
        "bengali": "bn",
        "japanese": "ja",
        "korean": "ko",
        "chinese": "zh",
        "arabic": "ar",
        "russian": "ru",
    }
    value = aliases.get(value, value)
    if "-" in value:
        maybe_iso2 = value.split("-", 1)[0].strip()
        if len(maybe_iso2) == 2:
            value = maybe_iso2
    return value or None


def _normalize_language_allow_list(raw: Any) -> list[str]:
    if raw is None:
        return []

    if isinstance(raw, str):
        values: list[Any] = [part.strip() for part in raw.split(",")]
    elif isinstance(raw, (list, tuple, set)):
        values = list(raw)
    else:
        values = [raw]

    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        language = _normalize_language_hint(value)
        if not language or language in seen:
            continue
        seen.add(language)
        normalized.append(language)
    return normalized


def _is_repetitive_transcript_noise(text: str) -> bool:
    compact = [char for char in text if not char.isspace()]
    if len(compact) < 24:
        return False

    longest_run = 1
    current_run = 1
    for index in range(1, len(compact)):
        if compact[index] == compact[index - 1]:
            current_run += 1
            if current_run > longest_run:
                longest_run = current_run
        else:
            current_run = 1

    if longest_run >= 10:
        return True

    counts = Counter(compact)
    unique_chars = len(counts)
    dominant_ratio = max(counts.values()) / float(len(compact))
    if unique_chars <= 2 and len(compact) >= 18:
        return True
    if unique_chars <= 3 and dominant_ratio >= 0.70:
        return True
    return False


def _transcript_score(text: str) -> int:
    return sum(1 for char in text if char.isalnum())


def _is_moonshine_model_dir(model_path: Path) -> bool:
    name = model_path.name.lower()
    if "moonshine" in name:
        return True
    config_path = model_path / "config.json"
    if config_path.is_file():
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
            model_type = str(config.get("model_type") or "").lower()
            if "moonshine" in model_type:
                return True
        except Exception:
            pass
    return False


def _is_whisper_model_dir(model_path: Path) -> bool:
    name = model_path.name.lower()
    if "whisper" in name:
        return True
    config_path = model_path / "config.json"
    if config_path.is_file():
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
            model_type = str(config.get("model_type") or "").lower()
            if "whisper" in model_type:
                return True
        except Exception:
            pass
    return False


def _load_audio_array(audio_path: Path, target_sample_rate: int | None) -> tuple[Any, int]:
    import torch
    import torchaudio

    waveform, sample_rate = torchaudio.load(str(audio_path))
    if waveform.ndim == 2 and waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    elif waveform.ndim == 1:
        waveform = waveform.unsqueeze(0)

    if target_sample_rate and sample_rate != target_sample_rate:
        waveform = torchaudio.functional.resample(waveform, sample_rate, target_sample_rate)
        sample_rate = target_sample_rate

    audio = waveform.squeeze(0).to(torch.float32).cpu().numpy()
    return audio, int(sample_rate)


def _load_parakeet_model(model_path: Path) -> tuple[Any, bool, str, str]:
    if not model_path.is_file():
        raise RuntimeError(f"Parakeet model file not found: {model_path}")

    resolved = str(model_path.resolve())
    _configure_torch_runtime()
    cached = MODEL_CACHE.get(resolved)
    if cached is not None:
        device = "cuda" if str(getattr(cached, "device", "cpu")).startswith("cuda") else "cpu"
        precision = str(getattr(cached, "_slasshy_precision", "fp32"))
        return cached, True, device, precision

    nemo_asr = _load_nemo_module()
    device = _pick_device()
    map_location = "cuda" if device == "cuda" else "cpu"
    model = nemo_asr.models.ASRModel.restore_from(str(model_path), map_location=map_location)
    precision = "fp32"
    try:
        model = model.eval()
    except Exception:
        pass
    try:
        model.freeze()
    except Exception:
        pass
    if device == "cuda":
        try:
            model = model.to("cuda")
        except Exception:
            pass
        try:
            model = model.half()
            precision = "fp16"
        except Exception:
            precision = "fp32"
    else:
        model, precision = _try_quantize_parakeet_cpu_int8(model)
    try:
        setattr(model, "_slasshy_precision", precision)
    except Exception:
        pass

    _evict_model_cache_except(resolved)
    MODEL_CACHE[resolved] = model
    return model, False, device, precision


def _load_faster_whisper_runner(model_path: Path) -> tuple[dict[str, Any], bool, str]:
    if not model_path.exists() or not model_path.is_dir():
        raise RuntimeError(f"Model directory not found: {model_path}")

    resolved = str(model_path.resolve())
    _, device = _hf_device_index()
    compute_type = "float16" if device == "cuda" else "int8"
    cache_key = f"faster_whisper::{resolved}::{device}:{compute_type}"
    cached = MODEL_CACHE.get(cache_key)
    if cached is not None:
        return cached, True, device

    from faster_whisper import WhisperModel  # type: ignore

    # Keep beam size conservative for low latency command/dictation usage.
    model = WhisperModel(
        resolved,
        device=device,
        compute_type=compute_type,
        local_files_only=True,
    )
    runner = {
        "kind": "faster_whisper",
        "model": model,
        "computeType": compute_type,
    }
    _evict_model_cache_except(cache_key)
    MODEL_CACHE[cache_key] = runner
    return runner, False, device


def _load_hf_asr_runner(
    model_path: Path,
    provider_hint: str,
    model_id_hint: str,
) -> tuple[dict[str, Any], bool, str]:
    if not model_path.exists() or not model_path.is_dir():
        raise RuntimeError(f"Model directory not found: {model_path}")

    normalized_provider = provider_hint.strip().lower()
    normalized_model_id = model_id_hint.strip().lower()

    # Prefer faster-whisper for Whisper family models.
    wants_whisper_fast_path = (
        normalized_provider == "whisper"
        or "whisper" in normalized_model_id
        or _is_whisper_model_dir(model_path)
    )
    if wants_whisper_fast_path:
        try:
            return _load_faster_whisper_runner(model_path)
        except Exception:
            # Fall through to transformers fallback when local artifacts are not in
            # CTranslate2 format or faster-whisper runtime is unavailable.
            pass

    resolved = str(model_path.resolve())
    device_index, device = _hf_device_index()
    cache_key = f"hf_asr_runner::{resolved}::{device}"
    cached = MODEL_CACHE.get(cache_key)
    if cached is not None:
        return cached, True, device

    import torch
    from transformers import AutoProcessor, pipeline  # type: ignore

    if _is_moonshine_model_dir(model_path):
        try:
            from transformers import MoonshineForConditionalGeneration  # type: ignore

            torch_dtype = torch.float16 if device == "cuda" else torch.float32
            model = MoonshineForConditionalGeneration.from_pretrained(
                resolved,
                trust_remote_code=True,
            )
            model = model.to(device)
            if torch_dtype != torch.float32:
                model = model.to(torch_dtype)
            model.eval()

            processor = AutoProcessor.from_pretrained(resolved, trust_remote_code=True)
            runner: dict[str, Any] = {
                "kind": "moonshine",
                "model": model,
                "processor": processor,
                "torch_dtype": str(torch_dtype).replace("torch.", ""),
            }
            _evict_model_cache_except(cache_key)
            MODEL_CACHE[cache_key] = runner
            return runner, False, device
        except Exception:
            # Fallback to generic ASR pipeline if Moonshine class is unavailable
            # in the installed transformers build.
            pass

    torch_dtype = torch.float16 if device == "cuda" else torch.float32
    processor = AutoProcessor.from_pretrained(resolved, trust_remote_code=True)
    asr = pipeline(
        "automatic-speech-recognition",
        model=resolved,
        tokenizer=processor.tokenizer,
        feature_extractor=processor.feature_extractor,
        trust_remote_code=True,
        device=device_index,
        torch_dtype=torch_dtype,
    )
    runner = {
        "kind": "pipeline",
        "pipeline": asr,
    }
    _evict_model_cache_except(cache_key)
    MODEL_CACHE[cache_key] = runner
    return runner, False, device


def action_warmup_parakeet(request: dict[str, Any]) -> dict[str, Any]:
    model_path = Path(str(request.get("modelPath") or "").strip())
    _, model_cached, device, precision = _load_parakeet_model(model_path)
    return {
        "ready": True,
        "modelCached": model_cached,
        "device": device,
        "precision": precision,
    }


def action_transcribe_parakeet(request: dict[str, Any]) -> dict[str, Any]:
    model_path = Path(str(request.get("modelPath") or "").strip())
    audio_path = Path(str(request.get("audioPath") or "").strip())
    if not audio_path.is_file():
        raise RuntimeError(f"Audio file not found: {audio_path}")

    unload_after_transcribe = bool(request.get("unloadAfterTranscribe") or False)
    asr_model, model_cached, device, precision = _load_parakeet_model(model_path)
    try:
        import torch

        with torch.inference_mode():
            raw = asr_model.transcribe([str(audio_path)], batch_size=1, num_workers=0, verbose=False)
    except Exception:
        raw = asr_model.transcribe([str(audio_path)], batch_size=1, num_workers=0, verbose=False)
    text = _extract_transcript(raw)
    if not text:
        raise RuntimeError(f"Parakeet returned an empty transcript. raw={_preview_object(raw)}")
    if _is_repetitive_transcript_noise(text):
        raise RuntimeError(
            f"Parakeet returned repetitive transcript noise. raw={_preview_object(raw)}"
        )
    unloaded_after_transcribe = False
    if unload_after_transcribe:
        MODEL_CACHE.clear()
        _compact_memory(force_cuda_empty_cache=True)
        unloaded_after_transcribe = True
    return {
        "text": text,
        "modelCached": model_cached,
        "device": device,
        "precision": precision,
        "unloadedAfterTranscribe": unloaded_after_transcribe,
    }


def action_warmup_hf_asr(request: dict[str, Any]) -> dict[str, Any]:
    model_path = Path(str(request.get("modelPath") or "").strip())
    provider_hint = str(request.get("provider") or "").strip()
    model_id_hint = str(request.get("modelId") or "").strip()
    _, model_cached, device = _load_hf_asr_runner(model_path, provider_hint, model_id_hint)
    return {"ready": True, "modelCached": model_cached, "device": device}


def action_transcribe_hf_asr(request: dict[str, Any]) -> dict[str, Any]:
    model_path = Path(str(request.get("modelPath") or "").strip())
    audio_path = Path(str(request.get("audioPath") or "").strip())
    if not audio_path.is_file():
        raise RuntimeError(f"Audio file not found: {audio_path}")

    provider_hint = str(request.get("provider") or "").strip()
    model_id_hint = str(request.get("modelId") or "").strip()
    language_hint = _normalize_language_hint(request.get("language"))
    allowed_languages = _normalize_language_allow_list(request.get("allowedLanguages"))
    if language_hint and language_hint not in allowed_languages:
        allowed_languages.insert(0, language_hint)
    normalized_provider = provider_hint.lower()
    normalized_model_id = model_id_hint.lower()
    is_whisper_family = (
        normalized_provider == "whisper"
        or "whisper" in normalized_model_id
        or _is_whisper_model_dir(model_path)
    )
    runner, model_cached, device = _load_hf_asr_runner(
        model_path,
        provider_hint,
        model_id_hint,
    )
    raw: Any
    if runner.get("kind") == "faster_whisper":
        model = runner["model"]

        def run_faster_whisper_decode(options: dict[str, Any], language_value: str | None):
            decode_kwargs = dict(options)
            decode_kwargs["task"] = "transcribe"
            if language_value:
                decode_kwargs["language"] = language_value
            try:
                return model.transcribe(str(audio_path), **decode_kwargs)
            except TypeError:
                decode_kwargs.pop("task", None)
                return model.transcribe(str(audio_path), **decode_kwargs)

        candidate_languages: list[str | None]
        if is_whisper_family:
            if allowed_languages:
                candidate_languages = list(allowed_languages)
            elif language_hint:
                candidate_languages = [language_hint]
            else:
                candidate_languages = [None]
        else:
            candidate_languages = [language_hint] if language_hint else [None]

        def decode_best(
            options: dict[str, Any],
            languages: list[str | None],
        ) -> tuple[str, Any, str]:
            best_transcript = ""
            best_info: Any = None
            best_language = ""
            best_score = -1
            for candidate_language in languages:
                segments, info = run_faster_whisper_decode(options, candidate_language)
                transcript = " ".join(
                    segment.text.strip() for segment in segments if str(segment.text).strip()
                ).strip()
                if not transcript or _is_repetitive_transcript_noise(transcript):
                    continue

                score = _transcript_score(transcript)
                if score > best_score:
                    best_score = score
                    best_transcript = transcript
                    best_info = info
                    best_language = candidate_language or ""
            return best_transcript, best_info, best_language

        transcribe_options = {
            "beam_size": 1,
            "best_of": 1,
            "temperature": 0.0,
            "condition_on_previous_text": False,
            "vad_filter": False,
        }
        transcript, info, transcript_language = decode_best(
            transcribe_options,
            candidate_languages,
        )

        if not transcript:
            # Retry once with a slightly more robust decode setup for short/noisy clips.
            retry_options = {
                "beam_size": 5,
                "best_of": 5,
                "temperature": 0.2,
                "condition_on_previous_text": False,
                "vad_filter": True,
            }
            retry_languages = list(candidate_languages)
            if "en" not in retry_languages:
                retry_languages.append("en")
            if None not in retry_languages:
                retry_languages.append(None)
            transcript, info, transcript_language = decode_best(retry_options, retry_languages)

        raw = {
            "text": transcript,
            "language": getattr(info, "language", "")
            or transcript_language
            or (language_hint or ""),
            "sample_rate": 16000,
            "source": "faster_whisper:file",
        }
    elif runner.get("kind") == "moonshine":
        import torch

        model = runner["model"]
        processor = runner["processor"]
        target_sample_rate = int(
            getattr(getattr(processor, "feature_extractor", None), "sampling_rate", 16000)
        )
        audio_array, sample_rate = _load_audio_array(audio_path, target_sample_rate)
        inputs = processor(
            audio_array,
            return_tensors="pt",
            sampling_rate=sample_rate,
        )
        if device == "cuda":
            inputs = inputs.to(device, torch.float16)
        else:
            inputs = inputs.to(device)

        # Avoid long hallucination loops for short clips.
        attention_mask = inputs.get("attention_mask")
        with torch.inference_mode():
            if attention_mask is not None:
                token_limit_factor = 6.5 / float(sample_rate)
                seq_lens = attention_mask.sum(dim=-1)
                max_length = max(8, int((seq_lens * token_limit_factor).max().item()))
                generated_ids = model.generate(**inputs, max_length=max_length)
            else:
                generated_ids = model.generate(**inputs)

        raw = {"text": processor.decode(generated_ids[0], skip_special_tokens=True)}
    else:
        asr = runner["pipeline"]
        target_sample_rate = int(
            getattr(getattr(asr, "feature_extractor", None), "sampling_rate", 16000)
        )
        audio_array, sample_rate = _load_audio_array(audio_path, target_sample_rate)
        asr_input = {"raw": audio_array, "sampling_rate": sample_rate}
        if is_whisper_family:
            candidate_languages: list[str | None]
            if allowed_languages:
                candidate_languages = list(allowed_languages)
            elif language_hint:
                candidate_languages = [language_hint]
            else:
                candidate_languages = [None]

            best_raw: Any = {}
            best_score = -1
            for candidate_language in candidate_languages:
                try:
                    if candidate_language:
                        candidate_raw = asr(
                            asr_input,
                            generate_kwargs={
                                "language": candidate_language,
                                "task": "transcribe",
                            },
                        )
                    else:
                        candidate_raw = asr(asr_input)
                except TypeError:
                    candidate_raw = asr(asr_input)

                candidate_text = _extract_transcript(candidate_raw)
                if not candidate_text or _is_repetitive_transcript_noise(candidate_text):
                    continue
                score = _transcript_score(candidate_text)
                if score > best_score:
                    best_score = score
                    best_raw = candidate_raw

            raw = best_raw if best_score >= 0 else asr(asr_input)
        else:
            raw = asr(asr_input)

    text = _extract_transcript(raw)
    if not text:
        raise RuntimeError(
            f"Local HF ASR returned an empty transcript. raw={_preview_object(raw)}"
        )
    if _is_repetitive_transcript_noise(text):
        raise RuntimeError(
            f"Local HF ASR returned repetitive transcript noise. raw={_preview_object(raw)}"
        )
    return {"text": text, "modelCached": model_cached, "device": device}


def action_trim_cache(_: dict[str, Any]) -> dict[str, Any]:
    cleared_entries = len(MODEL_CACHE)
    MODEL_CACHE.clear()
    _compact_memory(force_cuda_empty_cache=True)
    return {"trimmed": True, "clearedEntries": cleared_entries}


def execute(request: dict[str, Any]) -> dict[str, Any]:
    action = str(request.get("action") or "").strip().lower()
    if action == "warmup_parakeet":
        return action_warmup_parakeet(request)
    if action == "transcribe_parakeet":
        return action_transcribe_parakeet(request)
    if action == "warmup_hf_asr":
        return action_warmup_hf_asr(request)
    if action == "transcribe_hf_asr":
        return action_transcribe_hf_asr(request)
    if action == "trim_cache":
        return action_trim_cache(request)
    raise RuntimeError(f"Unsupported action: {action}")


def run_request(request: dict[str, Any]) -> dict[str, Any]:
    try:
        result = execute(request)
        return _success(result)
    except Exception as error:
        return _error(str(error))


def run_single_request(request_path: Path) -> int:
    if not request_path.is_file():
        payload = _error(f"Request file does not exist: {request_path}")
        print(json.dumps(payload, ensure_ascii=True), flush=True)
        return 2

    try:
        request = json.loads(request_path.read_text(encoding="utf-8"))
    except Exception as error:
        payload = _error(f"Failed to read request JSON: {error}")
        print(json.dumps(payload, ensure_ascii=True), flush=True)
        return 2

    payload = run_request(request)
    print(json.dumps(payload, ensure_ascii=True), flush=True)
    return 0 if payload.get("ok") else 1


def run_daemon_loop() -> int:
    while True:
        line = sys.stdin.readline()
        if line == "":
            return 0

        source = line.strip()
        if not source:
            continue

        try:
            request = json.loads(source)
        except Exception as error:
            payload = _error(f"Invalid daemon request JSON: {error}")
            print(json.dumps(payload, ensure_ascii=True), flush=True)
            continue

        payload = run_request(request)
        print(json.dumps(payload, ensure_ascii=True), flush=True)
        _compact_memory(force_cuda_empty_cache=False)


def main() -> int:
    parser = argparse.ArgumentParser(description="Bridge script for local Parakeet STT.")
    parser.add_argument(
        "--request",
        help="Path to a JSON request file.",
    )
    parser.add_argument(
        "--daemon",
        action="store_true",
        help="Run as a long-lived JSONL bridge over stdin/stdout.",
    )
    args = parser.parse_args()

    if args.daemon:
        return run_daemon_loop()
    if not args.request:
        payload = _error("Either --request or --daemon is required.")
        print(json.dumps(payload, ensure_ascii=True), flush=True)
        return 1
    return run_single_request(Path(args.request))


if __name__ == "__main__":
    raise SystemExit(main())
