#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export EMBER_MODEL_URL="http://127.0.0.1:11434/api/chat"
export EMBER_MODEL_NAME="${EMBER_MODEL_NAME:-qwen3.5:2b}"
exec python3 "$SCRIPT_DIR/ember_globe_server.py"
