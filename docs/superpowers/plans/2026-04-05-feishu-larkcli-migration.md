# Feishu lark-cli Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hand-rolled Feishu REST API code with lark-cli subprocess calls, consolidate all Feishu logic to the Python server, remove extension-side Feishu fallback.

**Architecture:** Server calls `lark-cli` via `subprocess.run()`, returning parsed JSON. Extension sends markdown content to server endpoints. `start-server.sh` handles first-time lark-cli setup automatically.

**Tech Stack:** Python/FastAPI, lark-cli (npm), TypeScript/Chrome Extension MV3

---

### Task 1: Server — lark-cli runner utility

**Files:**
- Create: `server/services/larkcli.py`

- [ ] **Step 1: Create the lark-cli subprocess wrapper**

```python
# server/services/larkcli.py
import subprocess
import json
import logging
import shutil

logger = logging.getLogger(__name__)


class LarkCliError(Exception):
    """Raised when a lark-cli command fails."""
    def __init__(self, message: str, returncode: int = 1):
        super().__init__(message)
        self.returncode = returncode


def is_installed() -> bool:
    """Check if lark-cli is available on PATH."""
    return shutil.which("lark-cli") is not None


def run(*args: str, timeout: int = 60) -> dict:
    """Run a lark-cli command and return parsed JSON output.

    Args:
        *args: Command arguments, e.g. ("docs", "+create", "--title", "Hello")
        timeout: Timeout in seconds (default 60, increase for media ops)

    Returns:
        Parsed JSON dict from lark-cli stdout.

    Raises:
        LarkCliError: If the command fails or returns non-zero exit code.
    """
    cmd = ["lark-cli", *args]
    logger.info("lark-cli %s", " ".join(args))

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise LarkCliError(f"lark-cli timed out after {timeout}s")
    except FileNotFoundError:
        raise LarkCliError("lark-cli not found. Run ./start-server.sh for setup.")

    if result.returncode != 0:
        err = result.stderr.strip() or result.stdout.strip() or "Unknown error"
        logger.error("lark-cli failed (rc=%d): %s", result.returncode, err)
        raise LarkCliError(err, result.returncode)

    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        # Some commands return non-JSON output
        return {"raw": result.stdout.strip()}


def get_auth_status() -> dict:
    """Get lark-cli authentication status."""
    return run("auth", "status")
```

- [ ] **Step 2: Verify it works manually**

Run: `cd server && python3 -c "from services.larkcli import get_auth_status; print(get_auth_status())"`
Expected: Dict with `tokenStatus: "valid"`, `userName`, etc.

- [ ] **Step 3: Commit**

```bash
git add server/services/larkcli.py
git commit -m "feat(server): add lark-cli subprocess wrapper"
```

---

### Task 2: Server — Feishu service rewrite

**Files:**
- Rewrite: `server/services/feishu_service.py`

- [ ] **Step 1: Replace feishu_service.py with lark-cli based implementation**

