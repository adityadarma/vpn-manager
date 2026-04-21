#!/bin/bash
# ============================================================
# VPN Manager - Node Installation/Update
# ============================================================
# Installs or updates OpenVPN server + Agent
# Can be used for:
#   - Fresh OpenVPN installation
#   - Update existing OpenVPN configuration
#   - Install/update Agent only
#
# Usage:
#   Interactive mode:
#     sudo bash scripts/install-node.sh
#
#   Non-interactive mode (pass as arguments):
#     curl -fsSL https://raw.githubusercontent.com/adityadarma/vpn-manager/main/scripts/install-node.sh | \
#     sudo bash -s -- \
#       MANAGER_URL=https://api-vpn.example.com \
#       VPN_TOKEN=your-vpn-token \
#       REG_KEY=your-registration-key
#
#   Or download first:
#     curl -fsSL https://raw.githubusercontent.com/adityadarma/vpn-manager/main/scripts/install-node.sh -o install-node.sh
#     sudo bash install-node.sh \
#       MANAGER_URL=https://api-vpn.example.com \
#       VPN_TOKEN=your-vpn-token \
#       REG_KEY=your-registration-key
#
#   Or use sudo -E:
#     export MANAGER_URL=https://api-vpn.example.com
#     export VPN_TOKEN=your-vpn-token
#     export REG_KEY=your-registration-key
#     sudo -E bash install-node.sh
#
# Environment Variables (Auto-registration):
#   MANAGER_URL or AGENT_API_MANAGER_URL - Manager API URL
#   VPN_TOKEN - VPN authentication token
#   REG_KEY or NODE_REGISTRATION_KEY - Registration key
#   VPN_SUBNET - VPN network CIDR (e.g. 10.8.0.0/16, default: auto-assigned by manager)
#   VPN_TYPE - VPN engine: openvpn (default) or wireguard
#   FIREWALL_ENGINE - Firewall: iptables (default), nftables, ufw, firewalld, none
#
# Environment Variables (Manual registration):
#   MANAGER_URL or AGENT_API_MANAGER_URL - Manager API URL
#   VPN_TOKEN - VPN authentication token
#   AGENT_NODE_ID - Node ID
#   AGENT_SECRET_TOKEN - Secret token
# ============================================================

set -e

# Colors
G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; R='\033[0;31m'; NC='\033[0m'
ok() { echo -e "${G}✓ $1${NC}"; }
info() { echo -e "${B}ℹ $1${NC}"; }
warn() { echo -e "${Y}⚠ $1${NC}"; }
error() { echo -e "${R}✗ $1${NC}"; }

mask_to_prefix() {
    local mask="$1"
    local old_ifs="$IFS"
    local prefix=0
    IFS='.'
    read -r o1 o2 o3 o4 <<< "$mask"
    IFS="$old_ifs"

    for octet in "$o1" "$o2" "$o3" "$o4"; do
        case "$octet" in
            255) prefix=$((prefix + 8)) ;;
            254) prefix=$((prefix + 7)) ;;
            252) prefix=$((prefix + 6)) ;;
            248) prefix=$((prefix + 5)) ;;
            240) prefix=$((prefix + 4)) ;;
            224) prefix=$((prefix + 3)) ;;
            192) prefix=$((prefix + 2)) ;;
            128) prefix=$((prefix + 1)) ;;
            0) ;;
            *) echo ""; return 1 ;;
        esac
    done

    echo "$prefix"
}

get_openvpn_vpn_cidr() {
    local network="${VPN_NETWORK:-10.8.1.0}"
    local netmask="${VPN_NETMASK:-255.255.255.0}"
    local prefix

    prefix=$(mask_to_prefix "$netmask")
    if [ -z "$prefix" ]; then
        prefix=24
    fi

    echo "${network}/${prefix}"
}

configure_firewalld_openvpn_rules() {
    local vpn_cidr="$1"
    local lan_cidr="$2"

    if ! command -v firewall-cmd &>/dev/null; then
        warn "firewall-cmd not found, falling back to iptables-compatible rules"
        return 1
    fi

    systemctl enable --now firewalld 2>/dev/null || true

    local forward_rule="rule family=ipv4 source address=${vpn_cidr} destination address=${lan_cidr} accept"
    local return_rule="rule family=ipv4 source address=${lan_cidr} destination address=${vpn_cidr} accept"

    firewall-cmd --permanent --add-masquerade >/dev/null 2>&1 || true
    firewall-cmd --permanent --add-rich-rule="$forward_rule" >/dev/null 2>&1 || true
    firewall-cmd --permanent --add-rich-rule="$return_rule" >/dev/null 2>&1 || true
    firewall-cmd --reload >/dev/null 2>&1 || true

    ok "firewalld rules configured"
    return 0
}

INSTALL_DIR="/opt/vpn-agent"

# Check root
[ "$EUID" -ne 0 ] && { error "Must run as root"; exit 1; }

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    OS_LIKE=${ID_LIKE:-""}
else
    error "Cannot detect operating system (missing /etc/os-release)"
    exit 1
fi

