from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from services.summarize_service import summarize_with_params

router = APIRouter()


class SummarizeRequest(BaseModel):
    text: str
    title: str
    provider: str  # "claude_setup_token" | "claude_api" | "openai" | "gemini" | "deepseek"
    api_key: str
    model: Optional[str] = None


class SummarizeResponse(BaseModel):
    summary: str


@router.post("/summarize", response_model=SummarizeResponse)
def do_summarize(req: SummarizeRequest):
    if not req.api_key:
        raise HTTPException(status_code=400, detail="API key not provided.")
    try:
        result = summarize_with_params(req.provider, req.api_key, req.title, req.text, req.model)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        error_msg = str(e)
        if "authentication" in error_msg.lower() or "401" in error_msg:
            raise HTTPException(status_code=401, detail="Invalid API key.")
        if "rate" in error_msg.lower() or "429" in error_msg:
            raise HTTPException(status_code=429, detail="Rate limited. Please try again later.")
        raise HTTPException(status_code=500, detail=error_msg)
    return SummarizeResponse(summary=result)
