"""Multi-provider AI summarization service.

Supports 5 providers (pick one):
  - claude_setup_token: Claude via setup token (OAuth)
  - claude_api: Claude via standard API key
  - openai: OpenAI API
  - gemini: Google Gemini API
  - deepseek: DeepSeek API (OpenAI-compatible)
"""

import time

SYSTEM_PROMPT = (
    "你是一个视频内容分析助手。请对以下视频字幕进行结构化总结，包含要点提炼和关键信息。"
)

DEFAULT_MODELS = {
    "claude_setup_token": "claude-haiku-4-5-20251001",
    "claude_api": "claude-haiku-4-5-20251001",
    "openai": "gpt-4o-mini",
    "gemini": "gemini-2.5-flash",
    "deepseek": "deepseek-chat",
}


def summarize_with_params(
    provider: str, api_key: str, title: str, text: str,
    model: str | None = None, max_retries: int = 3
) -> str:
    """Called by the router with explicit provider/key/model from the request."""
    m = model or DEFAULT_MODELS.get(provider, "")
    if provider == "claude_setup_token":
        return _summarize_claude_setup_token(api_key, m, title, text, max_retries)
    elif provider == "claude_api":
        return _summarize_claude_api(api_key, m, title, text, max_retries)
    elif provider == "openai":
        return _summarize_openai(api_key, m, title, text, max_retries)
    elif provider == "gemini":
        return _summarize_gemini(api_key, m, title, text, max_retries)
    elif provider == "deepseek":
        return _summarize_deepseek(api_key, m, title, text, max_retries)
    else:
        raise ValueError(f"Unknown provider: {provider}")


def get_active_provider() -> tuple[str, dict]:
    """Return (provider_name, config_dict) or raise ValueError."""
    cfg = load_config()
    provider = cfg.get("ai_provider", "")

    if not provider:
        # Auto-detect: check which key is set
        for p in ("claude_setup_token", "claude_api", "openai", "gemini", "deepseek"):
            key_field = _key_field(p)
            if cfg.get(key_field):
                provider = p
                break

    if not provider:
        raise ValueError(
            "No AI provider configured. Please set one in Settings or the setup page."
        )
    return provider, cfg


def _key_field(provider: str) -> str:
    """Map provider name to its API key config field."""
    return {
        "claude_setup_token": "claude_setup_token",
        "claude_api": "claude_api_key",
        "openai": "openai_api_key",
        "gemini": "gemini_api_key",
        "deepseek": "deepseek_api_key",
    }[provider]


def _model_field(provider: str) -> str:
    """Map provider name to its model config field."""
    return {
        "claude_setup_token": "claude_model",
        "claude_api": "claude_api_model",
        "openai": "openai_model",
        "gemini": "gemini_model",
        "deepseek": "deepseek_model",
    }[provider]


def summarize(title: str, text: str, max_retries: int = 3) -> str:
    provider, cfg = get_active_provider()
    key = cfg.get(_key_field(provider), "")
    model = cfg.get(_model_field(provider), "") or DEFAULT_MODELS[provider]

    if not key:
        raise ValueError(f"API key for {provider} is not configured.")

    if provider == "claude_setup_token":
        return _summarize_claude_setup_token(key, model, title, text, max_retries)
    elif provider == "claude_api":
        return _summarize_claude_api(key, model, title, text, max_retries)
    elif provider == "openai":
        return _summarize_openai(key, model, title, text, max_retries)
    elif provider == "gemini":
        return _summarize_gemini(key, model, title, text, max_retries)
    elif provider == "deepseek":
        return _summarize_deepseek(key, model, title, text, max_retries)
    else:
        raise ValueError(f"Unknown provider: {provider}")


def _summarize_claude_setup_token(
    token: str, model: str, title: str, text: str, max_retries: int
) -> str:
    import anthropic

    client = anthropic.Anthropic(
        auth_token=token,
        default_headers={
            "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
            "user-agent": "claude-cli/2.1.75",
            "x-app": "cli",
        },
    )
    return _call_anthropic(client, model, title, text, max_retries)


def _summarize_claude_api(
    api_key: str, model: str, title: str, text: str, max_retries: int
) -> str:
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    return _call_anthropic(client, model, title, text, max_retries)


def _call_anthropic(client, model: str, title: str, text: str, max_retries: int) -> str:
    import anthropic

    for attempt in range(max_retries):
        try:
            message = client.messages.create(
                model=model,
                max_tokens=2048,
                system=SYSTEM_PROMPT,
                messages=[
                    {"role": "user", "content": f"视频标题：{title}\n\n字幕内容：\n{text}"}
                ],
            )
            return message.content[0].text
        except anthropic.RateLimitError:
            if attempt < max_retries - 1:
                time.sleep(2 ** (attempt + 1))
            else:
                raise


def _summarize_openai(
    api_key: str, model: str, title: str, text: str, max_retries: int
) -> str:
    from openai import OpenAI, RateLimitError

    client = OpenAI(api_key=api_key)
    for attempt in range(max_retries):
        try:
            resp = client.chat.completions.create(
                model=model,
                max_tokens=2048,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"视频标题：{title}\n\n字幕内容：\n{text}"},
                ],
            )
            return resp.choices[0].message.content
        except RateLimitError:
            if attempt < max_retries - 1:
                time.sleep(2 ** (attempt + 1))
            else:
                raise


def _summarize_gemini(
    api_key: str, model: str, title: str, text: str, max_retries: int
) -> str:
    from google import genai

    client = genai.Client(api_key=api_key)
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model=model,
                contents=f"{SYSTEM_PROMPT}\n\n视频标题：{title}\n\n字幕内容：\n{text}",
            )
            return response.text
        except Exception as e:
            if "429" in str(e) and attempt < max_retries - 1:
                time.sleep(2 ** (attempt + 1))
            else:
                raise


def _summarize_deepseek(
    api_key: str, model: str, title: str, text: str, max_retries: int
) -> str:
    from openai import OpenAI, RateLimitError

    client = OpenAI(api_key=api_key, base_url="https://api.deepseek.com")
    for attempt in range(max_retries):
        try:
            resp = client.chat.completions.create(
                model=model,
                max_tokens=2048,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"视频标题：{title}\n\n字幕内容：\n{text}"},
                ],
            )
            return resp.choices[0].message.content
        except RateLimitError:
            if attempt < max_retries - 1:
                time.sleep(2 ** (attempt + 1))
            else:
                raise