# Preserve environment variables from command line arguments
# This allows: sudo bash install-node.sh MANAGER_URL=... VPN_TOKEN=... REG_KEY=...
for arg in "$@"; do
    if [[ "$arg" == *"="* ]]; then
        export "$arg"
    fi
done

echo -e "${B}============================================================"
echo "  VPN Manager - Node Installation/Update"
echo "============================================================${NC}"
echo ""

# Show environment variable support
if [ -n "$MANAGER_URL" ] || [ -n "$AGENT_API_MANAGER_URL" ] || [ -n "$VPN_TOKEN" ]; then
    info "Environment variables detected - using non-interactive mode"
    echo ""
fi

# Detect existing installation
OPENVPN_INSTALLED=false
WIREGUARD_INSTALLED=false
AGENT_INSTALLED=false

if systemctl is-active --quiet openvpn-server@server 2>/dev/null || \
   systemctl is-active --quiet openvpn@server 2>/dev/null; then
    OPENVPN_INSTALLED=true
    ok "OpenVPN is already installed"
fi

if systemctl is-active --quiet wg-quick@wg0 2>/dev/null; then
    WIREGUARD_INSTALLED=true
    ok "WireGuard is already installed"
fi

if [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
    AGENT_INSTALLED=true
    ok "Agent is already installed"
fi

echo ""

if [ -z "$VPN_TYPE" ]; then
    echo "Select VPN Engine to install/manage:"
    echo "1) OpenVPN (Default, PKI Certificates)"
    echo "2) WireGuard (Modern, Fast, Static Peers)"
    read -p "Choice [1-2] (default 1): " vpn_choice </dev/tty
    
    case $vpn_choice in
        2) VPN_TYPE="wireguard" ;;
        *) VPN_TYPE="openvpn" ;;
    esac
fi
export ENV_VPN_TYPE="$VPN_TYPE"

echo ""

# Installation mode
if [ "$ENV_VPN_TYPE" = "wireguard" ]; then
    if [ "$WIREGUARD_INSTALLED" = true ]; then
        echo "WireGuard is already installed. What do you want to do?"
        echo "1) Update WireGuard configuration only"
        echo "2) Install/Update Agent only"
        echo "3) Update both WireGuard and Agent"
        echo "4) Exit"
        read -p "Choice [1-4]: " mode </dev/tty
    else
        echo "WireGuard is not installed. What do you want to do?"
        echo "1) Install WireGuard + Agent (full node)"
        echo "2) Install WireGuard only"
        echo "3) Exit"
        read -p "Choice [1-3]: " mode </dev/tty
    fi
    
    if [[ "$WIREGUARD_INSTALLED" == true && "$mode" == "4" ]] || [[ "$WIREGUARD_INSTALLED" == false && "$mode" == "3" ]]; then
        exit 0
    fi
else
    if [ "$OPENVPN_INSTALLED" = true ]; then
        echo "OpenVPN is already installed. What do you want to do?"
        echo "1) Update OpenVPN configuration only"
        echo "2) Install/Update Agent only"
        echo "3) Update both OpenVPN and Agent"
        echo "4) Exit"
        read -p "Choice [1-4]: " mode </dev/tty
    else
        echo "OpenVPN is not installed. What do you want to do?"
        echo "1) Install OpenVPN + Agent (full node)"
        echo "2) Install OpenVPN only"
        echo "3) Exit"
        read -p "Choice [1-3]: " mode </dev/tty
    fi
    
    if [[ "$OPENVPN_INSTALLED" == true && "$mode" == "4" ]] || [[ "$OPENVPN_INSTALLED" == false && "$mode" == "3" ]]; then
        exit 0
    fi
fi

echo ""

if [ -z "$FIREWALL_ENGINE" ]; then
    echo "Firewall Engine (NAT/Routing & Agent Firewall):"
    echo "1) iptables (Legacy/Standard)"
    echo "2) nftables (Modern Linux/Debian 12+)"
    echo "3) ufw (Ubuntu)"
    echo "4) firewalld (RHEL/CentOS)"
    echo "5) none (Manage manually)"
    read -p "Choice [1-5] (default 1): " fw_choice </dev/tty
    
    case $fw_choice in
        2) FIREWALL_ENGINE="nftables" ;;
        3) FIREWALL_ENGINE="ufw" ;;
        4) FIREWALL_ENGINE="firewalld" ;;
        5) FIREWALL_ENGINE="none" ;;
        *) FIREWALL_ENGINE="iptables" ;;
    esac
fi
export ENV_FIREWALL_ENGINE="$FIREWALL_ENGINE"

echo ""

