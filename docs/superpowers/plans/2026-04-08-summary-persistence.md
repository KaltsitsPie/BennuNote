# Summary Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate AI summary into Download (.md) and Sync-to-Feishu, with a cross-session map (`bennunote_video_docs` in `chrome.storage.local`) so both subtitle sync and summary sync always target the same Feishu document.

**Architecture:** `SubtitlePanel` gains a raw `summaryText` field (set alongside the DOM render). The sync handler in `index.ts` reads/writes a per-videoId map in `chrome.storage.local` to decide whether to create a new doc or append-summary-only. The server gains an `append_summary_only` fast-path that calls `update_doc` once with just the `## 摘要` section.

**Tech Stack:** TypeScript (Chrome MV3), Python/FastAPI (server), lark-cli (Feishu API wrapper)

---

## File Map

| File | Change |
|---|---|
| `src/content/subtitle-panel.ts` | Add `summaryText` field + `getSummaryText()` getter; update `buildFeishuMarkdown()` + filename in `downloadMarkdown()` |
| `src/shared/messages.ts` | Add `summary?` + `appendSummaryOnly?` to `WriteFeishuRequest` |
| `src/background.ts` | Pass `summary` + `append_summary_only` through to server in `WRITE_FEISHU` handler |
| `src/content/index.ts` | Add `VideoDocMap` helpers; rewrite `setSyncHandler` with branching logic |
| `server/routers/feishu.py` | Add `summary` + `append_summary_only` to `LegacyWriteFeishuRequest`; pass to service |
| `server/main.py` | Pass new fields through in `root_write_feishu` |
| `server/services/feishu_service.py` | Add `append_summary_only` fast-path; append summary chunk in normal flow |
| `server/tests/test_feishu_service.py` | Pytest tests for the new server logic |

---

### Task 1: Add `summaryText` field and `getSummaryText()` to `SubtitlePanel`

**Files:**
- Modify: `src/content/subtitle-panel.ts`

**Context:** `summaryText` is currently only in the DOM (`summaryTextEl.innerHTML`). The sync handler in `index.ts` needs raw text without reading the DOM. `setSummary(text)` already receives the raw string — we just need to save it.

- [ ] **Step 1: Add the private field**

In `src/content/subtitle-panel.ts`, find the block of private field declarations (around line 70, near `private mergedItems: SubtitleItem[] = []`). Add after `private mergedItems: SubtitleItem[] = []`:

```ts
private summaryText = '';
```

- [ ] **Step 2: Assign it in `setSummary()`**

Find `setSummary(text: string)` (around line 1093). Add `this.summaryText = text;` as the first line of the method body:

