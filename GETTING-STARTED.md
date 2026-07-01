# VPN Manager — Installation Guide

A quick guide to install VPN Manager. Pick one of the methods below based on your needs.

> **Important:** Install the **Manager** first, then the **VPN Node**.

## Table of Contents

- [Quick Concept](#quick-concept)
- [Method 1: Install on a Server (Production)](#method-1-install-on-a-server-production)
- [Method 2: Run Locally (Development)](#method-2-run-locally-development)
- [Initial Configuration](#initial-configuration)
- [Useful Commands](#useful-commands)
- [Troubleshooting](#troubleshooting)

---

## Quick Concept

VPN Manager has 2 parts:

| Part | Purpose | Installed on |
| --- | --- | --- |
| **Manager** | Web dashboard + API to manage users, certificates, and access policies | 1 server |
| **VPN Node** | The actual VPN server (OpenVPN/WireGuard) that users connect to | same or a different server |

You can install both on a **single server** (simplest) or on **separate servers** (recommended for production). The steps are the same; only the server address differs.

---

## Method 1: Install on a Server (Production)

### Requirements

- Linux server (Ubuntu 20.04+, Debian 11+, or CentOS 8+)
- root/sudo access
- Docker & Docker Compose v2 (installed automatically if missing)

### Step 1 — Install the Manager

Run this on the server where the Manager will live:

```bash
curl -fsSL https://raw.githubusercontent.com/adityadarma/vpn-manager/main/scripts/install-manager.sh | sudo bash
```

During installation you'll be asked for:

1. **Database type** — pick `1) SQLite` if unsure (simplest, no extra setup)
2. **Server domain/IP** — the address used to reach the Manager
3. **Use HTTPS?** — choose `Y` for production
4. **Port** — keep the default `3000` unless it conflicts

When it finishes, the screen shows important info. **Save all of it:**

```
Web UI + API : http://YOUR-SERVER-IP:3000
Login        : admin / <password shown by the installer>

Node Registration Key : xxxxxxxx   ← for installing the VPN Node
VPN Token             : xxxxxxxx   ← for installing the VPN Node
```

> The admin password is randomly generated and shown **once** by the installer (or set it yourself beforehand via the `ADMIN_PASSWORD` environment variable). Save it now.

> Open `Web UI + API` in your browser and log in. **Change the admin password immediately** after the first login.

### Step 2 — Install the VPN Node

Move to the server where the VPN will run (can be the same server). Run the single command below, replacing the values with the ones from Step 1:

```bash
curl -fsSL https://raw.githubusercontent.com/adityadarma/vpn-manager/main/scripts/install-node.sh | sudo bash -s -- \
  MANAGER_URL=http://MANAGER-SERVER-IP:3000 \
  VPN_TOKEN=vpn-token-from-step-1 \
  REG_KEY=registration-key-from-step-1
```

The script automatically installs Docker (if needed), installs and configures OpenVPN, then starts the Agent and registers the node with the Manager. It also auto-detects the active firewall (iptables, nftables, ufw, or firewalld) and sets up the routing/NAT rules for you.

> **No arguments?** Just run `sudo bash` without arguments and the script will prompt you for each value one by one — including which firewall engine to use (the detected one is recommended).

> **Want to override the firewall?** Add `FIREWALL_ENGINE=...` to the command, e.g. `FIREWALL_ENGINE=nftables` (options: `iptables`, `nftables`, `ufw`, `firewalld`, `none`). When passed as an argument, the firewall prompt is skipped.

### Step 3 — Verify

```bash
docker logs vpn-agent                          # Is the Agent running?
systemctl status openvpn-server@server         # Is OpenVPN running?
```

Then open **Nodes** in the Web UI — your node should appear with status **Online**.

---

## Method 2: Run Locally (Development)

For trying out or developing on your own machine (without a real VPN server).

### Requirements

- Node.js >= 24
- pnpm >= 9
- Git

### Steps

```bash
# 1. Get the code
git clone https://github.com/adityadarma/vpn-manager.git
cd vpn-manager

# 2. Install dependencies
pnpm install

# 3. Set up config (defaults are fine for development)
cp .env.example .env

# 4. Set up the database + admin account
#    Tip: set ADMIN_PASSWORD in .env first, or the seed will print a random one.
pnpm db:migrate
pnpm db:seed

# 5. Build & run
pnpm build
pnpm dev
```

**Access:**

- Web UI: http://localhost:5173
- API: http://localhost:3001
- Login: `admin` / the password from the `pnpm db:seed` output (or your `ADMIN_PASSWORD`)

> To run the Agent locally (optional, needs a VPN server): `pnpm agent:dev`

---

## Initial Configuration

Once the Manager & Node are ready, do this from the Web UI:

1. **Change the admin password** — go to **Profile** → **Change Password**.
2. **Create a Network** — go to **Networks** → **Add Network**. Enter a name (e.g. `Office LAN`) and CIDR (e.g. `10.0.1.0/24`). Networks define the internal subnets reachable through the VPN.
3. **Configure the Node** (optional) — go to **Nodes** → **Configure** to change port, protocol, tunnel mode, DNS, or encryption.
4. **Create a User** — go to **Users** → **Add User**. Enter a username, email, and password.
5. **Generate a Certificate** — select the user → **Generate Certificate** → choose a node & validity period → **Generate**.
6. **Download the Config** — click **Download .ovpn**, then send the file to the user. The user imports it into a VPN client (OpenVPN Connect, Tunnelblick, etc.).
7. **Set a Policy** (optional) — go to **Policies** → **Add Policy** to decide which user/group may access which network (Allow/Deny).

---

## Useful Commands

### Manager

```bash
cd /opt/vpn-manager
docker compose up -d       # start
docker compose down        # stop
docker compose restart     # restart
docker compose logs -f     # view logs
docker compose pull && docker compose up -d   # update
```

### VPN Node

```bash
docker logs -f vpn-agent                       # agent logs
systemctl status openvpn-server@server         # OpenVPN status
tail -f /var/log/openvpn/openvpn.log           # OpenVPN logs

# Update the node
curl -fsSL https://raw.githubusercontent.com/adityadarma/vpn-manager/main/scripts/update-node.sh | sudo bash

# Remove the node
curl -fsSL https://raw.githubusercontent.com/adityadarma/vpn-manager/main/scripts/uninstall-node.sh | sudo bash
```

### Development

```bash
pnpm dev          # run everything (API + Web)
pnpm agent:dev    # run the agent
pnpm build        # build everything
pnpm typecheck    # TypeScript type checks
pnpm db:migrate   # database migrations
pnpm db:seed      # seed initial data (admin account)
```

---

## Troubleshooting

### Manager not reachable

```bash
cd /opt/vpn-manager
docker compose ps        # check container status
docker compose logs      # view errors
docker compose restart   # try restarting
```

### Agent not connecting

```bash
docker logs vpn-agent                  # view errors
docker exec vpn-agent env | grep AGENT_   # check config
```

Make sure `MANAGER_URL`, `VPN_TOKEN`, and the registration key are correct.

### OpenVPN not running

```bash
systemctl status openvpn-server@server
tail -f /var/log/openvpn/openvpn.log
systemctl restart openvpn-server@server
```

### Port already in use

```bash
sudo lsof -i :3000        # see what's using the port

cd /opt/vpn-manager
nano .env                 # change PORT, then:
docker compose restart
```

### Reset the database (CAUTION: deletes all data)

```bash
cd /opt/vpn-manager
docker compose down -v
docker compose up -d
```

---

## Need Help?

- **Project description & architecture:** [README.md](README.md)
- **Full documentation:** the [docs/](docs/) folder
- **Report an issue:** https://github.com/adityadarma/vpn-manager/issues
