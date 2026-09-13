#!/bin/bash
# ============================================================
# VPN Manager - Manager Installation
# ============================================================
# Installs the VPN Manager (API + Web UI) as a single container.
# For VPN node installation, use install-agent.sh
#
# Usage:
#   sudo bash scripts/install-manager.sh
#
#   # Install the beta channel instead of the default stable channel:
#   curl -fsSL https://raw.githubusercontent.com/adityadarma/vpn-manager/main/scripts/install-manager.sh | \
#     sudo bash -s -- CHANNEL=beta
#
# Environment variables:
#   CHANNEL - Image and source channel: latest (default) or beta
# ============================================================

set -e

# Ensure we are in a valid working directory (previous install dir may have been deleted)
cd /tmp

# Colors
G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; R='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${G}✓ $1${NC}"; }
info() { echo -e "${B}ℹ $1${NC}"; }
warn() { echo -e "${Y}⚠ $1${NC}"; }
error(){ echo -e "${R}✗ $1${NC}"; }

INSTALL_DIR="/opt/vpn-manager"

# Preserve environment variables passed as command-line KEY=VALUE arguments.
# This supports `sudo bash -s -- CHANNEL=beta` when invoked through curl.
for arg in "$@"; do
    if [[ "$arg" == *"="* ]]; then
        export "$arg"
    fi
done

CHANNEL="${CHANNEL:-latest}"
case "$CHANNEL" in
    latest) IMAGE_VERSION="latest" ;;
    beta) IMAGE_VERSION="beta" ;;
    *) error "CHANNEL must be latest or beta (received: $CHANNEL)"; exit 1 ;;
esac

# Check root
[ "$EUID" -ne 0 ] && { error "Must run as root"; exit 1; }

echo -e "${B}============================================================"
echo "  VPN Manager - Installation"
echo "============================================================${NC}"
info "Installation channel: ${CHANNEL} (Manager image: ${IMAGE_VERSION})"
echo ""

# Check Docker
if ! command -v docker &> /dev/null; then
    error "Docker not installed"
    info "Install: https://docs.docker.com/engine/install/"
    exit 1
fi
ok "Docker installed"

if ! docker compose version &> /dev/null; then
    error "Docker Compose v2 not installed"
    exit 1
fi
ok "Docker Compose installed"
echo ""

# Create install directory
info "Creating installation directory..."
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"
ok "Directory created: $INSTALL_DIR"
echo ""

# Refresh the managed Compose file from the selected channel. Credentials and
# database settings live in .env and are deliberately preserved below. Preserve
# a timestamped copy first because an existing installation may have local
# Compose customizations.
if [ -f "docker-compose.yml" ]; then
    backup="docker-compose.yml.backup-$(date +%Y%m%d-%H%M%S)"
    cp docker-compose.yml "$backup"
    info "Backed up existing docker-compose.yml to $backup"
fi
info "Downloading docker-compose.yml..."
REPO_URL="https://raw.githubusercontent.com/adityadarma/vpn-manager/main"
if curl -fsSL "$REPO_URL/docker-compose.prod.yml" -o docker-compose.yml; then
    ok "Downloaded docker-compose.yml"
else
    error "Failed to download docker-compose.prod.yml from channel ${CHANNEL}"
    exit 1
fi
echo ""

if [ -f .env ]; then
    # Preserve existing credentials and database settings so reinstalling the
    # Manager cannot disconnect registered nodes or invalidate admin sessions.
    APP_PORT=$(grep '^PORT=' .env | tail -n1 | cut -d '=' -f2-)
    APP_PORT=${APP_PORT:-3000}
    if grep -q '^IMAGE_VERSION=' .env; then
        sed -i "s|^IMAGE_VERSION=.*|IMAGE_VERSION=${IMAGE_VERSION}|" .env
    else
        echo "IMAGE_VERSION=${IMAGE_VERSION}" >> .env
    fi
    EXISTING_INSTALL=true
    warn "Existing .env found; preserving its configuration and secrets"
