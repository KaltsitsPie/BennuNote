import os
import tempfile
import subprocess
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.bcut_asr import transcribe_via_bcut, BcutASRError
from services.whisper_service import transcribe_audio

logger = logging.getLogger("bennunote.transcript")

router = APIRouter()


class TranscriptRequest(BaseModel):
    bvid: str
    model_size: str = "small"
    cookie: str = ""
    language: str = "zh"


class TranscriptResponse(BaseModel):
    text: str
    source: str  # "bcut_asr" | "whisper"
    duration: float
    items: list[dict]


@router.post("/transcript", response_model=TranscriptResponse)
async def transcript(req: TranscriptRequest):
    logger.info("Transcript request: bvid=%s, model_size=%s, language=%s", req.bvid, req.model_size, req.language)

    with tempfile.TemporaryDirectory() as tmpdir:
        audio_path = os.path.join(tmpdir, "audio.m4a")
        url = f"https://www.bilibili.com/video/{req.bvid}"

        cmd = [
            "yt-dlp",
            "-f", "ba",  # best audio
            "-o", audio_path,
            "--no-playlist",
        ]
        if req.cookie:
            cookie_file = os.path.join(tmpdir, "cookies.txt")
            with open(cookie_file, "w") as f:
                f.write(req.cookie)
            cmd.extend(["--cookies", cookie_file])
        cmd.append(url)

        logger.info("Running yt-dlp: %s", " ".join(cmd))
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

        if result.stdout:
            logger.info("yt-dlp stdout:\n%s", result.stdout.strip())
        if result.stderr:
            logger.warning("yt-dlp stderr:\n%s", result.stderr.strip())

        if result.returncode != 0:
            logger.error("yt-dlp failed with code %d", result.returncode)
            raise HTTPException(status_code=500, detail=f"yt-dlp failed: {result.stderr[:500]}")

        if not os.path.exists(audio_path):
            # yt-dlp may add extension automatically
            candidates = [f for f in os.listdir(tmpdir) if f.startswith("audio")]
            if candidates:
                audio_path = os.path.join(tmpdir, candidates[0])
                logger.info("Audio file found (auto-extension): %s", audio_path)
            else:
                logger.error("Audio file not found after download in %s", tmpdir)
                raise HTTPException(status_code=500, detail="Audio file not found after download")

        file_size_mb = os.path.getsize(audio_path) / 1024 / 1024
        logger.info("Audio downloaded: %s (%.1fMB)", audio_path, file_size_mb)

        # Try Bcut ASR first, fall back to Whisper
        source = "bcut_asr"
        try:
            logger.info("Trying Bcut ASR...")
            items = transcribe_via_bcut(audio_path)
            logger.info("Bcut ASR succeeded: %d segments", len(items))
        except (BcutASRError, Exception) as e:
            logger.warning("Bcut ASR failed (%s), falling back to Whisper...", e)
            source = "whisper"
            items = transcribe_audio(audio_path, req.model_size, req.language)

    full_text = "\n".join(item["content"] for item in items)
    duration = items[-1]["to"] if items else 0.0

    logger.info("Returning %d segments (source=%s), duration=%.1fs", len(items), source, duration)
    return TranscriptResponse(
        text=full_text,
        source=source,
        duration=duration,
        items=items,
    )
