import logging
from urllib.parse import urlparse, parse_qs

from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled

logger = logging.getLogger("bennunote.youtube_subtitles")

_api = YouTubeTranscriptApi()


def extract_youtube_subtitles(url: str, language: str = "zh") -> list[dict]:
    """Fetch native YouTube subtitles via InnerTube transcript API.

    Args:
        url:      Full YouTube video URL.
        language: Preferred language code (e.g. "zh", "en").

    Returns:
        List of {from, to, content} dicts with times in seconds.

    Raises:
        NoTranscriptFound: No transcript available for the requested languages.
        TranscriptsDisabled: Transcripts are disabled for this video.
        ValueError: URL does not contain a recognisable YouTube video ID.
    """
    video_id = _extract_video_id(url)
    lang_candidates = [language, "en"] if language != "en" else ["en"]
    logger.info("Fetching YouTube transcript: video_id=%s, lang_candidates=%s", video_id, lang_candidates)

    try:
        transcript = _api.fetch(video_id, languages=lang_candidates)
    except NoTranscriptFound:
        # Fallback: accept any available language
        logger.info("Requested languages not found — listing available transcripts")
        transcript_list = _api.list(video_id)
        # Pick the first available transcript
        transcript = next(iter(transcript_list)).fetch()

    snippets = list(transcript)
    logger.info("Fetched %d transcript snippets", len(snippets))
    return [
        {
            "from": s.start,
            "to": s.start + s.duration,
            "content": s.text,
        }
        for s in snippets
    ]


def _extract_video_id(url: str) -> str:
    parsed = urlparse(url)
    if parsed.hostname in ("youtu.be",):
        vid = parsed.path.lstrip("/")
        if vid:
            return vid
    qs = parse_qs(parsed.query)
    ids = qs.get("v", [])
    if ids:
        return ids[0]
    raise ValueError(f"Cannot extract video ID from URL: {url}")
