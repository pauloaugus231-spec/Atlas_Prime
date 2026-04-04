#!/usr/bin/env bash
set -euo pipefail

AUTHORIZED_ROOT="${1:-/Users/user/Agente_Autorizados}"

mkdir -p \
  "$AUTHORIZED_ROOT/Dev" \
  "$AUTHORIZED_ROOT/Social" \
  "$AUTHORIZED_ROOT/Conteudo" \
  "$AUTHORIZED_ROOT/Financeiro" \
  "$AUTHORIZED_ROOT/Admin"

link_if_exists() {
  local source_path="$1"
  local target_path="$2"
  if [ -e "$source_path" ]; then
    ln -sfn "$source_path" "$target_path"
    printf 'Linked: %s -> %s\n' "$target_path" "$source_path"
  else
    printf 'Skipped missing path: %s\n' "$source_path"
  fi
}

# Dev
link_if_exists "/Users/user/Documents/agente_ai" "$AUTHORIZED_ROOT/Dev/agente_ai"
link_if_exists "/Users/user/Documents/Abordagem" "$AUTHORIZED_ROOT/Dev/Abordagem"
link_if_exists "/Users/user/Documents/App Resumo" "$AUTHORIZED_ROOT/Dev/App_Resumo"
link_if_exists "/Users/user/Documents/Psicologa" "$AUTHORIZED_ROOT/Dev/Psicologa"
link_if_exists "/Users/user/Documents/beautymap" "$AUTHORIZED_ROOT/Dev/beautymap"
link_if_exists "/Users/user/Documents/brasil-swingers-frontend" "$AUTHORIZED_ROOT/Dev/brasil_swingers_frontend"
link_if_exists "/Users/user/Documents/dias-da-cruz" "$AUTHORIZED_ROOT/Dev/dias_da_cruz"
link_if_exists "/Users/user/Documents/memorando_digital" "$AUTHORIZED_ROOT/Dev/memorando_digital"
link_if_exists "/Users/user/Documents/solucao_barber" "$AUTHORIZED_ROOT/Dev/solucao_barber"
link_if_exists "/Users/user/Documents/solucao_estetica" "$AUTHORIZED_ROOT/Dev/solucao_estetica"

# Social
link_if_exists "/Users/user/Documents/SEAS PAEFI" "$AUTHORIZED_ROOT/Social/SEAS_PAEFI"
link_if_exists "/Users/user/Documents/App Sistematicas" "$AUTHORIZED_ROOT/Social/App_Sistematicas"

# Content
link_if_exists "/Users/user/Documents/Altiva" "$AUTHORIZED_ROOT/Conteudo/Altiva_assets"
link_if_exists "/Users/user/Documents/Psicologa/docs" "$AUTHORIZED_ROOT/Conteudo/Psicologa_docs"

# Conservative defaults for sensitive domains
mkdir -p "$AUTHORIZED_ROOT/Financeiro/Receitas" "$AUTHORIZED_ROOT/Financeiro/Relatorios"
mkdir -p "$AUTHORIZED_ROOT/Admin/Operacional" "$AUTHORIZED_ROOT/Admin/Documentos"

cat > "$AUTHORIZED_ROOT/MAPEAMENTO.md" <<MAP
# Mapeamento Atual das Roots Autorizadas

## Dev
- /Users/user/Documents/agente_ai
- /Users/user/Documents/Abordagem
- /Users/user/Documents/App Resumo
- /Users/user/Documents/Psicologa
- /Users/user/Documents/beautymap
- /Users/user/Documents/brasil-swingers-frontend
- /Users/user/Documents/dias-da-cruz
- /Users/user/Documents/memorando_digital
- /Users/user/Documents/solucao_barber
- /Users/user/Documents/solucao_estetica

## Social
- /Users/user/Documents/SEAS PAEFI
- /Users/user/Documents/App Sistematicas

## Conteudo
- /Users/user/Documents/Altiva
- /Users/user/Documents/Psicologa/docs

## Financeiro
- raiz dedicada do agente, ainda sem symlink para dados externos por seguranca

## Admin
- raiz dedicada do agente, ainda sem symlink para dados externos por seguranca
MAP

printf 'Mapping manifest written to: %s/MAPEAMENTO.md\n' "$AUTHORIZED_ROOT"
