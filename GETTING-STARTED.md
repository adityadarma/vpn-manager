# VPN Manager Quick Start

This page is the shortest path to a working deployment. Full installation, configuration, operations, security, and troubleshooting guidance is maintained on the [VPN Manager documentation site](https://adityadarma.github.io/vpn-manager/).

> Install the **Manager** first, then install one or more **VPN Nodes**.

## Components

| Component | Purpose                                                                     |
| --------- | --------------------------------------------------------------------------- |
| Manager   | Web dashboard and API for users, networks, policies, credentials, and nodes |
| VPN Node  | OpenVPN or WireGuard server plus the Agent that connects it to the Manager  |

The Manager is not a VPN endpoint. VPN clients connect directly to a VPN Node.

## Production Quick Start

Requirements: Linux, `root` or `sudo`, Docker Engine, and Docker Compose v2. The installation scripts do not install Docker.

```bash
docker --version
docker compose version
```

### 1. Install the Manager

Run this on the Manager host:

```bash
curl -fsSL https://raw.githubusercontent.com/adityadarma/vpn-manager/main/scripts/install-manager.sh | sudo bash
```

Save the installation output, especially the `admin` password, `NODE_REGISTRATION_KEY`, and `VPN_TOKEN`. Change the admin password after first login.

### 2. Install a VPN Node

Run this on the OpenVPN or WireGuard host. Replace the placeholder values with the secrets printed by the Manager installer.

```bash
curl -fsSL https://raw.githubusercontent.com/adityadarma/vpn-manager/main/scripts/install-node.sh | sudo bash -s -- \
  MANAGER_URL=https://vpn.example.com \
  VPN_TOKEN=replace-with-vpn-token \
  REG_KEY=replace-with-registration-key \
  VPN_TYPE=openvpn
```

Use `VPN_TYPE=wireguard` to install WireGuard. Confirm the node appears as `online` in the Manager dashboard before creating client credentials.

## Local Development

```bash
git clone https://github.com/adityadarma/vpn-manager.git
cd vpn-manager
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Dashboard: `http://localhost:5173`
- API: `http://localhost:3000`
- Development API reference: `http://localhost:3000/docs`

Set `ADMIN_PASSWORD` before seeding, or save the generated password printed by `pnpm db:seed`.

## Documentation

- [Install the Manager](https://adityadarma.github.io/vpn-manager/installation/manager/)
- [Install a VPN Node](https://adityadarma.github.io/vpn-manager/installation/node/)
- [Initial Setup](https://adityadarma.github.io/vpn-manager/administration/initial-setup/)
- [Operations and Security](https://adityadarma.github.io/vpn-manager/reference/operations-security/)
- [Troubleshooting](https://adityadarma.github.io/vpn-manager/reference/troubleshooting/)

Report issues at [github.com/adityadarma/vpn-manager/issues](https://github.com/adityadarma/vpn-manager/issues).
