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
