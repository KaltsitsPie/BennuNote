# server/services/feishu_service.py
"""Feishu service — all operations via lark-cli subprocess."""
import json
import logging
import os
import re
import tempfile
import time
from datetime import datetime, timezone, timedelta

import requests as http_requests

from services.larkcli import run, get_auth_status, LarkCliError

logger = logging.getLogger(__name__)


def auth_status() -> dict:
    return get_auth_status()


def list_wiki_spaces() -> dict:
    return run("wiki", "spaces", "list")


def list_wiki_nodes(space_id: str, parent_node_token: str = "") -> dict:
    params: dict = {"space_id": space_id}
    if parent_node_token:
        params["parent_node_token"] = parent_node_token
    return run("wiki", "nodes", "list", "--params", json.dumps(params))


def create_doc(markdown: str, title: str = "", wiki_node: str = "", folder_token: str = "",
               wiki_space: str = "") -> dict:
    args = ["docs", "+create", "--markdown", markdown]
    if title:
        args += ["--title", title]
    if wiki_space:
        args += ["--wiki-space", wiki_space]
    elif wiki_node:
        args += ["--wiki-node", wiki_node]
    elif folder_token:
        args += ["--folder-token", folder_token]
    return run(*args)


def fetch_doc(doc: str) -> dict:
    return run("docs", "+fetch", "--doc", doc)


def update_doc(doc: str, mode: str, markdown: str = "", selection_by_title: str = "",
               selection_with_ellipsis: str = "", new_title: str = "") -> dict:
    args = ["docs", "+update", "--doc", doc, "--mode", mode]
    if markdown:
        args += ["--markdown", markdown]
    if selection_by_title:
        args += ["--selection-by-title", selection_by_title]
    if selection_with_ellipsis:
        args += ["--selection-with-ellipsis", selection_with_ellipsis]
    if new_title:
        args += ["--new-title", new_title]
    return run(*args)


def search_docs(query: str, page_size: int = 15, page_token: str = "") -> dict:
    args = ["docs", "+search", "--query", query]
    if page_size != 15:
        args += ["--page-size", str(page_size)]
    if page_token:
        args += ["--page-token", page_token]
    return run(*args)


def insert_media(doc: str, file_path: str, file_type: str = "image",
                 align: str = "center", caption: str = "") -> dict:
    args = ["docs", "+media-insert", "--doc", doc, "--file", file_path, "--type", file_type]
    if align != "center":
        args += ["--align", align]
    if caption:
        args += ["--caption", caption]
    return run(*args, timeout=120)


def update_whiteboard(whiteboard_token: str, dsl_content: str, overwrite: bool = False) -> dict:
    args = ["docs", "+whiteboard-update", "--whiteboard-token", whiteboard_token]
    if overwrite:
        args += ["--overwrite"]
    return run(*args, stdin=dsl_content, timeout=60)


