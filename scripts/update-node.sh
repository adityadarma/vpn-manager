#!/bin/bash
# Updates an existing native or Docker Agent without replacing its .env file.
set -euo pipefail

INSTALL_DIR=/opt/vpn-agent
REPO_URL=https://raw.githubusercontent.com/adityadarma/vpn-manager/main

[ "${EUID}" -eq 0 ] || { echo "Must run as root" >&2; exit 1; }
[ -f "$INSTALL_DIR/.env" ] || { echo "No Agent configuration at $INSTALL_DIR/.env" >&2; exit 1; }

if [ -f /etc/systemd/system/vpn-agent.service ]; then
    exec env AGENT_INSTALL_MODE=native UPDATE_ONLY=true bash <(curl -fsSL "$REPO_URL/scripts/install-agent.sh")
fi

if [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
    exec env AGENT_INSTALL_MODE=docker UPDATE_ONLY=true bash <(curl -fsSL "$REPO_URL/scripts/install-agent.sh")
fi

echo "Unable to determine Agent installation mode" >&2
exit 1
