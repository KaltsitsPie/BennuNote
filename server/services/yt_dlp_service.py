import os
import sys
import shutil
import subprocess
import logging

from fastapi import HTTPException

logger = logging.getLogger("bennunote.yt_dlp")


def download_audio(url: str, cookie: str, tmpdir: str) -> str:
    """Download audio from *url* into *tmpdir* using yt-dlp.

    Args:
        url:    Full video URL (Bilibili or YouTube).
        cookie: Raw Netscape-format cookie string; may be empty.
        tmpdir: Path to an already-created temporary directory.
                The caller is responsible for its lifecycle.

    Returns:
        Absolute path to the downloaded audio file.

    Raises:
        HTTPException: 500 if yt-dlp is not found, download fails, or no
                       audio file is produced; 504 on timeout.
    """
    is_youtube = "youtube.com" in url or "youtu.be" in url
    audio_path = os.path.join(tmpdir, "audio.m4a")

    cmd = [
        sys.executable, "-m", "yt_dlp",
        "-f", "ba",  # best audio
        "-o", audio_path,
        "--no-playlist",
    ]
    if is_youtube:
        # Use Deno-based n-challenge solver (EJS) for YouTube.
        # web_creator was previously used but now requires auth; EJS + default client is more reliable.
        # Clear the EJS challenge-solver cache before each request so a stale lib.json doesn't
        # silently produce wrong n-challenge solutions (→ HTTP 403 from CDN).
        ejs_cache = os.path.expanduser("~/.cache/yt-dlp/challenge-solver")
        if os.path.exists(ejs_cache):
            shutil.rmtree(ejs_cache)
            logger.info("Cleared EJS challenge-solver cache to force fresh download")
        cmd.extend(["--remote-components", "ejs:github"])
    if cookie:
        cookie_file = os.path.join(tmpdir, "cookies.txt")
        with open(cookie_file, "w") as f:
            f.write(cookie)
        cmd.extend(["--cookies", cookie_file])
    elif is_youtube:
        # No explicit cookie provided — use Chrome's cookie store for YouTube auth.
        # This handles "Sign in to confirm you're not a bot" errors.
        cmd.extend(["--cookies-from-browser", "chrome"])
    cmd.append(url)

    logger.info("Running yt-dlp: %s", " ".join(cmd))
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except FileNotFoundError:
        logger.error("Python executable not found: %s", sys.executable)
        raise HTTPException(status_code=500, detail="Python executable not found")
    except subprocess.TimeoutExpired:
        logger.error("yt-dlp timed out after 120s")
        raise HTTPException(status_code=504, detail="yt-dlp timed out downloading audio")

    if result.stdout:
        logger.info("yt-dlp stdout:\n%s", result.stdout.strip())
    if result.stderr:
        logger.warning("yt-dlp stderr:\n%s", result.stderr.strip())

    if result.returncode != 0:
        logger.error("yt-dlp failed with code %d", result.returncode)
        # Show last 800 chars — warnings appear first, actual error is at the end
        raise HTTPException(status_code=500, detail=f"yt-dlp failed: {result.stderr[-800:]}")

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

    return audio_path
