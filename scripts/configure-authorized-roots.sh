#!/usr/bin/env bash
set -euo pipefail

HOST_HOME="${ATLAS_HOST_HOME:-$HOME}"
DOCUMENTS_DIR="${ATLAS_DOCUMENTS_DIR:-$HOST_HOME/Documents}"
AUTHORIZED_ROOT="${1:-${ATLAS_AUTHORIZED_ROOT:-$HOST_HOME/Agente_Autorizados}}"

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
link_if_exists "$DOCUMENTS_DIR/agente_ai" "$AUTHORIZED_ROOT/Dev/agente_ai"
link_if_exists "$DOCUMENTS_DIR/Abordagem" "$AUTHORIZED_ROOT/Dev/Abordagem"
link_if_exists "$DOCUMENTS_DIR/App Resumo" "$AUTHORIZED_ROOT/Dev/App_Resumo"
link_if_exists "$DOCUMENTS_DIR/Psicologa" "$AUTHORIZED_ROOT/Dev/Psicologa"
link_if_exists "$DOCUMENTS_DIR/beautymap" "$AUTHORIZED_ROOT/Dev/beautymap"
link_if_exists "$DOCUMENTS_DIR/brasil-swingers-frontend" "$AUTHORIZED_ROOT/Dev/brasil_swingers_frontend"
link_if_exists "$DOCUMENTS_DIR/dias-da-cruz" "$AUTHORIZED_ROOT/Dev/dias_da_cruz"
link_if_exists "$DOCUMENTS_DIR/memorando_digital" "$AUTHORIZED_ROOT/Dev/memorando_digital"
link_if_exists "$DOCUMENTS_DIR/solucao_barber" "$AUTHORIZED_ROOT/Dev/solucao_barber"
link_if_exists "$DOCUMENTS_DIR/solucao_estetica" "$AUTHORIZED_ROOT/Dev/solucao_estetica"

# Social
link_if_exists "$DOCUMENTS_DIR/SEAS PAEFI" "$AUTHORIZED_ROOT/Social/SEAS_PAEFI"
link_if_exists "$DOCUMENTS_DIR/App Sistematicas" "$AUTHORIZED_ROOT/Social/App_Sistematicas"

# Content
link_if_exists "$DOCUMENTS_DIR/Altiva" "$AUTHORIZED_ROOT/Conteudo/Altiva_assets"
link_if_exists "$DOCUMENTS_DIR/Psicologa/docs" "$AUTHORIZED_ROOT/Conteudo/Psicologa_docs"

# Conservative defaults for sensitive domains
mkdir -p "$AUTHORIZED_ROOT/Financeiro/Receitas" "$AUTHORIZED_ROOT/Financeiro/Relatorios"
mkdir -p "$AUTHORIZED_ROOT/Admin/Operacional" "$AUTHORIZED_ROOT/Admin/Documentos"

cat > "$AUTHORIZED_ROOT/MAPEAMENTO.md" <<MAP
# Mapeamento Atual das Roots Autorizadas

## Dev
- $DOCUMENTS_DIR/agente_ai
- $DOCUMENTS_DIR/Abordagem
- $DOCUMENTS_DIR/App Resumo
- $DOCUMENTS_DIR/Psicologa
- $DOCUMENTS_DIR/beautymap
- $DOCUMENTS_DIR/brasil-swingers-frontend
- $DOCUMENTS_DIR/dias-da-cruz
- $DOCUMENTS_DIR/memorando_digital
- $DOCUMENTS_DIR/solucao_barber
- $DOCUMENTS_DIR/solucao_estetica

## Social
- $DOCUMENTS_DIR/SEAS PAEFI
- $DOCUMENTS_DIR/App Sistematicas

## Conteudo
- $DOCUMENTS_DIR/Altiva
- $DOCUMENTS_DIR/Psicologa/docs

## Financeiro
- raiz dedicada do agente, ainda sem symlink para dados externos por seguranca

## Admin
- raiz dedicada do agente, ainda sem symlink para dados externos por seguranca
MAP

printf 'Mapping manifest written to: %s/MAPEAMENTO.md\n' "$AUTHORIZED_ROOT"
