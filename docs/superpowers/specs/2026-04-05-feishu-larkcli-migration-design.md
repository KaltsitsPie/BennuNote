# Feishu Integration Migration: Raw API → lark-cli

## Summary

Replace BennuNote's hand-rolled Feishu REST API integration (both TypeScript extension fallback and Python server) with `lark-cli` subprocess calls on the server side. All Feishu functionality moves exclusively to the Python server. The extension becomes a thin HTTP client.

## Motivation

Current implementation maintains ~320 lines of duplicate code (190 TS + 130 Python) that manually constructs Feishu block JSON, handles auth tokens, splits content into chunks, and base64-encodes URLs. `lark-cli` already handles all of this and accepts Markdown input directly.

## Architecture

```
Chrome Extension                    Python Server (localhost:2185)
┌──────────────────┐               ┌─────────────────────────────────┐
│ Settings:        │               │ /feishu/* FastAPI endpoints      │
│   - Wiki root URL│── HTTP ──────→│        ↓                        │
│   - Auth status  │               │ subprocess.run(["lark-cli",...]) │
│ Sync button      │               │        ↓                        │
│ Wiki browser UI  │               │ Feishu API (via lark-cli)       │
└──────────────────┘               └─────────────────────────────────┘
```

### Authentication

lark-cli manages its own auth state in `~/.lark-cli/config.json`. The `start-server.sh` script handles first-time setup:

1. Check `lark-cli` installed → if not, `npm install -g @anthropic-ai/lark-cli` (via nvm node)
2. Check `lark-cli config show` succeeds → if not, run `lark-cli config init` (interactive: App ID, App Secret, brand)
3. Check `lark-cli auth status` shows `tokenStatus: valid` → if not, run `lark-cli auth login` (opens browser)
4. Start uvicorn

After first run, steps 1-3 are no-ops (silent pass-through). Token refresh is handled by lark-cli automatically.

### No offline fallback

The extension's direct Feishu API fallback (`feishu-direct.ts`) is removed. If the server is offline, Feishu sync is unavailable. This is acceptable — the server is expected to be running.

## Files to Delete

| File | Reason |
|------|--------|
| `src/background/feishu-direct.ts` | Entire file — replaced by server-side lark-cli |

## Files to Modify

### `start-server.sh`

Add lark-cli prerequisite checks before starting uvicorn:

```bash
# Check lark-cli installed
if ! command -v lark-cli &>/dev/null; then
  echo "Installing lark-cli..."
  npm install -g @anthropic-ai/lark-cli
fi

# Check config exists
if ! lark-cli config show &>/dev/null; then
  echo "First-time setup: configuring lark-cli..."
  lark-cli config init
fi

# Check auth valid
TOKEN_STATUS=$(lark-cli auth status 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('tokenStatus',''))" 2>/dev/null || echo "")
if [ "$TOKEN_STATUS" != "valid" ]; then
  echo "Feishu login required..."
  lark-cli auth login
fi
```

### `src/background.ts`

- Remove `import { writeFeishuDirect }` and the fallback `catch` branch
- WRITE_FEISHU handler: only call server, return error if server offline

### `src/shared/messages.ts`

- `WriteFeishuRequest`: remove `videoInfo` raw fields, add `markdown: string` content field
- Keep `targetWikiNode` (wiki node token or URL for target location)

### `src/shared/types.ts`

- Remove `feishuAppId`, `feishuAppSecret` from `BennuNoteConfig`
- Keep `feishuWikiRootNodeToken`

### `src/content/index.ts`

- Change Feishu sync handler to assemble **Markdown** content instead of raw subtitle text
- Markdown structure: `# Title\n## Info\n- Author: ...\n- Link: ...\n## Subtitles\n...`

### `src/content/subtitle-panel.ts`

- Remove Feishu App ID / App Secret setup form
- Add auth status indicator (green/red dot) that polls `/feishu/auth/status`
- Keep wiki root node URL input

### `src/options/options.html` + `src/options/options.ts`

- Remove `feishu_app_id` and `feishu_app_secret` server secret rows
- Keep wiki root node URL config

### `server/routers/feishu.py`

Complete rewrite. New endpoints:

```python
# Auth
GET  /feishu/auth/status          → lark-cli auth status

# Wiki
GET  /feishu/wiki/spaces          → lark-cli wiki spaces list
POST /feishu/wiki/spaces/create   → lark-cli wiki spaces create (if supported)
GET  /feishu/wiki/nodes           → lark-cli wiki nodes list --params '{"space_id":"X", "parent_node_token":"Y"}'

# Documents
POST /feishu/docs/create          → lark-cli docs +create --wiki-node X --markdown "..."
GET  /feishu/docs/fetch           → lark-cli docs +fetch --doc X
POST /feishu/docs/update          → lark-cli docs +update --doc X --mode Y --markdown "..."
GET  /feishu/docs/search          → lark-cli docs +search --query X

# Media & Whiteboard
POST /feishu/docs/media-insert    → lark-cli docs +media-insert --doc X --file Y
POST /feishu/whiteboard/update    → lark-cli docs +whiteboard-update --whiteboard-token X
```

