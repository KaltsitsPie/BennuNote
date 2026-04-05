import lark_oapi as lark
from lark_oapi.api.docx.v1 import (
    CreateDocumentRequest,
    CreateDocumentRequestBody,
    CreateDocumentBlockChildrenRequest,
    CreateDocumentBlockChildrenRequestBody,
)
import json


def _build_client(app_id: str, app_secret: str) -> lark.Client:
    return lark.Client.builder().app_id(app_id).app_secret(app_secret).build()


def _text_block(text: str) -> dict:
    """Build a Lark document text block."""
    return {
        "block_type": 2,  # text block
        "text": {
            "elements": [
                {
                    "text_run": {
                        "content": text,
                    }
                }
            ],
            "style": {},
        },
    }


def _heading_block(text: str, level: int = 3) -> dict:
    """Build a Lark document heading block."""
    return {
        "block_type": 4,  # heading block
        "heading": {
            "elements": [
                {
                    "text_run": {
                        "content": text,
                    }
                }
            ],
            "level": level,
        },
    }


def create_document(
    app_id: str,
    app_secret: str,
    title: str,
    content: str,
    folder_token: str = "",
) -> str:
    """Create a new Lark document and return its URL."""
    client = _build_client(app_id, app_secret)

    # Create document
    req = CreateDocumentRequest.builder().request_body(
        CreateDocumentRequestBody.builder()
        .title(title)
        .folder_token(folder_token if folder_token else None)
        .build()
    ).build()

    resp = client.docx.v1.document.create(req)
    if not resp.success():
        raise Exception(f"Create document failed: {resp.code} - {resp.msg}")

    doc_id = resp.data.document.document_id
    _write_content_to_doc(client, doc_id, title, content)

    return f"https://bytedance.larkoffice.com/docx/{doc_id}"


def append_to_document(
    app_id: str,
    app_secret: str,
    doc_token: str,
    title: str,
    content: str,
) -> str:
    """Append content to an existing Lark document and return its URL."""
    client = _build_client(app_id, app_secret)
    _write_content_to_doc(client, doc_token, title, content)
    return f"https://bytedance.larkoffice.com/docx/{doc_token}"


def _write_content_to_doc(
    client: lark.Client,
    document_id: str,
    title: str,
    content: str,
):
    """Write heading + text blocks to a document's first page block."""
    # Split content into chunks of ~400 chars (Lark block text limit)
    max_chunk = 400
    lines = content.split("\n")
    chunks: list[str] = []
    current = ""
    for line in lines:
        if len(current) + len(line) + 1 > max_chunk:
            if current:
                chunks.append(current)
            current = line
        else:
            current = f"{current}\n{line}" if current else line
    if current:
        chunks.append(current)

    # Build blocks: heading + text chunks
    children = [_heading_block(title)]
    for chunk in chunks:
        children.append(_text_block(chunk))

    body = CreateDocumentBlockChildrenRequestBody.builder().children(
        json.dumps(children)
    ).build()

    req = (
        CreateDocumentBlockChildrenRequest.builder()
        .document_id(document_id)
        .block_id(document_id)  # root block = document_id
        .request_body(body)
        .build()
    )

    resp = client.docx.v1.document_block_children.create(req)
    if not resp.success():
        raise Exception(f"Write blocks failed: {resp.code} - {resp.msg}")
