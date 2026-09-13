# Contributing to VPN Manager

## Prerequisites

Use Node.js 24 or newer, pnpm 10 or newer, and Docker Compose v2 for container-based testing. Run `nvm use` when using nvm; the repository pins its major Node version in `.nvmrc`.

## Local setup

```bash
git clone https://github.com/adityadarma/vpn-manager.git
cd vpn-manager
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The API runs at `http://localhost:3000`, the dashboard at `http://localhost:5173`, and development OpenAPI UI at `http://localhost:3000/docs`.

## Change workflow

1. Create a focused branch from `main`.
2. Keep changes scoped to one concern and update user-facing documentation with behavior changes.
3. Do not commit `.env`, tokens, generated credentials, database files, or production backups.
4. Add or update tests when changing API, Agent, policy, credential, or firewall behavior.
5. Run the checks below before opening a pull request.

```bash
pnpm lint
pnpm typecheck
pnpm --filter @vpn/api test
pnpm --filter @vpn/agent test
pnpm --filter @vpn/docs build
```

Agent live tests interact with Linux VPN and firewall facilities. They are excluded from normal tests and must run only on an isolated host:

```bash
pnpm --filter @vpn/agent test:live
```

## Pull requests

Describe the problem, the behavioral change, and test evidence. Call out migration, environment-variable, installer, Docker, firewall, or security effects explicitly. Include before/after screenshots for dashboard changes. Do not include secrets or production customer data in descriptions, logs, fixtures, or screenshots.

## Reporting bugs

Open a GitHub issue for reproducible defects and feature requests. Include the application version, deployment method, sanitized logs, affected VPN engine, firewall engine, and steps to reproduce. Report security vulnerabilities privately under [SECURITY.md](SECURITY.md).