```python
# server/services/feishu_service.py
"""Feishu service — all operations via lark-cli subprocess."""
import json
import tempfile
import os

from services.larkcli import run, get_auth_status, LarkCliError


def auth_status() -> dict:
    """Check lark-cli auth status."""
    return get_auth_status()


def list_wiki_spaces() -> dict:
    """List all wiki knowledge spaces."""
    return run("wiki", "spaces", "list")


def list_wiki_nodes(space_id: str, parent_node_token: str = "") -> dict:
    """List child nodes within a wiki space."""
    params: dict = {"space_id": space_id}
    if parent_node_token:
        params["parent_node_token"] = parent_node_token
    return run("wiki", "nodes", "list", "--params", json.dumps(params))


def create_doc(
    markdown: str,
    title: str = "",
    wiki_node: str = "",
    folder_token: str = "",
) -> dict:
    """Create a new document with markdown content.

    Args:
        markdown: Document content in Markdown format.
        title: Document title.
        wiki_node: Wiki node token to create under (preferred).
        folder_token: Folder token (alternative to wiki_node).
    """
    args = ["docs", "+create", "--markdown", markdown]
    if title:
        args += ["--title", title]
    if wiki_node:
        args += ["--wiki-node", wiki_node]
    elif folder_token:
        args += ["--folder-token", folder_token]
    return run(*args)


def fetch_doc(doc: str) -> dict:
    """Fetch document content as markdown.

    Args:
        doc: Document URL, token, or wiki URL.
    """
    return run("docs", "+fetch", "--doc", doc)


def update_doc(
    doc: str,
    mode: str,
    markdown: str = "",
    selection_by_title: str = "",
    selection_with_ellipsis: str = "",
    new_title: str = "",
) -> dict:
    """Update a document.

    Args:
        doc: Document ID or URL.
        mode: One of: append, replace_range, replace_all, insert_before,
              insert_after, delete_range, overwrite.
        markdown: New content in Markdown.
        selection_by_title: Title-based location matcher (e.g. "## Section Name").
        selection_with_ellipsis: Content-based location matcher ("start...end").
        new_title: Update document title simultaneously.
    """
    args = ["docs", "+update", "--doc", doc, "--mode", mode]
    if markdown:
        args += ["--markdown", markdown]
    if selection_by_title:
        args += ["--selection-by-title", selection_by_title]
    if selection_with_ellipsis:
        args += ["--selection-with-ellipsis", selection_with_ellipsis]
    if new_title:
        args += ["--new-title", new_title]
    return run(*args)


def search_docs(query: str, page_size: int = 15, page_token: str = "") -> dict:
    """Search documents across cloud space and wiki."""
    args = ["docs", "+search", "--query", query]
    if page_size != 15:
        args += ["--page-size", str(page_size)]
    if page_token:
        args += ["--page-token", page_token]
    return run(*args)


def insert_media(
    doc: str,
    file_path: str,
    file_type: str = "image",
    align: str = "center",
    caption: str = "",
) -> dict:
    """Insert image or file into a document.

    Args:
        doc: Document ID or URL.
        file_path: Local file path (max 20MB).
        file_type: "image" or "file".
        align: Image alignment: left, center, right.
        caption: Image description.
    """
    args = ["docs", "+media-insert", "--doc", doc, "--file", file_path, "--type", file_type]
    if align != "center":
        args += ["--align", align]
    if caption:
        args += ["--caption", caption]
    return run(*args, timeout=120)


def update_whiteboard(whiteboard_token: str, dsl_content: str, overwrite: bool = False) -> dict:
    """Update a whiteboard.

    Args:
        whiteboard_token: Whiteboard token.
        dsl_content: DSL content for the whiteboard (piped via stdin in CLI,
                     but we write to a temp file and pipe).
        overwrite: Delete existing content before updating.
    """
    args = ["docs", "+whiteboard-update", "--whiteboard-token", whiteboard_token]
    if overwrite:
        args += ["--overwrite"]
    # whiteboard-update reads DSL from stdin — use subprocess directly
    import subprocess as sp
    cmd = ["lark-cli", *args]
    result = sp.run(cmd, input=dsl_content, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        raise LarkCliError(result.stderr.strip() or "Whiteboard update failed")
    import json as _json
    try:
        return _json.loads(result.stdout)
    except Exception:
        return {"raw": result.stdout.strip()}
```

- [ ] **Step 2: Quick smoke test**

Run: `cd server && python3 -c "from services.feishu_service import list_wiki_spaces; print(list_wiki_spaces())"`
Expected: JSON with BennuNote and CSCI wiki spaces.

- [ ] **Step 3: Commit**

```bash
git add server/services/feishu_service.py
git commit -m "refactor(server): rewrite feishu_service to use lark-cli"
```

---

### Task 3: Server — Feishu router rewrite

**Files:**
- Rewrite: `server/routers/feishu.py`

- [ ] **Step 1: Replace feishu router with new endpoints**

