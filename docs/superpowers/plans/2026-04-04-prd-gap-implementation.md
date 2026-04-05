# BennuNote PRD Gap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the missing PRD features: Python FastAPI backend (port 2185), Feishu document sync, service health detection, and Options settings page.

**Architecture:** Chrome extension keeps existing browser-side subtitle extraction. New Python FastAPI service at `localhost:2185` provides: `/health` endpoint, `/transcript` for yt-dlp + faster-whisper fallback, `/write_feishu` for Lark document integration via `lark-oapi`. Extension gains Options page for configuration and "Sync to Feishu" button in the subtitle panel.

**Tech Stack:** Python 3.9+, FastAPI, uvicorn, yt-dlp, faster-whisper, lark-oapi, Chrome Manifest V3, TypeScript

---

## File Structure

### New files — Python backend (`server/`)

| File | Responsibility |
|------|---------------|
| `server/requirements.txt` | Python dependencies |
| `server/main.py` | FastAPI app, CORS config, route mounting, uvicorn entry |
| `server/routers/health.py` | `GET /health` endpoint |
| `server/routers/transcript.py` | `POST /transcript` — yt-dlp audio download + faster-whisper |
| `server/routers/feishu.py` | `POST /write_feishu` — Lark document write (append/new) |
| `server/services/whisper_service.py` | faster-whisper model loading and transcription |
| `server/services/feishu_service.py` | lark-oapi client: create doc, append to doc |

### New files — Chrome extension

| File | Responsibility |
|------|---------------|
| `src/options/options.html` | Options page HTML |
| `src/options/options.ts` | Options page logic — load/save config to chrome.storage.local |

### Modified files — Chrome extension

| File | Changes |
|------|---------|
| `manifest.json` | Add `options_ui`, add `http://localhost:2185/*` to `host_permissions` |
| `src/shared/types.ts` | Add `BennuNoteConfig` interface |
| `src/shared/messages.ts` | Add `WRITE_FEISHU` and `HEALTH_CHECK` message types |
| `src/content/subtitle-panel.ts` | Add "Sync to Feishu" button, settings gear icon, service status indicator |
| `src/content/subtitle-panel.css` | Styles for new button and status indicator |
| `src/content/index.ts` | Add health check on load, handle Feishu sync button click |
| `src/popup/popup.html` | Add service status indicator |
| `src/popup/popup.ts` | Ping health on popup open, update status display |
| `src/background.ts` | Route `WRITE_FEISHU` messages to backend, handle `HEALTH_CHECK` |
| `vite.config.ts` | Add options page to rollup inputs |

---

## Task 1: Python Backend — Project Skeleton + Health Endpoint

**Files:**
- Create: `server/requirements.txt`
- Create: `server/main.py`
- Create: `server/routers/health.py`

- [ ] **Step 1: Create `server/requirements.txt`**

```
fastapi==0.115.*
uvicorn[standard]==0.34.*
yt-dlp>=2024.12
faster-whisper>=1.1.0
lark-oapi>=1.4.0
```

- [ ] **Step 2: Create `server/routers/health.py`**

```python
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health():
    return {"status": "ok"}
```

- [ ] **Step 3: Create `server/main.py`**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import health, transcript, feishu

