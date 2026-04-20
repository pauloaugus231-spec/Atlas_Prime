#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${ATLAS_APP_DIR:-/srv/atlas/app}"
COMPOSE_FILE="${ATLAS_COMPOSE_FILE:-docker-compose.prod.yml}"
SERVICE_NAME="${ATLAS_SERVICE_NAME:-agent}"
CONTAINER_NAME="${ATLAS_CONTAINER_NAME:-atlas-core}"
HEALTH_TIMEOUT_SECONDS="${ATLAS_HEALTH_TIMEOUT_SECONDS:-180}"
HEALTH_POLL_SECONDS="${ATLAS_HEALTH_POLL_SECONDS:-5}"
LOCK_FILE="${ATLAS_DEPLOY_LOCK_FILE:-/tmp/atlas-deploy.lock}"
STATE_DIR="${ATLAS_STATE_DIR:-/srv/atlas/state}"
WORKSPACE_STATE_DIR="${ATLAS_WORKSPACE_STATE_DIR:-$STATE_DIR/workspace}"
BACKUP_DIR="${ATLAS_BACKUP_DIR:-/srv/atlas/backups}"
LOGS_DIR="${ATLAS_LOGS_DIR:-/srv/atlas/logs}"
COMPOSE_PROFILES_VALUE="${ATLAS_COMPOSE_PROFILES:-${COMPOSE_PROFILES:-}}"

log() {
  printf '[deploy-ec2] %s\n' "$*"
}

fail() {
  printf '[deploy-ec2] ERROR: %s\n' "$*" >&2
  exit 1
}

docker_compose() {
  if [[ -n "${COMPOSE_PROFILES:-}" ]]; then
    sudo env "COMPOSE_PROFILES=$COMPOSE_PROFILES" docker compose -f "$COMPOSE_FILE" "$@"
    return
  fi
  sudo docker compose -f "$COMPOSE_FILE" "$@"
}

command -v sudo >/dev/null 2>&1 || fail "sudo nao encontrado"
command -v docker >/dev/null 2>&1 || fail "docker nao encontrado"
command -v flock >/dev/null 2>&1 || fail "flock nao encontrado"

cd "$APP_DIR"

[[ -f "$COMPOSE_FILE" ]] || fail "compose nao encontrado em $APP_DIR/$COMPOSE_FILE"
[[ -f ".env.production" ]] || fail ".env.production nao encontrado em $APP_DIR"

read_env_file_value() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" ".env.production" 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

ensure_env_default() {
  local key="$1"
  local value="$2"
  if ! grep -Eq "^${key}=" ".env.production"; then
    printf '\n%s=%s\n' "$key" "$value" >> ".env.production"
    log "Variavel ${key} adicionada em .env.production com valor padrao"
  fi
}

replace_env_value_if_exact_match() {
  local key="$1"
  local expected="$2"
  local replacement="$3"
  local current
  current="$(read_env_file_value "$key")"
  if [[ "$current" != "$expected" ]]; then
    return
  fi

  python3 - "$key" "$replacement" <<'PY'
import sys
from pathlib import Path

key = sys.argv[1]
replacement = sys.argv[2]
path = Path(".env.production")
lines = path.read_text(encoding="utf-8").splitlines()
out = []
updated = False

for line in lines:
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in line:
        out.append(line)
        continue
    existing_key, _ = line.split("=", 1)
    if existing_key == key:
        out.append(f"{key}={replacement}")
        updated = True
    else:
        out.append(line)

if updated:
    path.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")
PY
  log "Variavel ${key} atualizada de ${expected} para ${replacement}"
}

prepare_cloud_dirs() {
  sudo mkdir -p \
    "$WORKSPACE_STATE_DIR" \
    "$STATE_DIR/plugins" \
    "$STATE_DIR/authorized-projects" \
    "$LOGS_DIR" \
    "$BACKUP_DIR"
  sudo chown -R 10001:10001 "$WORKSPACE_STATE_DIR" "$STATE_DIR/plugins" "$LOGS_DIR"
  sudo chmod 700 "$BACKUP_DIR"
}

backup_agent_state() {
  local source_dir="$WORKSPACE_STATE_DIR/.agent-state"
  if [[ ! -d "$source_dir" ]]; then
    log "Backup ignorado: $source_dir ainda nao existe"
    return
  fi

  local timestamp
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  local target="$BACKUP_DIR/agent-state-$timestamp.tgz"

  sudo tar -C "$WORKSPACE_STATE_DIR" -czf "$target" .agent-state
  sudo chmod 600 "$target"
  log "Backup local do agent-state criado em $target"

  sudo find "$BACKUP_DIR" -maxdepth 1 -type f -name 'agent-state-*.tgz' -mtime +14 -delete
}

profile_enabled() {
  local profile="$1"
  case ",$COMPOSE_PROFILES_VALUE," in
    *,"$profile",*) return 0 ;;
    *) return 1 ;;
  esac
}

