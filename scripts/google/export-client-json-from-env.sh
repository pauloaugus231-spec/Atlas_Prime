#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${ATLAS_ROOT_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
ENV_FILE="${ATLAS_ENV_FILE:-$ROOT_DIR/.env}"
if [ ! -f "$ENV_FILE" ] && [ -f "$ROOT_DIR/.env.production" ]; then
  ENV_FILE="$ROOT_DIR/.env.production"
fi

read_env_value() {
  local key="$1"
  local value
  value="$(awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); value = $0 } END { print value }' "$ENV_FILE")"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

HOST_WORKSPACE_DIR="${ATLAS_HOST_WORKSPACE_DIR:-$(read_env_value HOST_AGENT_WORKSPACE)}"
if [ -z "$HOST_WORKSPACE_DIR" ]; then
  if [ -d "/srv/atlas/state/workspace" ] || [[ "$ENV_FILE" == *".env.production" ]]; then
    HOST_WORKSPACE_DIR="/srv/atlas/state/workspace"
  else
    HOST_WORKSPACE_DIR="$ROOT_DIR/app/workspace"
  fi
fi
TARGET_JSON="${ATLAS_GOOGLE_CLIENT_JSON:-$HOST_WORKSPACE_DIR/.agent-state/google-oauth-client.json}"

if [ ! -f "$ENV_FILE" ]; then
  printf 'Arquivo .env nao encontrado: %s\n' "$ENV_FILE" >&2
  exit 1
fi

client_id="$(read_env_value GOOGLE_CLIENT_ID)"
client_secret="$(read_env_value GOOGLE_CLIENT_SECRET)"
redirect_uri="$(read_env_value GOOGLE_REDIRECT_URI)"

if [ -z "$client_id" ] || [ -z "$client_secret" ] || [ -z "$redirect_uri" ]; then
  printf 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REDIRECT_URI precisam estar preenchidos no .env.\n' >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET_JSON")"
python3 - "$TARGET_JSON" "$client_id" "$client_secret" "$redirect_uri" <<'PY'
import json
import sys

target, client_id, client_secret, redirect_uri = sys.argv[1:]
payload = {
    "installed": {
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uris": [redirect_uri],
        "auth_uri": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
    }
}
with open(target, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
PY

printf 'Credencial OAuth escrita em: %s\n' "$TARGET_JSON"
