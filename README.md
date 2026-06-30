# VPN Manager — Modern VPN Management

![Build Status](https://github.com/adityadarma/vpn-manager/actions/workflows/docker-publish.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Docker](https://img.shields.io/badge/docker-ready-brightgreen.svg)

VPN Manager is an open-source app for managing VPNs centrally through a web dashboard, inspired by enterprise solutions like Pritunl and Tailscale Admin. Built on top of OpenVPN with a modern TypeScript monorepo architecture, it makes it easy to provision users, manage network access (CIDRs), run multiple VPN nodes, and push connection policies in real time.

> **Want to install right away?** See the **[Installation Guide (GETTING-STARTED.md)](GETTING-STARTED.md)**.

## Key Features

- **Multi-Database Support:** SQLite (default/development), PostgreSQL, or MySQL/MariaDB.
- **Multi-VPN Support:** OpenVPN (production-ready) and WireGuard (experimental), easy to extend to other VPN types.
- **Node Clustering:** Deploy multiple VPN nodes across regions, all controlled from one central Manager.
- **Role-Based Access Control (RBAC):** Admin and User roles.
- **Network Policies:** Decide which users can reach which internal IP segments, via CIDR-based Allow/Deny rules.
- **Active Session Tracking:** See who is connected, their virtual IPs, data used, and session history in real time via the agent heartbeat.
- **Client Certificate Management:**
  - Generate certificates with flexible validity (1 day to unlimited)
  - Password-protected private keys (optional)
  - Auto-renewal before expiry
  - Certificate Revocation List (CRL)
  - Download history tracking
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
│              │  Postgres/MySQL/    │    │
│              │  SQLite             │    │
│              └─────────────────────┘    │
└────────────────────────┬────────────────┘
                         │ HTTPS API (JWT / Token Auth)
              ┌──────────┴──────────┐
              │  VPN Node (Agent)   │
              │  ┌────────────────┐ │
              │  │  Node Agent    │ │
              │  │  (Node.js)     │ │
              │  └────────┬───────┘ │
              │           │         │
              │  ┌────────▼───────┐ │
              │  │   OpenVPN      │ │
              │  │   Server       │ │
              │  └────────────────┘ │
              └─────────────────────┘
```

Design principles:

- **Loose Coupling:** The agent communicates through a VPN driver abstraction (no systemd dependency).
- **Security First:** The agent runs without NET_ADMIN privileges.
- **Real-time Monitoring:** Live client data via the management interface.
- **Hybrid Deployment:** Supports both host-based and containerized VPN.
- **Extensible:** A driver pattern makes adding new VPN providers (IPSec, SoftEther, etc.) easy.

Architecture details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Monorepo Structure

```text
vpn-manager/
├── apps/
│   ├── api/        ← Fastify REST API (dev port 3001)
│   ├── web/        ← Vite SPA + ShadCN dashboard (dev port 5173)
│   └── agent/      ← VPN node agent (standalone worker)
├── packages/
│   ├── db/         ← Knex multi-database layer
│   ├── shared/     ← Types, Zod schemas, endpoint constants
│   └── ui/         ← Shared React components (Tailwind CSS)
├── docker-compose.yml
└── .env.example
```

## Tech Stack

- **Backend:** Fastify, TypeScript, Knex
- **Frontend:** Vite, React, ShadCN UI, Tailwind CSS
- **Database:** SQLite / PostgreSQL / MySQL (MariaDB)
- **VPN:** OpenVPN (production), WireGuard (experimental)
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

- **[Installation Guide](GETTING-STARTED.md)** — How to install the Manager & VPN Node
- **[Architecture](docs/ARCHITECTURE.md)** — System design
- **[Multi-VPN Support](docs/MULTI-VPN-SUPPORT.md)** — OpenVPN, WireGuard, and more
- **[Security Hardening](docs/SECURITY-HARDENING.md)** — Security best practices
- **[API Reference](docs/API-ENDPOINTS.md)** — API documentation

## License

[MIT License](LICENSE)

Copyright (c) 2026 Aditya Darma (adhit.boys1@gmail.com)
