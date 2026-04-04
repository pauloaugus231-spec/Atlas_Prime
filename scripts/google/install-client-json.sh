#!/usr/bin/env bash
set -euo pipefail

SOURCE_JSON="${1:-}"
TARGET_JSON="/Users/user/Agente_Workspace/.agent-state/google-oauth-client.json"

if [ -z "$SOURCE_JSON" ]; then
  printf 'Uso: %s /caminho/para/client_secret.json\n' "$0" >&2
  exit 1
fi

if [ ! -f "$SOURCE_JSON" ]; then
  printf 'Arquivo nao encontrado: %s\n' "$SOURCE_JSON" >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET_JSON")"
cp "$SOURCE_JSON" "$TARGET_JSON"
printf 'Credencial copiada para: %s\n' "$TARGET_JSON"
printf 'Proximo passo: ajustar GOOGLE_ENABLED=true no .env e rodar ./scripts/google/run-auth.sh\n'