### `server/services/feishu_service.py`

Complete rewrite. Replace raw HTTP calls with a `run_lark_cli()` helper:

```python
import subprocess, json

def run_lark_cli(*args) -> dict:
    """Run a lark-cli command and return parsed JSON output."""
    result = subprocess.run(
        ["lark-cli", *args],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        raise LarkCliError(result.stderr)
    return json.loads(result.stdout)
```

All service functions become thin wrappers:

```python
def create_doc(wiki_node: str, title: str, markdown: str) -> dict:
    return run_lark_cli("docs", "+create",
        "--wiki-node", wiki_node,
        "--title", title,
        "--markdown", markdown)

def fetch_doc(doc_id_or_url: str) -> dict:
    return run_lark_cli("docs", "+fetch", "--doc", doc_id_or_url)

def update_doc(doc_id: str, mode: str, markdown: str, **kwargs) -> dict:
    args = ["docs", "+update", "--doc", doc_id, "--mode", mode, "--markdown", markdown]
    if kwargs.get("selection_by_title"):
        args += ["--selection-by-title", kwargs["selection_by_title"]]
    return run_lark_cli(*args)

def search_docs(query: str) -> dict:
    return run_lark_cli("docs", "+search", "--query", query)

def list_wiki_spaces() -> dict:
    return run_lark_cli("wiki", "spaces", "list")

def list_wiki_nodes(space_id: str, parent_node_token: str = "") -> dict:
    params = {"space_id": space_id}
    if parent_node_token:
        params["parent_node_token"] = parent_node_token
    return run_lark_cli("wiki", "nodes", "list", "--params", json.dumps(params))

def insert_media(doc_id: str, file_path: str, file_type: str = "image") -> dict:
    return run_lark_cli("docs", "+media-insert",
        "--doc", doc_id, "--file", file_path, "--type", file_type)

def get_auth_status() -> dict:
    return run_lark_cli("auth", "status")
```

### `manifest.json`

- Remove Feishu API host permissions (`open.feishu.cn`, `larkoffice.com`, etc.)
- Keep only: `*.bilibili.com/*`, `*.hdslb.com/*`, `localhost:2185/*`, AI API domains

## Extension Settings Page Changes

### Remove
- App ID input field + status dot
- App Secret input field + status dot

### Keep
- Wiki root node URL input

### Add
- Auth status indicator: green dot + "lark-cli authenticated" / red dot + "lark-cli not configured — run ./start-server.sh"
- Polls `GET /feishu/auth/status` on page load

## Data Flow: Feishu Sync (After Migration)

```
1. User clicks "Sync to Feishu" in subtitle panel
2. Content script assembles Markdown:
   # Video Title
   ## Main Info
   - Author: [UP主名](https://space.bilibili.com/xxx)
   - Link: [原始链接](https://www.bilibili.com/video/BVxxx)
   - Cover: ![cover](https://...)
   ## Subtitles
   [subtitle content]
3. Content script sends WRITE_FEISHU message to background
4. Background POSTs to server:
   POST /feishu/docs/create
   { "wiki_node": "Sxz1w...", "title": "Video Title", "markdown": "..." }
5. Server runs: lark-cli docs +create --wiki-node Sxz1w... --title "..." --markdown "..."
6. Server returns { "doc_url": "https://...", "doc_id": "..." }
7. Background sends WRITE_FEISHU_RESULT back to content script
8. Panel shows success + doc link
```

## Error Handling

- **Server offline**: Extension shows "Server not available" (no fallback)
- **lark-cli not configured**: `/feishu/auth/status` returns error → Extension shows setup instructions
- **Token expired**: lark-cli handles refresh automatically via refresh token
- **Refresh token expired** (after ~7 days): `/feishu/auth/status` returns invalid → Extension shows "Re-run ./start-server.sh"
- **lark-cli command fails**: Server returns 500 with stderr message

## Permissions (lark-cli scopes)

Required scopes (already granted in current config):
- `docx:document:create`, `docx:document:write_only`, `docx:document:readonly` — document CRUD
- `docs:document.content:read` — fetch document content
- `docs:document.media:upload`, `docs:document.media:download` — media operations
- `wiki:node:create`, `wiki:node:read`, `wiki:node:retrieve` — wiki node management
- `wiki:space:read`, `wiki:space:retrieve` — wiki space listing
- `board:whiteboard:node:create`, `board:whiteboard:node:read` — whiteboard operations