```python
# server/routers/feishu.py
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional
import tempfile
import os

from services.feishu_service import (
    auth_status,
    list_wiki_spaces,
    list_wiki_nodes,
    create_doc,
    fetch_doc,
    update_doc,
    search_docs,
    insert_media,
    update_whiteboard,
)
from services.larkcli import LarkCliError

router = APIRouter(prefix="/feishu", tags=["feishu"])


def _handle_error(e: LarkCliError):
    raise HTTPException(status_code=500, detail=str(e))


# --- Auth ---

@router.get("/auth/status")
def get_auth_status():
    try:
        return auth_status()
    except LarkCliError as e:
        _handle_error(e)


# --- Wiki ---

@router.get("/wiki/spaces")
def get_wiki_spaces():
    try:
        return list_wiki_spaces()
    except LarkCliError as e:
        _handle_error(e)


class CreateWikiSpaceRequest(BaseModel):
    name: str
    description: str = ""


@router.post("/wiki/spaces/create")
def create_wiki_space(req: CreateWikiSpaceRequest):
    """Create a new wiki space. Uses lark-cli raw API if no direct command."""
    try:
        from services.larkcli import run
        return run(
            "api", "POST", "/open-apis/wiki/v2/spaces",
            "--body", f'{{"name": "{req.name}", "description": "{req.description}"}}'
        )
    except LarkCliError as e:
        _handle_error(e)


@router.get("/wiki/nodes")
def get_wiki_nodes(space_id: str, parent_node_token: str = ""):
    try:
        return list_wiki_nodes(space_id, parent_node_token)
    except LarkCliError as e:
        _handle_error(e)


# --- Documents ---

class CreateDocRequest(BaseModel):
    markdown: str
    title: str = ""
    wiki_node: str = ""
    folder_token: str = ""


@router.post("/docs/create")
def post_create_doc(req: CreateDocRequest):
    try:
        return create_doc(
            markdown=req.markdown,
            title=req.title,
            wiki_node=req.wiki_node,
            folder_token=req.folder_token,
        )
    except LarkCliError as e:
        _handle_error(e)


@router.get("/docs/fetch")
def get_fetch_doc(doc: str):
    try:
        return fetch_doc(doc)
    except LarkCliError as e:
        _handle_error(e)


class UpdateDocRequest(BaseModel):
    doc: str
    mode: str
    markdown: str = ""
    selection_by_title: str = ""
    selection_with_ellipsis: str = ""
    new_title: str = ""


@router.post("/docs/update")
def post_update_doc(req: UpdateDocRequest):
    try:
        return update_doc(
            doc=req.doc,
            mode=req.mode,
            markdown=req.markdown,
            selection_by_title=req.selection_by_title,
            selection_with_ellipsis=req.selection_with_ellipsis,
            new_title=req.new_title,
        )
    except LarkCliError as e:
        _handle_error(e)


@router.get("/docs/search")
def get_search_docs(query: str, page_size: int = 15, page_token: str = ""):
    try:
        return search_docs(query, page_size, page_token)
    except LarkCliError as e:
        _handle_error(e)


# --- Media ---

@router.post("/docs/media-insert")
async def post_media_insert(
    doc: str = Form(...),
    file_type: str = Form("image"),
    align: str = Form("center"),
    caption: str = Form(""),
    file: UploadFile = File(...),
):
    """Insert media into a document. Accepts multipart file upload."""
    try:
        # Save uploaded file to temp location
        suffix = os.path.splitext(file.filename or "upload")[1] or ".png"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name

        try:
            result = insert_media(doc, tmp_path, file_type, align, caption)
        finally:
            os.unlink(tmp_path)

        return result
    except LarkCliError as e:
        _handle_error(e)


# --- Whiteboard ---

class WhiteboardUpdateRequest(BaseModel):
    whiteboard_token: str
    dsl_content: str
    overwrite: bool = False


@router.post("/whiteboard/update")
def post_whiteboard_update(req: WhiteboardUpdateRequest):
    try:
        return update_whiteboard(req.whiteboard_token, req.dsl_content, req.overwrite)
    except LarkCliError as e:
        _handle_error(e)


# --- Legacy endpoint (backward compatibility during migration) ---

class LegacyWriteFeishuRequest(BaseModel):
    text: str
    title: str
    target_doc_token: str = ""
    video_info: dict = {}
    app_id: str = ""
    app_secret: str = ""
    wiki_node: str = ""


@router.post("/write_feishu")
def legacy_write_feishu(req: LegacyWriteFeishuRequest):
    """Legacy endpoint — converts old format to new lark-cli flow.

    Kept for backward compat during migration. Ignores app_id/app_secret
    (lark-cli handles auth). Assembles markdown from text + video_info.
    """
    vi = req.video_info
    bvid = vi.get("bvid", "")
    video_title = vi.get("title", req.title)
    owner_name = vi.get("ownerName", vi.get("owner_name", ""))
    owner_mid = vi.get("ownerMid", vi.get("owner_mid", ""))
    cover_url = vi.get("coverUrl", vi.get("cover_url", ""))

    # Build markdown
    lines = [f"# {video_title}", "", "## 主要信息"]
    if cover_url:
        full_url = f"https:{cover_url}" if cover_url.startswith("//") else cover_url
        lines.append(f"![封面]({full_url})")
    if owner_name:
        if owner_mid:
            lines.append(f"- UP主: [{owner_name}](https://space.bilibili.com/{owner_mid})")
        else:
            lines.append(f"- UP主: {owner_name}")
    if bvid:
        lines.append(f"- 原始链接: [Bilibili](https://www.bilibili.com/video/{bvid})")
    lines += ["", "## 字幕", "", req.text]
    markdown = "\n".join(lines)

    wiki_node = req.wiki_node or req.target_doc_token or ""

    try:
        if wiki_node and not req.target_doc_token:
            result = create_doc(markdown=markdown, title=req.title, wiki_node=wiki_node)
        elif req.target_doc_token:
            result = update_doc(doc=req.target_doc_token, mode="append", markdown=markdown)
        else:
            result = create_doc(markdown=markdown, title=req.title)

        doc_url = result.get("data", {}).get("doc_url", "") or result.get("doc_url", "")
        return {"doc_url": doc_url}
    except LarkCliError as e:
        raise HTTPException(status_code=500, detail=str(e))
```

