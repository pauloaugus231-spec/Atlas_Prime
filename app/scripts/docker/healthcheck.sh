#!/usr/bin/env bash
set -euo pipefail

OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://host.docker.internal:11434}"
OLLAMA_TIMEOUT_SECONDS="${OLLAMA_TIMEOUT_SECONDS:-5}"
OPENAI_BASE_URL="${OPENAI_BASE_URL:-https://api.openai.com/v1}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
OPENAI_TIMEOUT_SECONDS="${OPENAI_TIMEOUT_SECONDS:-5}"
LLM_PROVIDER="${LLM_PROVIDER:-}"
if [ -z "$LLM_PROVIDER" ]; then
  if [ -n "$OPENAI_API_KEY" ]; then
    LLM_PROVIDER="openai"
  else
    LLM_PROVIDER="ollama"
  fi
fi
WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"
PLUGINS_DIR="${PLUGINS_DIR:-/plugins}"
LOGS_DIR="${LOGS_DIR:-/logs}"
AUTHORIZED_PROJECTS_DIR="${AUTHORIZED_PROJECTS_DIR:-/authorized-projects}"

check_dir() {
  local dir="$1"
  local mode="$2"

  [ -d "$dir" ] || {
    printf '[healthcheck] missing dir: %s\n' "$dir" >&2
    return 1
  }

  case "$mode" in
    rw)
      [ -w "$dir" ] || {
        printf '[healthcheck] not writable: %s\n' "$dir" >&2
        return 1
      }
      ;;
    ro)
      [ -r "$dir" ] || {
        printf '[healthcheck] not readable: %s\n' "$dir" >&2
        return 1
      }
      ;;
    *)
      printf '[healthcheck] invalid mode for %s: %s\n' "$dir" "$mode" >&2
      return 1
      ;;
  esac
}

check_dir "$WORKSPACE_DIR" rw
check_dir "$PLUGINS_DIR" rw
check_dir "$LOGS_DIR" rw
check_dir "$AUTHORIZED_PROJECTS_DIR" ro

if [ "$LLM_PROVIDER" = "openai" ]; then
  [ -n "$OPENAI_API_KEY" ] || {
    printf '[healthcheck] missing OPENAI_API_KEY\n' >&2
    exit 1
  }

  curl \
    --silent \
    --show-error \
    --fail \
    --max-time "$OPENAI_TIMEOUT_SECONDS" \
    --header "Authorization: Bearer $OPENAI_API_KEY" \
    "${OPENAI_BASE_URL%/}/models" >/dev/null
else
  curl \
    --silent \
    --show-error \
    --fail \
    --max-time "$OLLAMA_TIMEOUT_SECONDS" \
    "${OLLAMA_BASE_URL%/}/api/tags" >/dev/null
fi