# Start of functions
install_openvpn() {
    info "Installing OpenVPN..."

    # Always ensure the chosen firewall package is installed,
    # even when OpenVPN itself is already present.
    local fw_pkg="iptables"
    if [ "$ENV_FIREWALL_ENGINE" = "nftables" ]; then fw_pkg="nftables"; fi
    if [ "$ENV_FIREWALL_ENGINE" = "ufw" ]; then fw_pkg="ufw"; fi
    if [ "$ENV_FIREWALL_ENGINE" = "firewalld" ]; then fw_pkg="firewalld"; fi
    if [ "$ENV_FIREWALL_ENGINE" = "none" ]; then fw_pkg=""; fi

    # Check if already installed
    if command -v openvpn &> /dev/null; then
        ok "OpenVPN already installed"
        # Still make sure the firewall package is present
        if [ -n "$fw_pkg" ]; then
            if [[ "$OS" == "ubuntu" || "$OS" == "debian" || "$OS_LIKE" == *"debian"* || "$OS_LIKE" == *"ubuntu"* ]]; then
                apt-get install -y $fw_pkg 2>/dev/null || true
            elif [[ "$OS" == "centos" || "$OS" == "rhel" || "$OS" == "rocky" || "$OS" == "almalinux" || "$OS" == "fedora" || "$OS_LIKE" == *"rhel"* || "$OS_LIKE" == *"fedora"* ]]; then
                local PKG_MGR="yum"; command -v dnf &>/dev/null && PKG_MGR="dnf"
                $PKG_MGR install -y $fw_pkg 2>/dev/null || true
            fi
        fi
    else
        info "Installing OpenVPN and components for $OS..."

        if [[ "$OS" == "ubuntu" || "$OS" == "debian" || "$OS_LIKE" == *"debian"* || "$OS_LIKE" == *"ubuntu"* ]]; then
            apt-get update -qq
            apt-get install -y openvpn easy-rsa curl $fw_pkg
        elif [[ "$OS" == "centos" || "$OS" == "rhel" || "$OS" == "rocky" || "$OS" == "almalinux" || "$OS" == "fedora" || "$OS_LIKE" == *"rhel"* || "$OS_LIKE" == *"fedora"* ]]; then
            local PKG_MGR="yum"
            if command -v dnf &> /dev/null; then PKG_MGR="dnf"; fi
            
            $PKG_MGR install -y epel-release || true
            $PKG_MGR install -y openvpn easy-rsa curl $fw_pkg
        else
            error "Unsupported operating system: $OS. Please install openvpn, easy-rsa, and curl manually."
            exit 1
        fi
        
        ok "Required packages installed"
    fi
    
    # Setup directories
    mkdir -p /etc/openvpn/server
    mkdir -p /var/log/openvpn
    
    # Setup Easy-RSA if not exists or PKI is incomplete
    if [ ! -d "/etc/openvpn/easy-rsa" ] || [ ! -f "/etc/openvpn/easy-rsa/pki/ca.crt" ]; then
        info "Setting up Easy-RSA..."

        # Clean up any incomplete previous attempt
        rm -rf /etc/openvpn/easy-rsa
        
        if command -v make-cadir &> /dev/null; then
            make-cadir /etc/openvpn/easy-rsa
        else
            mkdir -p /etc/openvpn/easy-rsa
            if [ -d "/usr/share/easy-rsa/3" ]; then
                cp -R /usr/share/easy-rsa/3/* /etc/openvpn/easy-rsa/
            elif [ -d "/usr/share/easy-rsa" ] && [ -f "/usr/share/easy-rsa/easyrsa" ]; then
                cp -R /usr/share/easy-rsa/* /etc/openvpn/easy-rsa/
            elif find /usr/share -name "easyrsa" -type f 2>/dev/null | grep -q .; then
                EASYRSA_BIN=$(find /usr/share -name "easyrsa" -type f | head -n1)
                cp -R "$(dirname "$EASYRSA_BIN")"/* /etc/openvpn/easy-rsa/
            else
                error "Could not find easy-rsa templates. Install easy-rsa package manually."
                exit 1
            fi
        fi
        
        cd /etc/openvpn/easy-rsa
        
        # Initialize PKI — use RSA (Easy-RSA default, no extra config needed on any distro)
        # Key exchange still uses ECDH (dh none in server.conf), so forward secrecy is guaranteed
        ./easyrsa init-pki
        ./easyrsa --batch build-ca nopass
        ./easyrsa --batch build-server-full server nopass
        # DH params not needed — server.conf uses 'dh none' (ECDH)
        openvpn --genkey secret /etc/openvpn/server/tls-crypt.key
        
        # Copy certificates
        cp pki/ca.crt /etc/openvpn/server/
        cp pki/issued/server.crt /etc/openvpn/server/
        cp pki/private/server.key /etc/openvpn/server/
        
        ok "Easy-RSA configured"
    else
        ok "Easy-RSA already configured"
    fi
    
    # Create/update server config
    update_openvpn_config
    
    # Enable IP forwarding
    if ! grep -q "net.ipv4.ip_forward=1" /etc/sysctl.conf; then
        echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
        sysctl -p >/dev/null 2>&1
    fi
    
    # Setup NAT + forwarding rules for VPN clients to reach LAN subnets
    IF=$(ip route | grep default | awk '{print $5}' | head -n1)
    VPN_CIDR=$(get_openvpn_vpn_cidr)
    LAN_CIDR=$(ip route show dev "$IF" proto kernel scope link | awk 'NR==1{print $1}')
    if [ -z "$LAN_CIDR" ]; then
        LAN_CIDR=$(ip -o -f inet addr show "$IF" | awk 'NR==1{print $4}')
    fi
    [ -z "$LAN_CIDR" ] && LAN_CIDR="0.0.0.0/0"
    info "Firewall bootstrap: VPN=${VPN_CIDR}, LAN=${LAN_CIDR}, IF=${IF}"
    
    if [ "$ENV_FIREWALL_ENGINE" = "firewalld" ]; then
        configure_firewalld_openvpn_rules "$VPN_CIDR" "$LAN_CIDR" || ENV_FIREWALL_ENGINE="iptables"
        if [ "$ENV_FIREWALL_ENGINE" = "firewalld" ]; then
            systemctl disable --now openvpn-iptables.service 2>/dev/null || true
            systemctl disable --now openvpn-nat.service 2>/dev/null || true
            rm -f /etc/systemd/system/openvpn-iptables.service
            rm -f /etc/systemd/system/openvpn-nat.service
            systemctl daemon-reload
        fi
    fi

    if [ "$ENV_FIREWALL_ENGINE" = "nftables" ]; then
        if ! command -v nft &> /dev/null; then
            error "nft command not found. nftables package may not have been installed correctly."
            error "Run: apt-get install -y nftables   then re-run this script."
            exit 1
        fi
        cat > /etc/systemd/system/openvpn-nat.service <<EOF
[Unit]
Before=network.target
[Service]
Type=oneshot
ExecStart=/usr/sbin/nft add table ip vpn_manager_nat
ExecStart=/usr/sbin/nft add chain ip vpn_manager_nat POSTROUTING { type nat hook postrouting priority 100 \; }
ExecStart=/usr/sbin/nft add rule ip vpn_manager_nat POSTROUTING oifname "$IF" ip saddr ${VPN_CIDR} masquerade
ExecStart=/usr/sbin/nft add table inet vpn_manager_filter
ExecStart=/usr/sbin/nft add chain inet vpn_manager_filter FORWARD { type filter hook forward priority 0 \; policy accept \; }
ExecStart=/usr/sbin/nft add rule inet vpn_manager_filter FORWARD ip saddr ${VPN_CIDR} ip daddr ${LAN_CIDR} accept
ExecStart=/usr/sbin/nft add rule inet vpn_manager_filter FORWARD ip daddr ${VPN_CIDR} ct state related,established accept
ExecStop=/usr/sbin/nft delete table ip vpn_manager_nat
ExecStop=/usr/sbin/nft delete table inet vpn_manager_filter
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
EOF
    fi
    
    if [ "$ENV_FIREWALL_ENGINE" = "iptables" ] || [ "$ENV_FIREWALL_ENGINE" = "ufw" ]; then
        # Default to standard iptables syntax for compatibility layers.
        # For UFW mode, we intentionally use direct iptables rules for deterministic server-side routing.
        cat > /etc/systemd/system/openvpn-nat.service <<EOF
[Unit]
Before=network.target
[Service]
Type=oneshot
ExecStart=/sbin/iptables -t nat -A POSTROUTING -s ${VPN_CIDR} -o $IF -j MASQUERADE
ExecStart=/sbin/iptables -A FORWARD -s ${VPN_CIDR} -d ${LAN_CIDR} -j ACCEPT
ExecStart=/sbin/iptables -A FORWARD -d ${VPN_CIDR} -m state --state RELATED,ESTABLISHED -j ACCEPT
ExecStop=/sbin/iptables -D POSTROUTING -s ${VPN_CIDR} -o $IF -j MASQUERADE
ExecStop=/sbin/iptables -D FORWARD -s ${VPN_CIDR} -d ${LAN_CIDR} -j ACCEPT
ExecStop=/sbin/iptables -D FORWARD -d ${VPN_CIDR} -m state --state RELATED,ESTABLISHED -j ACCEPT
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
EOF
    fi
    
    if [ "$ENV_FIREWALL_ENGINE" != "none" ] && [ "$ENV_FIREWALL_ENGINE" != "firewalld" ]; then
        systemctl daemon-reload
        # Disable old specific service if exists
        systemctl disable --now openvpn-iptables.service 2>/dev/null || true
        systemctl enable --now openvpn-nat.service
    fi
    
    # Start OpenVPN
    systemctl enable --now openvpn-server@server.service 2>/dev/null || \
    systemctl enable --now openvpn@server.service 2>/dev/null
    
    sleep 2
    
    if systemctl is-active --quiet openvpn-server@server.service 2>/dev/null || \
       systemctl is-active --quiet openvpn@server.service 2>/dev/null; then
        ok "OpenVPN installed and running"
    else
        error "OpenVPN failed to start"
        exit 1
    fi
}

update_openvpn_config() {
    info "Creating/updating OpenVPN server configuration..."
    
    # Detect OpenVPN version to use correct cipher directive
    # data-ciphers was introduced in 2.5 (renamed from ncp-ciphers)
    local ovpn_major ovpn_minor CIPHER_DIRECTIVE
    ovpn_major=$(openvpn --version 2>/dev/null | head -n1 | grep -oP '\d+\.\d+' | head -n1 | cut -d. -f1)
    ovpn_minor=$(openvpn --version 2>/dev/null | head -n1 | grep -oP '\d+\.\d+' | head -n1 | cut -d. -f2)
    if [ "${ovpn_major:-0}" -gt 2 ] || { [ "${ovpn_major:-0}" -eq 2 ] && [ "${ovpn_minor:-0}" -ge 5 ]; }; then
        CIPHER_DIRECTIVE="data-ciphers"
    else
        CIPHER_DIRECTIVE="ncp-ciphers"
    fi
    info "OpenVPN ${ovpn_major}.${ovpn_minor} detected — using '${CIPHER_DIRECTIVE}'"
    
    # Backup existing config
    if [ -f "/etc/openvpn/server/server.conf" ]; then
        cp /etc/openvpn/server/server.conf /etc/openvpn/server/server.conf.backup-$(date +%Y%m%d-%H%M%S)
        info "Backed up existing config"
    fi
    
    # Ensure CCD directory exists (used by kick_vpn_session to write disable files)
    mkdir -p /etc/openvpn/ccd
    chmod 755 /etc/openvpn/ccd

    # Create new config based on working reference
    cat > /etc/openvpn/server/server.conf <<EOF
port 1194
proto udp
dev tun

ca /etc/openvpn/server/ca.crt
cert /etc/openvpn/server/server.crt
key /etc/openvpn/server/server.key
dh none
tls-crypt /etc/openvpn/server/tls-crypt.key

server ${VPN_NETWORK:-10.8.1.0} ${VPN_NETMASK:-255.255.255.0}
topology subnet

# Client Config Directory — allows per-client overrides (e.g. "disable" to block a kicked user)
client-config-dir /etc/openvpn/ccd

push "dhcp-option DNS 8.8.8.8"
push "dhcp-option DNS 1.1.1.1"
push "redirect-gateway def1 bypass-dhcp"

keepalive 10 60
explicit-exit-notify 1
cipher AES-256-GCM
${CIPHER_DIRECTIVE} AES-256-GCM:AES-128-GCM
auth SHA256
tls-server
tls-version-min 1.2
tls-cipher TLS-ECDHE-RSA-WITH-AES-256-GCM-SHA384
persist-key
persist-tun

user nobody
group nogroup

status /var/log/openvpn/status.log 1
status-version 3
log /var/log/openvpn/openvpn.log
verb 3

# script-security not needed — device info captured via management interface CLIENT:ENV events
# (using client-connect shell scripts causes fork failures on constrained systems)
script-security 1

# Management Interface — agent reads IV_PLAT/IV_VER/IV_GUI_VER from >CLIENT:ENV events
management /run/openvpn/server.sock unix
EOF
    
    ok "OpenVPN configuration updated"
    
    # Restart if already running
    if systemctl is-active --quiet openvpn-server@server.service 2>/dev/null; then
        systemctl restart openvpn-server@server.service
        ok "OpenVPN restarted"
    elif systemctl is-active --quiet openvpn@server.service 2>/dev/null; then
        systemctl restart openvpn@server.service
        ok "OpenVPN restarted"
    fi
}

install_wireguard() {
    info "Installing WireGuard..."

    # Always ensure the chosen firewall package is installed,
    # even when WireGuard itself is already present.
    local fw_pkg="iptables"
    if [ "$ENV_FIREWALL_ENGINE" = "nftables" ]; then fw_pkg="nftables"; fi
    if [ "$ENV_FIREWALL_ENGINE" = "ufw" ]; then fw_pkg="ufw"; fi
    if [ "$ENV_FIREWALL_ENGINE" = "firewalld" ]; then fw_pkg="firewalld"; fi
    if [ "$ENV_FIREWALL_ENGINE" = "none" ]; then fw_pkg=""; fi

    if command -v wg &> /dev/null; then
        ok "WireGuard already installed"
        if [ -n "$fw_pkg" ]; then
            if [[ "$OS" == "ubuntu" || "$OS" == "debian" || "$OS_LIKE" == *"debian"* || "$OS_LIKE" == *"ubuntu"* ]]; then
                apt-get install -y $fw_pkg 2>/dev/null || true
            elif [[ "$OS" == "centos" || "$OS" == "rhel" || "$OS" == "rocky" || "$OS" == "almalinux" || "$OS" == "fedora" || "$OS_LIKE" == *"rhel"* || "$OS_LIKE" == *"fedora"* ]]; then
                local PKG_MGR="yum"; command -v dnf &>/dev/null && PKG_MGR="dnf"
                $PKG_MGR install -y $fw_pkg 2>/dev/null || true
            fi
        fi
    else
        info "Installing wireguard-tools for $OS..."

        if [[ "$OS" == "ubuntu" || "$OS" == "debian" || "$OS_LIKE" == *"debian"* || "$OS_LIKE" == *"ubuntu"* ]]; then
            apt-get update -qq
            apt-get install -y wireguard-tools curl $fw_pkg
        elif [[ "$OS" == "centos" || "$OS" == "rhel" || "$OS" == "rocky" || "$OS" == "almalinux" || "$OS" == "fedora" || "$OS_LIKE" == *"rhel"* || "$OS_LIKE" == *"fedora"* ]]; then
            local PKG_MGR="yum"
            if command -v dnf &> /dev/null; then PKG_MGR="dnf"; fi
            
            $PKG_MGR install -y epel-release || true
            $PKG_MGR install -y wireguard-tools curl $fw_pkg
        else
            error "Unsupported operating system: $OS. Please install wireguard-tools and curl manually."
            exit 1
        fi
        
        ok "Required packages installed"
    fi
    
    # Setup directories
    mkdir -p /etc/wireguard
    
    # Generate keys
    if [ ! -f /etc/wireguard/privatekey ]; then
        info "Generating WireGuard keys..."
        wg genkey | tee /etc/wireguard/privatekey | wg pubkey > /etc/wireguard/publickey
        chmod 600 /etc/wireguard/privatekey
        chmod 644 /etc/wireguard/publickey
        ok "WireGuard keys generated"
    fi
    
    # Setup wg0.conf
    local wg_priv=$(cat /etc/wireguard/privatekey)
    cat > /etc/wireguard/wg0.conf <<EOF
[Interface]
PrivateKey = $wg_priv
Address = 10.8.0.1/24
ListenPort = 51820
EOF
    chmod 600 /etc/wireguard/wg0.conf
    
    # Enable IP forwarding
    if ! grep -q "net.ipv4.ip_forward=1" /etc/sysctl.conf; then
        echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
        sysctl -p >/dev/null 2>&1
    fi
    
    # Enable and start WireGuard
    systemctl enable wg-quick@wg0
    systemctl restart wg-quick@wg0
    ok "WireGuard service restarted"
}

install_agent() {
    info "Installing Agent..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        error "Docker not installed"
        info "Install: https://docs.docker.com/engine/install/"
        exit 1
    fi
    
    # Create install directory
    mkdir -p "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    
    # Download docker-compose.yml if not exists
    if [ ! -f "docker-compose.yml" ]; then
        info "Downloading docker-compose.yml for agent..."
        REPO_URL="https://raw.githubusercontent.com/adityadarma/vpn-manager/main"
        if curl -fsSL "$REPO_URL/docker-compose.agent.yml" -o docker-compose.yml; then
            ok "Downloaded docker-compose.yml"
        else
            error "Failed to download docker-compose.agent.yml"
            info "Please ensure docker-compose.yml is in $INSTALL_DIR"
        fi
    fi
    
    # Adjust Docker Compose based on VPN Type
    if [ "$ENV_VPN_TYPE" = "wireguard" ] && [ -f "docker-compose.yml" ]; then
        # Add WireGuard volume
        sed -i '/volumes:/a \      - /etc/wireguard:/etc/wireguard' docker-compose.yml
    elif [ "$ENV_VPN_TYPE" = "openvpn" ] && [ -f "docker-compose.yml" ]; then
        # Inject OpenVPN volumes
        sed -i '/volumes:/a \      - /run/openvpn:/run/openvpn\n      - /etc/openvpn:/etc/openvpn\n      - /var/log/openvpn:/var/log/openvpn:ro' docker-compose.yml
    fi
    
    # Check for environment variables (support both naming conventions)
    ENV_MANAGER_URL="${MANAGER_URL:-${AGENT_API_MANAGER_URL}}"
    ENV_REG_KEY="${REG_KEY:-${NODE_REGISTRATION_KEY}}"
    ENV_VPN_TOKEN="${VPN_TOKEN}"
    ENV_NODE_ID="${AGENT_NODE_ID}"
    ENV_SECRET_TOKEN="${AGENT_SECRET_TOKEN}"
    ENV_FIREWALL_ENGINE="${FIREWALL_ENGINE}"
    ENV_VPN_CIDR="${VPN_SUBNET}"
    
    # Determine registration mode
    AUTO_REGISTER=false
    MANUAL_REGISTER=false
    
    if [ -n "$ENV_MANAGER_URL" ] && [ -n "$ENV_REG_KEY" ] && [ -n "$ENV_VPN_TOKEN" ]; then
        AUTO_REGISTER=true
        info "Auto-registration mode detected (using environment variables)"
    elif [ -n "$ENV_MANAGER_URL" ] && [ -n "$ENV_VPN_TOKEN" ] && [ -n "$ENV_NODE_ID" ] && [ -n "$ENV_SECRET_TOKEN" ]; then
        MANUAL_REGISTER=true
        info "Manual registration mode detected (using environment variables)"
    fi
    
    # Get configuration interactively if not provided via environment
    echo ""
    if [ "$AUTO_REGISTER" = false ] && [ "$MANUAL_REGISTER" = false ]; then
        # Interactive mode
        read -p "Manager API URL (e.g., https://api-vpn.example.com): " MANAGER_URL </dev/tty
        ENV_MANAGER_URL="$MANAGER_URL"
        
        read -p "VPN Token: " VPN_TOKEN </dev/tty
        ENV_VPN_TOKEN="$VPN_TOKEN"

        echo ""
        echo "Registration mode:"
        echo "1) Auto-register (using registration key)"
        echo "2) Manual (using existing Node ID and Secret Token)"
        read -p "Choice [1-2]: " reg_mode </dev/tty
        
        if [ "$reg_mode" = "1" ]; then
            read -p "Node registration key: " REG_KEY </dev/tty
            ENV_REG_KEY="$REG_KEY"

            read -p "VPN Subnet CIDR (e.g. 10.8.1.0/24) [default: 10.8.1.0/24]: " VPN_CIDR_INPUT </dev/tty
            ENV_VPN_CIDR="${VPN_CIDR_INPUT:-10.8.1.0/24}"

            AUTO_REGISTER=true
        else
            read -p "Node ID: " NODE_ID </dev/tty
            ENV_NODE_ID="$NODE_ID"
            read -p "Secret Token: " SECRET_TOKEN </dev/tty
            ENV_SECRET_TOKEN="$SECRET_TOKEN"
            MANUAL_REGISTER=true
        fi
    fi
    
    # Parse VPN CIDR if auto registering
    if [ "$AUTO_REGISTER" = true ]; then
        if [ -z "$ENV_VPN_CIDR" ]; then
            warn "VPN_SUBNET not set — vpn_network will be auto-assigned by the manager"
            warn "To specify a subnet, set VPN_SUBNET=10.8.0.0/16 (or pass it as an argument)"
            VPN_NETWORK=""
            VPN_NETMASK=""
        else
            VPN_NETWORK="${ENV_VPN_CIDR%/*}"
            VPN_PREFIX="${ENV_VPN_CIDR#*/}"
            
            if [ "$VPN_PREFIX" = "16" ]; then
                VPN_NETMASK="255.255.0.0"
            elif [ "$VPN_PREFIX" = "8" ]; then
                VPN_NETMASK="255.0.0.0"
            else
                VPN_NETMASK="255.255.255.0"
            fi
            info "VPN Subnet: ${VPN_NETWORK}/${VPN_PREFIX} (netmask: ${VPN_NETMASK})"
        fi
    fi

    # Update OpenVPN server.conf with the correct subnet now that VPN_NETWORK is known
    if [ -n "$VPN_NETWORK" ] && [ "$ENV_VPN_TYPE" = "openvpn" ] && command -v openvpn &>/dev/null; then
        update_openvpn_config
    fi
    
    # Get server info
    SERVER_IP=$(curl -s ifconfig.me || hostname -I | awk '{print $1}')
    HOSTNAME=$(hostname)
    
    # Create .env file
    if [ "$AUTO_REGISTER" = true ]; then
        # Auto-registration: create .env with empty credentials (will be filled after registration)
        cat > .env <<EOF