- [ ] **Step 2: Update server/main.py — the router prefix changed so remove old /write_feishu mount if needed**

The router now uses `prefix="/feishu"`, so new endpoints are at `/feishu/auth/status`, `/feishu/docs/create`, etc. The legacy `/write_feishu` endpoint uses a separate `@router.post("/write_feishu")` — but because the router has prefix `/feishu`, it will be at `/feishu/write_feishu`. We need to also mount it at the root level for backward compat.

Update `server/main.py` — add a root-level legacy route:

```python
# In main.py, after app.include_router(feishu.router):
# Legacy root-level /write_feishu for backward compat during migration
from routers.feishu import legacy_write_feishu, LegacyWriteFeishuRequest
@app.post("/write_feishu")
def root_write_feishu(req: LegacyWriteFeishuRequest):
    return legacy_write_feishu(req)
```

- [ ] **Step 3: Verify server starts and endpoints respond**

Run:
```bash
cd server && ../.venv/bin/python -c "
from services.feishu_service import auth_status, list_wiki_spaces
print('Auth:', auth_status().get('tokenStatus'))
print('Spaces:', [s['name'] for s in list_wiki_spaces().get('data', {}).get('items', [])])
"
```
Expected: `Auth: valid` and `Spaces: ['BennuNote', 'CSCI']`

- [ ] **Step 4: Commit**

```bash
git add server/routers/feishu.py server/main.py
git commit -m "refactor(server): rewrite feishu router with lark-cli endpoints"
```

---

### Task 4: Extension — Remove feishu-direct.ts and update background.ts

**Files:**
- Delete: `src/background/feishu-direct.ts`
- Modify: `src/background.ts:1-4,78-119`

- [ ] **Step 1: Delete feishu-direct.ts**

```bash
rm src/background/feishu-direct.ts
```

- [ ] **Step 2: Update background.ts — remove import and Feishu fallback**

Replace the entire file with:

