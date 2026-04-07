"""Multi-provider AI summarization service.

Supports 5 providers (pick one):
  - claude_setup_token: Claude via setup token (OAuth)
  - claude_api: Claude via standard API key
  - openai: OpenAI API
  - gemini: Google Gemini API
  - deepseek: DeepSeek API (OpenAI-compatible)
"""

import time
from typing import Optional

SYSTEM_PROMPT = """\
你是一位专业的内容分析师。请对以下视频文案进行深度总结，输出规范的 Markdown 文档。

【过滤规则】
- 忽略所有与主题无关的内容：广告、片尾致谢、频道引导语（如\u201c感谢三连\u201d）等
- 仅处理与核心主题直接相关的内容

【结构规则】
- 按视频的内容逻辑划分章节，每章有明确的主题标题
- 保留事件/论点之间的因果逻辑和叙事连贯性
- 对比性信息（数据、人物、国家等）优先使用表格呈现
- 文末附\u201c关键数据速览\u201d表格，汇总全文重要数字

【内容深度规则】
- 区分\u201c事实陈述\u201d与\u201c分析洞察\u201d，重要结论处用 blockquote（> ）标注
- 对视频中出现的核心概念、理论框架、专有名词给出简明解释
- 提炼跨章节的深层逻辑与结构性规律，不只罗列各段要点
- 文末写\u201c总结\u201d一节，用2-3段文字概括全文核心论点与意义

【格式规则】
- 使用 Markdown：# 一级标题、## 二级标题、### 三级标题、**加粗**、> blockquote
- 适度使用列表，但叙事性内容优先用段落而非 bullet points
- 输出语言与原文一致"""

DEFAULT_MODELS = {
    "claude_setup_token": "claude-haiku-4-5-20251001",
    "claude_api": "claude-haiku-4-5-20251001",
    "openai": "gpt-5.4",
    "gemini": "gemini-2.5-flash",
    "deepseek": "deepseek-chat",
}


def summarize_with_params(
    provider: str, api_key: str, title: str, text: str,
    model: Optional[str] = None, max_tokens: Optional[int] = None, max_retries: int = 3
) -> str:
    """Called by the router with explicit provider/key/model from the request."""
    m = model or DEFAULT_MODELS.get(provider, "")
    mt = max_tokens or 4096
    if provider == "claude_setup_token":
        return _summarize_claude_setup_token(api_key, m, title, text, mt, max_retries)
    elif provider == "claude_api":
        return _summarize_claude_api(api_key, m, title, text, mt, max_retries)
    elif provider == "openai":
        if m == "gpt-5.4-pro":
            return _summarize_openai_responses(api_key, m, title, text, mt, max_retries)
        return _summarize_openai(api_key, m, title, text, mt, max_retries)
    elif provider == "gemini":
        return _summarize_gemini(api_key, m, title, text, mt, max_retries)
    elif provider == "deepseek":
        return _summarize_deepseek(api_key, m, title, text, mt, max_retries)
    else:
        raise ValueError(f"Unknown provider: {provider}")




def _summarize_claude_setup_token(
    token: str, model: str, title: str, text: str, max_tokens: int, max_retries: int
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
    return _call_anthropic(client, model, title, text, max_tokens, max_retries)


def _summarize_claude_api(
    api_key: str, model: str, title: str, text: str, max_tokens: int, max_retries: int
) -> str:
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    return _call_anthropic(client, model, title, text, max_tokens, max_retries)


def _call_anthropic(client, model: str, title: str, text: str, max_tokens: int, max_retries: int) -> str:
    import anthropic

    for attempt in range(max_retries):
        try:
            message = client.messages.create(
                model=model,
                max_tokens=max_tokens,
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
    api_key: str, model: str, title: str, text: str, max_tokens: int, max_retries: int
) -> str:
    from openai import OpenAI, RateLimitError

    client = OpenAI(api_key=api_key)
    for attempt in range(max_retries):
        try:
            resp = client.chat.completions.create(
                model=model,
                max_tokens=max_tokens,
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


def _summarize_openai_responses(
    api_key: str, model: str, title: str, text: str, max_tokens: int, max_retries: int
) -> str:
    from openai import OpenAI, RateLimitError

    client = OpenAI(api_key=api_key)
    for attempt in range(max_retries):
        try:
            resp = client.responses.create(
                model=model,
                max_output_tokens=max_tokens,
                instructions=SYSTEM_PROMPT,
                input=f"视频标题：{title}\n\n字幕内容：\n{text}",
            )
            return resp.output_text
        except RateLimitError:
            if attempt < max_retries - 1:
                time.sleep(2 ** (attempt + 1))
            else:
                raise


def _summarize_gemini(
    api_key: str, model: str, title: str, text: str, max_tokens: int, max_retries: int
) -> str:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model=model,
                contents=f"{SYSTEM_PROMPT}\n\n视频标题：{title}\n\n字幕内容：\n{text}",
                config=types.GenerateContentConfig(max_output_tokens=max_tokens),
            )
            return response.text
        except Exception as e:
            if "429" in str(e) and attempt < max_retries - 1:
                time.sleep(2 ** (attempt + 1))
            else:
                raise


def _summarize_deepseek(
    api_key: str, model: str, title: str, text: str, max_tokens: int, max_retries: int
) -> str:
    from openai import OpenAI, RateLimitError

    client = OpenAI(api_key=api_key, base_url="https://api.deepseek.com")
    for attempt in range(max_retries):
        try:
            resp = client.chat.completions.create(
                model=model,
                max_tokens=max_tokens,
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