def _format_time(seconds: float) -> str:
    """Format seconds to M:SS or H:MM:SS."""
    total = int(seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def _build_info_table(vi: dict, bvid: str) -> str:
    """Build a lark-table for the 主要信息 section matching reference format."""
    owner_name = vi.get("ownerName", vi.get("owner_name", ""))
    owner_mid = vi.get("ownerMid", vi.get("owner_mid", ""))
    pubdate = vi.get("pubdate", 0)
    desc = vi.get("desc", vi.get("description", ""))
    video_url = vi.get("videoUrl", "")

    # Format owner cell
    if owner_name and owner_mid:
        owner_cell = f"[{owner_name}](https://space.bilibili.com/{owner_mid})"
    else:
        owner_cell = owner_name or ""

    # Format link cell
    if bvid:
        link_cell = f"https://www.bilibili.com/video/{bvid}"
    elif video_url:
        link_cell = video_url
    else:
        link_cell = ""

    # Format pubdate cell
    if pubdate:
        dt = datetime.fromtimestamp(pubdate, tz=timezone(timedelta(hours=8)))
        pubdate_cell = dt.strftime("%Y-%m-%d %H:%M:%S")
    else:
        pubdate_cell = ""

    desc_cell = re.sub(r" {2,}", " ", (desc or "").replace("\r", " ").replace("\n", " "))

    rows = [
        ("Up主", owner_cell),
        ("链接", link_cell),
        ("发布时间", pubdate_cell),
        ("简介", desc_cell),
    ]
    # Filter out empty rows
    rows = [(k, v) for k, v in rows if v]
    num_rows = len(rows)

    lines = [
        f'<lark-table rows="{num_rows}" cols="2" column-widths="100,708">',
        "",
    ]
    for label, value in rows:
        lines += [
            "  <lark-tr>",
            "    <lark-td>",
            f"      {label}",
            "    </lark-td>",
            "    <lark-td>",
            f"      {value}",
            "    </lark-td>",
            "  </lark-tr>",
        ]
    lines.append("</lark-table>")
    return "\n".join(lines)


def _build_subtitle_table(items: list[dict]) -> str:
    """Build a lark-table markdown for subtitle items with time + content columns."""
    rows = len(items) + 1  # +1 for header
    lines = [
        f'<lark-table rows="{rows}" cols="2" header-row="true" column-widths="112,981">',
        "",
        "  <lark-tr>",
        "    <lark-td>",
        "      时间",
        "    </lark-td>",
        "    <lark-td>",
        "      内容",
        "    </lark-td>",
        "  </lark-tr>",
    ]
    for item in items:
        from_sec = item.get("from", 0)
        content = re.sub(r" {2,}", " ", str(item.get("content", "")).replace("\r", " ").replace("\n", " "))
        lines += [
            "  <lark-tr>",
            "    <lark-td>",
            f"      {_format_time(from_sec)}",
            "    </lark-td>",
            "    <lark-td>",
            f"      {content}",
            "    </lark-td>",
            "  </lark-tr>",
        ]
    lines.append("</lark-table>")
    return "\n".join(lines)


def _extract_wiki_token(doc_url: str) -> str:
    """Extract wiki node token from a Feishu wiki URL like https://...feishu.cn/wiki/TOKEN."""
    if "/wiki/" in doc_url:
        token = doc_url.split("/wiki/")[-1].split("?")[0].split("/")[0]
        return token
    return ""


def _resolve_obj_token(wiki_token: str) -> str:
    """Resolve a wiki node token to its underlying obj_token via the Wiki API."""
    try:
        result = run("api", "GET", "/open-apis/wiki/v2/spaces/get_node",
                     "--params", json.dumps({"token": wiki_token}))
        return result.get("data", {}).get("node", {}).get("obj_token", "")
    except LarkCliError as e:
        logger.warning("Failed to resolve obj_token for wiki token %s: %s", wiki_token, e)
        return ""


def _ensure_root_link(wiki_node: str, doc_url: str, title: str, obj_token: str = ""):
    """Append a mention-doc link to the wiki root node if not already present.

    Feishu stores the obj_token (not the wiki node token) in mention-doc blocks,
    so we resolve it before checking for duplicates.
    """
    wiki_token = _extract_wiki_token(doc_url)
    if not wiki_token or not wiki_node:
        return

    # Resolve obj_token if not provided (Feishu stores this in mention-doc)
    if not obj_token:
        obj_token = _resolve_obj_token(wiki_token)
    try:
        root = fetch_doc(wiki_node)
        root_md = root.get("data", root).get("markdown", "")
        if (obj_token and obj_token in root_md) or wiki_token in root_md:
            logger.info("Root doc already contains link (obj=%s, wiki=%s), skipping", obj_token, wiki_token)
            return
        mention = f'### <mention-doc token="{wiki_token}" type="wiki">{title}</mention-doc>\n'
        update_doc(doc=wiki_node, mode="append", markdown=mention)
        logger.info("Appended link to root doc: %s (obj=%s)", wiki_token, obj_token)
    except LarkCliError as e:
        logger.warning("Failed to update root doc with link: %s", e)


def _download_and_insert_cover(doc_token: str, cover_url: str) -> str:
    """Download a cover image from URL and insert it into the Feishu doc via media API.

    Returns empty string on success, or an error message on failure.
    """
    full_url = f"https:{cover_url}" if cover_url.startswith("//") else cover_url
    try:
        resp = http_requests.get(full_url, timeout=30, allow_redirects=True)
        resp.raise_for_status()
    except Exception as e:
        msg = f"Failed to download cover image from {full_url}: {e}"
        logger.warning(msg)
        return msg

    content_type = resp.headers.get("content-type", "")
    if "jpeg" in content_type or "jpg" in content_type:
        suffix = ".jpg"
    elif "png" in content_type:
        suffix = ".png"
    elif "webp" in content_type:
        suffix = ".webp"
    else:
        suffix = ".jpg"

    # lark-cli requires a relative file path within cwd (server dir)
    server_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    tmp_name = f".cover_tmp{suffix}"
    tmp_path = os.path.join(server_dir, tmp_name)
    try:
        with open(tmp_path, "wb") as f:
            f.write(resp.content)
        insert_media(doc_token, tmp_name, file_type="image")
        logger.info("Inserted cover image into doc %s from %s (%d bytes)",
                     doc_token, full_url, len(resp.content))
        return ""
    except Exception as e:
        msg = f"Failed to insert cover image into doc {doc_token}: {e}"
        logger.warning(msg)
        return msg
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


def _append_chunks_with_retry(
    doc_token: str,
    chunks: list[str],
    max_retries: int = 2,
    backoff_base: float = 2.0,
) -> dict:
    """Append subtitle chunks to a doc with retry and best-effort continuation."""
    total = len(chunks)
    succeeded = 0
    errors: list[str] = []

    for idx, chunk in enumerate(chunks):
        last_err = None
        for attempt in range(max_retries + 1):
            try:
                update_doc(doc=doc_token, mode="append", markdown=chunk)
                succeeded += 1
                last_err = None
                break
            except LarkCliError as e:
                last_err = e
                if attempt < max_retries:
                    wait = backoff_base ** (attempt + 1)
                    logger.warning(
                        "Chunk %d/%d append failed (attempt %d/%d): %s — retrying in %.1fs",
                        idx + 1, total, attempt + 1, max_retries + 1, e, wait,
                    )
                    time.sleep(wait)
                else:
                    logger.error(
                        "Chunk %d/%d append failed after %d attempts: %s",
                        idx + 1, total, max_retries + 1, e,
                    )
        if last_err:
            errors.append(f"Batch {idx + 1}/{total}: {last_err}")

    return {"succeeded": succeeded, "failed": total - succeeded, "total": total, "errors": errors}


def legacy_write_feishu(text: str, title: str, items: list, target_doc_token: str,
                        video_info: dict, wiki_node: str,
                        summary: str = "", append_summary_only: bool = False) -> dict:
    """Assembles markdown from video_info + subtitle items, creates Feishu doc."""
    vi = video_info

    # Fast-path: caller already synced subtitles; only append summary section.
    if append_summary_only and target_doc_token:
        result = update_doc(doc=target_doc_token, mode="append",
                            markdown=f"## 摘要\n\n{summary}\n")
        doc_url = (result.get("data", {}).get("doc_url", "")
                   or result.get("doc_url", "")
                   or f"https://www.feishu.cn/wiki/{target_doc_token}")
        return {"doc_url": doc_url}

    bvid = vi.get("bvid", "")
    video_title = vi.get("title", title)
    cover_url = vi.get("coverUrl", vi.get("cover_url", ""))

    # Step 1: Build header + info markdown (without cover — cover inserted via media API)
    header_lines = [f"# {video_title}"]
    header_lines += ["", "## 主要信息", ""]
    header_lines.append(_build_info_table(vi, bvid))
    header_lines.append("")
    header_md = "\n".join(header_lines)

    # Step 2: Build subtitle chunks (batch to stay within API block limits)
    BATCH_SIZE = 30
    subtitle_chunks: list[str] = []
    if items:
        for i in range(0, len(items), BATCH_SIZE):
            batch = items[i:i + BATCH_SIZE]
            chunk_lines = []
            if i == 0:
                chunk_lines += ["## 字幕", ""]
            chunk_lines.append(_build_subtitle_table(batch))
            chunk_lines.append("")
            subtitle_chunks.append("\n".join(chunk_lines))
    elif text:
        subtitle_chunks.append(f"## 字幕\n\n{text}\n")

    if summary:
        subtitle_chunks.append(f"## 摘要\n\n{summary}\n")

    resolved_wiki_node = wiki_node or target_doc_token or ""
    cover_error = ""

    # --- Append-to-existing-doc path ---
    if target_doc_token:
        result = update_doc(doc=target_doc_token, mode="append", markdown=header_md)
        if cover_url:
            cover_error = _download_and_insert_cover(target_doc_token, cover_url)
        doc_url = result.get("data", {}).get("doc_url", "") or result.get("doc_url", "")
        chunk_result = _append_chunks_with_retry(target_doc_token, subtitle_chunks)
        target_url = doc_url or f"https://www.feishu.cn/wiki/{target_doc_token}"
        if wiki_node:
            _ensure_root_link(wiki_node, target_url, video_title)
        return {
            "doc_url": doc_url,
            "subtitle_batches_total": chunk_result["total"],
            "subtitle_batches_succeeded": chunk_result["succeeded"],
            "subtitle_batches_failed": chunk_result["failed"],
            "subtitle_errors": chunk_result["errors"],
            "cover_error": cover_error,
        }

    # --- Create-new-doc path ---
    if resolved_wiki_node and not target_doc_token:
        result = create_doc(markdown=header_md, title=title, wiki_node=resolved_wiki_node)
    else:
        result = create_doc(markdown=header_md, title=title)

    doc_url = result.get("data", {}).get("doc_url", "") or result.get("doc_url", "")
    doc_id = result.get("data", {}).get("doc_id", "")
    chunk_result = {"succeeded": 0, "failed": 0, "total": 0, "errors": []}
    if doc_id:
        if cover_url:
            cover_error = _download_and_insert_cover(doc_id, cover_url)
        chunk_result = _append_chunks_with_retry(doc_id, subtitle_chunks)
    if resolved_wiki_node and doc_url:
        _ensure_root_link(resolved_wiki_node, doc_url, video_title, obj_token=doc_id)
    return {
        "doc_url": doc_url,
        "subtitle_batches_total": chunk_result["total"],
        "subtitle_batches_succeeded": chunk_result["succeeded"],
        "subtitle_batches_failed": chunk_result["failed"],
        "subtitle_errors": chunk_result["errors"],
        "cover_error": cover_error,
    }