AGENT_MANAGER_URL=${ENV_MANAGER_URL}
VPN_TOKEN=${ENV_VPN_TOKEN}
AGENT_NODE_ID=
AGENT_SECRET_TOKEN=
AGENT_POLL_INTERVAL_MS=5000
AGENT_HEARTBEAT_INTERVAL_MS=30000
FIREWALL_ENGINE=${ENV_FIREWALL_ENGINE:-auto}
EOF
        if [ "$ENV_VPN_TYPE" = "wireguard" ]; then
            echo "VPN_TYPE=wireguard" >> .env
        else
            echo "VPN_TYPE=openvpn" >> .env
        fi
        
        # Register node
        info "Registering node with Manager..."
        
        # Prepare JSON payload natively
        local port=1194
        if [ "$ENV_VPN_TYPE" = "wireguard" ]; then port=51820; fi
        
        local wg_pub=""
        local wg_priv=""
        if [ "$ENV_VPN_TYPE" = "wireguard" ]; then
            wg_pub=$(cat /etc/wireguard/publickey 2>/dev/null || echo "")
            wg_priv=$(cat /etc/wireguard/privatekey 2>/dev/null || echo "")
        fi

        JSON_PAYLOAD="{\"hostname\":\"$HOSTNAME\",\"ip\":\"$SERVER_IP\",\"port\":$port,\"version\":\"auto\",\"registrationKey\":\"$ENV_REG_KEY\""
        if [ "$ENV_VPN_TYPE" = "wireguard" ]; then
            JSON_PAYLOAD="$JSON_PAYLOAD, \"vpnType\":\"wireguard\", \"publicKey\":\"$wg_pub\", \"privateKey\":\"$wg_priv\""
        fi
        
        # Construct config object — cipher/auth_digest must match server.conf template
        # Only include vpn_network if explicitly set; otherwise let the manager assign nextNetwork
        if [ -n "$VPN_NETWORK" ]; then
            JSON_PAYLOAD="$JSON_PAYLOAD, \"config\":{\"vpn_network\":\"$VPN_NETWORK\", \"vpn_netmask\":\"$VPN_NETMASK\", \"cipher\":\"AES-256-GCM\", \"auth_digest\":\"SHA256\""
        else
            JSON_PAYLOAD="$JSON_PAYLOAD, \"config\":{\"cipher\":\"AES-256-GCM\", \"auth_digest\":\"SHA256\""
        fi
        if [ -n "$ENV_FIREWALL_ENGINE" ]; then
            JSON_PAYLOAD="$JSON_PAYLOAD, \"firewall_engine\":\"$ENV_FIREWALL_ENGINE\""
        fi
        JSON_PAYLOAD="$JSON_PAYLOAD}}"

        RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${ENV_MANAGER_URL}/api/v1/nodes/register" \
            -H "Content-Type: application/json" \
            -H "X-VPN-Token: ${ENV_VPN_TOKEN}" \
            -d "$JSON_PAYLOAD")
        
        HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
        BODY=$(echo "$RESPONSE" | sed '$d')
        
        if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
            NODE_ID=$(echo "$BODY" | grep -o '"id":"[^"]*' | cut -d'"' -f4)
            SECRET_TOKEN=$(echo "$BODY" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
            
            if [ -n "$NODE_ID" ] && [ -n "$SECRET_TOKEN" ]; then
                # Update .env with credentials
                sed -i "s|AGENT_NODE_ID=.*|AGENT_NODE_ID=$NODE_ID|" .env
                sed -i "s|AGENT_SECRET_TOKEN=.*|AGENT_SECRET_TOKEN=$SECRET_TOKEN|" .env
                ok "Node registered successfully: $NODE_ID"
            else
                error "Failed to parse registration response"
                warn "Please register manually and update .env file"
            fi
        else
            error "Node registration failed (HTTP $HTTP_CODE)"
            warn "Response: $BODY"
            warn "Please register manually and update .env file"
        fi
    else
        # Manual registration: use provided credentials
        # Manual registration: use provided credentials
        cat > .env <<EOF
AGENT_MANAGER_URL=${ENV_MANAGER_URL}
VPN_TOKEN=${ENV_VPN_TOKEN}
AGENT_NODE_ID=${ENV_NODE_ID}
AGENT_SECRET_TOKEN=${ENV_SECRET_TOKEN}
AGENT_POLL_INTERVAL_MS=5000
AGENT_HEARTBEAT_INTERVAL_MS=30000
FIREWALL_ENGINE=${ENV_FIREWALL_ENGINE:-auto}
EOF
        if [ "$ENV_VPN_TYPE" = "wireguard" ]; then
            echo "VPN_TYPE=wireguard" >> .env
        else
            echo "VPN_TYPE=openvpn" >> .env
        fi
        ok "Configuration saved with provided credentials"
    fi
    
    # Start agent
    info "Starting agent..."
    docker compose pull
    docker compose up -d
    
    sleep 3
    
    if docker ps --filter name=vpn-agent --format '{{.Status}}' | grep -q "Up"; then
        ok "Agent started successfully"
    else
        warn "Agent may not be running properly"
        info "Check logs: docker logs vpn-agent"
    fi
    
    ok "Agent installation complete"
}

