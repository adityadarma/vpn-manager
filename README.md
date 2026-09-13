# VPN Manager — Modern VPN Management

![Build Status](https://github.com/adityadarma/vpn-manager/actions/workflows/release.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Docker](https://img.shields.io/badge/docker-ready-brightgreen.svg)

VPN Manager is an open-source control plane for operating self-hosted VPN infrastructure from one web dashboard. It separates central management from the VPN data plane: the Manager owns users, access policies, credentials, and node configuration, while each VPN Node runs the selected VPN engine and carries client traffic. OpenVPN and WireGuard are supported today; the node-agent design keeps the control-plane API independent of a specific engine.

> **Want to install right away?** Read the [Quick Start](GETTING-STARTED.md) or the [full documentation](https://adityadarma.github.io/vpn-manager/).

## Key Features

- **SQLite Storage:** A persistent local SQLite database for the Manager.
- **VPN Engine Support:** Run OpenVPN or WireGuard nodes in the same deployment. Select an engine per node without changing the Manager's user, policy, or operational workflow.
- **Node Clustering:** Deploy multiple VPN nodes across regions, all controlled from one central Manager.
- **Role-Based Access Control (RBAC):** Admin and User roles.
- **Network Policies:** Decide which users can reach which internal IP segments, via CIDR-based Allow/Deny rules.
- **Active Session Tracking:** See who is connected, their virtual IPs, data used, and session history in real time via the agent heartbeat.
- **Engine-Aware Client Credentials:**
  - OpenVPN: issue X.509 client certificates, optional password-protected private keys, CRL revocation, and renewal before expiry.
  - WireGuard: create and distribute peer configuration, then remove or rotate peers through the node agent.
  - Track credential downloads, validity, renewal, and revocation centrally.
- **Node Configuration:**
  - Customize VPN settings per node (port, protocol, tunnel mode)
  - Full/Split tunnel support
  - Custom DNS servers & routes
  - Configurable encryption (AES-256-GCM cipher, SHA256 auth, LZ4 compression)
  - TLS-Crypt for extra security
  - Web-based configuration management

## Architecture

```text
┌─────────────────────────────────────────┐
│           VPN Manager (Core)            │
│  ┌──────────┐  ┌──────────────────────┐ │
│  │  Web UI  │  │    API (Fastify)     │ │
│  │ Vite SPA │◄─│  TypeScript + Knex   │ │
│  └──────────┘  └──────────────────────┘ │
│                         │               │
│              ┌──────────┴──────────┐    │
│              │  Database           │    │
│              │  SQLite             │    │
│              └─────────────────────┘    │
└────────────────────────┬────────────────┘
                         │ HTTPS API (JWT / node token)
              ┌──────────┴──────────┐
              │  VPN Node (Agent)   │
              │  ┌────────────────┐ │
              │  │  Node Agent    │ │
              │  │  (Node.js)     │ │
              │  └────────┬───────┘ │
              │           │         │
              │  ┌────────▼───────┐ │
              │  │ VPN Engine     │ │
              │  │ OpenVPN /      │ │
              │  │ WireGuard      │ │
              │  └────────────────┘ │
              └─────────────────────┘
```

Design principles:

- **Control Plane and Data Plane Separation:** The Manager does not terminate VPN traffic. It sends desired configuration and lifecycle tasks to each node, while clients connect directly to the selected engine on that node.
- **Engine-Aware Agent:** The Agent translates Manager tasks into engine-specific configuration, credential, peer, status, and session operations. OpenVPN uses its management/status interfaces; WireGuard uses its local interface and `wg` tooling.
- **Security First:** The Agent is isolated in a container but requires `NET_ADMIN` and `NET_RAW` on its dedicated VPN node to manage VPN interfaces and firewall policy chains.
- **Real-time Monitoring:** The Agent normalizes connected-client and traffic data from the active engine before sending it to the Manager.
- **Hybrid Deployment:** Supports both host-based and containerized VPN.
- **Extensible:** The Manager-facing node workflow is designed to accommodate additional VPN engines when an Agent integration is implemented.

Architecture details: [Documentation: Architecture](https://adityadarma.github.io/vpn-manager/architecture/).

## Monorepo Structure

```text
vpn-manager/
├── apps/
│   ├── api/        ← Fastify REST API (dev port 3000)
│   ├── web/        ← Vite SPA + ShadCN dashboard (dev port 5173)
│   └── agent/      ← VPN node agent (standalone worker)
├── packages/
│   ├── db/         ← Knex SQLite layer
│   ├── shared/     ← Types, Zod schemas, endpoint constants
│   └── ui/         ← Shared React components (Tailwind CSS)
├── docker-compose.yml
└── .env.example
```

## Tech Stack

- **Backend:** Fastify, TypeScript, Knex
- **Frontend:** Vite, React, ShadCN UI, Tailwind CSS
- **Database:** SQLite
- **VPN Engines:** OpenVPN and WireGuard
- **Tooling:** Turborepo + pnpm (monorepo)

## Available Scripts

Run from the root directory:

- `pnpm dev` — Run the API + Web in watch mode.
- `pnpm agent:dev` — Run the agent in watch mode.
- `pnpm build` — Build all packages & apps for production.
- `pnpm typecheck` — Run TypeScript checks across the monorepo.
- `pnpm db:migrate` — Apply Knex schema migrations.
- `pnpm db:seed` — Seed the database with initial data (admin account).
- `pnpm db:rollback` — Revert the latest migration batch.

## Documentation

- **[Quick Start](GETTING-STARTED.md)** — Short Manager and VPN Node setup
- **[Full Documentation](https://adityadarma.github.io/vpn-manager/)** — Installation, administration, configuration, operations, security, and troubleshooting
- **[Architecture](https://adityadarma.github.io/vpn-manager/architecture/)** — Component topology and data flow
- **[API and Development](https://adityadarma.github.io/vpn-manager/reference/api-development/)** — Local development and API boundaries

## License

[MIT License](LICENSE)

Copyright (c) 2026 Aditya Darma (adhit.boys1@gmail.com)