```ts
setSummary(text: string) {
  this.summaryText = text;           // ← add this line
  this.setSummaryState('text');
  this.summaryTextEl.innerHTML = text
    .split('\n\n')
    .map((p) => `<p>${this.escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  // ... rest of method unchanged
```

- [ ] **Step 3: Add public getter**

Find `getMergedItems(): SubtitleItem[]` (around line 1139). Add directly after it:

```ts
getSummaryText(): string {
  return this.summaryText;
}
```

- [ ] **Step 4: Build and verify**

```bash
cd /Users/bytedance/Documents/BennuNote && npm run build 2>&1 | tail -5
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/bytedance/Documents/BennuNote
git add src/content/subtitle-panel.ts
git commit -m "feat(panel): add summaryText field and getSummaryText() getter"
```

---

### Task 2: Include summary in `buildFeishuMarkdown()` and fix filename

**Files:**
- Modify: `src/content/subtitle-panel.ts`

**Context:** `buildFeishuMarkdown()` builds the `.md` content for both local download and as a reference format. `downloadMarkdown()` currently uses `${date}` in the filename, making it inconsistent across sessions. We change the filename to use `bvid` (or `youtubeVideoId`) so the same video always suggests the same filename, enabling the user to overwrite in their download folder.

- [ ] **Step 1: Append `## 摘要` section in `buildFeishuMarkdown()`**

Find the end of `buildFeishuMarkdown()` (around line 1214, the `lines.push(''); return lines.join('\n');` at the end). Replace those two lines with:

```ts
    if (this.summaryText) {
      lines.push('', '## 摘要', '', this.summaryText);
    }

    lines.push('');
    return lines.join('\n');
```

- [ ] **Step 2: Fix the filename in `downloadMarkdown()`**

Find `downloadMarkdown()` (around line 1218). Find this block:

```ts
const videoTitle = this.videoInfo?.title || 'subtitle';
const safeTitle = videoTitle.replace(/[/\\:*?"<>|]/g, '_');
const date = new Date().toLocaleDateString('zh-CN');
const filename = `${safeTitle} - ${date}.md`;
```

Replace with:

```ts
const videoTitle = this.videoInfo?.title || 'subtitle';
const safeTitle = videoTitle.replace(/[/\\:*?"<>|]/g, '_');
const videoId = this.videoInfo?.bvid || this.videoInfo?.youtubeVideoId || '';
const filename = videoId ? `${safeTitle} - ${videoId}.md` : `${safeTitle}.md`;
```

- [ ] **Step 3: Build and verify**

```bash
cd /Users/bytedance/Documents/BennuNote && npm run build 2>&1 | tail -5
```

Expected: no TypeScript errors.

- [ ] **Step 4: Manual smoke test**

Load the extension, extract subtitles, generate a summary, click Download. Verify:
- The save dialog suggests `<VideoTitle> - <bvid>.md`
- The saved file contains `## 字幕` table followed by `## 摘要` section

- [ ] **Step 5: Commit**

```bash
cd /Users/bytedance/Documents/BennuNote
git add src/content/subtitle-panel.ts
git commit -m "feat(panel): include summary in markdown download, use videoId in filename"
```

---

### Task 3: Extend `WriteFeishuRequest` message type

**Files:**
- Modify: `src/shared/messages.ts`

**Context:** The sync handler will need to pass `summary` text and an `appendSummaryOnly` flag to the background script, which forwards them to the server.

- [ ] **Step 1: Add two optional fields to `WriteFeishuRequest`**

Find `WriteFeishuRequest` (line 26). Add after `targetDocToken?: string;`:

```ts
export interface WriteFeishuRequest {
  type: 'WRITE_FEISHU';
  text: string;
  title: string;
  items?: { from: number; to: number; content: string }[];
  videoInfo?: {
    bvid: string;
    title: string;
    ownerName?: string;
    ownerMid?: number;
    coverUrl?: string;
    videoUrl?: string;
  };
  targetDocToken?: string;
  summary?: string;             // AI-generated summary text
  appendSummaryOnly?: boolean;  // true = only append ## 摘要 to existing doc
}
```

- [ ] **Step 2: Build**

```bash
cd /Users/bytedance/Documents/BennuNote && npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/bytedance/Documents/BennuNote
git add src/shared/messages.ts
git commit -m "feat(messages): add summary and appendSummaryOnly to WriteFeishuRequest"
```

---

### Task 4: Pass new fields through `background.ts` to the server

**Files:**
- Modify: `src/background.ts`

**Context:** `background.ts` handles `WRITE_FEISHU` by POSTing to `http://localhost:2185/write_feishu`. We need to forward the two new fields.

- [ ] **Step 1: Update the fetch body in the `WRITE_FEISHU` handler**

Find the `WRITE_FEISHU` handler (around line 92). Find the `body: JSON.stringify({...})` block and add two new fields:

```ts
body: JSON.stringify({
  text: msg.text,
  title: msg.title,
  items: msg.items || [],
  target_doc_token: msg.targetDocToken || '',
  video_info: msg.videoInfo || { bvid: '', title: msg.title },
  wiki_node: config.feishuWikiRootNodeToken || '',
  summary: msg.summary || '',                          // ← add
  append_summary_only: msg.appendSummaryOnly || false, // ← add
}),
```

- [ ] **Step 2: Build**

```bash
cd /Users/bytedance/Documents/BennuNote && npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/bytedance/Documents/BennuNote
git add src/background.ts
git commit -m "feat(background): forward summary and appendSummaryOnly to feishu server"
```

---

### Task 5: Update server to handle `append_summary_only` and include summary in docs

**Files:**
- Modify: `server/routers/feishu.py`
- Modify: `server/main.py`
- Modify: `server/services/feishu_service.py`
- Create: `server/tests/test_feishu_service.py`

- [ ] **Step 1: Write failing tests for the new server logic**

Create `server/tests/test_feishu_service.py`:

```python
"""Tests for legacy_write_feishu summary handling."""
import pytest
from unittest.mock import patch, MagicMock


# --- helpers ---

def _make_update_result(doc_url: str = "https://www.feishu.cn/wiki/TOKEN123"):
    return {"data": {"doc_url": doc_url, "doc_id": "DOC123"}}

def _make_create_result(doc_url: str = "https://www.feishu.cn/wiki/TOKEN123", doc_id: str = "DOC123"):
    return {"data": {"doc_url": doc_url, "doc_id": doc_id}}

def _make_chunk_result(succeeded: int = 1, failed: int = 0, total: int = 1):
    return {"succeeded": succeeded, "failed": failed, "total": total, "errors": []}


# --- append_summary_only path ---

def test_append_summary_only_calls_update_doc_with_summary_markdown():
    """append_summary_only=True with a docToken should call update_doc once with ## 摘要."""
    from services.feishu_service import legacy_write_feishu

    with patch("services.feishu_service.update_doc", return_value=_make_update_result()) as mock_update, \
         patch("services.feishu_service.create_doc") as mock_create, \
         patch("services.feishu_service._append_chunks_with_retry") as mock_chunks:

        result = legacy_write_feishu(
            text="", title="My Video", items=[], target_doc_token="TOKEN123",
            video_info={}, wiki_node="",
            summary="这是摘要内容。", append_summary_only=True,
        )

    mock_create.assert_not_called()
    mock_chunks.assert_not_called()
    mock_update.assert_called_once()
    call_kwargs = mock_update.call_args
    markdown_arg = call_kwargs.kwargs.get("markdown") or call_kwargs.args[2] if len(call_kwargs.args) > 2 else ""
    assert "## 摘要" in markdown_arg
    assert "这是摘要内容。" in markdown_arg
    assert result["doc_url"] != ""


def test_append_summary_only_without_doc_token_falls_through_to_create():
    """append_summary_only=True but no docToken: must NOT silently skip — falls through to normal create."""
    from services.feishu_service import legacy_write_feishu

    with patch("services.feishu_service.update_doc") as mock_update, \
         patch("services.feishu_service.create_doc", return_value=_make_create_result()) as mock_create, \
         patch("services.feishu_service._append_chunks_with_retry", return_value=_make_chunk_result()), \
         patch("services.feishu_service._download_and_insert_cover", return_value=""):

        result = legacy_write_feishu(
            text="", title="My Video", items=[], target_doc_token="",
            video_info={}, wiki_node="",
            summary="摘要", append_summary_only=True,
        )

    mock_create.assert_called_once()
    assert result["doc_url"] != ""


# --- summary in normal create flow ---

def test_normal_create_with_summary_appends_summary_chunk():
    """When summary is provided and append_summary_only=False, summary is included as a chunk."""
    from services.feishu_service import legacy_write_feishu

    captured_chunks = []

    def fake_append_chunks(doc_id, chunks):
        captured_chunks.extend(chunks)
        return _make_chunk_result(total=len(chunks), succeeded=len(chunks))

    with patch("services.feishu_service.create_doc", return_value=_make_create_result()), \
         patch("services.feishu_service._append_chunks_with_retry", side_effect=fake_append_chunks), \
         patch("services.feishu_service._download_and_insert_cover", return_value=""), \
         patch("services.feishu_service._ensure_root_link"):

        legacy_write_feishu(
            text="", title="My Video",
            items=[{"from": 0, "to": 5, "content": "Hello"}],
            target_doc_token="", video_info={}, wiki_node="",
            summary="这是摘要。", append_summary_only=False,
        )

    all_chunk_text = "\n".join(captured_chunks)
    assert "## 摘要" in all_chunk_text
    assert "这是摘要。" in all_chunk_text


def test_normal_create_without_summary_has_no_summary_section():
    """When summary is empty, no ## 摘要 section is added."""
    from services.feishu_service import legacy_write_feishu

    captured_chunks = []

    def fake_append_chunks(doc_id, chunks):
        captured_chunks.extend(chunks)
        return _make_chunk_result(total=len(chunks), succeeded=len(chunks))

    with patch("services.feishu_service.create_doc", return_value=_make_create_result()), \
         patch("services.feishu_service._append_chunks_with_retry", side_effect=fake_append_chunks), \
         patch("services.feishu_service._download_and_insert_cover", return_value=""), \
         patch("services.feishu_service._ensure_root_link"):

        legacy_write_feishu(
            text="", title="My Video",
            items=[{"from": 0, "to": 5, "content": "Hello"}],
            target_doc_token="", video_info={}, wiki_node="",
            summary="", append_summary_only=False,
        )

    all_chunk_text = "\n".join(captured_chunks)
    assert "## 摘要" not in all_chunk_text
```

- [ ] **Step 2: Run tests — expect failures (functions don't accept new params yet)**

```bash
cd /Users/bytedance/Documents/BennuNote/server && .venv/bin/pytest tests/test_feishu_service.py -v 2>&1 | tail -20
```

Expected: 4 tests FAILED with `TypeError: legacy_write_feishu() got an unexpected keyword argument 'summary'`.

- [ ] **Step 3: Update `legacy_write_feishu()` in `feishu_service.py`**

Find the function signature (line 321):
```python
def legacy_write_feishu(text: str, title: str, items: list, target_doc_token: str,
                        video_info: dict, wiki_node: str) -> dict:
```

Change to:
```python
def legacy_write_feishu(text: str, title: str, items: list, target_doc_token: str,
                        video_info: dict, wiki_node: str,
                        summary: str = "", append_summary_only: bool = False) -> dict:
```

Then, immediately after the docstring / `vi = video_info` line, add the fast-path before Step 1:

```python
    # Fast-path: caller already synced subtitles; only append summary section.
    if append_summary_only and target_doc_token:
        result = update_doc(doc=target_doc_token, mode="append",
                            markdown=f"## 摘要\n\n{summary}\n")
        doc_url = (result.get("data", {}).get("doc_url", "")
                   or result.get("doc_url", "")
                   or f"https://www.feishu.cn/wiki/{target_doc_token}")
        return {"doc_url": doc_url}
```

Then find where `subtitle_chunks` is built (around line 338). After the `elif text:` block, add the summary chunk:

```python
    if items:
        for i in range(0, len(items), BATCH_SIZE):
            batch = items[i:i + BATCH_SIZE]
            chunk_lines = []
            if i == 0:
                chunk_lines += ["## 字幕", ""]
            chunk_lines.append(_build_subtitle_table(batch))
            chunk_lines.append("")
            subtitle_chunks.append("\n".join(chunk_lines))
    elif text:
        subtitle_chunks.append(f"## 字幕\n\n{text}\n")

    if summary:                                          # ← add this block
        subtitle_chunks.append(f"## 摘要\n\n{summary}\n")
```

- [ ] **Step 4: Update `LegacyWriteFeishuRequest` in `routers/feishu.py`**

Find `class LegacyWriteFeishuRequest` (line 218). Add two fields:

```python
class LegacyWriteFeishuRequest(BaseModel):
    text: str
    title: str
    items: list[dict] = []
    target_doc_token: str = ""
    video_info: dict = {}
    wiki_node: str = ""
    summary: str = ""               # ← add
    append_summary_only: bool = False  # ← add
```

Find `post_legacy_write_feishu` (line 228). Pass new fields to the service:

```python
@router.post("/write")
def post_legacy_write_feishu(req: LegacyWriteFeishuRequest):
    try:
        return feishu_service.legacy_write_feishu(
            text=req.text, title=req.title, items=req.items or [],
            target_doc_token=req.target_doc_token or '',
            video_info=req.video_info or {}, wiki_node=req.wiki_node or '',
            summary=req.summary or '',                      # ← add
            append_summary_only=req.append_summary_only,    # ← add
        )
    except LarkCliError as e:
        _handle_error(e)
```

- [ ] **Step 5: Update `root_write_feishu` in `main.py`**

Find `root_write_feishu` (around line 35). Pass new fields:

```python
@app.post("/write_feishu")
def root_write_feishu(req: LegacyWriteFeishuRequest):
    try:
        return legacy_write_feishu(
            text=req.text, title=req.title, items=req.items or [],
            target_doc_token=req.target_doc_token or '',
            video_info=req.video_info or {}, wiki_node=req.wiki_node or '',
            summary=req.summary or '',                      # ← add
            append_summary_only=req.append_summary_only,    # ← add
        )
    except LarkCliError as e:
        _handle_error(e)
```

- [ ] **Step 6: Run tests — expect all pass**

```bash
cd /Users/bytedance/Documents/BennuNote/server && .venv/bin/pytest tests/test_feishu_service.py -v 2>&1 | tail -20
```

Expected: 4 tests PASSED.

- [ ] **Step 7: Commit**

```bash
cd /Users/bytedance/Documents/BennuNote
git add server/tests/test_feishu_service.py server/services/feishu_service.py \
        server/routers/feishu.py server/main.py
git commit -m "feat(server): support append_summary_only and summary in feishu write"
```

---

### Task 6: Video doc map + smart sync handler in `index.ts`

**Files:**
- Modify: `src/content/index.ts`

**Context:** This is the wiring task. The sync handler needs to read/write `bennunote_video_docs` from `chrome.storage.local`, decide which branch to take based on map state + summary availability, and update the map after each successful sync. `parseFeishuToken` from `src/shared/utils.ts` extracts a docToken from a Feishu URL.

- [ ] **Step 1: Add the import for `parseFeishuToken`**

Find the imports at the top of `src/content/index.ts`. Add `parseFeishuToken` to the `getConfig` import line:

```ts
import { getConfig, parseFeishuToken } from '../shared/utils';
```

- [ ] **Step 2: Add the `VideoDocMap` type and map helpers**

After the existing module-level variables (`let panel`, `let currentVideoInfo`, etc.), add:

```ts
// --- Video doc map (cross-session persistence for Feishu doc tokens) ---

type VideoDocEntry = { docToken: string; summaryAppended: boolean };

function getVideoId(info: VideoInfo): string {
  return info.bvid || info.youtubeVideoId || '';
}

async function readVideoDocMap(): Promise<Record<string, VideoDocEntry>> {
  const data = await chrome.storage.local.get('bennunote_video_docs');
  return (data.bennunote_video_docs as Record<string, VideoDocEntry>) || {};
}

async function writeVideoDocEntry(videoId: string, entry: VideoDocEntry): Promise<void> {
  const map = await readVideoDocMap();
  map[videoId] = entry;
  await chrome.storage.local.set({ bennunote_video_docs: map });
}
```

- [ ] **Step 3: Rewrite `setSyncHandler` in `getPanel()`**

Find the `panel.setSyncHandler(() => {` block (around line 21 in `index.ts`). Replace the entire callback with:

```ts
panel.setSyncHandler(async () => {
  if (!currentVideoInfo || !panel) return;
  const p = panel!;
  const videoId = getVideoId(currentVideoInfo);
  const summaryText = p.getSummaryText();

  // Read cross-session map
  const map = await readVideoDocMap();
  const entry = videoId ? map[videoId] : undefined;

  // Determine target doc token: footer input overrides map
  const footerToken = p.getWikiDocLink() || undefined;
  const mapToken = entry?.docToken;
  const targetDocToken = footerToken || mapToken;

  // Branch: append summary only?
  const appendSummaryOnly = !footerToken && !!mapToken && !!summaryText && !entry?.summaryAppended;

  // Guard: nothing new to sync
  if (targetDocToken && !appendSummaryOnly && !footerToken) {
    if (!summaryText) {
      p.showToast('已同步字幕，生成摘要后可再次同步', 'info');
      return;
    }
    if (entry?.summaryAppended) {
      p.showToast('字幕和摘要均已同步', 'info');
      return;
    }
  }

  p.setFeishuSyncing(true);
  p.log(appendSummaryOnly ? 'Appending summary to Feishu doc...' : 'Syncing to Feishu Wiki...', 'step');

  const merged = p.getMergedItems();
  const text = merged.map(i => i.content).join('\n');
  const items = merged.map(i => ({ from: i.from, to: i.to, content: i.content }));
  const title = `${currentVideoInfo!.title} - ${new Date().toLocaleDateString('zh-CN')}`;
  const youtubeUrl =
    currentVideoInfo!.platform === 'youtube' && currentVideoInfo!.youtubeVideoId
      ? `https://www.youtube.com/watch?v=${currentVideoInfo!.youtubeVideoId}`
      : undefined;
  const videoInfo = {
    bvid: currentVideoInfo!.bvid,
    title: currentVideoInfo!.title,
    ownerName: currentVideoInfo!.ownerName,
    ownerMid: currentVideoInfo!.ownerMid,
    coverUrl: currentVideoInfo!.coverUrl,
    pubdate: currentVideoInfo!.pubdate,
    desc: currentVideoInfo!.desc,
    videoUrl: youtubeUrl,
  };

  chrome.runtime.sendMessage(
    {
      type: 'WRITE_FEISHU',
      text,
      title,
      items,
      videoInfo,
      targetDocToken,
      summary: summaryText || undefined,
      appendSummaryOnly,
    },
    async (response) => {
      p.setFeishuSyncing(false);
      if (chrome.runtime.lastError) {
        const errMsg = chrome.runtime.lastError.message || 'Unknown error';
        p.log(`Feishu sync failed: ${errMsg}`, 'error');
        p.showToast(`Sync failed: ${errMsg}`, 'error');
        return;
      }
      if (response?.success && response.docUrl) {
        p.log(appendSummaryOnly ? 'Summary appended to Feishu!' : 'Feishu sync successful!', 'success');
        if (response.warning) p.log(`Warning: ${response.warning}`, 'warn');
        p.showToast(appendSummaryOnly ? 'Summary synced to Feishu' : 'Synced to Feishu', 'success', 3000);
        p.showFeishuLink(response.docUrl);

        // Update cross-session map
        if (videoId) {
          const docToken = parseFeishuToken(response.docUrl) || response.docUrl;
          const summaryAppended = appendSummaryOnly || (!!summaryText && !appendSummaryOnly);
          await writeVideoDocEntry(videoId, { docToken, summaryAppended });
        }

        if (!targetDocToken && !appendSummaryOnly) {
          window.open(response.docUrl, '_blank');
        }
      } else {
        const errMsg = response?.error || 'Unknown error';
        p.log(`Feishu sync failed: ${errMsg}`, 'error');
        p.showToast(`Sync failed: ${errMsg}`, 'error');
      }
    },
  );
});
```

- [ ] **Step 4: Build**

```bash
cd /Users/bytedance/Documents/BennuNote && npm run build 2>&1 | tail -10
```

Expected: no TypeScript errors.

- [ ] **Step 5: Manual smoke test — subtitle sync**

1. Open a Bilibili or YouTube video page
2. Extract subtitles
3. Click "Sync to Feishu" → should create a new doc, open it in a new tab
4. Check `chrome.storage.local` in DevTools console:
   ```js
   chrome.storage.local.get('bennunote_video_docs', console.log)
   ```
   Expected: `{ "BV1xxxx": { docToken: "doccXXX", summaryAppended: false } }`

- [ ] **Step 6: Manual smoke test — summary sync (same session)**

1. Generate AI summary
2. Click "Sync to Feishu" again
3. Expected: log shows "Appending summary to Feishu doc...", toast "Summary synced to Feishu"
4. Check map: `summaryAppended: true`
5. Check the Feishu doc: should now have `## 摘要` section appended