# Execute based on mode
case $mode in
    1)
        if [ "$OPENVPN_INSTALLED" = true ] && [ "$ENV_VPN_TYPE" != "wireguard" ]; then
            update_openvpn_config
            # Update FIREWALL_ENGINE in agent .env if agent is already installed
            if [ "$AGENT_INSTALLED" = true ] && [ -f "$INSTALL_DIR/.env" ]; then
                if grep -q "^FIREWALL_ENGINE=" "$INSTALL_DIR/.env"; then
                    sed -i "s|^FIREWALL_ENGINE=.*|FIREWALL_ENGINE=${ENV_FIREWALL_ENGINE}|" "$INSTALL_DIR/.env"
                else
                    echo "FIREWALL_ENGINE=${ENV_FIREWALL_ENGINE}" >> "$INSTALL_DIR/.env"
                fi
                ok "Updated FIREWALL_ENGINE=${ENV_FIREWALL_ENGINE} in agent .env"
                info "Restarting agent to apply new firewall engine..."
                cd "$INSTALL_DIR" && docker compose restart
                ok "Agent restarted"
            fi
        else
            if [ "$ENV_VPN_TYPE" = "wireguard" ]; then
                install_wireguard
            else
                install_openvpn
            fi
            install_agent
        fi
        ;;
    2)
        if [ "$ENV_VPN_TYPE" = "wireguard" ]; then
            install_wireguard
        else
            if [ "$OPENVPN_INSTALLED" = true ]; then
                install_agent
            else
                install_openvpn
            fi
        fi
        ;;
    3)
        if [ "$OPENVPN_INSTALLED" = true ]; then
            update_openvpn_config
            install_agent
        else
            exit 0
        fi
        ;;
    4|*)
        exit 0
        ;;
