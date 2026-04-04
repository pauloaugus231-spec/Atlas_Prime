#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  printf 'Missing env file: %s\n' "$ENV_FILE" >&2
  exit 1
fi

read_env_value() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  if [ -z "$line" ]; then
    return 1
  fi
  printf '%s' "${line#*=}"
}

required_vars=(
  HOST_AGENT_WORKSPACE
  HOST_AGENT_PLUGINS
  HOST_AGENT_LOGS
  HOST_AUTHORIZED_PROJECTS_DIR
)

for var_name in "${required_vars[@]}"; do
  value="$(read_env_value "$var_name" || true)"
  if [ -z "$value" ]; then
    printf 'Missing required variable in %s: %s\n' "$ENV_FILE" "$var_name" >&2
    exit 1
  fi
  mkdir -p "$value"
  printf 'Prepared: %s\n' "$value"
done

authorized_root="$(read_env_value "HOST_AUTHORIZED_PROJECTS_DIR" || true)"
if [ -z "$authorized_root" ]; then
  printf 'Missing required variable in %s: HOST_AUTHORIZED_PROJECTS_DIR\n' "$ENV_FILE" >&2
  exit 1
fi

for domain_dir in Dev Social Conteudo Financeiro Admin; do
  mkdir -p "${authorized_root}/${domain_dir}"
  printf 'Prepared domain root: %s\n' "${authorized_root}/${domain_dir}"
done
