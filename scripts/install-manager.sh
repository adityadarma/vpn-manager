#!/bin/bash
# ============================================================
# VPN Manager - Manager Installation
# ============================================================
# Installs the VPN Manager (API + Web UI) as a single container.
# For VPN node installation, use install-node.sh
#
# Usage:
#   sudo bash scripts/install-manager.sh
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

# Check root
[ "$EUID" -ne 0 ] && { error "Must run as root"; exit 1; }

echo -e "${B}============================================================"
echo "  VPN Manager - Installation"
echo "============================================================${NC}"
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

# Download docker-compose.yml if not present
if [ ! -f "docker-compose.yml" ]; then
    info "Downloading docker-compose.yml..."
    REPO_URL="https://raw.githubusercontent.com/adityadarma/vpn-manager/main"
    if curl -fsSL "$REPO_URL/docker-compose.prod.yml" -o docker-compose.yml; then
        ok "Downloaded docker-compose.yml"
    else
        error "Failed to download docker-compose.yml"
        exit 1
    fi
fi
echo ""

if [ -f .env ]; then
    # Preserve existing credentials and database settings so reinstalling the
    # Manager cannot disconnect registered nodes or invalidate admin sessions.
    APP_PORT=$(grep '^PORT=' .env | tail -n1 | cut -d '=' -f2-)
    APP_PORT=${APP_PORT:-3000}
    DATABASE_TYPE=$(grep '^DATABASE_TYPE=' .env | tail -n1 | cut -d '=' -f2-)
    case "$DATABASE_TYPE" in
        postgres) DATABASE_PROFILE="--profile postgres" ;;
        mysql) DATABASE_PROFILE="--profile mariadb" ;;
        *) DATABASE_PROFILE="" ;;
    esac
    APP_URL="http://localhost:${APP_PORT}"
    EXISTING_INSTALL=true
    warn "Existing .env found; preserving its configuration and secrets"
else
    EXISTING_INSTALL=false
    info "Generating secrets..."
    JWT_SECRET=$(openssl rand -base64 32)
    VPN_TOKEN=$(openssl rand -hex 32)
    NODE_REGISTRATION_KEY=$(openssl rand -hex 16)
    ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 20)
    ok "Secrets generated"
    echo ""

    echo "Select database:"
    echo "1) SQLite (default, simple)"
    echo "2) PostgreSQL (production)"
    echo "3) MariaDB"
    read -p "Choice [1-3] (default: 1): " db_choice < /dev/tty
    db_choice=${db_choice:-1}

    case $db_choice in
        1) DATABASE_TYPE="sqlite"; DATABASE_PROFILE="" ;;
        2)
            DATABASE_TYPE="postgres"; DATABASE_PROFILE="--profile postgres"
            read -p "PostgreSQL password (auto-generate if empty): " POSTGRES_PASSWORD < /dev/tty
            POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-$(openssl rand -base64 32 | tr -d '/')}
            ;;
        3)
            DATABASE_TYPE="mysql"; DATABASE_PROFILE="--profile mariadb"
            read -p "MariaDB password (auto-generate if empty): " MARIADB_PASSWORD < /dev/tty
            MARIADB_PASSWORD=${MARIADB_PASSWORD:-$(openssl rand -base64 32 | tr -d '/')}
            read -p "MariaDB root password (auto-generate if empty): " MARIADB_ROOT_PASSWORD < /dev/tty
            MARIADB_ROOT_PASSWORD=${MARIADB_ROOT_PASSWORD:-$(openssl rand -base64 32 | tr -d '/')}
            ;;
        *) DATABASE_TYPE="sqlite"; DATABASE_PROFILE=""; warn "Invalid choice, defaulting to SQLite" ;;
    esac

    if [ "$DATABASE_TYPE" = "postgres" ]; then
        DATABASE_URL="postgresql://vpn:${POSTGRES_PASSWORD}@postgres:5432/vpn"
    elif [ "$DATABASE_TYPE" = "mysql" ]; then
        DATABASE_URL="mysql://vpn:${MARIADB_PASSWORD}@mariadb:3306/vpn"
    else
        DATABASE_URL=""
    fi

    SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
    echo "Enter your reverse-proxy domain or Manager IP address."
    echo "The Manager container itself serves HTTP; configure TLS at the reverse proxy."
    read -p "Server domain/IP (default: $SERVER_IP): " SERVER_DOMAIN < /dev/tty
    SERVER_DOMAIN=${SERVER_DOMAIN:-$SERVER_IP}
    read -p "Public URL uses HTTPS through a reverse proxy? [Y/n] (default: Y): " USE_HTTPS < /dev/tty
    USE_HTTPS=${USE_HTTPS:-Y}
    if [[ "$USE_HTTPS" == "y" || "$USE_HTTPS" == "Y" ]]; then PROTOCOL="https"; else PROTOCOL="http"; fi
    read -p "Port (default: 3000): " APP_PORT < /dev/tty
    APP_PORT=${APP_PORT:-3000}
    if [[ "$PROTOCOL" = "https" && "$APP_PORT" = "443" ]]; then APP_URL="https://$SERVER_DOMAIN"
    elif [[ "$PROTOCOL" = "http" && "$APP_PORT" = "80" ]]; then APP_URL="http://$SERVER_DOMAIN"
    else APP_URL="$PROTOCOL://$SERVER_DOMAIN:$APP_PORT"; fi

    info "Creating .env file..."
    cat > .env <<EOF
# ============================================================
# VPN Manager — Production Environment
# ============================================================

# App
NODE_ENV=production
PORT=${APP_PORT}

# Database
DATABASE_TYPE=${DATABASE_TYPE}
DATABASE_URL=${DATABASE_URL}
$([ "$DATABASE_TYPE" = "sqlite" ] && echo "DATABASE_SQLITE_PATH=/data/vpn.sqlite")
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
docker compose $DATABASE_PROFILE pull
docker compose $DATABASE_PROFILE up -d

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
    echo "  Existing endpoint unchanged (check your reverse proxy configuration)"
else
    echo "  Web UI + API: $APP_URL"
fi
echo ""
if [ "$EXISTING_INSTALL" = false ]; then
    echo -e "${G}Default Credentials:${NC}"
    echo "  Username: admin"
    echo "  Password: $ADMIN_PASSWORD"
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
