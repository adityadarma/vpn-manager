#!/bin/bash
# ============================================================
# VPN Manager - Uninstaller
# ============================================================
# Removes OpenVPN, WireGuard + Agent completely
#
# Usage:
#   sudo bash scripts/uninstall-node.sh
# ============================================================

set -e

R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; NC='\033[0m'
err() { echo -e "${R}✗ $1${NC}"; }
ok() { echo -e "${G}✓ $1${NC}"; }
warn() { echo -e "${Y}⚠ $1${NC}"; }

notify_manager_node_deleted() {
    local env_file="/opt/vpn-agent/.env"

    if [ ! -f "$env_file" ]; then
        warn "Agent .env not found, skipping manager node deletion notification"
        return 0
    fi

    local manager_url node_id secret_token
    manager_url=$(grep -e "^AGENT_MANAGER_URL=" "$env_file" | tail -n1 | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
    node_id=$(grep -e "^AGENT_NODE_ID=" "$env_file" | tail -n1 | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
    secret_token=$(grep -e "^AGENT_SECRET_TOKEN=" "$env_file" | tail -n1 | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)

    if [ -z "$manager_url" ] || [ -z "$secret_token" ]; then
        warn "Manager URL/token not found in .env, skipping manager notification"
        return 0
    fi

    local endpoint="${manager_url%/}/api/v1/nodes/me"
    local response http_code body

    response=$(curl -sS -m 12 -w "\n%{http_code}" -X DELETE "$endpoint" \
        -H "Authorization: Bearer ${secret_token}" \
        -H "Content-Type: application/json" 2>/dev/null || true)

    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$http_code" = "204" ]; then
        ok "Node ${node_id:-unknown} deleted on manager"
        return 0
    fi

    if [ -z "$http_code" ] || [ "$http_code" = "000" ]; then
        warn "Failed to reach manager while deleting node; uninstall will continue locally"
    else
        warn "Manager node deletion returned HTTP ${http_code}; uninstall will continue locally"
        [ -n "$body" ] && warn "Manager response: $body"
    fi

    return 0
}

[ "$EUID" -ne 0 ] && { err "Must run as root"; exit 1; }

echo -e "${Y}============================================================"
echo "  VPN Manager - Uninstaller"
echo "============================================================${NC}"
echo ""
# Attempt to detect VPN engine from agent environment
DETECTED_VPN="Unknown"
if [ -f "/opt/vpn-agent/.env" ]; then
    VPN_TYPE=$(grep -e "^VPN_TYPE=" /opt/vpn-agent/.env | cut -d '=' -f2 | tr -d '"' | tr -d "'" || echo "openvpn")
    [ -z "$VPN_TYPE" ] && VPN_TYPE="openvpn"
    if [ "$VPN_TYPE" = "wireguard" ]; then
        DETECTED_VPN="WireGuard"
    elif [ "$VPN_TYPE" = "openvpn" ]; then
        DETECTED_VPN="OpenVPN"
    fi
else
    VPN_TYPE="both"
    DETECTED_VPN="OpenVPN & WireGuard (Force Purge All)"
fi

warn "Detected Engine: $DETECTED_VPN"
warn "This will remove $DETECTED_VPN, the Agent, and all matching certificates/keys!"
echo ""
read -p "Continue? [y/N]: " confirm
[[ "$confirm" != "y" && "$confirm" != "Y" ]] && { echo "Aborted."; exit 0; }

echo ""
echo "Notifying manager to delete this node..."
notify_manager_node_deleted

# Detect OS
[ -f /etc/os-release ] && . /etc/os-release || OS="unknown"

echo ""
echo "Stopping services..."

# Stop agent
if [ -d "/opt/vpn-agent" ]; then
    cd /opt/vpn-agent
    docker compose down 2>/dev/null || true
    ok "Agent stopped"
fi

if [ "$VPN_TYPE" = "openvpn" ] || [ "$VPN_TYPE" = "both" ]; then
    # Stop OpenVPN
    systemctl stop openvpn-server@server.service 2>/dev/null || true
    systemctl stop openvpn@server.service 2>/dev/null || true
    systemctl disable openvpn-server@server.service 2>/dev/null || true
    systemctl disable openvpn@server.service 2>/dev/null || true
    
    # Stop iptables service (legacy wrapper)
    systemctl stop openvpn-iptables.service 2>/dev/null || true
    systemctl disable openvpn-iptables.service 2>/dev/null || true
    rm -f /etc/systemd/system/openvpn-iptables.service
    
    systemctl daemon-reload
    ok "OpenVPN services stopped"
fi

if [ "$VPN_TYPE" = "wireguard" ] || [ "$VPN_TYPE" = "both" ]; then
    # Stop WireGuard
    systemctl stop wg-quick@wg0 2>/dev/null || true
    systemctl disable wg-quick@wg0 2>/dev/null || true
    ok "WireGuard stopped"
fi



echo ""
echo "Removing packages..."

if [[ "$OS" =~ ^(ubuntu|debian)$ ]]; then
    if [ "$VPN_TYPE" = "openvpn" ] || [ "$VPN_TYPE" = "both" ]; then
        apt-get purge -y openvpn easy-rsa 2>/dev/null || true
    fi
    if [ "$VPN_TYPE" = "wireguard" ] || [ "$VPN_TYPE" = "both" ]; then
        apt-get purge -y wireguard-tools 2>/dev/null || true
    fi
    apt-get autoremove -y 2>/dev/null || true
elif [[ "$OS" =~ ^(centos|rhel|fedora|rocky|almalinux)$ ]]; then
    if [ "$VPN_TYPE" = "openvpn" ] || [ "$VPN_TYPE" = "both" ]; then
        yum remove -y openvpn easy-rsa 2>/dev/null || true
    fi
    if [ "$VPN_TYPE" = "wireguard" ] || [ "$VPN_TYPE" = "both" ]; then
        yum remove -y wireguard-tools 2>/dev/null || true
    fi
fi

ok "Packages removed"

echo ""
echo "Cleaning up files..."

if [ "$VPN_TYPE" = "openvpn" ] || [ "$VPN_TYPE" = "both" ]; then
    rm -rf /etc/openvpn
    rm -rf /var/log/openvpn*
fi

if [ "$VPN_TYPE" = "wireguard" ] || [ "$VPN_TYPE" = "both" ]; then
    rm -rf /etc/wireguard
fi

rm -rf /opt/vpn-agent

ok "Files removed"

echo ""
echo "Reverting network config..."

sed -i '/net.ipv4.ip_forward=1/d' /etc/sysctl.conf 2>/dev/null || true
sysctl -p >/dev/null 2>&1 || true

ok "Network config reverted"

echo ""
echo -e "${G}============================================================"
echo "  Uninstall Complete"
echo "============================================================${NC}"
echo ""
echo "VPN Manager has been completely removed."
echo ""
