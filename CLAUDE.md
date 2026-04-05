# BennuNote

Chrome extension (Manifest V3) that extracts subtitles from Bilibili videos.

## Build & Dev

```bash
npm install
npm run build        # tsc && vite build → dist/
npm run dev          # vite dev server (HMR for popup/offscreen, not content script)
```

Load `dist/` as unpacked extension in `chrome://extensions/` (Developer mode).

After code changes, rebuild and click the refresh icon on the extension card.
Content script changes require reloading the Bilibili tab as well.

## Architecture

```
Popup (src/popup/)           → trigger button, language select, sends EXTRACT_SUBTITLES
  ↓
Background (src/background.ts) → message router, server-or-direct fallback (AI only)
  ├→ Content Script (src/content/) → runs on bilibili.com/video/*
  │   ├ bilibili-api.ts  → video info extraction, subtitle/audio API calls
  │   ├ subtitle-panel.ts → Shadow DOM floating panel (Log + Subtitles + Summary + Settings)
  │   └ index.ts          → orchestrates extraction flow
  └→ Python Backend (server/) → localhost:2185
      ├ /transcript      → Bcut ASR → Whisper fallback
      ├ /summarize       → AI summary (credentials passed in request)
      └ /feishu/*        → Feishu Wiki ops via lark-cli (auth managed by lark-cli)
```

Messages flow between contexts via `chrome.runtime.sendMessage`. Types are defined in `src/shared/messages.ts`.

### Server-or-Direct Fallback

For AI summarization, the background script tries the Python server first. If offline, it falls back to direct API calls:
- `src/background/summarize-direct.ts` — Direct AI API calls (Claude/OpenAI/Gemini/DeepSeek)

Feishu operations are server-only (no offline fallback). Auth is managed by lark-cli (`~/.lark-cli/config.json`), configured via `./start-server.sh`.

AI credentials are stored in `chrome.storage.local` and passed to the server in the request body.

## Key Modules

### `src/content/bilibili-api.ts`
- `extractVideoInfo()` — async, tries page script injection for `__INITIAL_STATE__`, falls back to Bilibili's `/x/web-interface/view` API
- `fetchSubtitles(bvid, cid, preferredLang)` — returns `{ result, tracks, debug }`. `tracks` is all available subtitle languages; `result` is the auto-selected one
- `pickTrack(tracks, lang)` — priority: `ai-{lang}` > `{lang}` > prefix match > `ai-zh` > `zh` > first
- `loadTrack(track)` — fetches subtitle JSON for a specific track
- `fetchAudioUrl(bvid, cid)` — gets DASH audio stream URL for Whisper fallback
- `setLogFn(fn)` — allows content/index.ts to wire panel logging into API calls

### `src/content/subtitle-panel.ts`
- `SubtitlePanel` class — Shadow DOM panel with four tabs: **Log**, **Subtitles**, **Summary**, **Settings**
- Settings tab: configure AI provider/key/model, Bilibili cookie, Whisper model; shows Feishu auth status
- All config stored in `chrome.storage.local` (key: `bennunote_config`)
- Log entries are accumulated in `logLines[]` array
- Language dropdown appears when multiple subtitle tracks exist; switching triggers `loadTrack()`
- Save button (header) downloads full log as timestamped `.txt` file

### `src/background.ts`
- Routes messages between popup, content script, and backend server
- Tracks `activeTabId` to route results back to the correct tab
- WRITE_FEISHU: forwards to server (no offline fallback)
- SUMMARIZE: try server → catch network error → direct API fallback

### `src/background/summarize-direct.ts`
- Direct AI API calls for offline fallback
- Supports 5 providers: Claude Setup Token, Claude API, OpenAI, Gemini, DeepSeek
- Same system prompt and default models as `server/services/summarize_service.py`

## Configuration

All configuration is stored in `chrome.storage.local` under key `bennunote_config`. No server-side config storage.

| Category | Fields | Purpose |
|----------|--------|---------|
| Feishu Wiki | `feishuWikiRootNodeToken` | Feishu Wiki sync target (auth via lark-cli) |
| AI Provider | `aiProvider`, plus key/model for each provider | AI summarization |
| Other | `bilibiliCookie`, `whisperModelSize` | Transcription |

Supported AI providers (pick one via `aiProvider`):

| Provider | Key Field | Model Field | Default Model |
|----------|-----------|-------------|---------------|
| `claude_setup_token` | `claudeSetupToken` | `claudeModel` | `claude-haiku-4-5-20251001` |
| `claude_api` | `claudeApiKey` | `claudeApiModel` | `claude-haiku-4-5-20251001` |
| `openai` | `openaiApiKey` | `openaiModel` | `gpt-5.4` |
| `gemini` | `geminiApiKey` | `geminiModel` | `gemini-2.5-flash` |
| `deepseek` | `deepseekApiKey` | `deepseekModel` | `deepseek-chat` |

## Permissions

- `activeTab` — access current tab for content script messaging
- `storage` — persist config and logs to `chrome.storage.local`
- `downloads` — save log files
- `host_permissions`: `*.bilibili.com/*`, `*.hdslb.com/*`, `localhost:2185/*`, plus AI API domains for direct fallback

## Workflow

- Do NOT `git add` or `git commit` after writing code. Leave changes in the working tree for human review before committing.

## Documentation

- `SERVER.md` — 后端服务器文档：启动方式、API 端点、架构说明。
- `Transcript.md` — 中文用户使用说明，覆盖字幕提取流程、常见问题。面向终端用户。

## Conventions

- TypeScript strict mode, no `any` except for the transformers.js pipeline instance
- CSS uses `bennu-` prefix for all class names (inside Shadow DOM)
- All cross-context message types are defined in `src/shared/messages.ts`
- Debug info objects (`FetchSubtitlesDebug`, `FetchAudioDebug`) accompany API results for logging
