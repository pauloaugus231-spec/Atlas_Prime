#!/usr/bin/env bash
set -euo pipefail

SOURCE_JSON="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${ATLAS_ROOT_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
ENV_FILE="${ATLAS_ENV_FILE:-$ROOT_DIR/.env}"
if [ ! -f "$ENV_FILE" ] && [ -f "$ROOT_DIR/.env.production" ]; then
  ENV_FILE="$ROOT_DIR/.env.production"
fi

read_env_value() {
  local key="$1"
  local value
  value="$(awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); value = $0 } END { print value }' "$ENV_FILE" 2>/dev/null)"
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
printf 'Proximo passo: ajustar GOOGLE_ENABLED=true no env usado e rodar ./scripts/google/run-auth.sh\n'