```typescript
import type { Message } from './shared/messages';
import type { BennuNoteConfig } from './shared/types';
import { DEFAULT_CONFIG } from './shared/types';
import { summarizeDirect } from './background/summarize-direct';

let activeTabId: number | null = null;

async function getConfig(): Promise<BennuNoteConfig> {
  const data = await chrome.storage.local.get('bennunote_config');
  return { ...DEFAULT_CONFIG, ...(data.bennunote_config as Partial<BennuNoteConfig> | undefined) };
}

/** Get the active AI provider's key and model from config. */
function getAIParams(config: BennuNoteConfig): { provider: string; apiKey: string; model: string } {
  const provider = config.aiProvider || '';
  const map: Record<string, { key: string; model: string }> = {
    claude_setup_token: { key: config.claudeSetupToken, model: config.claudeModel },
    claude_api: { key: config.claudeApiKey, model: config.claudeApiModel },
    openai: { key: config.openaiApiKey, model: config.openaiModel },
    gemini: { key: config.geminiApiKey, model: config.geminiModel },
    deepseek: { key: config.deepseekApiKey, model: config.deepseekModel },
  };
  const entry = map[provider];
  return { provider, apiKey: entry?.key || '', model: entry?.model || '' };
}

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  if (msg.type === 'EXTRACT_SUBTITLES') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId) {
        activeTabId = tabId;
        chrome.tabs.sendMessage(tabId, msg, () => { void chrome.runtime.lastError; });
      }
    });
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'TRANSCRIPT_REQUEST') {
    const tabId = sender.tab?.id || activeTabId;
    (async () => {
      try {
        const config = await getConfig();
        const resp = await fetch('http://localhost:2185/transcript', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bvid: msg.bvid,
            model_size: config.whisperModelSize || 'small',
            cookie: config.bilibiliCookie || '',
            language: msg.language,
          }),
        });
        const data = await resp.json();
        if (resp.ok && data.items) {
          if (tabId) chrome.tabs.sendMessage(tabId, {
            type: 'TRANSCRIPT_RESULT',
            result: { source: data.source, items: data.items, language: msg.language },
          }, () => { void chrome.runtime.lastError; });
        } else {
          if (tabId) chrome.tabs.sendMessage(tabId, {
            type: 'TRANSCRIPT_RESULT', result: null,
            error: typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || 'Unknown error'),
          }, () => { void chrome.runtime.lastError; });
        }
      } catch (err) {
        if (tabId) chrome.tabs.sendMessage(tabId, {
          type: 'TRANSCRIPT_RESULT', result: null, error: `Backend offline: ${err}`,
        }, () => { void chrome.runtime.lastError; });
      }
    })();
    sendResponse({ ok: true });
    return false;
  }

  // Write to Feishu Wiki (server only — no fallback)
  if (msg.type === 'WRITE_FEISHU') {
    (async () => {
      try {
        const resp = await fetch('http://localhost:2185/write_feishu', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: msg.text,
            title: msg.title,
            target_doc_token: msg.targetDocToken || '',
            video_info: msg.videoInfo || { bvid: '', title: msg.title },
          }),
        });
        const data = await resp.json();
        if (resp.ok && data.doc_url) {
          sendResponse({ type: 'WRITE_FEISHU_RESULT', success: true, docUrl: data.doc_url });
        } else {
          sendResponse({ type: 'WRITE_FEISHU_RESULT', success: false, error: data.detail || 'Server error' });
        }
      } catch (err) {
        sendResponse({
          type: 'WRITE_FEISHU_RESULT', success: false,
          error: `Server offline. Start the backend: ./start-server.sh — ${err}`,
        });
      }
    })();
    return true;
  }

  // Summarize (server → direct fallback)
  if (msg.type === 'SUMMARIZE') {
    (async () => {
      const config = await getConfig();
      const { provider, apiKey, model } = getAIParams(config);
      let summary: string | undefined;
      let error: string | undefined;

      const maxTokens = msg.maxTokens || config.maxTokens || 4096;
      try {
        const resp = await fetch('http://localhost:2185/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: msg.text, title: msg.title,
            provider, api_key: apiKey, model: model || undefined,
            max_tokens: maxTokens,
          }),
        });
        const data = await resp.json();
        if (resp.ok && data.summary) summary = data.summary;
        else error = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || 'Server error');
      } catch {
        // Server offline → direct fallback
        try {
          summary = await summarizeDirect(config, msg.title, msg.text, maxTokens);
        } catch (e) { error = `${e}`; }
      }

      sendResponse(summary
        ? { type: 'SUMMARIZE_RESULT', success: true, summary }
        : { type: 'SUMMARIZE_RESULT', success: false, error });
    })();
    return true;
  }

  return false;
});
```

- [ ] **Step 3: Build and verify no TypeScript errors**

Run: `npm run build`
Expected: Build succeeds with no errors about missing feishu-direct module.

- [ ] **Step 4: Commit**

