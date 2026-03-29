# Getting Started - VPN Manager

Complete installation guide for VPN Manager in production and development environments.

## 🎯 Choose Your Installation Mode

VPN Manager supports two installation modes:

1. **All-in-One:** Manager + VPN Node on same server (simplest)
2. **Separate Servers:** Manager and VPN Node on different servers (production)

---

## 📋 Table of Contents

- [All-in-One Installation](#-all-in-one-installation-single-server)
- [Separate Servers Installation](#-separate-servers-installation)
- [Development Installation](#-development-installation)
- [Initial Configuration](#-initial-configuration)
- [Troubleshooting](#-troubleshooting)

---

## 🚀 All-in-One Installation (Single Server)

Install everything (Manager + VPN Node) on one server.

### Prerequisites

- Linux server (Ubuntu 20.04+, Debian 11+, CentOS 8+)
- Docker & Docker Compose v2
- Root/sudo access
- Open ports: 5173 (Web UI), 3000 (API), 1194 (OpenVPN UDP)

### Install

```bash
curl -fsSL https://raw.githubusercontent.com/adityadarma/vpn-manager/main/scripts/install-manager.sh | sudo bash
```

During installation:
1. Select **Installation mode:** `2) All-in-One`
2. Choose database type (SQLite recommended for single server)
3. Enter server domain/IP
4. Configure ports
5. Choose HTTP/HTTPS

The script will:
- Install Manager (API + Web UI)
- Install OpenVPN on host
- Install Agent in Docker
- Auto-register VPN Node
- Configure VPN hooks

### Access

```
Web UI: http://YOUR_SERVER_IP:5173
Login: admin / Admin@1234!
```

**Done!** Your VPN server is ready. Skip to [Initial Configuration](#-initial-configuration)

---

## 🏢 Separate Servers Installation

Install Manager and VPN Node on different servers (recommended for production).

### Step 1: Install VPN Manager

VPN Manager consists of API and Web UI. Install this first on a server.

#### Prerequisites

- Linux server (Ubuntu 20.04+, Debian 11+, CentOS 8+)
- Docker & Docker Compose v2
- Root/sudo access
- Open ports: 5173 (Web UI), 3000 (API)

#### Install Manager

**One-line install:**

```bash
curl -fsSL https://raw.githubusercontent.com/adityadarma/vpn-manager/main/scripts/install-manager.sh | sudo bash
```

During installation:
1. Select **Installation mode:** `1) Manager Only`
2. Choose database type
3. Enter server domain/IP
4. Configure ports
5. Choose HTTP/HTTPS

#### Access Web UI

```
http://YOUR_SERVER_IP:3000
```

**Default credentials:**
- Username: `admin`
- Password: `Admin@1234!`

⚠️ **IMPORTANT:** Change password after first login!

---

### Step 2: Configure Manager

Before installing VPN Node, get credentials from Manager:

```bash
cd /opt/vpn-manager
grep NODE_REGISTRATION_KEY .env
grep VPN_TOKEN .env
```

Save these values for VPN Node installation.

---

### Step 3: Install VPN Node

Set up auto-registration for easy node installation:

```bash
cd /opt/vpn-manager

# Generate and save registration key
echo "NODE_REGISTRATION_KEY=$(openssl rand -hex 32)" >> .env

# Restart API to apply changes
docker compose restart api

# Note the registration key (you'll need this for node installation)
grep NODE_REGISTRATION_KEY .env

# Note the VPN token (you'll need this for node installation)
grep VPN_TOKEN .env
```

### Option B: Manual Register

If you prefer manual registration:

1. Login to Web UI: http://YOUR_SERVER_IP:3000
2. Go to **Nodes** → **Add Node**
3. Fill in:
   - Hostname: your-vpn-server.com
   - IP Address: 203.0.113.10
   - Region: (select your region)
4. Click **Save**
5. **Important:** Copy and save the:
   - **Node ID**
   - **Secret Token**

---

## 🔧 Step 3: Install VPN Node

Now install VPN Node on a separate server. This server will run OpenVPN or WireGuard.

### Prerequisites

- Separate Linux server with public IP
- Root/sudo access
- Open ports: 1194/UDP (OpenVPN) or 51820/UDP (WireGuard)

### Install VPN Node

**Using Auto-Register (if you set up registration key in Step 2):**

```bash
# On VPN Node server - Download script first
curl -fsSL https://raw.githubusercontent.com/adityadarma/vpn-manager/main/scripts/install-node.sh -o install-node.sh
chmod +x install-node.sh

# Run with environment variables
sudo MANAGER_URL=http://YOUR_MANAGER_SERVER_IP:3001 \
VPN_TOKEN=your-vpn-token-from-step2 \
REG_KEY=your-registration-key-from-step2 \
./install-node.sh
```

**Using Manual Register (if you registered node in Web UI):**

```bash
# On VPN Node server - Download script first
curl -fsSL https://raw.githubusercontent.com/adityadarma/vpn-manager/main/scripts/install-node.sh -o install-node.sh
chmod +x install-node.sh

# Run with environment variables
sudo MANAGER_URL=http://YOUR_MANAGER_SERVER_IP:3001 \
VPN_TOKEN=your-vpn-token-from-step2 \
NODE_ID=your-node-id-from-webui \
SECRET_TOKEN=your-secret-token-from-webui \
./install-node.sh
```

### Verify Installation

```bash
# Check agent is running
docker logs vpn-agent

# Check OpenVPN is running
systemctl status openvpn-server@server

# Check node status in Web UI
# Go to http://YOUR_MANAGER_IP:3000/nodes
# The node should show as "Online"
```

---

## 💻 Development Installation

For local development testing:

### Prerequisites

- Node.js >= 24.x
- pnpm >= 9.x
- Git

### Step 1: Clone Repository

```bash
git clone https://github.com/adityadarma/vpn-manager.git
cd vpn-manager
```

### Step 2: Install Dependencies

```bash
pnpm install
```

### Step 3: Setup Environment

```bash
# Copy environment template
cp .env.example .env

# Edit configuration
nano .env
```

### Step 4: Setup Database

```bash
pnpm db:migrate
pnpm db:seed
```

### Step 5: Build and Start

```bash
pnpm build
pnpm dev
```

**Access:**
- Web UI: http://localhost:3000
- API: http://localhost:3001
- Login: `admin` / `Admin@1234!`

---

## 🎯 Initial Configuration

```bash
git clone https://github.com/adityadarma/vpn-manager.git
cd vpn-manager
```

### Step 2: Install Dependencies

```bash
pnpm install
```

### Step 3: Setup Environment

```bash
# Copy environment template
cp .env.example .env

# Edit configuration (optional, defaults are OK for development)
nano .env
```

**Minimal configuration for development:**

```env
# Database (SQLite - no setup needed)
DATABASE_TYPE=sqlite

# JWT Secret (generate or use default for dev)
JWT_SECRET=dev-secret-please-change-in-production-32chars

# VPN Token (for hooks authentication)
VPN_TOKEN=dev-vpn-token-change-in-production
```

### Step 4: Setup Database

```bash
# Run migrations
pnpm db:migrate

# Seed database (create admin user)
pnpm db:seed
```

### Step 5: Build Packages

```bash
pnpm build
```

### Step 6: Start Development Server

```bash
# Start all services (API + Web + Agent)
pnpm dev
```

**Or start individually:**

```bash
# API only
pnpm dev:api

# Web UI only
pnpm dev:web

# Agent only (requires VPN server)
pnpm dev:agent
```

### Step 7: Access Development

- **Web UI:** http://localhost:3000
- **API:** http://localhost:3001
- **API Docs:** http://localhost:3001/docs

**Default credentials:**
- Username: `admin`
- Password: `Admin@1234!`

---

### WireGuard Node (Experimental)

If you prefer WireGuard over OpenVPN:

**1. Install WireGuard:**

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install wireguard wireguard-tools

# CentOS/RHEL
sudo yum install wireguard-tools
```

**2. Setup WireGuard interface:**

```bash
# Generate keys
wg genkey | sudo tee /etc/wireguard/server_private.key
sudo cat /etc/wireguard/server_private.key | wg pubkey | sudo tee /etc/wireguard/server_public.key

# Create config
sudo nano /etc/wireguard/wg0.conf
```

```conf
[Interface]
Address = 10.8.0.1/24
ListenPort = 51820
PrivateKey = <paste-server-private-key>
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE
```

**3. Start WireGuard:**

```bash
sudo wg-quick up wg0
sudo systemctl enable wg-quick@wg0
```

**4. Install Agent with WireGuard:**

```bash
mkdir -p /opt/vpn-agent
cd /opt/vpn-agent
curl -fsSL https://raw.githubusercontent.com/adityadarma/vpn-manager/main/docker-compose.agent.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/adityadarma/vpn-manager/main/.env.agent -o .env

# Configure for WireGuard
nano .env
```

```env
VPN_TYPE=wireguard
WIREGUARD_INTERFACE=wg0
AGENT_MANAGER_URL=http://YOUR_MANAGER_SERVER_IP:3001
AGENT_NODE_ID=your-node-id
AGENT_SECRET_TOKEN=your-secret-token
VPN_TOKEN=your-vpn-token
```

**5. Start agent:**

```bash
docker compose up -d
```

### Verify Node Installation

```bash
# Check agent
docker logs vpn-agent

# Check OpenVPN
systemctl status openvpn-server@server

# Check WireGuard
sudo wg show

# In Web UI, go to Nodes - should show "Online"
```

---

## ⚙️ Initial Configuration

### 1. Change Admin Password

- Login to Web UI
- Go to **Profile** → **Change Password**
- Enter strong new password

### 2. Create Network

Networks define internal subnets accessible via VPN.

- Go to **Networks** → **Add Network**
- Name: `Office LAN`
- CIDR: `10.0.1.0/24`
- Click **Save**

### 3. Configure Node

After node is registered, customize VPN settings:

- Go to **Nodes** → Click **Configure** (⚙️)
- Adjust settings:
  - Port & Protocol (UDP/TCP)
  - Tunnel Mode (Full/Split)
  - DNS Servers
  - Encryption settings
- Click **Update Configuration**

### 4. Create User

- Go to **Users** → **Add User**
- Username: `john.doe`
- Email: `john@example.com`
- Password: (auto-generated or custom)
- Click **Save**

### 5. Generate Certificate

- Go to **Users** → Select user → **Generate Certificate**
- Select VPN node
- Choose validity period (1 day - unlimited)
- Optional: Enable password protection
- Click **Generate**

### 6. Download Config

- Click **Download .ovpn** button
- Send file to user securely
- User imports to VPN client (OpenVPN Connect, Tunnelblick, etc)

### 7. Create Policy (Optional)

Policies control user access to specific networks.

- Go to **Policies** → **Add Policy**
- Select user/group
- Select network
- Action: Allow/Deny
- Click **Save**

---

## 🔍 Troubleshooting

### Manager not accessible

```bash
# Check services
docker compose ps

# Check logs
docker compose logs api
docker compose logs web

# Restart services
docker compose restart
```

### Agent not connecting

```bash
# Check agent logs
docker logs vpn-agent

# Check network connectivity
docker exec vpn-agent ping api.example.com

# Verify credentials
docker exec vpn-agent env | grep AGENT_
```

### OpenVPN not starting

```bash
# Check status
systemctl status openvpn-server@server

# Check logs
tail -f /var/log/openvpn/openvpn.log

# Check config
cat /etc/openvpn/server/server.conf

# Restart
systemctl restart openvpn-server@server
```

### WireGuard not starting

```bash
# Check interface
ip link show wg0

# Check status
sudo wg show wg0

# Check logs
journalctl -u wg-quick@wg0

# Restart
sudo wg-quick down wg0
sudo wg-quick up wg0
```

### Database error

```bash
# Check database
docker compose exec postgres psql -U vpn -d vpn -c "SELECT 1;"

# Run migrations
docker compose exec api pnpm db:migrate

# Reset database (WARNING: deletes all data!)
docker compose down -v
docker compose up -d
```

### Port already in use

```bash
# Check what's using the port
sudo netstat -tulpn | grep -E '3000|3001|1194'

# Change ports in .env
nano .env
# API_PORT=3011
# WEB_PORT=3010

# Restart
docker compose restart
```

---

## 📚 Next Steps

After successful installation:

1. ✅ Read [Architecture](docs/ARCHITECTURE.md) to understand the system
2. ✅ Read [Multi-VPN Support](docs/MULTI-VPN-SUPPORT.md) for WireGuard
3. ✅ Read [Security Hardening](docs/SECURITY-HARDENING.md) for production
4. ✅ Setup SSL/TLS with Nginx/Caddy
5. ✅ Setup automatic backups
6. ✅ Setup monitoring (Prometheus/Grafana)

---

## 🆘 Need Help?

- **Documentation:** [docs/](docs/)
- **GitHub Issues:** https://github.com/adityadarma/vpn-manager/issues
- **GitHub Discussions:** https://github.com/adityadarma/vpn-manager/discussions

---

## 📝 Quick Reference

### Manager Commands

```bash
# Start
docker compose up -d

# Stop
docker compose down

# Logs
docker compose logs -f

# Restart
docker compose restart

# Update
docker compose pull
docker compose up -d
```

### VPN Node Commands

```bash
# Agent logs
docker logs vpn-agent -f

# OpenVPN status
systemctl status openvpn-server@server

# OpenVPN logs
tail -f /var/log/openvpn/openvpn.log

# WireGuard status
sudo wg show

# Update agent
curl -fsSL https://raw.githubusercontent.com/adityadarma/vpn-manager/main/scripts/update-node.sh | sudo bash
```

### Development Commands

```bash
# Install dependencies
pnpm install

# Build all
pnpm build

# Start dev
pnpm dev

# Run migrations
pnpm db:migrate

# Seed database
pnpm db:seed

# Type check
pnpm typecheck

# Run tests
pnpm test
```

---
