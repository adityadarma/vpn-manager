#!/bin/bash
# Updates a Manager installation without replacing its .env secrets or data volume.
set -euo pipefail

INSTALL_DIR=/opt/vpn-manager
REPO_URL=https://raw.githubusercontent.com/adityadarma/vpn-manager/main

[ "${EUID}" -eq 0 ] || { echo "Must run as root" >&2; exit 1; }
[ -f "$INSTALL_DIR/.env" ] || { echo "No Manager configuration at $INSTALL_DIR/.env" >&2; exit 1; }

CHANNEL="${CHANNEL:-}"
if [ -z "$CHANNEL" ] && grep -q '^IMAGE_VERSION=beta$' "$INSTALL_DIR/.env"; then
    CHANNEL=beta
fi

if [ -n "$CHANNEL" ]; then
    exec env CHANNEL="$CHANNEL" bash <(curl -fsSL "$REPO_URL/scripts/install-manager.sh")
fi

exec bash <(curl -fsSL "$REPO_URL/scripts/install-manager.sh")