stop_inactive_profile_containers() {
  if ! profile_enabled "ollama"; then
    log "Parando container opcional do Ollama fora do profile ativo"
    sudo docker stop atlas-ollama >/dev/null 2>&1 || true
  fi

  if profile_enabled "whatsapp"; then
    return
  fi

  log "Parando containers opcionais de WhatsApp/Evolution fora do profile ativo"
  sudo docker stop \
    atlas-whatsapp-sidecar \
    atlas-evolution-api \
    atlas-evolution-postgres \
    atlas-evolution-redis >/dev/null 2>&1 || true
}

pull_ollama_model_if_enabled() {
  if ! profile_enabled "ollama"; then
    return
  fi

  local pull_on_deploy
  pull_on_deploy="$(read_env_file_value "OLLAMA_PULL_ON_DEPLOY")"
  if [[ "$pull_on_deploy" == "false" || "$pull_on_deploy" == "0" ]]; then
    log "Pull do modelo Ollama ignorado por OLLAMA_PULL_ON_DEPLOY=$pull_on_deploy"
    return
  fi

  local model
  model="$(read_env_file_value "OLLAMA_MODEL")"
  model="${model:-qwen3:1.7b}"
  log "Garantindo modelo Ollama local: $model"
  for _ in $(seq 1 30); do
    if docker_compose exec -T ollama ollama list >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  docker_compose exec -T ollama ollama pull "$model"
}

if grep -Eq '^OPENAI_API_KEY=.+$' ".env.production"; then
  ensure_env_default "LLM_SMART_ROUTING_ENABLED" "true"
  ensure_env_default "LLM_COMPLEXITY_PROMPT_CHARS" "180"
  ensure_env_default "LLM_TOOL_COMPLEXITY_PROMPT_CHARS" "80"
  ensure_env_default "LLM_USE_ADVANCED_FOR_TOOLS" "true"
  ensure_env_default "OPENAI_ADVANCED_MODEL" "gpt-5.4"
  ensure_env_default "OPENAI_ADVANCED_TIMEOUT_SECONDS" "90"
  replace_env_value_if_exact_match "OPENAI_MODEL" "gpt-5-mini" "gpt-5.4-mini"
  ensure_env_default "VOICE_ENABLED" "true"
  ensure_env_default "VOICE_STT_PROVIDER" "openai"
  ensure_env_default "VOICE_MAX_AUDIO_SECONDS" "90"
  ensure_env_default "VOICE_MAX_AUDIO_BYTES" "15728640"
  ensure_env_default "VOICE_TEMP_DIR" "/workspace/.agent-state/voice-temp"
  ensure_env_default "VOICE_STT_TIMEOUT_MS" "120000"
  ensure_env_default "VOICE_OPENAI_MODEL" "gpt-4o-mini-transcribe"
fi

if [[ -z "$COMPOSE_PROFILES_VALUE" ]]; then
  COMPOSE_PROFILES_VALUE="$(read_env_file_value "ATLAS_COMPOSE_PROFILES")"
fi
if [[ -z "$COMPOSE_PROFILES_VALUE" ]]; then
  COMPOSE_PROFILES_VALUE="$(read_env_file_value "COMPOSE_PROFILES")"
fi
if [[ -z "$COMPOSE_PROFILES_VALUE" ]]; then
  whatsapp_enabled="$(read_env_file_value "WHATSAPP_ENABLED")"
  whatsapp_sidecar_enabled="$(read_env_file_value "WHATSAPP_SIDECAR_ENABLED")"
  if [[ "$whatsapp_enabled" == "true" && "$whatsapp_sidecar_enabled" == "true" ]]; then
    COMPOSE_PROFILES_VALUE="whatsapp"
  fi
fi

exec 9>"$LOCK_FILE"
if ! flock -w 300 9; then
  fail "timeout aguardando lock de deploy em $LOCK_FILE"
fi

prepare_cloud_dirs
backup_agent_state

if [[ -n "$COMPOSE_PROFILES_VALUE" ]]; then
  export COMPOSE_PROFILES="$COMPOSE_PROFILES_VALUE"
  log "Docker Compose profiles ativos: $COMPOSE_PROFILES"
else
  unset COMPOSE_PROFILES
  log "Docker Compose profiles ativos: nenhum (core cloud-only)"
fi

log "Subindo stack de producao com lock exclusivo"
docker_compose up -d --build --remove-orphans
pull_ollama_model_if_enabled
stop_inactive_profile_containers

deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
last_status="unknown"

while (( SECONDS < deadline )); do
  status="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER_NAME" 2>/dev/null || true)"
  last_status="${status:-missing}"

  case "$last_status" in
    healthy|running)
      log "Container $CONTAINER_NAME pronto com status=$last_status"
      docker_compose ps
      exit 0
      ;;
    unhealthy)
      log "Container $CONTAINER_NAME ainda unhealthy; aguardando ate o timeout"
      docker_compose logs --tail=60 "$SERVICE_NAME" || true
      ;;
    exited|dead)
      log "Container $CONTAINER_NAME falhou com status=$last_status"
      docker_compose logs --tail=120 "$SERVICE_NAME" || true
      exit 1
      ;;
  esac

  sleep "$HEALTH_POLL_SECONDS"
done

log "Timeout aguardando healthcheck do container $CONTAINER_NAME (ultimo status=$last_status)"
docker_compose ps || true
docker_compose logs --tail=120 "$SERVICE_NAME" || true
exit 1