app = FastAPI(title="BennuNote Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "chrome-extension://*",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(transcript.router)
app.include_router(feishu.router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=2185)
```

- [ ] **Step 4: Create placeholder routers so import works**

Create `server/routers/__init__.py` (empty file).

Create `server/routers/transcript.py`:
```python
from fastapi import APIRouter

router = APIRouter()
```

Create `server/routers/feishu.py`:
```python
from fastapi import APIRouter

router = APIRouter()
```

Create `server/services/__init__.py` (empty file).

- [ ] **Step 5: Install dependencies and test health endpoint**

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py &
curl http://127.0.0.1:2185/health
# Expected: {"status":"ok"}
kill %1
```

- [ ] **Step 6: Commit**

```bash
git add server/
git commit -m "feat(server): add FastAPI skeleton with /health endpoint"
```

---

## Task 2: Python Backend — `/transcript` Endpoint (yt-dlp + faster-whisper)

**Files:**
- Create: `server/services/whisper_service.py`
- Modify: `server/routers/transcript.py`

- [ ] **Step 1: Create `server/services/whisper_service.py`**

```python
import os
import tempfile
from faster_whisper import WhisperModel

_model: WhisperModel | None = None


def get_model(size: str = "small") -> WhisperModel:
    global _model
    if _model is None:
        _model = WhisperModel(size, device="auto", compute_type="auto")
    return _model


def transcribe_audio(audio_path: str, model_size: str = "small") -> list[dict]:
    """Transcribe an audio file and return list of {from, to, content} dicts."""
    model = get_model(model_size)
    segments, _ = model.transcribe(audio_path, language="zh")
    items = []
    for seg in segments:
        items.append({
            "from": round(seg.start, 2),
            "to": round(seg.end, 2),
            "content": seg.text.strip(),
        })
    return items
```

- [ ] **Step 2: Implement `server/routers/transcript.py`**

```python
import os
import tempfile
import subprocess

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.whisper_service import transcribe_audio

router = APIRouter()


class TranscriptRequest(BaseModel):
    bvid: str
    model_size: str = "small"
    cookie: str = ""


class TranscriptResponse(BaseModel):
    text: str
    source: str  # "cc_subtitle" | "whisper"
    duration: float
    items: list[dict]


@router.post("/transcript", response_model=TranscriptResponse)
async def transcript(req: TranscriptRequest):
    # Use yt-dlp to download audio
    with tempfile.TemporaryDirectory() as tmpdir:
        audio_path = os.path.join(tmpdir, "audio.m4a")
        url = f"https://www.bilibili.com/video/{req.bvid}"

        cmd = [
            "yt-dlp",
            "-f", "ba",  # best audio
            "-o", audio_path,
            "--no-playlist",
        ]
        if req.cookie:
            cookie_file = os.path.join(tmpdir, "cookies.txt")
            with open(cookie_file, "w") as f:
                f.write(req.cookie)
            cmd.extend(["--cookies", cookie_file])
        cmd.append(url)

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"yt-dlp failed: {result.stderr[:500]}")

        if not os.path.exists(audio_path):
            # yt-dlp may add extension automatically
            candidates = [f for f in os.listdir(tmpdir) if f.startswith("audio")]
            if candidates:
                audio_path = os.path.join(tmpdir, candidates[0])
            else:
                raise HTTPException(status_code=500, detail="Audio file not found after download")

        items = transcribe_audio(audio_path, req.model_size)

    full_text = "\n".join(item["content"] for item in items)
    duration = items[-1]["to"] if items else 0.0

    return TranscriptResponse(
        text=full_text,
        source="whisper",
        duration=duration,
        items=items,
    )
```

- [ ] **Step 3: Test the endpoint**

```bash
cd server
source .venv/bin/activate
python main.py &
curl -X POST http://127.0.0.1:2185/transcript \
  -H "Content-Type: application/json" \
  -d '{"bvid": "BV1GJ411x7h7"}'
# Expected: JSON with text, source="whisper", duration, items
kill %1
```

- [ ] **Step 4: Commit**

```bash
git add server/services/whisper_service.py server/routers/transcript.py
git commit -m "feat(server): add /transcript endpoint with yt-dlp + faster-whisper"
```

---

## Task 3: Python Backend — `/write_feishu` Endpoint

**Files:**
- Create: `server/services/feishu_service.py`
- Modify: `server/routers/feishu.py`

- [ ] **Step 1: Create `server/services/feishu_service.py`**

```python
import lark_oapi as lark
from lark_oapi.api.docx.v1 import (
    CreateDocumentRequest,
    CreateDocumentRequestBody,
    CreateDocumentBlockChildrenRequest,
    CreateDocumentBlockChildrenRequestBody,
)
from lark_oapi.api.drive.v1 import (
    CreateFileRequest,
    CreateFileRequestBody,
)
import json


def _build_client(app_id: str, app_secret: str) -> lark.Client:
    return lark.Client.builder().app_id(app_id).app_secret(app_secret).build()


def _text_block(text: str) -> dict:
    """Build a Lark document text block."""
    return {
        "block_type": 2,  # text block
        "text": {
            "elements": [
                {
                    "text_run": {
                        "content": text,
                    }
                }
            ],
            "style": {},
        },
    }


def _heading_block(text: str, level: int = 3) -> dict:
    """Build a Lark document heading block."""
    return {
        "block_type": 4,  # heading block
        "heading": {
            "elements": [
                {
                    "text_run": {
                        "content": text,
                    }
                }
            ],
            "level": level,
        },
    }


def create_document(
    app_id: str,
    app_secret: str,
    title: str,
    content: str,
    folder_token: str = "",
) -> str:
    """Create a new Lark document and return its URL."""
    client = _build_client(app_id, app_secret)

    # Create document
    req = CreateDocumentRequest.builder().request_body(
        CreateDocumentRequestBody.builder()
        .title(title)
        .folder_token(folder_token if folder_token else None)
        .build()
    ).build()

    resp = client.docx.v1.document.create(req)
    if not resp.success():
        raise Exception(f"Create document failed: {resp.code} - {resp.msg}")

    doc_id = resp.data.document.document_id
    _write_content_to_doc(client, doc_id, title, content)

    return f"https://bytedance.larkoffice.com/docx/{doc_id}"


def append_to_document(
    app_id: str,
    app_secret: str,
    doc_token: str,
    title: str,
    content: str,
) -> str:
    """Append content to an existing Lark document and return its URL."""
    client = _build_client(app_id, app_secret)
    _write_content_to_doc(client, doc_token, title, content)
    return f"https://bytedance.larkoffice.com/docx/{doc_token}"


def _write_content_to_doc(
    client: lark.Client,
    document_id: str,
    title: str,
    content: str,
):
    """Write heading + text blocks to a document's first page block."""
    # Split content into chunks of ~400 chars (Lark block text limit)
    max_chunk = 400
    lines = content.split("\n")
    chunks: list[str] = []
    current = ""
    for line in lines:
        if len(current) + len(line) + 1 > max_chunk:
            if current:
                chunks.append(current)
            current = line
        else:
            current = f"{current}\n{line}" if current else line
    if current:
        chunks.append(current)

    # Build blocks: heading + text chunks
    children = [_heading_block(title)]
    for chunk in chunks:
        children.append(_text_block(chunk))

    body = CreateDocumentBlockChildrenRequestBody.builder().children(
        json.dumps(children)
    ).build()

    req = (
        CreateDocumentBlockChildrenRequest.builder()
        .document_id(document_id)
        .block_id(document_id)  # root block = document_id
        .request_body(body)
        .build()
    )

    resp = client.docx.v1.document_block_children.create(req)
    if not resp.success():
        raise Exception(f"Write blocks failed: {resp.code} - {resp.msg}")
```

- [ ] **Step 2: Implement `server/routers/feishu.py`**

```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.feishu_service import create_document, append_to_document

router = APIRouter()


class WriteFeishuRequest(BaseModel):
    text: str
    title: str
    mode: str  # "append" | "new"
    doc_token: str = ""
    folder_token: str = ""
    app_id: str
    app_secret: str


class WriteFeishuResponse(BaseModel):
    doc_url: str


@router.post("/write_feishu", response_model=WriteFeishuResponse)
async def write_feishu(req: WriteFeishuRequest):
    try:
        if req.mode == "append":
            if not req.doc_token:
                raise HTTPException(status_code=400, detail="doc_token required for append mode")
            url = append_to_document(
                app_id=req.app_id,
                app_secret=req.app_secret,
                doc_token=req.doc_token,
                title=req.title,
                content=req.text,
            )
        elif req.mode == "new":
            url = create_document(
                app_id=req.app_id,
                app_secret=req.app_secret,
                title=req.title,
                content=req.text,
                folder_token=req.folder_token,
            )
        else:
            raise HTTPException(status_code=400, detail=f"Invalid mode: {req.mode}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return WriteFeishuResponse(doc_url=url)
```

- [ ] **Step 3: Commit**

```bash
git add server/services/feishu_service.py server/routers/feishu.py
git commit -m "feat(server): add /write_feishu endpoint with lark-oapi"
```

---

## Task 4: Chrome Extension — Config Types + Options Page

**Files:**
- Modify: `src/shared/types.ts` — add `BennuNoteConfig` interface
- Create: `src/options/options.html`
- Create: `src/options/options.ts`
- Modify: `manifest.json` — add `options_ui` and localhost host permission
- Modify: `vite.config.ts` — add options input

- [ ] **Step 1: Add `BennuNoteConfig` to `src/shared/types.ts`**

Append to end of file:

```typescript
export interface BennuNoteConfig {
  feishuMode: 'append' | 'new';
  feishuDocToken: string;
  feishuFolderToken: string;
  feishuAppId: string;
  feishuAppSecret: string;
  bilibiliCookie: string;
  whisperModelSize: 'tiny' | 'base' | 'small' | 'medium' | 'large';
}

export const DEFAULT_CONFIG: BennuNoteConfig = {
  feishuMode: 'new',
  feishuDocToken: '',
  feishuFolderToken: '',
  feishuAppId: '',
  feishuAppSecret: '',
  bilibiliCookie: '',
  whisperModelSize: 'small',
};
```

- [ ] **Step 2: Create `src/options/options.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 480px;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #333;
      background: #f8f9fa;
    }
    h1 { font-size: 20px; margin-bottom: 20px; }
    .section { margin-bottom: 20px; }
    .section h2 {
      font-size: 14px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid #e0e0e0;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 4px;
      color: #555;
    }
    input, select, textarea {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid #d0d0d0;
      border-radius: 6px;
      font-size: 13px;
      margin-bottom: 12px;
      background: #fff;
    }
    textarea { resize: vertical; min-height: 60px; }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: #00a1d6;
      box-shadow: 0 0 0 2px rgba(0,161,214,0.15);
    }
    .btn {
      padding: 10px 24px;
      border: none;
      border-radius: 8px;
      background: #00a1d6;
      color: #fff;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
    }
    .btn:hover { background: #0090c0; }
    .toast {
      display: none;
      padding: 8px 14px;
      background: #4caf50;
      color: #fff;
      border-radius: 6px;
      font-size: 13px;
      margin-top: 12px;
    }
    .conditional { display: none; }
    .conditional.visible { display: block; }
  </style>
</head>
<body>
  <h1>BennuNote Settings</h1>

  <div class="section">
    <h2>Feishu / Lark</h2>
    <label for="feishu-app-id">App ID</label>
    <input type="text" id="feishu-app-id" placeholder="cli_xxxxxxxx">
    <label for="feishu-app-secret">App Secret</label>
    <input type="password" id="feishu-app-secret" placeholder="Your App Secret">
    <label for="feishu-mode">Write Mode</label>
    <select id="feishu-mode">
      <option value="new">New document each time</option>
      <option value="append">Append to fixed document</option>
    </select>
    <div id="append-fields" class="conditional">
      <label for="feishu-doc-token">Fixed Document Token</label>
      <input type="text" id="feishu-doc-token" placeholder="doccnXXXXXX">
    </div>
    <div id="new-fields" class="conditional visible">
      <label for="feishu-folder-token">Target Folder Token (optional)</label>
      <input type="text" id="feishu-folder-token" placeholder="fldcnXXXXXX">
    </div>
  </div>

  <div class="section">
    <h2>Bilibili</h2>
    <label for="bilibili-cookie">Cookie (SESSDATA, optional)</label>
    <textarea id="bilibili-cookie" placeholder="SESSDATA=xxxxx; bili_jct=xxxxx"></textarea>
  </div>

  <div class="section">
    <h2>Whisper Model</h2>
    <label for="whisper-model">Model Size (for backend transcription)</label>
    <select id="whisper-model">
      <option value="tiny">Tiny (fastest, lowest accuracy)</option>
      <option value="base">Base</option>
      <option value="small" selected>Small (default)</option>
      <option value="medium">Medium</option>
      <option value="large">Large (slowest, best accuracy)</option>
    </select>
  </div>

  <button class="btn" id="save-btn">Save</button>
  <div class="toast" id="toast">Settings saved!</div>

  <script type="module" src="options.ts"></script>
</body>
</html>
```

- [ ] **Step 3: Create `src/options/options.ts`**

```typescript
import type { BennuNoteConfig } from '../shared/types';
import { DEFAULT_CONFIG } from '../shared/types';

const ids = {
  appId: 'feishu-app-id',
  appSecret: 'feishu-app-secret',
  mode: 'feishu-mode',
  docToken: 'feishu-doc-token',
  folderToken: 'feishu-folder-token',
  cookie: 'bilibili-cookie',
  whisper: 'whisper-model',
} as const;

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// Toggle conditional fields based on mode
function updateConditional() {
  const mode = el<HTMLSelectElement>(ids.mode).value;
  document.getElementById('append-fields')!.classList.toggle('visible', mode === 'append');
  document.getElementById('new-fields')!.classList.toggle('visible', mode === 'new');
}

// Load saved config
chrome.storage.local.get('bennunote_config', (data) => {
  const config: BennuNoteConfig = { ...DEFAULT_CONFIG, ...data.bennunote_config };
  el<HTMLInputElement>(ids.appId).value = config.feishuAppId;
  el<HTMLInputElement>(ids.appSecret).value = config.feishuAppSecret;
  el<HTMLSelectElement>(ids.mode).value = config.feishuMode;
  el<HTMLInputElement>(ids.docToken).value = config.feishuDocToken;
  el<HTMLInputElement>(ids.folderToken).value = config.feishuFolderToken;
  el<HTMLTextAreaElement>(ids.cookie).value = config.bilibiliCookie;
  el<HTMLSelectElement>(ids.whisper).value = config.whisperModelSize;
  updateConditional();
});

el<HTMLSelectElement>(ids.mode).addEventListener('change', updateConditional);

// Save
el<HTMLButtonElement>('save-btn').addEventListener('click', () => {
  const config: BennuNoteConfig = {
    feishuAppId: el<HTMLInputElement>(ids.appId).value.trim(),
    feishuAppSecret: el<HTMLInputElement>(ids.appSecret).value.trim(),
    feishuMode: el<HTMLSelectElement>(ids.mode).value as 'append' | 'new',
    feishuDocToken: el<HTMLInputElement>(ids.docToken).value.trim(),
    feishuFolderToken: el<HTMLInputElement>(ids.folderToken).value.trim(),
    bilibiliCookie: el<HTMLTextAreaElement>(ids.cookie).value.trim(),
    whisperModelSize: el<HTMLSelectElement>(ids.whisper).value as BennuNoteConfig['whisperModelSize'],
  };
  chrome.storage.local.set({ bennunote_config: config }, () => {
    const toast = document.getElementById('toast')!;
    toast.style.display = 'block';
    setTimeout(() => (toast.style.display = 'none'), 2000);
  });
});
```

- [ ] **Step 4: Update `manifest.json`**

Add `options_ui` field and `http://localhost:2185/*` to `host_permissions`:

```jsonc
// Add to manifest.json:
"options_ui": {
  "page": "src/options/options.html",
  "open_in_tab": true
},
// Add to host_permissions array:
"http://localhost:2185/*"
```

- [ ] **Step 5: Update `vite.config.ts`**

Add options page to rollup inputs:

```typescript
// In build.rollupOptions.input, add:
options: 'src/options/options.html',
```

- [ ] **Step 6: Build and verify Options page loads**

```bash
npm run build
# Load dist/ in chrome://extensions, open extension options page
```

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/options/ manifest.json vite.config.ts
git commit -m "feat: add Options settings page with Feishu/Bilibili/Whisper config"
```

---

## Task 5: Chrome Extension — Service Health Detection

**Files:**
- Modify: `src/popup/popup.html` — add status indicator
- Modify: `src/popup/popup.ts` — ping health on open
- Modify: `src/content/index.ts` — ping health on load
- Modify: `src/content/subtitle-panel.ts` — add status indicator to header

- [ ] **Step 1: Update `src/popup/popup.html`**

Add a status dot before the status text. Replace the existing `<div class="status">` line:

```html
<div class="status" id="status">
  <span id="status-dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ccc;margin-right:6px;vertical-align:middle;"></span>
  <span id="status-text">Checking service...</span>
</div>
```

- [ ] **Step 2: Update `src/popup/popup.ts`**

Replace the entire file:

```typescript
const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;
const btn = document.getElementById('extract-btn') as HTMLButtonElement;

async function checkHealth(): Promise<boolean> {
  try {
    const resp = await fetch('http://localhost:2185/health', { signal: AbortSignal.timeout(2000) });
    const data = await resp.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}

async function init() {
  // Check if on bilibili video page
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tabs[0]?.url || '';
  if (!url.includes('bilibili.com/video/')) {
    statusText.textContent = 'Please navigate to a Bilibili video page';
    btn.disabled = true;
    return;
  }

  // Check backend health
  const healthy = await checkHealth();
  if (healthy) {
    statusDot.style.background = '#4caf50';
    statusText.textContent = 'Service online';
  } else {
    statusDot.style.background = '#f44336';
    statusText.textContent = 'Service offline — please start the backend';
    btn.disabled = true;
  }
}

init();

btn.addEventListener('click', () => {
  btn.disabled = true;
  statusText.textContent = 'Extracting...';
  chrome.runtime.sendMessage({ type: 'EXTRACT_SUBTITLES' });
  setTimeout(() => window.close(), 300);
});
```

- [ ] **Step 3: Add status indicator to `src/content/subtitle-panel.ts`**

In the `buildUI()` method, inside the `.bennu-header` div, after the title/badge span, add a status dot:

```html
<span class="bennu-status-dot" title="Checking service..."></span>
```

Add a public method to update the status:

```typescript
setServiceStatus(online: boolean) {
  const dot = this.shadow.querySelector('.bennu-status-dot') as HTMLElement;
  if (dot) {
    dot.style.background = online ? '#4caf50' : '#f44336';
    dot.title = online ? 'Backend online' : 'Backend offline';
  }
}
```

- [ ] **Step 4: Add status dot styles to `src/content/subtitle-panel.css`**

```css
.bennu-status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #888;
  margin-left: 8px;
  vertical-align: middle;
}
```

- [ ] **Step 5: Ping health in `src/content/index.ts`**

Add at the top of the `handleExtract()` function, before the extraction steps:

```typescript
// Check backend health
try {
  const resp = await fetch('http://localhost:2185/health', { signal: AbortSignal.timeout(2000) });
  const data = await resp.json();
  p.setServiceStatus(data.status === 'ok');
  if (data.status === 'ok') p.log('Backend service: online', 'success');
  else p.log('Backend service: offline', 'warn');
} catch {
  p.setServiceStatus(false);
  p.log('Backend service: offline (will use browser-only mode)', 'warn');
}
```

- [ ] **Step 6: Build and verify**

```bash
npm run build
# Open popup on bilibili video page — should show red dot + "Service offline"
# Start python backend → refresh popup → green dot + "Service online"
```

- [ ] **Step 7: Commit**

```bash
git add src/popup/ src/content/subtitle-panel.ts src/content/subtitle-panel.css src/content/index.ts
git commit -m "feat: add service health detection in popup and panel"
```

---

## Task 6: Chrome Extension — "Sync to Feishu" Button + Backend Integration

**Files:**
- Modify: `src/shared/messages.ts` — add message types
- Modify: `src/background.ts` — route Feishu write to backend
- Modify: `src/content/subtitle-panel.ts` — add Feishu button + settings gear
- Modify: `src/content/subtitle-panel.css` — styles
- Modify: `src/content/index.ts` — handle Feishu sync

- [ ] **Step 1: Add message types to `src/shared/messages.ts`**

Add before the `export type Message` union:

```typescript
// Content Script → Background: write subtitles to Feishu
export interface WriteFeishuRequest {
  type: 'WRITE_FEISHU';
  text: string;
  title: string;
}

// Background → Content Script: Feishu write result
export interface WriteFeishuResult {
  type: 'WRITE_FEISHU_RESULT';
  success: boolean;
  docUrl?: string;
  error?: string;
}
```

Update the `Message` union to include the new types:

```typescript
export type Message =
  | ExtractRequest
  | SubtitleApiResult
  | TranscribeRequest
  | TranscribeProgress
  | TranscribeResult
  | AudioUrlRequest
  | AudioUrlResponse
  | PreloadModelRequest
  | PreloadModelResult
  | SaveLogRequest
  | TranscribeAudioData
  | WriteFeishuRequest
  | WriteFeishuResult;
```

- [ ] **Step 2: Add Feishu routing to `src/background.ts`**

Add a new message handler block before the `return false;` at the end of the `onMessage` listener:

```typescript
// Content script → Backend: write to Feishu
if (msg.type === 'WRITE_FEISHU') {
  const tabId = sender.tab?.id || activeTabId;

  (async () => {
    try {
      const configData = await chrome.storage.local.get('bennunote_config');
      const config = configData.bennunote_config || {};

      const resp = await fetch('http://localhost:2185/write_feishu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: msg.text,
          title: msg.title,
          mode: config.feishuMode || 'new',
          doc_token: config.feishuDocToken || '',
          folder_token: config.feishuFolderToken || '',
          app_id: config.feishuAppId || '',
          app_secret: config.feishuAppSecret || '',
        }),
      });

      const data = await resp.json();
      if (resp.ok && data.doc_url) {
        if (tabId) {
          chrome.tabs.sendMessage(tabId, {
            type: 'WRITE_FEISHU_RESULT',
            success: true,
            docUrl: data.doc_url,
          } as Message);
        }
      } else {
        const detail = data.detail || 'Unknown error';
        if (tabId) {
          chrome.tabs.sendMessage(tabId, {
            type: 'WRITE_FEISHU_RESULT',
            success: false,
            error: detail,
          } as Message);
        }
      }
    } catch (err) {
      if (tabId) {
        chrome.tabs.sendMessage(tabId, {
          type: 'WRITE_FEISHU_RESULT',
          success: false,
          error: `${err}`,
        } as Message);
      }
    }
  })();

  sendResponse({ ok: true });
  return false;
}
```

- [ ] **Step 3: Add "Sync to Feishu" button and settings gear to `src/content/subtitle-panel.ts`**

In the `buildUI()` method, add to `.bennu-footer` innerHTML:

```html
<button class="bennu-btn bennu-feishu-btn" data-action="sync-feishu">Sync to Feishu</button>
```

Add to `.bennu-header-actions`:

```html
<button class="bennu-btn" data-action="settings" title="Settings">&#x2699;</button>
```

Add a link container after footer for doc URL:

```html
<div class="bennu-feishu-link" style="display:none">
  <a class="bennu-feishu-url" href="#" target="_blank">Open in Feishu →</a>
