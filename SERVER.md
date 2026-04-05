# BennuNote Backend Server

Python FastAPI 后端，运行在 `http://127.0.0.1:2185`，为 Chrome 扩展提供转录、AI 总结和飞书同步能力。

服务器为可选组件 — 扩展在服务器离线时会直接调用外部 API。服务器在线时优先使用服务器（转录功能需要服务器）。

## 快速启动

```bash
./start-server.sh
```

首次运行会自动创建 venv 并安装依赖。无需额外配置 — 所有凭证由 Chrome 扩展管理并在请求中传入。

## 配置

所有凭证（飞书 App ID/Secret、AI API Key 等）存储在 Chrome 扩展本地（`chrome.storage.local`），通过扩展面板的 Settings tab 进行配置。

服务器本身无状态，不保存任何凭证。每次请求由扩展携带所需凭证。

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/transcript` | 音频转录（Bcut ASR → Whisper 降级） |
| POST | `/summarize` | AI 字幕总结（多 provider，凭证由请求携带） |
| POST | `/write_feishu` | 写入飞书文档（凭证由请求携带） |

### `/summarize` 请求格式

```json
{
  "text": "字幕文本",
  "title": "视频标题",
  "provider": "openai",
  "api_key": "sk-...",
  "model": "gpt-4o-mini"
}
```

支持的 provider：`claude_setup_token`、`claude_api`、`openai`、`gemini`、`deepseek`

### `/write_feishu` 请求格式

```json
{
  "text": "内容",
  "title": "标题",
  "mode": "new",
  "folder_token": "fldcnXXX",
  "app_id": "cli_xxx",
  "app_secret": "xxx"
}
```

## 架构

```
server/
├── main.py              # FastAPI app，路由挂载，CORS
├── routers/
│   ├── health.py        # /health
│   ├── transcript.py    # /transcript（yt-dlp + Bcut ASR + Whisper）
│   ├── summarize.py     # /summarize（多 provider AI 总结）
│   └── feishu.py        # /write_feishu（lark-oapi）
└── services/
    ├── bcut_asr.py      # Bcut ASR 客户端
    ├── summarize_service.py # 多 provider AI 总结（Claude/OpenAI/Gemini/DeepSeek）
    ├── feishu_service.py # 飞书文档操作
    └── whisper_service.py # faster-whisper 本地转录
```

## 依赖

主要依赖（完整列表见 `requirements.txt`）：

- `fastapi` + `uvicorn` — Web 框架
- `yt-dlp` — 音频下载
- `faster-whisper` — 本地语音识别
- `anthropic` — Claude API
- `openai` — OpenAI / DeepSeek API
- `google-genai` — Gemini API
- `lark-oapi` — 飞书 API
