from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.claude_service import summarize_subtitles

router = APIRouter()


class SummarizeRequest(BaseModel):
    text: str
    title: str
    setup_token: str


class SummarizeResponse(BaseModel):
    summary: str


@router.post("/summarize", response_model=SummarizeResponse)
async def summarize(req: SummarizeRequest):
    if not req.setup_token or not req.setup_token.startswith("sk-ant-"):
        raise HTTPException(
            status_code=400,
            detail="Please configure Claude Setup Token in Settings",
        )
    try:
        result = summarize_subtitles(req.setup_token, req.title, req.text)
    except Exception as e:
        error_msg = str(e)
        if "authentication" in error_msg.lower() or "401" in error_msg:
            raise HTTPException(
                status_code=401, detail="Invalid Setup Token. Please check Settings."
            )
        if "rate" in error_msg.lower() or "429" in error_msg:
            raise HTTPException(
                status_code=429, detail="Rate limited. Please try again later."
            )
        raise HTTPException(status_code=500, detail=error_msg)
    return SummarizeResponse(summary=result)
