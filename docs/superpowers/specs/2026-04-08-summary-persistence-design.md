# Summary Persistence Design

**Date**: 2026-04-08  
**Status**: Approved

## Problem

Summary (AI-generated) is currently disconnected from the Download and Sync-to-Feishu features. When a user extracts subtitles, syncs them to Feishu, then generates a summary, there is no way to append the summary to the same Feishu document — especially across browser sessions.

## Goals

- Include summary in local `.md` downloads (when available)
- Include summary in Feishu documents (when available)
- Guarantee that subtitle sync and summary sync go to the **same** Feishu document, even across sessions
- No duplicate content on re-sync

## Non-Goals

- Overwriting/updating already-synced subtitle content
- Restoring subtitle items across sessions
- Handling multiple summary versions (regenerate replaces in-panel only)

---

## Document Structure (unified for download and Feishu)

```markdown
# 视频标题

## 主要信息
| | |
|---|---|
| Up主 | xxx |
| 链接 | ... |

## 字幕
| 时间 | 内容 |
|---|---|
| 0:01 | ... |

## 摘要

AI generated summary text, paragraphs preserved as-is.
```

`## 摘要` is appended only when `summaryText` is non-empty.

---

## Architecture

### 1. Panel — new `summaryText` field

**File**: `src/content/subtitle-panel.ts`

Add a class field:
```ts
private summaryText = '';
```

In `setSummary(text: string)`, also set `this.summaryText = text`. Add a public getter:

```ts
getSummaryText(): string { return this.summaryText; }
```

This gives the sync handler in `index.ts` direct access to the raw text without reading from the DOM.

### 2. Cross-session persistence map

**Storage key**: `bennunote_video_docs` in `chrome.storage.local`

**Shape**:
```ts
type VideoDocMap = {
  [videoId: string]: {
    docToken: string;       // Feishu doc token
    summaryAppended: boolean; // whether summary has been appended to this doc
  };
};
```

- `videoId` = `bvid` for Bilibili, `youtubeVideoId` for YouTube
- Written after a successful Feishu sync
- Read at sync time to determine which doc to target and what to do

### 3. Sync button behavior

The "Sync to Feishu" button dispatches based on map state:

| docToken in map | summary available | summaryAppended | Action |
|---|---|---|---|
| No | No | — | Create new doc (header + subtitles). Store `{ docToken, summaryAppended: false }`. |
| No | Yes | — | Create new doc (header + subtitles + summary). Store `{ docToken, summaryAppended: true }`. |
| Yes | No | false | Toast: "已同步字幕，生成摘要后可再次同步" |
| Yes | Yes | false | Append `## 摘要` only to existing doc. Set `summaryAppended: true`. |
| Yes | Yes | true | Toast: "字幕和摘要均已同步" |

The user-provided wiki doc link input (footer) still takes precedence over the map entry and can override it.

### 4. Local download

**File**: `src/content/subtitle-panel.ts` — `buildFeishuMarkdown()` and `downloadMarkdown()`

- Filename: `${safeTitle} - ${bvid}.md` (remove date, add bvid for cross-session consistency)
  - YouTube fallback: `${safeTitle} - ${youtubeVideoId}.md`
  - No videoId case: `${safeTitle}.md`
- `buildFeishuMarkdown()` appends `## 摘要\n\n${summaryText}` when `summaryText` is non-empty
- Always a full snapshot of current panel state — no incremental logic needed

### 5. Message protocol changes

**File**: `src/shared/messages.ts`

```ts
export interface WriteFeishuRequest {
  type: 'WRITE_FEISHU';
  text: string;
  title: string;
  items?: { from: number; to: number; content: string }[];
  videoInfo?: { ... };
  targetDocToken?: string;
  summary?: string;             // NEW: summary text if available
  appendSummaryOnly?: boolean;  // NEW: true = only append ## 摘要 to existing doc
}
```

### 6. Server changes

**File**: `server/services/feishu_service.py` — `legacy_write_feishu()`

New parameter: `summary: str = ""`, `append_summary_only: bool = False`

Logic:
- If `append_summary_only and target_doc_token`:
  - Call `update_doc(doc=target_doc_token, mode="append", markdown=f"## 摘要\n\n{summary}\n")`
  - Return immediately
- Otherwise (existing flow):
  - At the end of the subtitle chunks, if `summary` is non-empty, append one more chunk: `## 摘要\n\n{summary}\n`

**File**: `server/routers/feishu.py` — `LegacyWriteFeishuRequest`

Add fields:
```python
summary: str = ""
append_summary_only: bool = False
```

Pass them through to `feishu_service.legacy_write_feishu()`.

---

## Data Flow

```
User clicks "Sync to Feishu"
  │
  ├─ Read videoId from currentVideoInfo
  ├─ Read bennunote_video_docs[videoId] from chrome.storage.local
  │
  ├─ [No docToken] → sendMessage WRITE_FEISHU (full content, summary if available)
  │     └─ On success: store docToken + summaryAppended in map
  │
  ├─ [Has docToken, summary, !summaryAppended] → sendMessage WRITE_FEISHU (appendSummaryOnly=true)
  │     └─ On success: set summaryAppended=true in map
  │
  └─ [Other] → Toast only, no network call
```

---

## Files Changed

| File | Change |
|---|---|
| `src/content/subtitle-panel.ts` | Add `summaryText` field; update `setSummary()`; update `buildFeishuMarkdown()` (add `## 摘要`, fix filename); expose `getSummaryText()` |
| `src/content/index.ts` | `setSyncHandler` reads map, branches on state, writes map on success |
| `src/shared/messages.ts` | Add `summary?` and `appendSummaryOnly?` to `WriteFeishuRequest` |
| `src/background.ts` | Pass `summary` and `appendSummaryOnly` through to server (no logic change) |
| `server/routers/feishu.py` | Add `summary` and `append_summary_only` to `LegacyWriteFeishuRequest` |
| `server/services/feishu_service.py` | Handle `append_summary_only` branch; append summary chunk in normal flow |
