#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


MODEL_CACHE: dict[str, Any] = {}


def load_request(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise RuntimeError(f"Request file was not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def list_voice_ids(voice_dir: Path) -> list[str]:
    if not voice_dir.exists():
        return []

    voices: set[str] = set()
    for suffix in (".pth", ".pt", ".json"):
        for file_path in voice_dir.glob(f"*{suffix}"):
            if file_path.is_file():
                voices.add(file_path.stem)

    return sorted(voices)


def pick_device(use_gpu: bool) -> str:
    import torch

    if use_gpu and torch.cuda.is_available():
        return "cuda"
    return "cpu"


def load_tts_model(model_name: str, use_gpu: bool) -> tuple[Any, str, bool]:
    device = pick_device(use_gpu)
    cache_key = f"{model_name}|{device}"
    if cache_key in MODEL_CACHE:
        return MODEL_CACHE[cache_key], device, True

    from TTS.api import TTS

    tts = TTS(model_name=model_name, progress_bar=False, gpu=(device == "cuda"))
    tts = tts.to(device)
    MODEL_CACHE[cache_key] = tts
    return tts, device, False


def read_audio_duration_seconds(audio_path: Path) -> float:
    try:
        import torchaudio

        waveform, sample_rate = torchaudio.load(str(audio_path))
        if sample_rate <= 0:
            return 0.0
        return float(waveform.shape[1]) / float(sample_rate)
    except Exception:
        if audio_path.suffix.lower() != ".wav":
            raise
        import wave

        with wave.open(str(audio_path), "rb") as wav_file:
            sample_rate = wav_file.getframerate()
            frame_count = wav_file.getnframes()
            if sample_rate <= 0:
                return 0.0
            return float(frame_count) / float(sample_rate)


def build_quality_kwargs(quality: str) -> dict[str, Any]:
    quality_key = (quality or "balanced").strip().lower()
    if quality_key == "fast":
        return {
            "temperature": 0.92,
            "top_k": 30,
            "top_p": 0.78,
            "repetition_penalty": 7.5,
        }
    if quality_key == "high":
        return {
            "temperature": 0.62,
            "top_k": 70,
            "top_p": 0.94,
            "repetition_penalty": 12.0,
            "length_penalty": 1.0,
        }
    return {
        "temperature": 0.75,
        "top_k": 50,
        "top_p": 0.86,
        "repetition_penalty": 10.0,
    }


def emotion_speed_multiplier(emotion: str) -> float:
    key = (emotion or "neutral").strip().lower()
    return {
        "neutral": 1.0,
        "calm": 0.9,
        "happy": 1.05,
        "excited": 1.14,
        "serious": 0.95,
        "sad": 0.88,
    }.get(key, 1.0)


def action_status(request: dict[str, Any]) -> dict[str, Any]:
    voice_dir = Path(request["voiceDir"])
    voice_dir.mkdir(parents=True, exist_ok=True)

    payload: dict[str, Any] = {
        "pythonPath": sys.executable,
        "available": False,
        "ttsVersion": "",
        "cudaAvailable": False,
        "voices": list_voice_ids(voice_dir),
        "voiceDir": str(voice_dir),
    }

    try:
        import torch
        from TTS import __version__ as tts_version

        payload["available"] = True
        payload["ttsVersion"] = str(tts_version)
        payload["cudaAvailable"] = bool(torch.cuda.is_available())
    except Exception as error:
        payload["error"] = str(error)

    return payload


def action_list_models(request: dict[str, Any]) -> dict[str, Any]:
    default_model = str(
        request.get("defaultModel") or "tts_models/multilingual/multi-dataset/xtts_v2"
    ).strip()
    warning = ""
    models: list[str] = []

    try:
        from TTS.api import TTS

        models = list(TTS().list_models())
    except Exception as error:
        warning = str(error)

    if default_model and default_model not in models:
        models.insert(0, default_model)

    return {"models": models, "warning": warning}


def action_list_voices(request: dict[str, Any]) -> dict[str, Any]:
    voice_dir = Path(request["voiceDir"])
    voice_dir.mkdir(parents=True, exist_ok=True)
    return {
        "voiceDir": str(voice_dir),
        "voices": list_voice_ids(voice_dir),
    }


def action_clone_voice(request: dict[str, Any]) -> dict[str, Any]:
    model_name = str(request["modelName"]).strip()
    language = str(request.get("language") or "en").strip() or "en"
    speaker_id = str(request["speakerId"]).strip()
    reference_audio_path = Path(request["referenceAudioPath"])
    voice_dir = Path(request["voiceDir"])
    preview_output_path = Path(request["previewOutputPath"])
    use_gpu = bool(request.get("useGpu", False))
    max_seconds = float(request.get("maxReferenceSeconds", 30.0))

    if not model_name:
        raise RuntimeError("Coqui model name is required.")
    if not speaker_id:
        raise RuntimeError("Speaker ID is required for cloning.")
    if not reference_audio_path.is_file():
        raise RuntimeError(f"Reference audio file was not found: {reference_audio_path}")

    voice_dir.mkdir(parents=True, exist_ok=True)
    preview_output_path.parent.mkdir(parents=True, exist_ok=True)

    duration_seconds = read_audio_duration_seconds(reference_audio_path)
    if duration_seconds <= 0:
        raise RuntimeError("Reference audio duration could not be read.")
    if duration_seconds > max_seconds:
        raise RuntimeError(
            f"Reference audio is too long ({duration_seconds:.2f}s). Maximum is {max_seconds:.2f}s."
        )

    tts, device, model_cached = load_tts_model(model_name, use_gpu=use_gpu)

    # Voice cloning is cached under the speaker ID in voice_dir for reuse.
    tts.tts_to_file(
        text="This voice profile is now ready.",
        speaker_wav=str(reference_audio_path),
        speaker=speaker_id,
        language=language,
        file_path=str(preview_output_path),
        split_sentences=False,
        voice_dir=str(voice_dir),
    )

    return {
        "speakerId": speaker_id,
        "modelName": model_name,
        "language": language,
        "durationSeconds": duration_seconds,
        "device": device,
        "modelCached": model_cached,
        "previewAudioPath": str(preview_output_path),
        "voiceDir": str(voice_dir),
        "voices": list_voice_ids(voice_dir),
    }


def action_synthesize(request: dict[str, Any]) -> dict[str, Any]:
    text = str(request["text"]).strip()
    model_name = str(request["modelName"]).strip()
    language = str(request.get("language") or "en").strip() or "en"
    speaker_id = str(request.get("speakerId") or "").strip()
    quality = str(request.get("quality") or "balanced")
    emotion = str(request.get("emotion") or "neutral")
    output_path = Path(request["outputPath"])
    voice_dir = Path(request["voiceDir"])
    use_gpu = bool(request.get("useGpu", False))
    split_sentences = bool(request.get("splitSentences", False))

    if not text:
        raise RuntimeError("No text provided for Coqui TTS.")
    if not model_name:
        raise RuntimeError("Coqui model name is required.")
    if not speaker_id:
        raise RuntimeError("Select or clone a voice before using Coqui TTS.")

    base_speed = float(request.get("speed", 1.0))
    base_speed = max(0.5, min(2.0, base_speed))
    final_speed = max(0.5, min(2.0, base_speed * emotion_speed_multiplier(emotion)))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    voice_dir.mkdir(parents=True, exist_ok=True)

    tts, device, model_cached = load_tts_model(model_name, use_gpu=use_gpu)
    generation_kwargs = build_quality_kwargs(quality)

    wav = tts.synthesizer.tts(
        text=text,
        speaker_name=speaker_id,
        language_name=language,
        split_sentences=split_sentences,
        voice_dir=str(voice_dir),
        speed=final_speed,
        **generation_kwargs,
    )
    tts.synthesizer.save_wav(wav=wav, path=str(output_path))

    return {
        "outputPath": str(output_path),
        "device": device,
        "modelCached": model_cached,
        "speed": final_speed,
        "quality": quality,
        "emotion": emotion,
    }


def execute(request: dict[str, Any]) -> dict[str, Any]:
    action = str(request.get("action") or "").strip().lower()
    if action == "status":
        return action_status(request)
    if action == "list_models":
        return action_list_models(request)
    if action == "list_voices":
        return action_list_voices(request)
    if action == "clone_voice":
        return action_clone_voice(request)
    if action == "synthesize":
        return action_synthesize(request)
    raise RuntimeError(f"Unsupported action: {action}")


def run_single_request(request_path: str) -> int:
    try:
        request = load_request(Path(request_path))
        result = execute(request)
        payload = {"ok": True, "result": result}
        print(json.dumps(payload, ensure_ascii=False), flush=True)
        return 0
    except Exception as error:
        payload = {"ok": False, "error": str(error)}
        print(json.dumps(payload, ensure_ascii=False), flush=True)
        return 1


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
            result = execute(request)
            payload = {"ok": True, "result": result}
        except Exception as error:
            payload = {"ok": False, "error": str(error)}

        print(json.dumps(payload, ensure_ascii=False), flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Bridge script for Coqui TTS integration.")
    parser.add_argument("--request", help="Path to a JSON request file.")
    parser.add_argument(
        "--daemon",
        action="store_true",
        help="Run as a long-lived JSONL bridge over stdin/stdout.",
    )
    args = parser.parse_args()

    if args.daemon:
        return run_daemon_loop()
    if not args.request:
        payload = {"ok": False, "error": "Either --request or --daemon is required."}
        print(json.dumps(payload, ensure_ascii=False), flush=True)
        return 1
    return run_single_request(args.request)


if __name__ == "__main__":
    raise SystemExit(main())
