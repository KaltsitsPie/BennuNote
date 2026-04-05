import time

import anthropic


DEFAULT_MODEL = "claude-haiku-4-5-20251001"


def summarize_subtitles(setup_token: str, title: str, text: str, model: str = "", max_retries: int = 3) -> str:
    # Setup tokens (sk-ant-oat01-...) require:
    # 1. Authorization: Bearer (via auth_token param, NOT api_key)
    # 2. anthropic-beta header with claude-code and oauth flags
    # 3. user-agent and x-app headers identifying as claude-cli
    # Aligned with OpenClaw's anthropic-transport-stream.ts
    client = anthropic.Anthropic(
        auth_token=setup_token,
        default_headers={
            "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
            "user-agent": "claude-cli/2.1.75",
            "x-app": "cli",
        },
    )
    for attempt in range(max_retries):
        try:
            message = client.messages.create(
                model=model or DEFAULT_MODEL,
                max_tokens=2048,
                system="You are Claude Code, Anthropic's official CLI for Claude. 你是一个视频内容分析助手。请对以下视频字幕进行结构化总结，包含要点提炼和关键信息。",
                messages=[
                    {"role": "user", "content": f"视频标题：{title}\n\n字幕内容：\n{text}"}
                ],
            )
            return message.content[0].text
        except anthropic.RateLimitError:
            if attempt < max_retries - 1:
                wait = 2 ** (attempt + 1)  # 2, 4, 8 seconds
                time.sleep(wait)
            else:
                raise
