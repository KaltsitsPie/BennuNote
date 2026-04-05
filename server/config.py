import json
import os

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")
SENSITIVE_KEYS = (
    "feishu_app_id", "feishu_app_secret",
    "ai_provider",  # "claude_setup_token" | "claude_api" | "openai" | "gemini" | "deepseek"
    "claude_setup_token", "claude_model",
    "claude_api_key", "claude_api_model",
    "openai_api_key", "openai_model",
    "gemini_api_key", "gemini_model",
    "deepseek_api_key", "deepseek_model",
)


def load_config() -> dict:
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_config(config: dict) -> None:
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)


def _redact(value: str) -> str:
    if len(value) <= 4:
        return "***"
    return value[:4] + "***"


def get_config_status() -> dict:
    config = load_config()
    status = {}
    for key in SENSITIVE_KEYS:
        val = config.get(key, "")
        status[key] = {
            "set": bool(val),
            "preview": _redact(val) if val else "",
        }
    return status


def update_config(updates: dict) -> dict:
    config = load_config()
    for key, value in updates.items():
        if key in SENSITIVE_KEYS:
            config[key] = value
    save_config(config)
    return get_config_status()


def delete_config_key(key: str) -> dict:
    config = load_config()
    config.pop(key, None)
    save_config(config)
    return get_config_status()


def is_config_complete() -> bool:
    """Check if Feishu + at least one AI provider is configured."""
    config = load_config()
    feishu_ok = bool(config.get("feishu_app_id")) and bool(config.get("feishu_app_secret"))
    ai_ok = any(
        bool(config.get(k))
        for k in ("claude_setup_token", "claude_api_key", "openai_api_key", "gemini_api_key", "deepseek_api_key")
    )
    return feishu_ok and ai_ok
