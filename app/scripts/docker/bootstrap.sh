#!/usr/bin/env bash
set -euo pipefail

APP_HOME="${APP_HOME:-/app}"
WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"
PLUGINS_DIR="${PLUGINS_DIR:-/plugins}"
LOGS_DIR="${LOGS_DIR:-/logs}"
AUTHORIZED_PROJECTS_DIR="${AUTHORIZED_PROJECTS_DIR:-/authorized-projects}"
BOOTSTRAP_STRICT_OLLAMA="${BOOTSTRAP_STRICT_OLLAMA:-true}"
LLM_PROVIDER="${LLM_PROVIDER:-}"
if [ -z "$LLM_PROVIDER" ]; then
  if [ -n "${OPENAI_API_KEY:-}" ]; then
    LLM_PROVIDER="openai"
  else
    LLM_PROVIDER="ollama"
  fi
fi

log() {
  printf '[bootstrap] %s\n' "$*"
}

fail() {
  printf '[bootstrap] ERROR: %s\n' "$*" >&2
  exit 1
}

ensure_dir() {
  local dir="$1"
  local mode="$2"

  if [ ! -d "$dir" ]; then
    fail "Directory not mounted or missing: $dir"
  fi

  case "$mode" in
    rw)
      if [ ! -w "$dir" ]; then
        fail "Directory is not writable: $dir"
      fi
      ;;
    ro)
      if [ ! -r "$dir" ]; then
        fail "Directory is not readable: $dir"
      fi
      ;;
    *)
      fail "Unknown directory mode: $mode"
      ;;
  esac
}

log "Validating mounted directories"
ensure_dir "$APP_HOME" ro
ensure_dir "$WORKSPACE_DIR" rw
ensure_dir "$PLUGINS_DIR" rw
ensure_dir "$LOGS_DIR" rw
ensure_dir "$AUTHORIZED_PROJECTS_DIR" ro

if [ "$LLM_PROVIDER" = "openai" ]; then
  log "Validating OpenAI connectivity"
else
  log "Validating Ollama connectivity"
fi

if ! "$APP_HOME/scripts/docker/healthcheck.sh" >/dev/null; then
  if [ "$LLM_PROVIDER" = "ollama" ] && [ "$BOOTSTRAP_STRICT_OLLAMA" != "true" ]; then
    log "Ollama check failed, but BOOTSTRAP_STRICT_OLLAMA=false so continuing"
  else
    if [ "$LLM_PROVIDER" = "openai" ]; then
      fail "Unable to validate OpenAI at ${OPENAI_BASE_URL:-https://api.openai.com/v1}"
    fi
    fail "Unable to reach Ollama at ${OLLAMA_BASE_URL:-http://host.docker.internal:11434}"
  fi
fi

log "Container ready"
exec "$@"
