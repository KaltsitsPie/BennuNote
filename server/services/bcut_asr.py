import os
import math
import json
import time
import logging
import requests

logger = logging.getLogger("bennunote.bcut_asr")

API_BASE = "https://member.bilibili.com/x/bcut/rubick-interface"
MODEL_ID = "8"
POLL_INTERVAL = 5  # seconds
MAX_POLL_ATTEMPTS = 60  # 5 minutes max

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
}


class BcutASRError(Exception):
    pass


def transcribe_via_bcut(audio_path: str) -> list[dict]:
    """
    Upload audio file to Bcut ASR and return transcription as list of
    {from, to, content} dicts (times in seconds).
    """
    filename = os.path.basename(audio_path)
    ext = os.path.splitext(filename)[1].lstrip(".") or "m4a"

    with open(audio_path, "rb") as f:
        audio_data = f.read()

    file_size = len(audio_data)
    logger.info("Bcut ASR: file=%s, size=%.1fMB, ext=%s", filename, file_size / 1024 / 1024, ext)

    # Step 1: Request upload slot
    logger.info("Step 1: Requesting upload slot...")
    resp = requests.post(
        f"{API_BASE}/resource/create",
        headers=HEADERS,
        data={
            "type": 2,
            "name": filename,
            "size": file_size,
            "resource_file_type": ext,
            "model_id": MODEL_ID,
        },
        timeout=30,
    )
    resp.raise_for_status()
    create_data = resp.json()
    if create_data.get("code") != 0:
        raise BcutASRError(f"resource/create failed: code={create_data.get('code')}, msg={create_data.get('message')}")

    info = create_data["data"]
    resource_id = info["resource_id"]
    upload_urls = info["upload_urls"]
    upload_id = info["upload_id"]
    per_size = info["per_size"]
    in_boss_key = info["in_boss_key"]
    logger.info("Upload slot created: resource_id=%s, %d chunk(s), per_size=%d", resource_id, len(upload_urls), per_size)

    # Step 2: Upload chunks
    num_chunks = math.ceil(file_size / per_size)
    etags = []
    logger.info("Step 2: Uploading %d chunk(s)...", num_chunks)
    for i in range(num_chunks):
        start = i * per_size
        end = min(start + per_size, file_size)
        chunk = audio_data[start:end]
        put_resp = requests.put(upload_urls[i], headers=HEADERS, data=chunk, timeout=60)
        put_resp.raise_for_status()
        etag = put_resp.headers.get("Etag", put_resp.headers.get("ETag", ""))
        if not etag:
            logger.warning("  Chunk %d/%d: empty etag in response headers", i + 1, num_chunks)
        etags.append(etag)
        logger.info("  Chunk %d/%d uploaded (%d bytes), etag=%s", i + 1, num_chunks, len(chunk), etag[:20])

    # Step 3: Complete upload
    logger.info("Step 3: Completing upload...")
    resp = requests.post(
        f"{API_BASE}/resource/create/complete",
        headers=HEADERS,
        data={
            "in_boss_key": in_boss_key,
            "resource_id": resource_id,
            "etags": ",".join(etags),
            "upload_id": upload_id,
            "model_id": MODEL_ID,
        },
        timeout=30,
    )
    resp.raise_for_status()
    complete_data = resp.json()
    if complete_data.get("code") != 0:
        raise BcutASRError(f"resource/create/complete failed: code={complete_data.get('code')}, msg={complete_data.get('message')}")

    download_url = complete_data["data"]["download_url"]
    logger.info("Upload complete: download_url=%s", download_url[:80])

    # Step 4: Create task
    logger.info("Step 4: Creating ASR task...")
    resp = requests.post(
        f"{API_BASE}/task",
        headers={**HEADERS, "Content-Type": "application/json"},
        json={
            "resource": download_url,
            "model_id": MODEL_ID,
        },
        timeout=30,
    )
    resp.raise_for_status()
    task_data = resp.json()
    if task_data.get("code") != 0:
        raise BcutASRError(f"task create failed: code={task_data.get('code')}, msg={task_data.get('message')}")

    task_id = task_data["data"]["task_id"]
    logger.info("ASR task created: task_id=%s", task_id)

    # Poll for result
    logger.info("Step 5: Polling for result (interval=%ds, max=%d attempts)...", POLL_INTERVAL, MAX_POLL_ATTEMPTS)
    t0 = time.time()
    for attempt in range(MAX_POLL_ATTEMPTS):
        time.sleep(POLL_INTERVAL)
        resp = requests.get(
            f"{API_BASE}/task/result",
            headers=HEADERS,
            params={"model_id": MODEL_ID, "task_id": task_id},
        )
        resp.raise_for_status()
        result_data = resp.json()
        if result_data.get("code") != 0:
            raise BcutASRError(f"task/result failed: code={result_data.get('code')}, msg={result_data.get('message')}")

        state = result_data["data"]["state"]
        state_names = {0: "STOP", 1: "RUNNING", 3: "ERROR", 4: "COMPLETE"}
        logger.info("  Poll #%d: state=%s (%d), elapsed=%.0fs",
                     attempt + 1, state_names.get(state, "UNKNOWN"), state, time.time() - t0)

        if state == 4:  # COMPLETE
            result_json = json.loads(result_data["data"]["result"])
            utterances = result_json.get("utterances", [])
            items = []
            for u in utterances:
                items.append({
                    "from": round(u["start_time"] / 1000, 2),
                    "to": round(u["end_time"] / 1000, 2),
                    "content": u["transcript"].strip(),
                })
            elapsed = time.time() - t0
            logger.info("Bcut ASR complete: %d segments in %.0fs", len(items), elapsed)
            return items
        elif state == 3:  # ERROR
            remark = result_data["data"].get("remark", "Unknown error")
            raise BcutASRError(f"ASR task failed: {remark}")
        # state 0 (STOP) or 1 (RUNNING): continue polling

    raise BcutASRError(f"ASR task timed out after {MAX_POLL_ATTEMPTS * POLL_INTERVAL}s of polling")
