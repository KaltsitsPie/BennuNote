# BennuNote Backend Server

Python FastAPI 后端，运行在 `http://127.0.0.1:2185`，为 Chrome 扩展提供转录、AI 总结和飞书同步能力。

## 快速启动

```bash
./start-server.sh
```

首次运行会自动创建 venv、安装依赖。如果配置不完整，会自动打开浏览器进入设置页面。

## 配置

### Web 设置页面

访问 `http://127.0.0.1:2185/setup` 进行配置。服务器运行期间始终可访问。

配置项：

| 项目 | 说明 | 用途 |
|------|------|------|
| Feishu App ID | 飞书开放平台应用 ID | 飞书文档同步 |
| Feishu App Secret | 飞书应用密钥 | 飞书文档同步 |
| AI Provider | 5 选 1：Claude Setup Token / Claude API / OpenAI / Gemini / DeepSeek | AI 字幕总结 |

配置保存在 `server/config.json`（已 gitignore）。

### 飞书应用权限

设置页面中提供了一键复制功能。需要的权限覆盖以下 7 个域：

- **docx** — 文档创建、读写
- **docs** — 文档内容读取、媒体上传下载、评论、权限管理、事件订阅
- **sheets** — 电子表格创建、读写
- **drive/space** — 云空间元数据、文件上传下载、文件夹管理
- **base** — 多维表格全套（表、字段、记录、视图、仪表盘等）
- **wiki** — 知识空间管理、节点增删改查
- **board** — 画板节点管理

完整 scope 列表见设置页面。

### AI Provider

支持 5 种 AI 提供商（任选其一）：

| Provider | Key 格式 | 获取方式 |
|----------|----------|----------|
| Claude Setup Token | `sk-ant-oat01-...` | 终端运行 `claude setup-token` |
| Claude API Key | `sk-ant-api03-...` | [Anthropic Console](https://console.anthropic.com/settings/keys) |
| OpenAI API Key | `sk-...` | [OpenAI Platform](https://platform.openai.com/api-keys) |
| Gemini API Key | `AIza...` | [Google AI Studio](https://aistudio.google.com/apikey) |
| DeepSeek API Key | `sk-...` | [DeepSeek Platform](https://platform.deepseek.com/api_keys) |

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/setup` | Web 设置页面 |
| GET | `/config` | 获取配置状态（脱敏） |
| PUT | `/config` | 更新配置 |
| DELETE | `/config/{key}` | 清除单个配置项 |
| POST | `/transcript` | 音频转录（Bcut ASR → Whisper 降级） |
| POST | `/summarize` | AI 字幕总结（多 provider） |
| POST | `/write_feishu` | 写入飞书文档 |

## 架构

```
server/
├── main.py              # FastAPI app，路由挂载，CORS，静态文件
├── config.py            # 配置读写（config.json）
├── setup.py             # 旧版 CLI 交互式配置（已弃用）
├── static/
│   └── setup.html       # Web 设置页面
├── routers/
│   ├── health.py        # /health
│   ├── config_router.py # /config CRUD
│   ├── transcript.py    # /transcript（yt-dlp + Bcut ASR + Whisper）
│   ├── summarize.py     # /summarize（Claude API）
│   └── feishu.py        # /write_feishu（lark-oapi）
└── services/
    ├── bcut_asr.py      # Bcut ASR 客户端
    ├── claude_service.py # Claude API 调用（旧，被 summarize_service 取代）
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
