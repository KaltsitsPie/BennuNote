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

# Start server
echo "Starting BennuNote backend on http://127.0.0.1:2185 ..."
cd "$SERVER_DIR"
exec "$VENV_DIR/bin/uvicorn" main:app --host 127.0.0.1 --port 2185 --reload
