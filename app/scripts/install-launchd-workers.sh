#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "$APP_DIR/.." && pwd)"
LOGS_DIR="${HOST_AGENT_LOGS:-${LOGS_DIR:-$HOME/Agente_Logs}}"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
mkdir -p "$LOGS_DIR" "$LAUNCH_AGENTS_DIR"

install_plist() {
  local label="$1"
  local target_script="$2"
  local plist_path="${LAUNCH_AGENTS_DIR}/${label}.plist"

  cat >"$plist_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/bin/env</string>
      <string>ENV_FILE=${ROOT_DIR}/.env</string>
      <string>HOME=${HOME}</string>
      <string>PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
      <string>node</string>
      <string>${APP_DIR}/node_modules/tsx/dist/cli.mjs</string>
      <string>${APP_DIR}/${target_script}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${APP_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>NODE_ENV</key>
      <string>development</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOGS_DIR}/${label}.out.log</string>
    <key>StandardErrorPath</key>
    <string>${LOGS_DIR}/${label}.err.log</string>
  </dict>
</plist>
PLIST

  launchctl bootout "gui/$(id -u)" "$plist_path" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$plist_path"
  launchctl kickstart -k "gui/$(id -u)/${label}"
  echo "installed ${label}: ${plist_path}"
}

install_plist "com.atlas.mac-worker" "scripts/mac-worker.ts"
install_plist "com.atlas.whatsapp-sidecar" "scripts/whatsapp-sidecar.ts"
