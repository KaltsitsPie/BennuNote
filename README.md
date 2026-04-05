# BennuNote

A Chrome extension that extracts subtitles and transcribes speech from Bilibili videos.

## Features

- **API Subtitle Extraction** — Fetches existing AI-generated or CC subtitles from Bilibili's internal API (instant)
- **Local Whisper Transcription** — Falls back to in-browser speech-to-text using [transformers.js](https://github.com/huggingface/transformers.js) + Whisper when no subtitles are available
- **Log Panel** — Real-time debug log showing each step, API responses, and errors
- **Subtitle Panel** — Timestamped transcript with click-to-seek, copy-to-clipboard, and download (TXT/SRT)
- **Model Preloading** — Whisper model is automatically preloaded on install/startup and cached in browser storage

## How It Works

```
Popup (trigger)
  → Background Service Worker
    ├→ Content Script (bilibili.com)
    │   ├ Extract bvid/cid (page injection + API fallback)
    │   ├ Fetch subtitles from Bilibili API
    │   └ Render subtitle panel (Shadow DOM)
    └→ Offscreen Document
        └ Whisper transcription via WASM (no server needed)
```

1. Extracts the video ID (`bvid`) and chapter ID (`cid`) from the current Bilibili page
2. Calls Bilibili's player API to fetch existing AI/CC subtitles
3. If no subtitles exist, downloads the audio stream and transcribes it locally using Whisper (runs entirely in the browser via WebAssembly)

## Install

### From Source

```bash
# Clone and install dependencies
cd BennuNote
npm install

# Build
npm run build
```

Then load the extension in Chrome:

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `dist/` directory

### Usage

1. Navigate to any Bilibili video page (`bilibili.com/video/...`)
2. Click the BennuNote extension icon
3. Click **Extract Subtitles**
4. View results in the floating panel on the right side of the page

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Extension framework | Chrome Manifest V3 + [CRXJS](https://crxjs.dev/) |
| Build tool | Vite + TypeScript |
| Speech-to-text | [transformers.js](https://github.com/huggingface/transformers.js) (Xenova/whisper-small, ONNX + WASM) |
| UI | Shadow DOM (isolated from page styles) |

## Project Structure

```
src/
├── background.ts          # Service worker: message routing, model preloading
├── content/
│   ├── index.ts           # Content script entry point
│   ├── bilibili-api.ts    # Bilibili API calls (subtitles, audio, video info)
│   ├── subtitle-panel.ts  # Floating panel UI with Log/Subtitles tabs
│   └── subtitle-panel.css
├── offscreen/
│   ├── offscreen.html
│   └── offscreen.ts       # Whisper transcription in offscreen document
├── popup/
│   ├── popup.html
│   └── popup.ts           # Extension popup UI
└── shared/
    ├── types.ts            # Shared type definitions
    └── messages.ts         # Message types for cross-context communication
```

## Notes

- The Whisper model (~150MB) is downloaded once and cached in the browser's Cache Storage
- Subsequent loads read from cache (a few seconds, no network required)
- Transcription speed depends on your hardware — a 10-minute video may take a few minutes on CPU
- You must be logged in to Bilibili for some videos' subtitle API to return results

## License

MIT
