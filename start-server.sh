#!/usr/bin/env bash
# BennuNote Backend — one-click start script
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"
VENV_DIR="$SERVER_DIR/.venv"

# Create venv if missing
if [ ! -d "$VENV_DIR" ]; then
  echo "Creating virtual environment..."
  python3 -m venv "$VENV_DIR"
fi

# Install / update dependencies
echo "Checking dependencies..."
"$VENV_DIR/bin/pip" install -q -r "$SERVER_DIR/requirements.txt"

# Open setup page in browser if config is incomplete
cd "$SERVER_DIR"
if ! "$VENV_DIR/bin/python" -c "from config import is_config_complete; exit(0 if is_config_complete() else 1)" 2>/dev/null; then
  echo "Configuration incomplete — opening setup page..."
  # Delay open so the server has time to start
  (sleep 1 && open "http://127.0.0.1:2185/setup" 2>/dev/null || true) &
fi

# Start server
echo "Starting BennuNote backend on http://127.0.0.1:2185 ..."
echo "Setup page: http://127.0.0.1:2185/setup"
exec "$VENV_DIR/bin/uvicorn" main:app --host 127.0.0.1 --port 2185 --reload