</div>
```

Store references:

```typescript
private feishuBtn!: HTMLElement;
private feishuLink!: HTMLElement;
private feishuUrl!: HTMLAnchorElement;
```

In the event delegation, handle new actions:

```typescript
else if (action === 'sync-feishu') this.onSyncFeishu?.();
else if (action === 'settings') chrome.runtime.openOptionsPage();
```

Add callback and public methods:

```typescript
private onSyncFeishu: (() => void) | null = null;

setSyncHandler(handler: () => void) {
  this.onSyncFeishu = handler;
}

showFeishuLink(url: string) {
  this.feishuUrl.href = url;
  this.feishuUrl.textContent = 'Open in Feishu →';
  this.feishuLink.style.display = '';
}

setFeishuSyncing(syncing: boolean) {
  const btn = this.shadow.querySelector('.bennu-feishu-btn') as HTMLElement;
  if (btn) {
    btn.textContent = syncing ? 'Syncing...' : 'Sync to Feishu';
    (btn as HTMLButtonElement).disabled = syncing;
  }
}
```

- [ ] **Step 4: Add styles to `src/content/subtitle-panel.css`**

```css
.bennu-feishu-btn {
  background: #3370ff;
}
.bennu-feishu-btn:hover {
  background: #2860e0;
}
.bennu-feishu-btn:disabled {
  background: #999;
  cursor: not-allowed;
}
.bennu-feishu-link {
  padding: 8px 16px;
  background: #1a2a1a;
  border-top: 1px solid #333;
}
.bennu-feishu-url {
  color: #3370ff;
  font-size: 13px;
  text-decoration: none;
}
.bennu-feishu-url:hover {
  text-decoration: underline;
}
```

- [ ] **Step 5: Wire up Feishu sync in `src/content/index.ts`**

After the panel is created (in `getPanel()`), add the sync handler and message listener:

```typescript
// In getPanel(), after creating the panel:
panel.setSyncHandler(() => {
  if (currentVideoInfo && panel) {
    panel.setFeishuSyncing(true);
    panel.log('Syncing subtitles to Feishu...', 'step');
    const text = currentItems.map(i => i.content).join('\n');
    const title = `${currentVideoInfo.title} - ${new Date().toLocaleDateString('zh-CN')}`;
    chrome.runtime.sendMessage({ type: 'WRITE_FEISHU', text, title });
  }
});

