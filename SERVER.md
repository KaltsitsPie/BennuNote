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

### 转录与总结

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/transcript` | 音频转录（Bcut ASR → Whisper 降级） |
| POST | `/summarize` | AI 字幕总结（多 provider，凭证由请求携带） |

### 飞书（`/feishu/*`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/feishu/auth/status` | 查询 lark-cli 登录状态 |
| POST | `/feishu/auth/logout` | lark-cli 登出 |
| GET | `/feishu/wiki/spaces` | 列出知识空间 |
| POST | `/feishu/wiki/spaces/create` | 创建知识空间 |
| GET | `/feishu/wiki/nodes` | 列出知识节点 |
| POST | `/feishu/docs/create` | 从 Markdown 创建文档 |
| GET | `/feishu/docs/fetch` | 获取文档内容 |
| POST | `/feishu/docs/update` | 更新文档（追加/覆盖/替换等模式） |
| GET | `/feishu/docs/search` | 搜索文档 |
| POST | `/feishu/docs/media-insert` | 插入图片或文件到文档 |
| POST | `/feishu/whiteboard/update` | 更新画板 DSL |
| POST | `/write_feishu` | ⚠️ Legacy 端点（向后兼容，内部调用飞书服务） |

### `/transcript` 请求格式

```json
{
  "bvid": "BVxxxx",
  "video_url": "",
  "model_size": "tiny",
  "cookie": "",
  "language": "zh",
  "req_id": ""
}
```

- `bvid` 与 `video_url` 二选一（`video_url` 优先）
- `req_id`：可选的请求关联 ID，用于日志追踪；若不传则服务器自动生成

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

### `/feishu/docs/create` 请求格式

```json
{
  "markdown": "# 标题\n内容",
  "title": "文档标题",
  "wiki_node": "节点 token（可选）",
  "wiki_space": "空间 ID（可选）",
  "folder_token": "文件夹 token（可选）"
}
```

### `/write_feishu` 请求格式（Legacy）

```json
{
  "text": "字幕文本",
  "title": "文档标题",
  "items": [{ "from": 0.0, "to": 3.5, "content": "字幕内容" }],
  "video_info": { "bvid": "BVxxxx", "title": "视频标题", "ownerName": "...", "coverUrl": "..." },
  "wiki_node": "根节点 token",
  "target_doc_token": ""
}
```

## 架构

```
server/
├── main.py              # FastAPI app，路由挂载，CORS，legacy /write_feishu
├── request_context.py   # 请求级 req_id（contextvars）+ 日志 Filter
├── routers/
│   ├── health.py        # /health
│   ├── transcript.py    # /transcript（yt-dlp + Bcut ASR + Whisper）
│   ├── summarize.py     # /summarize（多 provider AI 总结）
│   └── feishu.py        # /feishu/* REST API + legacy_write_feishu
└── services/
    ├── bcut_asr.py      # Bcut ASR 客户端
    ├── larkcli.py       # lark-cli 子进程封装（run / get_auth_status）
    ├── feishu_service.py # 飞书文档操作（通过 larkcli）
    ├── summarize_service.py # 多 provider AI 总结（Claude/OpenAI/Gemini/DeepSeek）
    └── whisper_service.py # faster-whisper 本地转录
```

### 日志格式

日志包含请求关联 ID（`req_id`），便于在多并发场景下追踪单次请求的完整流程：

```
12:34:56 [bennunote.transcript] INFO [a3f7k2]: Transcript request: req_id=a3f7k2, url=...
```

`req_id` 由扩展在发起 `/transcript` 请求时生成（6 位随机字母数字），若未传入则由服务器自动生成。

## 依赖

主要依赖（完整列表见 `requirements.txt`）：

- `fastapi` + `uvicorn` — Web 框架
- `yt-dlp` — 音频下载
- `faster-whisper` — 本地语音识别
- `anthropic` — Claude API
- `openai` — OpenAI / DeepSeek API
- `google-genai` — Gemini API
- `lark-cli` — 飞书操作 CLI（二进制，通过子进程调用；由 `./start-server.sh` 安装）
