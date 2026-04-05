from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from config import get_config_status, update_config, delete_config_key, SENSITIVE_KEYS

router = APIRouter()


class ConfigUpdateRequest(BaseModel):
    feishu_app_id: Optional[str] = None
    feishu_app_secret: Optional[str] = None
    ai_provider: Optional[str] = None
    claude_setup_token: Optional[str] = None
    claude_model: Optional[str] = None
    claude_api_key: Optional[str] = None
    claude_api_model: Optional[str] = None
    openai_api_key: Optional[str] = None
    openai_model: Optional[str] = None
    gemini_api_key: Optional[str] = None
    gemini_model: Optional[str] = None
    deepseek_api_key: Optional[str] = None
    deepseek_model: Optional[str] = None


@router.get("/config")
def get_config():
    return get_config_status()


@router.put("/config")
def put_config(req: ConfigUpdateRequest):
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided")
    return update_config(updates)


@router.delete("/config/{key}")
def clear_config(key: str):
    if key not in SENSITIVE_KEYS:
        raise HTTPException(status_code=400, detail=f"Invalid key: {key}")
    return delete_config_key(key)
