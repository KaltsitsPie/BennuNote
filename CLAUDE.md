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
Popup (src/popup/)           → trigger button, sends EXTRACT_SUBTITLES
  ↓
Background (src/background.ts) → message router between contexts
  ├→ Content Script (src/content/) → runs on bilibili.com/video/*
  │   ├ bilibili-api.ts  → video info extraction, subtitle/audio API calls
  │   ├ subtitle-panel.ts → Shadow DOM floating panel (Log + Subtitles tabs)
  │   └ index.ts          → orchestrates extraction flow
  └→ Offscreen Document (src/offscreen/) → Whisper transcription via transformers.js
```

Messages flow between contexts via `chrome.runtime.sendMessage`. Types are defined in `src/shared/messages.ts`.

## Key Modules

### `src/content/bilibili-api.ts`
- `extractVideoInfo()` — async, tries page script injection for `__INITIAL_STATE__`, falls back to Bilibili's `/x/web-interface/view` API
- `fetchSubtitles(bvid, cid, preferredLang)` — returns `{ result, tracks, debug }`. `tracks` is all available subtitle languages; `result` is the auto-selected one
- `pickTrack(tracks, lang)` — priority: `ai-{lang}` > `{lang}` > prefix match > `ai-zh` > `zh` > first
- `loadTrack(track)` — fetches subtitle JSON for a specific track
- `fetchAudioUrl(bvid, cid)` — gets DASH audio stream URL for Whisper fallback
- `setLogFn(fn)` — allows content/index.ts to wire panel logging into API calls

### `src/content/subtitle-panel.ts`
- `SubtitlePanel` class — Shadow DOM panel with two tabs: **Log** and **Subtitles**
- Log entries are accumulated in `logLines[]` array and persisted to `chrome.storage.local` (key: `bennunote_log`)
- Progress logs (model loading, transcription) are throttled to 10% milestones only
- Language dropdown appears when multiple subtitle tracks exist; switching triggers `loadTrack()`
- Save button (header) downloads full log as timestamped `.txt` file

### `src/offscreen/offscreen.ts`
- Uses `@huggingface/transformers` with `Xenova/whisper-small` model
- Runs in Offscreen Document (required for WASM in MV3)
- `isModelCached()` checks Cache Storage before loading to show appropriate status message
- Handles `PRELOAD_MODEL` message for background preloading on install/startup
- Singleton pattern for the transcriber pipeline

### `src/background.ts`
- Routes messages between popup, content script, and offscreen document
- Tracks `activeTabId` to route Whisper results back to the correct tab
- Triggers model preload on `chrome.runtime.onInstalled` and `chrome.runtime.onStartup`

## Log System

Every operation logs to the panel with level (step/info/success/warn/error) and timestamp.
Logs are:
- Displayed in the dark-themed Log tab
- Accumulated in memory (`logLines[]`)
- Persisted to `chrome.storage.local` on each write
- Downloadable via the save button in the panel header

When debugging issues, ask the user to save and share the log file.

## Permissions

- `activeTab` — access current tab for content script messaging
- `offscreen` — create offscreen document for Whisper WASM
- `storage` — persist logs to `chrome.storage.local`
- `host_permissions`: `*.bilibili.com/*`, `*.hdslb.com/*` — API calls and audio/subtitle fetching

## Workflow

- Do NOT `git add` or `git commit` after writing code. Leave changes in the working tree for human review before committing.

## Documentation

- `Transcript.md` — 中文用户使用说明，覆盖安装配置、字幕提取流程、飞书同步、常见问题。面向终端用户。

## Conventions

- TypeScript strict mode, no `any` except for the transformers.js pipeline instance
- CSS uses `bennu-` prefix for all class names (inside Shadow DOM)
- All cross-context message types are defined in `src/shared/messages.ts`
- Debug info objects (`FetchSubtitlesDebug`, `FetchAudioDebug`) accompany API results for logging