```bash
git add -A src/background/feishu-direct.ts src/background.ts
git commit -m "refactor(extension): remove Feishu direct fallback, server-only sync"
```

---

### Task 5: Extension — Remove Feishu credentials from types and config

**Files:**
- Modify: `src/shared/types.ts:34-35,53-54`

- [ ] **Step 1: Remove feishuAppId and feishuAppSecret from BennuNoteConfig**

In `src/shared/types.ts`, remove lines 34-35 (`feishuAppId`, `feishuAppSecret`) from the interface and lines 53-54 from DEFAULT_CONFIG. Also remove the comment on line 34.

Edit `src/shared/types.ts` — remove from interface:
```typescript
  // Server secrets stored locally for offline fallback
  feishuAppId: string;
  feishuAppSecret: string;
```

Edit `src/shared/types.ts` — remove from DEFAULT_CONFIG:
```typescript
  feishuAppId: '',
  feishuAppSecret: '',
```

- [ ] **Step 2: Build to verify no references break**

Run: `npm run build`
Expected: Build succeeds. If there are errors about `feishuAppId` or `feishuAppSecret`, fix them (they should already be gone from background.ts in Task 4).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "refactor(types): remove Feishu credentials from BennuNoteConfig"
```

---

### Task 6: Extension — Clean up options page (remove Feishu credential rows)

**Files:**
- Modify: `src/options/options.html:147-175`
- Modify: `src/options/options.ts` (no code changes needed — secret-row logic is generic and will just skip the removed rows)

- [ ] **Step 1: Remove Feishu App ID and App Secret secret-rows from options.html**

Delete lines 147-175 (the two `<div class="secret-row">` blocks for `feishu_app_id` and `feishu_app_secret`). Keep the `</div>` that closes the section.

The section should go from:
```html
    <div id="server-status" class="server-status loading">Checking server...</div>

    <div class="secret-row" data-key="feishu_app_id">
      ...
    </div>

    <div class="secret-row" data-key="feishu_app_secret">
      ...
    </div>

  </div>
```

To:
```html
    <div id="server-status" class="server-status loading">Checking server...</div>

  </div>
```

- [ ] **Step 2: Add a Feishu auth status section**

After the server status div, add:

```html
    <div id="feishu-status" class="server-status loading">Checking Feishu auth...</div>
```

- [ ] **Step 3: Add feishu auth check to options.ts**

Add after the `refreshServerConfig();` call at line 140:

```typescript
// Check Feishu (lark-cli) auth status
(async () => {
  const feishuEl = document.getElementById('feishu-status')!;
  try {
    const resp = await fetch(`${SERVER_URL}/feishu/auth/status`);
    if (resp.ok) {
      const data = await resp.json();
      if (data.tokenStatus === 'valid') {
        feishuEl.className = 'server-status online';
        feishuEl.textContent = `Feishu: authenticated as ${data.userName || 'user'}`;
      } else {
        feishuEl.className = 'server-status offline';
        feishuEl.textContent = 'Feishu: not authenticated — run ./start-server.sh';
      }
    } else {
      feishuEl.className = 'server-status offline';
      feishuEl.textContent = 'Feishu: server error';
    }
  } catch {
    feishuEl.className = 'server-status offline';
    feishuEl.textContent = 'Feishu: server offline';
  }
})();
```

- [ ] **Step 4: Build and verify**

Run: `npm run build`
Expected: Builds successfully.

- [ ] **Step 5: Commit**

```bash
git add src/options/options.html src/options/options.ts
git commit -m "refactor(options): remove Feishu credentials, add lark-cli auth status"
```

---

### Task 7: Extension — Clean up subtitle panel (remove Feishu setup form)

**Files:**
- Modify: `src/content/subtitle-panel.ts`

- [ ] **Step 1: Remove Feishu credential UI from the panel HTML template**

In the Settings tab section (around lines 166-195), remove the `feishuAppId` and `feishuAppSecret` secret-row divs and the "Feishu Wiki" section title + help text. Replace with a simple auth status indicator:

Replace lines 165-195 (the Feishu Wiki settings section) with:

```html
            <div class="bennu-settings-section-title">Feishu Wiki</div>
            <div class="bennu-feishu-auth-status" style="font-size:12px;color:#999;padding:4px 0 8px">
              Checking...
            </div>
