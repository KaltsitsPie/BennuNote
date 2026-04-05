import os
import tempfile
from faster_whisper import WhisperModel

_model: WhisperModel | None = None


def get_model(size: str = "small") -> WhisperModel:
    global _model
    if _model is None:
        _model = WhisperModel(size, device="auto", compute_type="auto")
    return _model


def transcribe_audio(audio_path: str, model_size: str = "small") -> list[dict]:
    """Transcribe an audio file and return list of {from, to, content} dicts."""
    model = get_model(model_size)
    segments, _ = model.transcribe(audio_path, language="zh")
    items = []
    for seg in segments:
        items.append({
            "from": round(seg.start, 2),
            "to": round(seg.end, 2),
            "content": seg.text.strip(),
        })
    return items
