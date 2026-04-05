# server/routers/feishu.py
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional
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
from services.larkcli import LarkCliError

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
        return run("api", "POST", "/open-apis/wiki/v2/spaces", "--body", body)
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
    folder_token: str = ""


@router.post("/docs/create")
def post_create_doc(req: CreateDocRequest):
    try:
        return create_doc(
            markdown=req.markdown,
            title=req.title,
            wiki_node=req.wiki_node,
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


def legacy_write_feishu(req: LegacyWriteFeishuRequest):
    """Assembles markdown from video_info + subtitle items, creates Feishu doc."""
    vi = req.video_info
    bvid = vi.get("bvid", "")
    video_title = vi.get("title", req.title)
    owner_name = vi.get("ownerName", vi.get("owner_name", ""))
    owner_mid = vi.get("ownerMid", vi.get("owner_mid", ""))
    cover_url = vi.get("coverUrl", vi.get("cover_url", ""))

    lines = [f"# {video_title}"]
    # Cover image as embedded image (markdown img syntax)
    if cover_url:
        full_url = f"https:{cover_url}" if cover_url.startswith("//") else cover_url
        lines.append(f"![cover]({full_url})")
    lines += ["", "## 主要信息"]
    if owner_name:
        if owner_mid:
            lines.append(f"- UP主: [{owner_name}](https://space.bilibili.com/{owner_mid})")
        else:
            lines.append(f"- UP主: {owner_name}")
    if bvid:
        lines.append(f"- 原始链接: [Bilibili](https://www.bilibili.com/video/{bvid})")

    # Subtitles section — folded heading with lark-table
    lines.append('## 字幕 {folded="true"}')
    lines.append("")
    if req.items:
        lines.append(_build_subtitle_table(req.items))
    else:
        # Fallback: plain text if no structured items provided
        lines.append(req.text)
    lines.append("")
    markdown = "\n".join(lines)

    wiki_node = req.wiki_node or req.target_doc_token or ""

    try:
        if wiki_node and not req.target_doc_token:
            result = create_doc(markdown=markdown, title=req.title, wiki_node=wiki_node)
        elif req.target_doc_token:
            result = update_doc(doc=req.target_doc_token, mode="append", markdown=markdown)
        else:
            result = create_doc(markdown=markdown, title=req.title)

        doc_url = result.get("data", {}).get("doc_url", "") or result.get("doc_url", "")
        return {"doc_url": doc_url}
    except LarkCliError as e:
        raise HTTPException(status_code=500, detail=str(e))
