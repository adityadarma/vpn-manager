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
AGENT_INSTALLED=false

if systemctl is-active --quiet openvpn-server@server 2>/dev/null || \
   systemctl is-active --quiet openvpn@server 2>/dev/null; then
    OPENVPN_INSTALLED=true
    ok "OpenVPN is already installed"
fi

if [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
    AGENT_INSTALLED=true
    ok "Agent is already installed"
fi

echo ""

# Installation mode
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

# Functions
install_openvpn() {
    info "Installing OpenVPN..."
    
    # Check if already installed
    if command -v openvpn &> /dev/null; then
        ok "OpenVPN already installed"
    else
        info "Installing OpenVPN and components for $OS..."
        
        local fw_pkg="iptables"
        if [ "$ENV_FIREWALL_ENGINE" = "nftables" ]; then fw_pkg="nftables"; fi
        if [ "$ENV_FIREWALL_ENGINE" = "ufw" ]; then fw_pkg="ufw"; fi
        if [ "$ENV_FIREWALL_ENGINE" = "firewalld" ]; then fw_pkg="firewalld"; fi
        if [ "$ENV_FIREWALL_ENGINE" = "none" ]; then fw_pkg=""; fi

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
    
    # Setup Easy-RSA if not exists
    if [ ! -d "/etc/openvpn/easy-rsa" ]; then
        info "Setting up Easy-RSA..."
        
        if command -v make-cadir &> /dev/null; then
            make-cadir /etc/openvpn/easy-rsa
        else
            mkdir -p /etc/openvpn/easy-rsa
            if [ -d "/usr/share/easy-rsa/3" ]; then
                cp -R /usr/share/easy-rsa/3/* /etc/openvpn/easy-rsa/
            elif [ -d "/usr/share/easy-rsa" ]; then
                cp -R /usr/share/easy-rsa/* /etc/openvpn/easy-rsa/
            else
                error "Could not find easy-rsa templates"
                exit 1
            fi
        fi
        
        cd /etc/openvpn/easy-rsa
        
        # Initialize PKI
        ./easyrsa init-pki
        ./easyrsa --batch build-ca nopass
        ./easyrsa --batch build-server-full server nopass
        ./easyrsa gen-dh
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
    
    # Setup NAT
    IF=$(ip route | grep default | awk '{print $5}' | head -n1)
    
    if [ "$ENV_FIREWALL_ENGINE" = "nftables" ]; then
        # Check if nftables is installed and working
        if command -v nft &> /dev/null; then
            cat > /etc/systemd/system/openvpn-nat.service <<EOF
[Unit]
Before=network.target
[Service]
Type=oneshot
ExecStart=/usr/sbin/nft add table ip nat
ExecStart=/usr/sbin/nft add chain ip nat POSTROUTING { type nat hook postrouting priority 100 \; }
ExecStart=/usr/sbin/nft add rule ip nat POSTROUTING oifname "$IF" ip saddr 10.8.0.0/24 masquerade
ExecStop=/usr/sbin/nft delete table ip nat
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
EOF
        else
            warn "nft command not found despite trying to install nftables. Will try to use iptables-nft."
            ENV_FIREWALL_ENGINE="iptables"
        fi
    fi
    
    if [ "$ENV_FIREWALL_ENGINE" = "iptables" ] || [ "$ENV_FIREWALL_ENGINE" = "ufw" ] || [ "$ENV_FIREWALL_ENGINE" = "firewalld" ]; then
        # Default to standard iptables syntax for compatibility layers
        cat > /etc/systemd/system/openvpn-nat.service <<EOF
[Unit]
Before=network.target
[Service]
Type=oneshot
ExecStart=/sbin/iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o $IF -j MASQUERADE
ExecStop=/sbin/iptables -t nat -D POSTROUTING -s 10.8.0.0/24 -o $IF -j MASQUERADE
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
EOF
    fi
    
    if [ "$ENV_FIREWALL_ENGINE" != "none" ]; then
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
    
    # Backup existing config
    if [ -f "/etc/openvpn/server/server.conf" ]; then
        cp /etc/openvpn/server/server.conf /etc/openvpn/server/server.conf.backup-$(date +%Y%m%d-%H%M%S)
        info "Backed up existing config"
    fi
    
    # Ensure CCD directory exists (used by kick_vpn_session to write disable files)
    mkdir -p /etc/openvpn/ccd
    chmod 755 /etc/openvpn/ccd

    # Create new config based on working reference
    cat > /etc/openvpn/server/server.conf <<'EOF'
port 1194
proto udp
dev tun

ca /etc/openvpn/server/ca.crt
cert /etc/openvpn/server/server.crt
key /etc/openvpn/server/server.key
dh none
ecdh-curve prime256v1
tls-crypt /etc/openvpn/server/tls-crypt.key

server 10.8.0.0 255.255.255.0
topology subnet

# Client Config Directory — allows per-client overrides (e.g. "disable" to block a kicked user)
client-config-dir /etc/openvpn/ccd

push "dhcp-option DNS 8.8.8.8"
push "dhcp-option DNS 1.1.1.1"
push "redirect-gateway def1 bypass-dhcp"

keepalive 10 120
cipher AES-128-GCM
ncp-ciphers AES-128-GCM
auth SHA256
tls-server
tls-version-min 1.2
tls-cipher TLS-ECDHE-ECDSA-WITH-AES-128-GCM-SHA256
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
            exit 1
        fi
    fi
    
    # Check for environment variables (support both naming conventions)
    ENV_MANAGER_URL="${MANAGER_URL:-${AGENT_API_MANAGER_URL}}"
    ENV_REG_KEY="${REG_KEY:-${NODE_REGISTRATION_KEY}}"
    ENV_VPN_TOKEN="${VPN_TOKEN}"
    ENV_NODE_ID="${AGENT_NODE_ID}"
    ENV_SECRET_TOKEN="${AGENT_SECRET_TOKEN}"
    ENV_FIREWALL_ENGINE="${FIREWALL_ENGINE}"
    
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
            AUTO_REGISTER=true
        else
            read -p "Node ID: " NODE_ID </dev/tty
            ENV_NODE_ID="$NODE_ID"
            read -p "Secret Token: " SECRET_TOKEN </dev/tty
            ENV_SECRET_TOKEN="$SECRET_TOKEN"
            MANUAL_REGISTER=true
        fi
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
OPENVPN_SOCKET_PATH=/run/openvpn/server.sock
EOF
        
        # Register node
        info "Registering node with Manager..."
        
        # Prepare JSON payload natively
        JSON_PAYLOAD="{\"hostname\":\"$HOSTNAME\",\"ip\":\"$SERVER_IP\",\"port\":1194,\"version\":\"auto\",\"registrationKey\":\"$ENV_REG_KEY\""
        if [ -n "$ENV_FIREWALL_ENGINE" ]; then
            JSON_PAYLOAD="$JSON_PAYLOAD, \"config\":{\"firewall_engine\":\"$ENV_FIREWALL_ENGINE\"}"
        fi
        JSON_PAYLOAD="$JSON_PAYLOAD}"

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
        cat > .env <<EOF
AGENT_MANAGER_URL=${ENV_MANAGER_URL}
VPN_TOKEN=${ENV_VPN_TOKEN}
AGENT_NODE_ID=${ENV_NODE_ID}
AGENT_SECRET_TOKEN=${ENV_SECRET_TOKEN}
AGENT_POLL_INTERVAL_MS=5000
AGENT_HEARTBEAT_INTERVAL_MS=30000
OPENVPN_SOCKET_PATH=/run/openvpn/server.sock
EOF
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
        if [ "$OPENVPN_INSTALLED" = true ]; then
            update_openvpn_config
        else
            install_openvpn
            install_agent
        fi
        ;;
    2)
        if [ "$OPENVPN_INSTALLED" = true ]; then
            install_agent
        else
            install_openvpn
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
echo "OpenVPN: $(systemctl is-active openvpn-server@server 2>/dev/null || systemctl is-active openvpn@server 2>/dev/null || echo 'not running')"
echo "Agent: $(docker ps --filter name=vpn-agent --format '{{.Status}}' 2>/dev/null || echo 'not running')"
echo ""
echo "Useful Commands:"
echo "  OpenVPN logs: tail -f /var/log/openvpn/openvpn.log"
echo "  Agent logs: docker logs -f vpn-agent"
echo "  Restart OpenVPN: systemctl restart openvpn-server@server"
echo "  Restart Agent: cd $INSTALL_DIR && docker compose restart"
echo ""
echo "============================================================"
echo ""
