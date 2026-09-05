# VPN Manager Documentation

This documentation site uses Astro and Starlight. Source content is in `src/content/docs`, and the main navigation is configured in `astro.config.mjs`. The `dist` directory is build output and must not be edited manually.

Run commands from the monorepo root:

| Command | Purpose |
| --- | --- |
| `pnpm --filter @vpn/docs dev` | Runs the local site, usually at `http://localhost:4321` |
| `pnpm --filter @vpn/docs build` | Validates and builds the static site into `apps/docs/dist` |
| `pnpm --filter @vpn/docs preview` | Previews the local build output |

Documentation must match the implementation in `apps/api`, `apps/agent`, `apps/web`, Docker Compose files, and installation scripts. Do not document endpoints, variables, or behavior that has not been verified from those sources.
