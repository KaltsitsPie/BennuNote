# server/services/feishu_service.py
"""Feishu service — all operations via lark-cli subprocess."""
import json
import logging
from datetime import datetime, timezone, timedelta

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

    desc_cell = desc or ""

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
        content = item.get("content", "")
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
        mention = f'<mention-doc token="{wiki_token}" type="wiki">{title}</mention-doc>\n'
        update_doc(doc=wiki_node, mode="append", markdown=mention)
        logger.info("Appended link to root doc: %s (obj=%s)", wiki_token, obj_token)
    except LarkCliError as e:
        logger.warning("Failed to update root doc with link: %s", e)


def legacy_write_feishu(text: str, title: str, items: list, target_doc_token: str,
                        video_info: dict, wiki_node: str) -> dict:
    """Assembles markdown from video_info + subtitle items, creates Feishu doc."""
    vi = video_info
    bvid = vi.get("bvid", "")
    video_title = vi.get("title", title)
    cover_url = vi.get("coverUrl", vi.get("cover_url", ""))

    # Step 1: Build header + info markdown (without subtitles)
    header_lines = [f"# {video_title}"]
    if cover_url:
        full_url = f"https:{cover_url}" if cover_url.startswith("//") else cover_url
        header_lines.append(f"![cover]({full_url})")
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

    resolved_wiki_node = wiki_node or target_doc_token or ""

    # Create doc with header + info only
    if resolved_wiki_node and not target_doc_token:
        result = create_doc(markdown=header_md, title=title, wiki_node=resolved_wiki_node)
    elif target_doc_token:
        result = update_doc(doc=target_doc_token, mode="append", markdown=header_md)
        doc_url = result.get("data", {}).get("doc_url", "") or result.get("doc_url", "")
        for chunk in subtitle_chunks:
            update_doc(doc=target_doc_token, mode="append", markdown=chunk)
        # Ensure link in root doc (no doc_id — let it resolve from wiki token)
        target_url = doc_url or f"https://www.feishu.cn/wiki/{target_doc_token}"
        if wiki_node:
            _ensure_root_link(wiki_node, target_url, video_title)
        return {"doc_url": doc_url}
    else:
        result = create_doc(markdown=header_md, title=title)

    doc_url = result.get("data", {}).get("doc_url", "") or result.get("doc_url", "")
    doc_id = result.get("data", {}).get("doc_id", "")
    if doc_id:
        for chunk in subtitle_chunks:
            update_doc(doc=doc_id, mode="append", markdown=chunk)
    # Ensure link in root doc (doc_id from create IS the obj_token)
    if resolved_wiki_node and doc_url:
        _ensure_root_link(resolved_wiki_node, doc_url, video_title, obj_token=doc_id)
    return {"doc_url": doc_url}
