from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.summarize_service import summarize

router = APIRouter()


class SummarizeRequest(BaseModel):
    text: str
    title: str


class SummarizeResponse(BaseModel):
    summary: str


@router.post("/summarize", response_model=SummarizeResponse)
def do_summarize(req: SummarizeRequest):
    try:
        result = summarize(req.title, req.text)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        error_msg = str(e)
        if "authentication" in error_msg.lower() or "401" in error_msg:
            raise HTTPException(
                status_code=401, detail="Invalid API key. Please check Settings."
            )
        if "rate" in error_msg.lower() or "429" in error_msg:
            raise HTTPException(
                status_code=429, detail="Rate limited. Please try again later."
            )
        raise HTTPException(status_code=500, detail=error_msg)
    return SummarizeResponse(summary=result)
