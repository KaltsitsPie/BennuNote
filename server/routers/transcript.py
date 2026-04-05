import os
import tempfile
import subprocess

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.whisper_service import transcribe_audio

router = APIRouter()


class TranscriptRequest(BaseModel):
    bvid: str
    model_size: str = "small"
    cookie: str = ""


class TranscriptResponse(BaseModel):
    text: str
    source: str  # "cc_subtitle" | "whisper"
    duration: float
    items: list[dict]


@router.post("/transcript", response_model=TranscriptResponse)
async def transcript(req: TranscriptRequest):
    # Use yt-dlp to download audio
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

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"yt-dlp failed: {result.stderr[:500]}")

        if not os.path.exists(audio_path):
            # yt-dlp may add extension automatically
            candidates = [f for f in os.listdir(tmpdir) if f.startswith("audio")]
            if candidates:
                audio_path = os.path.join(tmpdir, candidates[0])
            else:
                raise HTTPException(status_code=500, detail="Audio file not found after download")

        items = transcribe_audio(audio_path, req.model_size)

    full_text = "\n".join(item["content"] for item in items)
    duration = items[-1]["to"] if items else 0.0

    return TranscriptResponse(
        text=full_text,
        source="whisper",
        duration=duration,
        items=items,
    )
