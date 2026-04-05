import anthropic


def summarize_subtitles(setup_token: str, title: str, text: str) -> str:
    client = anthropic.Anthropic(api_key=setup_token)
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2048,
        system="你是一个视频内容分析助手。请对以下视频字幕进行结构化总结，包含要点提炼和关键信息。",
        messages=[
            {"role": "user", "content": f"视频标题：{title}\n\n字幕内容：\n{text}"}
        ],
    )
    return message.content[0].text
