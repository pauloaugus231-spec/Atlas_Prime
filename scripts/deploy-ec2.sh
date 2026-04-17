#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${ATLAS_APP_DIR:-/srv/atlas/app}"
COMPOSE_FILE="${ATLAS_COMPOSE_FILE:-docker-compose.prod.yml}"
SERVICE_NAME="${ATLAS_SERVICE_NAME:-agent}"
CONTAINER_NAME="${ATLAS_CONTAINER_NAME:-atlas-core}"
HEALTH_TIMEOUT_SECONDS="${ATLAS_HEALTH_TIMEOUT_SECONDS:-180}"
HEALTH_POLL_SECONDS="${ATLAS_HEALTH_POLL_SECONDS:-5}"
LOCK_FILE="${ATLAS_DEPLOY_LOCK_FILE:-/tmp/atlas-deploy.lock}"

log() {
  printf '[deploy-ec2] %s\n' "$*"
}

fail() {
  printf '[deploy-ec2] ERROR: %s\n' "$*" >&2
  exit 1
}

command -v sudo >/dev/null 2>&1 || fail "sudo nao encontrado"
command -v docker >/dev/null 2>&1 || fail "docker nao encontrado"
command -v flock >/dev/null 2>&1 || fail "flock nao encontrado"

cd "$APP_DIR"

[[ -f "$COMPOSE_FILE" ]] || fail "compose nao encontrado em $APP_DIR/$COMPOSE_FILE"
[[ -f ".env.production" ]] || fail ".env.production nao encontrado em $APP_DIR"

ensure_env_default() {
  local key="$1"
  local value="$2"
  if ! grep -Eq "^${key}=" ".env.production"; then
    printf '\n%s=%s\n' "$key" "$value" >> ".env.production"
    log "Variavel ${key} adicionada em .env.production com valor padrao"
  fi
}

if grep -Eq '^OPENAI_API_KEY=.+$' ".env.production"; then
  ensure_env_default "VOICE_ENABLED" "true"
  ensure_env_default "VOICE_STT_PROVIDER" "openai"
  ensure_env_default "VOICE_MAX_AUDIO_SECONDS" "90"
  ensure_env_default "VOICE_MAX_AUDIO_BYTES" "15728640"
  ensure_env_default "VOICE_TEMP_DIR" "/workspace/.agent-state/voice-temp"
  ensure_env_default "VOICE_STT_TIMEOUT_MS" "120000"
  ensure_env_default "VOICE_OPENAI_MODEL" "gpt-4o-mini-transcribe"
fi

exec 9>"$LOCK_FILE"
if ! flock -w 300 9; then
  fail "timeout aguardando lock de deploy em $LOCK_FILE"
fi

log "Subindo stack de producao com lock exclusivo"
sudo docker compose -f "$COMPOSE_FILE" up -d --build --remove-orphans

deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
last_status="unknown"

while (( SECONDS < deadline )); do
  status="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER_NAME" 2>/dev/null || true)"
  last_status="${status:-missing}"

  case "$last_status" in
    healthy|running)
      log "Container $CONTAINER_NAME pronto com status=$last_status"
      sudo docker compose -f "$COMPOSE_FILE" ps
      exit 0
      ;;
    unhealthy|exited|dead)
      log "Container $CONTAINER_NAME falhou com status=$last_status"
      sudo docker compose -f "$COMPOSE_FILE" logs --tail=120 "$SERVICE_NAME" || true
      exit 1
      ;;
  esac

  sleep "$HEALTH_POLL_SECONDS"
done

log "Timeout aguardando healthcheck do container $CONTAINER_NAME (ultimo status=$last_status)"
sudo docker compose -f "$COMPOSE_FILE" ps || true
sudo docker compose -f "$COMPOSE_FILE" logs --tail=120 "$SERVICE_NAME" || true
exit 1
