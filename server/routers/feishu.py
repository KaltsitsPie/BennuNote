# server/routers/feishu.py
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
import tempfile
import os

from services.feishu_service import (
    auth_status,
    list_wiki_spaces,
    list_wiki_nodes,
    create_doc,
    fetch_doc,
    update_doc,
    search_docs,
    insert_media,
    update_whiteboard,
)
from services.larkcli import LarkCliError, run

router = APIRouter(prefix="/feishu", tags=["feishu"])


def _handle_error(e: LarkCliError):
    raise HTTPException(status_code=500, detail=str(e))


# --- Auth ---

@router.get("/auth/status")
def get_auth_status():
    try:
        return auth_status()
    except LarkCliError as e:
        _handle_error(e)


@router.post("/auth/logout")
def post_auth_logout():
    try:
        from services.larkcli import run
        return run("auth", "logout")
    except LarkCliError as e:
        _handle_error(e)


# --- Wiki ---

@router.get("/wiki/spaces")
def get_wiki_spaces():
    try:
        return list_wiki_spaces()
    except LarkCliError as e:
        _handle_error(e)


class CreateWikiSpaceRequest(BaseModel):
    name: str
    description: str = ""


@router.post("/wiki/spaces/create")
def post_create_wiki_space(req: CreateWikiSpaceRequest):
    try:
        from services.larkcli import run
        import json as _json
        body = _json.dumps({"name": req.name, "description": req.description})
        return run("api", "POST", "/open-apis/wiki/v2/spaces", "--data", body)
    except LarkCliError as e:
        _handle_error(e)


@router.get("/wiki/nodes")
def get_wiki_nodes(space_id: str, parent_node_token: str = ""):
    try:
        return list_wiki_nodes(space_id, parent_node_token)
    except LarkCliError as e:
        _handle_error(e)


# --- Documents ---

class CreateDocRequest(BaseModel):
    markdown: str
    title: str = ""
    wiki_node: str = ""
    wiki_space: str = ""
    folder_token: str = ""


@router.post("/docs/create")
def post_create_doc(req: CreateDocRequest):
    try:
        return create_doc(
            markdown=req.markdown,
            title=req.title,
            wiki_node=req.wiki_node,
            wiki_space=req.wiki_space,
            folder_token=req.folder_token,
        )
    except LarkCliError as e:
        _handle_error(e)


@router.get("/docs/fetch")
def get_fetch_doc(doc: str):
    try:
        return fetch_doc(doc)
    except LarkCliError as e:
        _handle_error(e)


class UpdateDocRequest(BaseModel):
    doc: str
    mode: str
    markdown: str = ""
    selection_by_title: str = ""
    selection_with_ellipsis: str = ""
    new_title: str = ""


@router.post("/docs/update")
def post_update_doc(req: UpdateDocRequest):
    try:
        return update_doc(
            doc=req.doc,
            mode=req.mode,
            markdown=req.markdown,
            selection_by_title=req.selection_by_title,
            selection_with_ellipsis=req.selection_with_ellipsis,
            new_title=req.new_title,
        )
    except LarkCliError as e:
        _handle_error(e)


@router.get("/docs/search")
def get_search_docs(query: str, page_size: int = 15, page_token: str = ""):
    try:
        return search_docs(query, page_size, page_token)
    except LarkCliError as e:
        _handle_error(e)


# --- Media ---

@router.post("/docs/media-insert")
async def post_media_insert(
    doc: str = Form(...),
    file_type: str = Form("image"),
    align: str = Form("center"),
    caption: str = Form(""),
    file: UploadFile = File(...),
):
    try:
        suffix = os.path.splitext(file.filename or "upload")[1] or ".png"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name
        try:
            result = insert_media(doc, tmp_path, file_type, align, caption)
        finally:
            os.unlink(tmp_path)
        return result
    except LarkCliError as e:
        _handle_error(e)


# --- Whiteboard ---

class WhiteboardUpdateRequest(BaseModel):
    whiteboard_token: str
    dsl_content: str
    overwrite: bool = False


