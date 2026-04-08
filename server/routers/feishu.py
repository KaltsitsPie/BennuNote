# server/routers/feishu.py
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
import json
import logging
import tempfile
import os

logger = logging.getLogger(__name__)

import services.feishu_service as feishu_service
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
        body = json.dumps({"name": req.name, "description": req.description})
        return run("api", "POST", "/open-apis/wiki/v2/spaces", "--data", body)
    except LarkCliError as e:
        _handle_error(e)


@router.get("/wiki/node-info")
def get_wiki_node_info(token: str):
    """Resolve a wiki node token to its space name."""
    try:
        # Get node info (returns space_id, title, etc.)
        node_result = run("api", "GET", "/open-apis/wiki/v2/spaces/get_node",
                          "--params", json.dumps({"token": token}))
        node = node_result.get("data", {}).get("node", {})
        space_id = node.get("space_id", "")
        if not space_id:
            return {"space_id": "", "space_name": "", "node_title": node.get("title", "")}

        # Get space info to find the name
        spaces = list_wiki_spaces()
        space_name = ""
        for space in spaces.get("data", {}).get("items", []):
            if space.get("space_id") == space_id:
                space_name = space.get("name", "")
                break

        return {"space_id": space_id, "space_name": space_name, "node_title": node.get("title", "")}
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
        # lark-cli requires a relative file path within cwd (server dir)
        server_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        tmp_name = f".media_tmp{suffix}"
        tmp_path = os.path.join(server_dir, tmp_name)
        content = await file.read()
        with open(tmp_path, "wb") as f:
            f.write(content)
        try:
            result = insert_media(doc, tmp_name, file_type, align, caption)
        finally:
            if os.path.exists(tmp_path):
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

class LegacyWriteFeishuRequest(BaseModel):
    text: str
    title: str
    items: list[dict] = []
    target_doc_token: str = ""
    video_info: dict = {}
    wiki_node: str = ""


@router.post("/write")
def post_legacy_write_feishu(req: LegacyWriteFeishuRequest):
    try:
        return feishu_service.legacy_write_feishu(
            text=req.text, title=req.title, items=req.items or [],
            target_doc_token=req.target_doc_token or '',
            video_info=req.video_info or {}, wiki_node=req.wiki_node or ''
        )
    except LarkCliError as e:
        _handle_error(e)
