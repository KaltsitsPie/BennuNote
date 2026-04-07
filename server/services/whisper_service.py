import os
import time
import logging
from typing import Optional
from faster_whisper import WhisperModel

logger = logging.getLogger("bennunote.whisper")

_model: Optional[WhisperModel] = None
_model_size: Optional[str] = None


def get_model(size: str = "small") -> WhisperModel:
    global _model, _model_size
    if _model is None or _model_size != size:
        logger.info("Loading Whisper model: size=%s, device=auto, compute_type=auto", size)
        t0 = time.time()
        _model = WhisperModel(size, device="auto", compute_type="auto")
        _model_size = size
        logger.info("Whisper model loaded in %.1fs", time.time() - t0)
    return _model


def transcribe_audio(audio_path: str, model_size: str = "small", language: str = "zh") -> list:
    """Transcribe an audio file and return list of {from, to, content} dicts."""
    file_size_mb = os.path.getsize(audio_path) / 1024 / 1024
    logger.info("Transcription start: path=%s, size=%.1fMB, language=%s", audio_path, file_size_mb, language)

    model = get_model(model_size)
    t0 = time.time()
    segments_gen, info = model.transcribe(audio_path, language=language)
    logger.info("Audio info: language=%s, language_probability=%.2f, duration=%.1fs",
                info.language, info.language_probability, info.duration)

    items = []
    for seg in segments_gen:
        items.append({
            "from": round(seg.start, 2),
            "to": round(seg.end, 2),
            "content": seg.text.strip(),
        })
        if len(items) % 50 == 0:
            logger.info("Transcription progress: %d segments processed so far", len(items))

    elapsed = time.time() - t0
    total_duration = items[-1]["to"] if items else 0.0
    logger.info("Transcription complete: %d segments, audio_duration=%.1fs, elapsed=%.1fs, speed=%.1fx",
                len(items), total_duration, elapsed, total_duration / elapsed if elapsed > 0 else 0)
    return items
