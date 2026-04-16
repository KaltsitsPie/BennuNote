import os
import tempfile
import logging
import random
import string

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.bcut_asr import transcribe_via_bcut, BcutASRError
from services.whisper_service import transcribe_audio
from services.yt_dlp_service import download_audio
from services.youtube_subtitles_service import extract_youtube_subtitles
from youtube_transcript_api import NoTranscriptFound, TranscriptsDisabled
from request_context import set_req_id

logger = logging.getLogger("bennunote.transcript")


def _gen_req_id() -> str:
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))

router = APIRouter()


class TranscriptRequest(BaseModel):
    bvid: str = ""
    video_url: str = ""  # explicit URL (e.g. YouTube); takes priority over bvid
    model_size: str = "tiny"
    cookie: str = ""
    language: str = "zh"
    req_id: str = ""    # correlation ID for log tracing (generated here if empty)


class TranscriptResponse(BaseModel):
    text: str
    source: str  # "youtube_native" | "bcut_asr" | "whisper"
    duration: float
    items: list[dict]


@router.post("/transcript", response_model=TranscriptResponse)
def transcript(req: TranscriptRequest):
    req_id = req.req_id or _gen_req_id()
    set_req_id(req_id)
    url = req.video_url if req.video_url else f"https://www.bilibili.com/video/{req.bvid}"
    is_youtube = "youtube.com" in url or "youtu.be" in url
    is_bilibili = "bilibili.com" in url
    logger.info("Transcript request: req_id=%s, url=%s, model_size=%s, language=%s", req_id, url, req.model_size, req.language)

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            if is_youtube:
                # Try native subtitles first via InnerTube API (no audio download needed).
                # Fall back to Whisper only if native subtitles are unavailable.
                try:
                    logger.info("YouTube URL — trying native subtitles (InnerTube)...")
                    items = extract_youtube_subtitles(url, req.language)
                    source = "youtube_native"
                    logger.info("YouTube native subtitles: %d segments", len(items))
                except (NoTranscriptFound, TranscriptsDisabled, Exception) as e:
                    logger.warning("YouTube native subtitles failed (%s) — falling back to Whisper", e)
                    audio_path = download_audio(url, req.cookie, tmpdir)
                    source = "whisper"
                    items = transcribe_audio(audio_path, req.model_size, req.language)
            elif is_bilibili:
                # Bilibili: download audio, try Bcut ASR first, fall back to Whisper.
                audio_path = download_audio(url, req.cookie, tmpdir)
                source = "bcut_asr"
                try:
                    logger.info("Trying Bcut ASR...")
                    items = transcribe_via_bcut(audio_path)
                    logger.info("Bcut ASR succeeded: %d segments", len(items))
                except (BcutASRError, Exception) as e:
                    logger.warning("Bcut ASR failed (%s), falling back to Whisper...", e)
                    source = "whisper"
                    items = transcribe_audio(audio_path, req.model_size, req.language)
            else:
                # Generic site: yt-dlp download → Whisper transcription only.
                logger.info("Generic URL — downloading audio via yt-dlp...")
                audio_path = download_audio(url, req.cookie, tmpdir)
                source = "whisper"
                items = transcribe_audio(audio_path, req.model_size, req.language)
                logger.info("Generic transcription: %d segments via Whisper", len(items))

        full_text = "\n".join(item["content"] for item in items)
        duration = items[-1]["to"] if items else 0.0

        logger.info("Returning %d segments (source=%s), duration=%.1fs", len(items), source, duration)
        return TranscriptResponse(
            text=full_text,
            source=source,
            duration=duration,
            items=items,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in /transcript")
        raise HTTPException(status_code=500, detail=str(e))