esac

# Summary
echo ""
echo -e "${B}============================================================"
echo "  Installation Complete!"
echo "============================================================${NC}"
echo ""
if [ "$ENV_VPN_TYPE" = "wireguard" ]; then
    echo "WireGuard: $(systemctl is-active wg-quick@wg0 2>/dev/null || echo 'not running')"
else
    echo "OpenVPN: $(systemctl is-active openvpn-server@server 2>/dev/null || systemctl is-active openvpn@server 2>/dev/null || echo 'not running')"
fi
echo "Agent: $(docker ps --filter name=vpn-agent --format '{{.Status}}' 2>/dev/null || echo 'not running')"
echo ""
echo "Useful Commands:"
if [ "$ENV_VPN_TYPE" = "wireguard" ]; then
    echo "  WireGuard logs: journalctl -u wg-quick@wg0"
    echo "  Restart WireGuard: systemctl restart wg-quick@wg0"
else
    echo "  OpenVPN logs: tail -f /var/log/openvpn/openvpn.log"
    echo "  Restart OpenVPN: systemctl restart openvpn-server@server"
fi
echo "  Agent logs: docker logs -f vpn-agent"
echo "  Restart Agent: cd $INSTALL_DIR && docker compose restart"
echo ""
echo "============================================================"
echo ""