```

- [ ] **Step 2: Remove the Feishu setup form from footer area**

Remove lines 381-397 (the `bennu-feishu-setup` div with App ID/Secret inputs).

- [ ] **Step 3: Remove setup-related private members and methods**

Remove these private members:
- `feishuSetupEl` (line 84)

Remove these methods:
- `showFeishuSetup()` (lines 980-988)
- `hideFeishuSetup()` (lines 991-996)
- `handleSaveFeishu()` (lines 1010-1033)

Remove action handlers in the click handler (lines 541-542):
```typescript
      else if (action === 'save-feishu') this.handleSaveFeishu();
      else if (action === 'cancel-feishu') this.hideFeishuSetup();
```

Remove the `feishuSetupEl` querySelector assignment (line 427):
```typescript
    this.feishuSetupEl = panel.querySelector('.bennu-feishu-setup')!;
```

- [ ] **Step 4: Add auth status check on panel init**

In the constructor, after the settings tab wiring, add a Feishu auth status check:

```typescript
    // Check Feishu auth status
    const authStatusEl = panel.querySelector('.bennu-feishu-auth-status') as HTMLElement;
    if (authStatusEl) {
      fetch('http://localhost:2185/feishu/auth/status', { signal: AbortSignal.timeout(3000) })
        .then(r => r.json())
        .then(data => {
          if (data.tokenStatus === 'valid') {
            authStatusEl.textContent = `✓ ${data.userName || 'Authenticated'}`;
            authStatusEl.style.color = '#4caf50';
          } else {
            authStatusEl.textContent = '✗ Not authenticated — run ./start-server.sh';
            authStatusEl.style.color = '#f44336';
          }
        })
        .catch(() => {
          authStatusEl.textContent = '✗ Server offline';
          authStatusEl.style.color = '#f44336';
        });
    }
```

- [ ] **Step 5: Build and verify**

Run: `npm run build`
Expected: Builds successfully with no references to removed members.

- [ ] **Step 6: Commit**

```bash
git add src/content/subtitle-panel.ts
git commit -m "refactor(panel): remove Feishu setup form, add auth status indicator"
```

---

### Task 8: Extension — Remove Feishu host permission from manifest

**Files:**
- Modify: `manifest.json:11`

- [ ] **Step 1: Remove Feishu host permission**

Remove line 11 from manifest.json:
```json
    "https://open.feishu.cn/*",
```

The `host_permissions` array should become:
```json
  "host_permissions": [
    "*://*.bilibili.com/*",
    "*://*.hdslb.com/*",
    "http://localhost:2185/*",
    "https://api.anthropic.com/*",
    "https://api.openai.com/*",
    "https://generativelanguage.googleapis.com/*",
    "https://api.deepseek.com/*"
  ],
```

- [ ] **Step 2: Commit**

```bash
git add manifest.json
git commit -m "chore(manifest): remove Feishu host permission (server handles API calls)"
```

---

### Task 9: start-server.sh — Add lark-cli auto-setup

**Files:**
- Modify: `start-server.sh`

- [ ] **Step 1: Add lark-cli checks before server start**

Replace the entire `start-server.sh` with:

```bash
#!/usr/bin/env bash
# BennuNote Backend — one-click start script
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"
VENV_DIR="$SERVER_DIR/.venv"

# ── lark-cli prerequisite ──

if ! command -v lark-cli &>/dev/null; then
  echo "lark-cli not found. Installing..."
  npm install -g @anthropic-ai/lark-cli
fi

# Check if config exists (has appId set)
if ! lark-cli config show &>/dev/null 2>&1; then
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "  First-time setup: configuring lark-cli for Feishu"
  echo "═══════════════════════════════════════════════════════"
  echo ""
  lark-cli config init
  echo ""
fi

# Check if auth is valid
TOKEN_STATUS=$(lark-cli auth status 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('tokenStatus', ''))
except:
    print('')
" 2>/dev/null || echo "")

if [ "$TOKEN_STATUS" != "valid" ]; then
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "  Feishu login required (opens browser)"
  echo "═══════════════════════════════════════════════════════"
  echo ""
  lark-cli auth login
  echo ""
fi

echo "✓ lark-cli: authenticated"