- [ ] **Step 7: Manual smoke test — cross-session**

1. Close and reopen the tab
2. Extract subtitles for the same video
3. Generate summary
4. Click "Sync to Feishu" → should go straight to append-summary-only (no new doc created)

- [ ] **Step 8: Manual smoke test — already synced guard**

1. With `summaryAppended: true` in map, click "Sync to Feishu"
2. Expected: toast "字幕和摘要均已同步", no network call

- [ ] **Step 9: Commit**

```bash
cd /Users/bytedance/Documents/BennuNote
git add src/content/index.ts
git commit -m "feat(sync): cross-session video doc map, smart subtitle/summary branching"
```

---

## Spec Coverage Check

| Spec requirement | Covered by |
|---|---|
| `private summaryText` field + `getSummaryText()` | Task 1 |
| `buildFeishuMarkdown()` includes `## 摘要` | Task 2 |
| Filename uses videoId not date | Task 2 |
| `summary` + `appendSummaryOnly` in message | Task 3 |
| background.ts passes new fields to server | Task 4 |
| Server `append_summary_only` fast-path | Task 5 |
| Server includes summary chunk in normal flow | Task 5 |
| `bennunote_video_docs` map in chrome.storage.local | Task 6 |
| Sync branches by map state + summary state | Task 6 |
| Toast guards for already-synced states | Task 6 |
| Map updated after successful sync | Task 6 |
