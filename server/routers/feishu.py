from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.feishu_service import create_document, append_to_document

router = APIRouter()


class WriteFeishuRequest(BaseModel):
    text: str
    title: str
    mode: str  # "append" | "new"
    doc_token: str = ""
    folder_token: str = ""
    app_id: str
    app_secret: str


class WriteFeishuResponse(BaseModel):
    doc_url: str


@router.post("/write_feishu", response_model=WriteFeishuResponse)
async def write_feishu(req: WriteFeishuRequest):
    try:
        if req.mode == "append":
            if not req.doc_token:
                raise HTTPException(status_code=400, detail="doc_token required for append mode")
            url = append_to_document(
                app_id=req.app_id,
                app_secret=req.app_secret,
                doc_token=req.doc_token,
                title=req.title,
                content=req.text,
            )
        elif req.mode == "new":
            url = create_document(
                app_id=req.app_id,
                app_secret=req.app_secret,
                title=req.title,
                content=req.text,
                folder_token=req.folder_token,
            )
        else:
            raise HTTPException(status_code=400, detail=f"Invalid mode: {req.mode}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return WriteFeishuResponse(doc_url=url)