else
    EXISTING_INSTALL=false
    info "Generating secrets..."
    JWT_SECRET=$(openssl rand -base64 32)
    VPN_TOKEN=$(openssl rand -hex 32)
    NODE_REGISTRATION_KEY=$(openssl rand -hex 16)
    ok "Secrets generated"
    echo ""

    if [ -z "${ADMIN_PASSWORD:-}" ]; then
        read -rsp "Initial admin password (minimum 8 characters; press Enter to auto-generate): " ADMIN_PASSWORD < /dev/tty
        echo ""
    else
        info "Using initial admin password provided through ADMIN_PASSWORD"
    fi
    if [ -n "$ADMIN_PASSWORD" ] && [ "${#ADMIN_PASSWORD}" -lt 8 ]; then
        error "Initial admin password must be at least 8 characters"
        exit 1
    fi
    if [ -z "$ADMIN_PASSWORD" ]; then
        ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 20)
        ADMIN_PASSWORD_GENERATED=true
        info "A strong admin password will be generated and shown once after installation"
    fi

    info "Using the built-in SQLite database"

    read -p "Manager HTTP port (default: 3000): " APP_PORT < /dev/tty
    APP_PORT=${APP_PORT:-3000}
    SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

    info "Creating .env file..."
    cat > .env <<EOF
# ============================================================
# VPN Manager — Production Environment
# ============================================================

# App
NODE_ENV=production
PORT=${APP_PORT}
IMAGE_VERSION=${IMAGE_VERSION}

# Database
$([ -n "$POSTGRES_PASSWORD" ] && echo "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}")
$([ -n "$MARIADB_PASSWORD" ] && echo "MARIADB_PASSWORD=${MARIADB_PASSWORD}")
$([ -n "$MARIADB_ROOT_PASSWORD" ] && echo "MARIADB_ROOT_PASSWORD=${MARIADB_ROOT_PASSWORD}")

# JWT
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=7d

# Security
VPN_TOKEN=${VPN_TOKEN}
NODE_REGISTRATION_KEY=${NODE_REGISTRATION_KEY}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
EOF
    ok ".env file created"
fi
echo ""

# Start services
info "Starting services..."
docker compose pull
docker compose up -d

sleep 5

# Wait for service to be healthy
info "Waiting for service to be ready..."
MAX_WAIT=60
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if curl -sf "http://localhost:${APP_PORT}/api/v1/health" > /dev/null 2>&1; then
        ok "Service is ready"
        break
    fi
    sleep 2
    ((WAITED+=2))
    echo -n "."
done
echo ""

if [ $WAITED -ge $MAX_WAIT ]; then
    warn "Health check timeout — service may still be starting"
    info "Check logs: docker compose logs -f manager"
fi

# Show summary
echo ""
echo -e "${B}============================================================"
echo "  Installation Complete!"
echo "============================================================${NC}"
echo ""
echo -e "${G}Access:${NC}"
if [ "$EXISTING_INSTALL" = true ]; then
    echo "  Existing installation preserved (check your reverse proxy configuration)"
else
    echo "  Reverse proxy: point your domain to http://127.0.0.1:${APP_PORT} and terminate TLS there"
fi
echo ""
if [ "$EXISTING_INSTALL" = false ]; then
    echo -e "${G}Default Credentials:${NC}"
    echo "  Username: admin"
    if [ "$ADMIN_PASSWORD_GENERATED" = true ]; then
        echo "  Password: $ADMIN_PASSWORD"
        echo "  (Auto-generated because no initial password was entered)"
    else
        echo "  Password: set from your ADMIN_PASSWORD input"
    fi
    echo "  ⚠ Change password after first login!"
    echo ""
    echo -e "${G}Node Registration Key (for VPN node install):${NC}"
    echo "  $NODE_REGISTRATION_KEY"
    echo ""
    echo -e "${G}VPN Token (for VPN hooks authentication):${NC}"
    echo "  $VPN_TOKEN"
    echo ""
fi
echo -e "${G}Useful Commands:${NC}"
echo "  Logs:    docker compose logs -f"
echo "  Restart: docker compose restart"
echo "  Stop:    docker compose down"
echo "  Update:  docker compose pull && docker compose up -d"
echo ""
echo "Installation directory: $INSTALL_DIR"
echo "============================================================"
echo ""
