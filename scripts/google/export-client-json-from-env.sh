#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/Users/user/Documents/agente_ai"
ENV_FILE="$ROOT_DIR/.env"
TARGET_JSON="/Users/user/Agente_Workspace/.agent-state/google-oauth-client.json"

if [ ! -f "$ENV_FILE" ]; then
  printf 'Arquivo .env nao encontrado: %s\n' "$ENV_FILE" >&2
  exit 1
fi

client_id="$(perl -ne 'print "$1\n" if /^GOOGLE_CLIENT_ID=(.*)$/' "$ENV_FILE" | tail -n 1)"
client_secret="$(perl -ne 'print "$1\n" if /^GOOGLE_CLIENT_SECRET=(.*)$/' "$ENV_FILE" | tail -n 1)"
redirect_uri="$(perl -ne 'print "$1\n" if /^GOOGLE_REDIRECT_URI=(.*)$/' "$ENV_FILE" | tail -n 1)"

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
