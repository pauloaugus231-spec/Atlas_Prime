#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${ATLAS_APP_DIR:-/srv/atlas/app}"
COMPOSE_FILE="${ATLAS_COMPOSE_FILE:-docker-compose.prod.yml}"
SERVICE_NAME="${ATLAS_SERVICE_NAME:-agent}"
CONTAINER_NAME="${ATLAS_CONTAINER_NAME:-atlas-core}"
HEALTH_TIMEOUT_SECONDS="${ATLAS_HEALTH_TIMEOUT_SECONDS:-180}"
HEALTH_POLL_SECONDS="${ATLAS_HEALTH_POLL_SECONDS:-5}"
EVOLUTION_DIR="${ATLAS_EVOLUTION_DIR:-/srv/atlas/vendor/evolution-api}"
EVOLUTION_REPO_URL="${EVOLUTION_REPO_URL:-https://github.com/EvolutionAPI/evolution-api.git}"
EVOLUTION_REPO_REF="${EVOLUTION_REPO_REF:-2.3.7}"

log() {
  printf '[deploy-ec2] %s\n' "$*"
}

fail() {
  printf '[deploy-ec2] ERROR: %s\n' "$*" >&2
  exit 1
}

command -v sudo >/dev/null 2>&1 || fail "sudo nao encontrado"
command -v docker >/dev/null 2>&1 || fail "docker nao encontrado"
command -v git >/dev/null 2>&1 || fail "git nao encontrado"

cd "$APP_DIR"

[[ -f "$COMPOSE_FILE" ]] || fail "compose nao encontrado em $APP_DIR/$COMPOSE_FILE"
[[ -f ".env.production" ]] || fail ".env.production nao encontrado em $APP_DIR"

log "Preparando vendor do Evolution API em $EVOLUTION_DIR"
sudo mkdir -p "$(dirname "$EVOLUTION_DIR")"
sudo chown "$(id -un):$(id -gn)" "$(dirname "$EVOLUTION_DIR")"

if [[ ! -d "$EVOLUTION_DIR/.git" ]]; then
  rm -rf "$EVOLUTION_DIR"
  git clone --depth 1 --branch "$EVOLUTION_REPO_REF" "$EVOLUTION_REPO_URL" "$EVOLUTION_DIR"
else
  git -C "$EVOLUTION_DIR" fetch --depth 1 origin "$EVOLUTION_REPO_REF"
  git -C "$EVOLUTION_DIR" checkout -f FETCH_HEAD
fi

git -C "$EVOLUTION_DIR" clean -fdx
log "Evolution API pronto em ref=$(git -C "$EVOLUTION_DIR" rev-parse --short HEAD)"

log "Subindo stack de producao com rebuild controlado"
sudo docker compose -f "$COMPOSE_FILE" up -d --build --force-recreate

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