# ── Python venv ──

# Create venv if missing
if [ ! -d "$VENV_DIR" ]; then
  echo "Creating virtual environment..."
  python3 -m venv "$VENV_DIR"
fi

# Install / update dependencies
echo "Checking dependencies..."
"$VENV_DIR/bin/pip" install -q -r "$SERVER_DIR/requirements.txt"

# Start server
echo "Starting BennuNote backend on http://127.0.0.1:2185 ..."
cd "$SERVER_DIR"
exec "$VENV_DIR/bin/uvicorn" main:app --host 127.0.0.1 --port 2185 --reload
```

- [ ] **Step 2: Test the script detects existing auth**

Run: `./start-server.sh` (Ctrl-C after server starts)
Expected: Should print `✓ lark-cli: authenticated` and start the server without prompting for config or login.

- [ ] **Step 3: Commit**

```bash
git add start-server.sh
git commit -m "feat(server): add lark-cli auto-setup to start-server.sh"
```

---

### Task 10: Update CLAUDE.md documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update Architecture section**

Replace the Feishu-related parts of the architecture diagram:
```
      └→ Python Backend (server/) → localhost:2185, optional (offline fallback in extension)
          ├ /transcript  → Bcut ASR → Whisper fallback
          ├ /summarize   → AI summary (credentials passed in request)
          └ /write_feishu → Feishu doc sync (credentials passed in request)
```
With:
```
      └→ Python Backend (server/) → localhost:2185
          ├ /transcript      → Bcut ASR → Whisper fallback
          ├ /summarize       → AI summary (credentials passed in request)
          └ /feishu/*        → Feishu Wiki ops via lark-cli (auth managed by lark-cli)
```

- [ ] **Step 2: Update Server-or-Direct Fallback section**

Replace the paragraph about feishu-direct.ts fallback. Remove the bullet for `src/background/feishu-direct.ts`. Update to explain that Feishu operations are server-only via lark-cli (no offline fallback). Keep the summarize-direct.ts bullet.

- [ ] **Step 3: Update Key Modules section**

Remove the `src/background/feishu-direct.ts` module description. Update `src/background.ts` description to remove "WRITE_FEISHU: try server → catch network error → direct API fallback" and replace with "WRITE_FEISHU: forwards to server (no offline fallback)".

- [ ] **Step 4: Update Configuration table**

Remove `feishuAppId`, `feishuAppSecret` rows from the Configuration table. Add a note: "Feishu auth is managed by lark-cli (`~/.lark-cli/config.json`), configured via `./start-server.sh`."

- [ ] **Step 5: Update Permissions section**

Remove `host_permissions` entry for `open.feishu.cn`.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for lark-cli Feishu integration"
```

---

### Task 11: Final build and smoke test

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Start server and test Feishu endpoints**

Run: `./start-server.sh` (in a separate terminal)

Then test:
```bash
# Auth status
curl -s http://localhost:2185/feishu/auth/status | python3 -m json.tool

# List wiki spaces
curl -s http://localhost:2185/feishu/wiki/spaces | python3 -m json.tool

# Create test doc
curl -s -X POST http://localhost:2185/feishu/docs/create \
  -H "Content-Type: application/json" \
  -d '{"markdown": "# Test\nHello from BennuNote server!", "title": "Server Test", "wiki_node": "Sxz1wOEaWiOaXkkCxW2cluSKnOh"}' | python3 -m json.tool

# Search
curl -s "http://localhost:2185/feishu/docs/search?query=test" | python3 -m json.tool
```

Expected: All return valid JSON responses.

- [ ] **Step 3: Test legacy endpoint still works**

```bash
curl -s -X POST http://localhost:2185/write_feishu \
  -H "Content-Type: application/json" \
  -d '{"text": "test subtitle", "title": "Legacy Test", "video_info": {"bvid": "BV1test", "title": "Test Video"}}' | python3 -m json.tool
```

Expected: Returns `{"doc_url": "https://..."}`.

- [ ] **Step 4: Load extension in Chrome and verify**

1. Load `dist/` as unpacked extension
2. Open options page — verify Feishu auth status shows green
3. Navigate to a Bilibili video page — verify panel loads without errors
4. Check that "Sync to Feishu" button is present in the footer
