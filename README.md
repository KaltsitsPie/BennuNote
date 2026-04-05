# BennuNote

A Chrome extension that extracts subtitles and transcribes speech from Bilibili videos, with AI summarization and Feishu document sync.

## Features

- **API Subtitle Extraction** — Fetches existing AI-generated or CC subtitles from Bilibili's internal API (instant)
- **Backend Transcription** — Falls back to Bcut ASR or local Whisper via Python backend when no subtitles are available
- **AI Summarization** — Generates structured summaries using Claude, OpenAI, Gemini, or DeepSeek (5 providers supported)
- **Feishu Sync** — Creates or appends subtitle content to Feishu/Lark documents
- **Offline Capable** — AI summarization and Feishu sync work even without the Python backend (direct API calls from extension)
- **Subtitle Panel** — Timestamped transcript with click-to-seek, copy-to-clipboard, and download (TXT/SRT)
- **Settings Panel** — Configure all credentials and preferences directly in the panel's Settings tab

## How It Works

```
Popup (trigger)
  → Background Service Worker
    ├→ Content Script (bilibili.com)
    │   ├ Extract bvid/cid (page injection + API fallback)
    │   ├ Fetch subtitles from Bilibili API
    │   └ Render subtitle panel (Shadow DOM)
    ├→ Python Backend (optional, localhost:2185)
    │   ├ Bcut ASR / Whisper transcription
    │   ├ AI summarization (server path)
    │   └ Feishu doc sync (server path)
    └→ Direct API calls (fallback when backend offline)
        ├ AI summarization via provider APIs
        └ Feishu doc sync via Feishu REST API
```

## Install

### From Source

```bash
cd BennuNote
npm install
npm run build
```

Then load the extension in Chrome:

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `dist/` directory

### Backend (optional, for transcription)

```bash
./start-server.sh
```

The backend is required only for audio transcription (Bcut ASR / Whisper). AI summarization and Feishu sync work without it.

### Configuration

1. Navigate to any Bilibili video page
2. Click the BennuNote extension icon → **Extract Subtitles**
3. In the floating panel, click the **Settings** tab (gear icon)
4. Configure:
   - **Feishu**: App ID + App Secret (from [Feishu Open Platform](https://open.feishu.cn/app))
   - **AI Provider**: Pick one of Claude Setup Token / Claude API / OpenAI / Gemini / DeepSeek and enter the API key
   - Select your preferred model for the chosen provider

## Supported AI Providers

| Provider | Default Model | Get API Key |
|----------|--------------|-------------|
| Claude (Setup Token) | Haiku 4.5 | Terminal: `claude setup-token` |
| Claude (API Key) | Haiku 4.5 | [Anthropic Console](https://console.anthropic.com/settings/keys) |
| OpenAI | GPT-4o mini | [OpenAI Platform](https://platform.openai.com/api-keys) |
| Gemini | Gemini 2.5 Flash | [Google AI Studio](https://aistudio.google.com/apikey) |
| DeepSeek | DeepSeek Chat V3 | [DeepSeek Platform](https://platform.deepseek.com/api_keys) |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Extension framework | Chrome Manifest V3 + [CRXJS](https://crxjs.dev/) |
| Build tool | Vite + TypeScript |
| Backend | Python + FastAPI |
| Transcription | Bcut ASR + [faster-whisper](https://github.com/SYSTRAN/faster-whisper) |
| AI Summary | Anthropic / OpenAI / Google GenAI / DeepSeek APIs |
| Feishu | [lark-oapi](https://github.com/larksuite/oapi-sdk-python) (server) + REST API (extension fallback) |
| UI | Shadow DOM (isolated from page styles) |

## Project Structure

```
src/
├── background.ts          # Service worker: message routing, server-or-direct fallback
├── background/
│   ├── feishu-direct.ts   # Direct Feishu REST API (offline fallback)
│   └── summarize-direct.ts # Direct AI API calls (offline fallback)
├── content/
│   ├── index.ts           # Content script entry point
│   ├── bilibili-api.ts    # Bilibili API calls (subtitles, audio, video info)
│   ├── subtitle-panel.ts  # Floating panel UI (Log/Subtitles/Summary/Settings)
│   └── subtitle-panel.css
├── popup/
│   ├── popup.html
│   └── popup.ts           # Extension popup UI
└── shared/
    ├── types.ts            # Shared type definitions
    └── messages.ts         # Message types for cross-context communication

server/                     # Optional Python backend
├── main.py                # FastAPI app
├── routers/               # API endpoint handlers
└── services/              # Business logic (transcription, AI, Feishu)
```

## License

MIT
