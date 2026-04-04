#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/Users/user/Documents/agente_ai"
ENV_FILE="$ROOT_DIR/.env"

if ! grep -q '^GOOGLE_ENABLED=true$' "$ENV_FILE"; then
  perl -0pi -e 's/^GOOGLE_ENABLED=.*/GOOGLE_ENABLED=true/m' "$ENV_FILE"
  printf 'GOOGLE_ENABLED=true aplicado em %s\n' "$ENV_FILE"
fi

cd "$ROOT_DIR"
docker compose up -d --force-recreate agent
printf 'Abra o navegador quando a URL aparecer abaixo.\n\n'
docker compose exec agent npm run google:auth