@router.post("/whiteboard/update")
def post_whiteboard_update(req: WhiteboardUpdateRequest):
    try:
        return update_whiteboard(req.whiteboard_token, req.dsl_content, req.overwrite)
    except LarkCliError as e:
        _handle_error(e)


# --- Legacy endpoint ---

class SubtitleItem(BaseModel):
    from_: float = 0
    to: float = 0
    content: str = ""

    model_config = {"populate_by_name": True}

    def __init__(self, **data):
        if "from" in data:
            data["from_"] = data.pop("from")
        super().__init__(**data)


class LegacyWriteFeishuRequest(BaseModel):
    text: str
    title: str
    items: list[dict] = []
    target_doc_token: str = ""
    video_info: dict = {}
    app_id: str = ""
    app_secret: str = ""
    wiki_node: str = ""


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
        from datetime import datetime, timezone, timedelta
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
        import json as _json
        result = run("api", "GET", "/open-apis/wiki/v2/spaces/get_node",
                     "--params", _json.dumps({"token": wiki_token}))
        return result.get("data", {}).get("node", {}).get("obj_token", "")
    except LarkCliError:
        return ""


def _ensure_root_link(wiki_node: str, doc_url: str, title: str, obj_token: str = ""):
    """Append a mention-doc link to the wiki root node if not already present.

    Feishu stores the obj_token (not the wiki node token) in mention-doc blocks,
    so we resolve it before checking for duplicates.
    """
    import logging
    log = logging.getLogger(__name__)
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
            log.info("Root doc already contains link (obj=%s, wiki=%s), skipping", obj_token, wiki_token)
            return
        mention = f'<mention-doc token="{wiki_token}" type="wiki">{title}</mention-doc>\n'
        update_doc(doc=wiki_node, mode="append", markdown=mention)
        log.info("Appended link to root doc: %s (obj=%s)", wiki_token, obj_token)
    except LarkCliError as e:
        log.warning("Failed to update root doc with link: %s", e)


def legacy_write_feishu(req: LegacyWriteFeishuRequest):
    """Assembles markdown from video_info + subtitle items, creates Feishu doc."""
    vi = req.video_info
    bvid = vi.get("bvid", "")
    video_title = vi.get("title", req.title)
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
    if req.items:
        for i in range(0, len(req.items), BATCH_SIZE):
            batch = req.items[i:i + BATCH_SIZE]
            chunk_lines = []
            if i == 0:
                chunk_lines += ["## 字幕", ""]
            chunk_lines.append(_build_subtitle_table(batch))
            chunk_lines.append("")
            subtitle_chunks.append("\n".join(chunk_lines))
    elif req.text:
        subtitle_chunks.append(f"## 字幕\n\n{req.text}\n")

    wiki_node = req.wiki_node or req.target_doc_token or ""

    try:
        # Create doc with header + info only
        if wiki_node and not req.target_doc_token:
            result = create_doc(markdown=header_md, title=req.title, wiki_node=wiki_node)
        elif req.target_doc_token:
            result = update_doc(doc=req.target_doc_token, mode="append", markdown=header_md)
            doc_url = result.get("data", {}).get("doc_url", "") or result.get("doc_url", "")
            for chunk in subtitle_chunks:
                update_doc(doc=req.target_doc_token, mode="append", markdown=chunk)
            # Ensure link in root doc (no doc_id — let it resolve from wiki token)
            target_url = doc_url or f"https://www.feishu.cn/wiki/{req.target_doc_token}"
            if req.wiki_node:
                _ensure_root_link(req.wiki_node, target_url, video_title)
            return {"doc_url": doc_url}
        else:
            result = create_doc(markdown=header_md, title=req.title)

        doc_url = result.get("data", {}).get("doc_url", "") or result.get("doc_url", "")
        doc_id = result.get("data", {}).get("doc_id", "")
        if doc_id:
            for chunk in subtitle_chunks:
                update_doc(doc=doc_id, mode="append", markdown=chunk)
        # Ensure link in root doc (doc_id from create IS the obj_token)
        if wiki_node and doc_url:
            _ensure_root_link(wiki_node, doc_url, video_title, obj_token=doc_id)
        return {"doc_url": doc_url}
    except LarkCliError as e:
        raise HTTPException(status_code=500, detail=str(e))