// In the onMessage listener, add handler for WRITE_FEISHU_RESULT:
if (msg.type === 'WRITE_FEISHU_RESULT') {
  const p = getPanel();
  p.setFeishuSyncing(false);
  if (msg.success && msg.docUrl) {
    p.log(`Feishu sync successful!`, 'success');
    p.showFeishuLink(msg.docUrl);
  } else {
    p.log(`Feishu sync failed: ${msg.error}`, 'error');
  }
}
```

Store current video info and items as module-level variables:

```typescript
let currentVideoInfo: { bvid: string; cid: number; title: string } | null = null;
let currentItems: SubtitleItem[] = [];
```

Update these when subtitles are loaded (in `handleExtract()` and the `TRANSCRIBE_RESULT` handler).

- [ ] **Step 6: Build and test end-to-end**

```bash
npm run build
# 1. Start backend: cd server && python main.py
# 2. Load extension, go to bilibili video page
# 3. Extract subtitles
# 4. Click "Sync to Feishu" — should call backend /write_feishu
# 5. If Feishu credentials are set correctly, should show doc link
```

- [ ] **Step 7: Commit**

```bash
git add src/shared/messages.ts src/background.ts src/content/ src/popup/
git commit -m "feat: add Feishu sync button and backend integration"
```

---

## Verification

1. **Backend health**: `curl http://127.0.0.1:2185/health` → `{"status":"ok"}`
2. **Backend transcript**: `curl -X POST http://127.0.0.1:2185/transcript -H 'Content-Type: application/json' -d '{"bvid":"BV1GJ411x7h7"}'` → JSON with Whisper result
3. **Extension popup**: Shows green/red service status dot
4. **Options page**: Right-click extension → Options → all fields load/save correctly
5. **Subtitle extraction**: Works as before (browser-side)
6. **Feishu sync**: After extracting subtitles, "Sync to Feishu" button appears in footer, clicking it sends content to backend and shows doc URL on success
7. **Panel status**: Status dot in panel header reflects backend connectivity
