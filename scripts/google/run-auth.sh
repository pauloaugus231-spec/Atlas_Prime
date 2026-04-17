#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${ATLAS_ROOT_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
ENV_FILE="${ATLAS_ENV_FILE:-$ROOT_DIR/.env}"
if [ ! -f "$ENV_FILE" ] && [ -f "$ROOT_DIR/.env.production" ]; then
  ENV_FILE="$ROOT_DIR/.env.production"
fi
COMPOSE_FILE="${ATLAS_COMPOSE_FILE:-docker-compose.yml}"
if [[ "$ENV_FILE" == *".env.production" ]]; then
  COMPOSE_FILE="${ATLAS_COMPOSE_FILE:-docker-compose.prod.yml}"
fi
SERVICE_NAME="${ATLAS_SERVICE_NAME:-agent}"

if ! grep -q '^GOOGLE_ENABLED=true$' "$ENV_FILE"; then
  perl -0pi -e 's/^GOOGLE_ENABLED=.*/GOOGLE_ENABLED=true/m' "$ENV_FILE"
  printf 'GOOGLE_ENABLED=true aplicado em %s\n' "$ENV_FILE"
fi

cd "$ROOT_DIR"
docker compose -f "$COMPOSE_FILE" up -d --force-recreate "$SERVICE_NAME"
printf 'Abra o navegador quando a URL aparecer abaixo.\n\n'
docker compose -f "$COMPOSE_FILE" exec "$SERVICE_NAME" npm run google:auth
