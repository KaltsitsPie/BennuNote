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

# ── Python version check ──

# Find a working Python 3.10+ — validate version, stdlib, AND venv creation
PYTHON_BIN=""
for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
  _path=$(command -v "$candidate" 2>/dev/null) || continue

  # Check version >= 3.10 and stdlib accessible when run directly
  _ok=$("$_path" -c "
import sys
if sys.version_info < (3, 10):
    sys.exit(1)
import encodings, os, tempfile
print('ok')
" 2>/dev/null) || true
  [ "$_ok" = "ok" ] || continue

  # Check that this Python can create a working venv (catches incomplete installs)
  _tmpvenv=$(mktemp -d)
  _venv_ok=false
  if "$_path" -m venv --without-pip "$_tmpvenv" 2>/dev/null && \
     "$_tmpvenv/bin/python" -c "import sys, os, json" 2>/dev/null; then
    _venv_ok=true
  fi
  rm -rf "$_tmpvenv"

  if [ "$_venv_ok" = "true" ]; then
    PYTHON_BIN="$_path"
    break
  else
    echo "Warning: $candidate ($($_path --version 2>&1)) at $_path cannot create working venvs — skipping."
  fi
done

if [ -z "$PYTHON_BIN" ]; then
  echo ""
  echo "ERROR: No working Python 3.10+ found."
  if command -v brew &>/dev/null; then
    echo "Install via: brew install python@3.12"
  elif command -v pyenv &>/dev/null; then
    echo "Install via: pyenv install 3.12 && pyenv global 3.12"
  else
    echo "Install Homebrew first: https://brew.sh"
    echo "Then: brew install python@3.12"
  fi
  echo "Then re-run: ./start-server.sh"
  exit 1
fi

echo "✓ Python: $($PYTHON_BIN --version) ($PYTHON_BIN)"

# ── Python venv ──

# Recreate venv if it was built with Python < 3.10
if [ -d "$VENV_DIR" ]; then
  _venv_ver=$("$VENV_DIR/bin/python" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || echo "0.0")
  _venv_major=${_venv_ver%%.*}
  _venv_minor=${_venv_ver##*.}
  if ! ([ "$_venv_major" -ge 3 ] && [ "$_venv_minor" -ge 10 ]); then
    echo "Existing venv uses Python $_venv_ver (< 3.10) — recreating..."
    rm -rf "$VENV_DIR"
  fi
fi

# Create venv if missing
if [ ! -d "$VENV_DIR" ]; then
  echo "Creating virtual environment with $($PYTHON_BIN --version)..."
  # Try normal venv first (includes pip via ensurepip); fall back to --without-pip
  if ! "$PYTHON_BIN" -m venv "$VENV_DIR" 2>/dev/null; then
    echo "ensurepip unavailable — creating venv without pip first..."
    "$PYTHON_BIN" -m venv --without-pip "$VENV_DIR"
  fi

  # Bootstrap pip if it's not available (--without-pip path)
  if ! "$VENV_DIR/bin/python" -m pip --version &>/dev/null 2>&1; then
    echo "Bootstrapping pip via get-pip.py..."
    if ! curl -sS https://bootstrap.pypa.io/get-pip.py | "$VENV_DIR/bin/python"; then
      rm -rf "$VENV_DIR"
      echo "ERROR: Failed to bootstrap pip."
      exit 1
    fi
  fi
fi

# Install / update dependencies
echo "Checking dependencies..."
"$VENV_DIR/bin/pip" install -q -r "$SERVER_DIR/requirements.txt"

# Start server
echo "Starting BennuNote backend on http://127.0.0.1:2185 ..."
cd "$SERVER_DIR"
exec "$VENV_DIR/bin/uvicorn" main:app --host 127.0.0.1 --port 2185 --reload
