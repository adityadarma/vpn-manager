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
