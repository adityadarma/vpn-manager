# Changelog

All notable changes to VPN Manager are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added a dedicated Group Details page at `/groups/$groupId` with full-width tabbed management for member assignments and network routing, replacing the compact side drawer.
- Added an interactive Agent deployment-mode prompt so manual node installation can choose native systemd or Docker Compose without setting `AGENT_INSTALL_MODE`.

### Fixed

- Fixed pagination navigation glitch when clicking "Next" for the first time by configuring TanStack Query with `placeholderData: keepPreviousData` across all paginated tables (Users, Tasks, Audit Logs, and Session History), preventing unmounting of the pagination footer and flickering skeleton rows during page transitions, automatically disabling navigation buttons during background fetch, and resetting the active page to 1 whenever search queries or filters change.
- Fixed modal dialog vertical clipping on compact viewports by pinning headers and footers, constraining card max-height to `100dvh`, and enabling smooth internal body scrolling.
- Fixed group selector in DNS Domain Policies (`/dns`) that forcibly selected the first group and prevented selecting "Select a group..." or clearing the active selection.

- Removed the unused "Assigned VPN IP" column from the Group Members table since IP addresses belong to client certificates and active sessions rather than group membership.
- Removed obsolete subnet references and "No dedicated subnet" / "Default Subnet" placeholders from the groups directory table and group details page, replacing the stat card with Active Members.
- Fixed native date input calendar picker indicator not adapting to dark mode in the certificate creation modal.
- Used the credential label instead of `Unknown Device` when the Agent synchronizes an already-connected OpenVPN client.

### Changed

- Overhauled the User Profile page at `/profile` into an administrative command center: added an interactive hero profile card featuring an avatar with user initials and gradient styling, live status badge with pulsating indicator, role badge, one-click copyable User ID pill, and an account metadata bar (status, role, member since, and last sign-in timestamp); added an editable Personal Information form allowing real-time updates to full name and email address with dirty checking, reset support, and live synchronization with `useAuthStore` and `/api/v1/auth/me`; added an upgraded Security & Password change card with password visibility toggles (`Eye`/`EyeOff`), real-time password criteria validation badges (length & matching confirmation), and instant error handling; added a Session & Security Telemetry overview displaying active cookie protection, JTI token revocation status, per-IP rate limiting algorithms, and VPN certificate counts with a direct link to certificate management; and added a Recent Administrative Actions audit feed displaying the administrator's latest 4 activity records with semantic action badges, resource targets, IP addresses, and direct navigation to `/audit`.
- Standardized the default table pagination size to 10 rows per page across all application tables (Tasks `/tasks`, Session History `/sessions`, Audit Logs and Failed Connection Attempts `/audit`, joining Users `/users`), updated backend API query fallback limits to 10 across `/api/v1/tasks`, `/api/v1/sessions/history`, and `/api/v1/audit/logs` & `/connection-attempts`, and added explicit monospace page number indicators between Previous and Next navigation buttons.
- Overhauled the Audit Logs page at `/audit` into a dual-tab security audit center: added support for inspecting both Administrative Logs (`logs`) and Failed Connection Attempts (`attempts`), powered by `/api/v1/audit/connection-attempts` and `/api/v1/audit/connection-attempts/stats`; fixed server-side resource filtering query parameter (`resource_type`) and pagination total parsing; added 4 real-time metric cards (Total Events, Config Updates, Failed Auth 24h, and Active Actors); provided search toolbars with clear buttons (`X`), action category pills, and resource dropdowns; standardized tables with row numbering (`#`), action badges, and animated skeleton loaders; and added deep inspection modals for both administrative events (with formatted metadata JSON viewer and one-click copy) and rejected connection handshakes.
- Overhauled the VPN Sessions page at `/sessions` to align with the modern design system: added 4 real-time overview metric cards (Active Tunnels with pulsing indicator, Sessions Today 24h, Bandwidth Today with upload/download breakdown, and Avg Connection Time) backed by `/api/v1/sessions/stats`; integrated dedicated toolbars with real-time search and clear buttons (`X`) and a VPN Node filter dropdown for both Active and History tabs; added quick disconnect reason filter pills for History; standardized both tables using `@/components/ui/table` with row numbering (`#`), monospace IP and traffic badges, and animated skeleton loaders; added a comprehensive Session Telemetry & Details modal (`Inspect`) for deep diagnostic inspection; and replaced brittle window-coordinate dropdowns and native browser `confirm()` popups with styled, accessible Block and Unkick confirmation dialogs.
- Overhauled the Task Queue page at `/tasks` to align with the modern design system: replaced the native `<details>` accordion with a full-width directory table featuring row numbering (`#`), human-readable action labels and category icon boxes, target node badges, and status pills; added 4 interactive stat cards (Total, Pending, Completed, Failed) that filter the table on click; added an "All Tasks" view alongside quick status pills, a target node dropdown filter (`?nodeId=`), an instant search bar with a clear button (`X`), a manual refresh button with spinning feedback, and a comprehensive Task Details modal with tabbed Payload, Result, Error diagnostic alert, and one-click JSON clipboard copying.
- Updated the DNS Domain Policies tab on `/dns` to display all policies across all client groups by default with a group badge column, a group filter dropdown in the toolbar (`All Groups` / specific group), and an explicit `Target Group` selector inside the "Add Domain Policy" modal.
- Replaced the action dropdown menu in Network Policies (`/policies`) with a direct 'Delete' button featuring a trash icon and confirmation dialog, streamlining table rows since delete is the sole available action.
- Redesigned the Network Policies table at `/policies` to align with the Users, Groups, and Networks design system, removing bulk checkboxes and bulk delete in favor of row numbering (`#`), standardized 60px row heights with icon boxes, segmented quick filter pills (Action: All/Allow/Deny, Nodes: All/Global/Specific), animated skeleton loaders, and illustrated empty states.
- Updated input and textarea component styling to use the darker background token (matching select dropdowns and theme background), providing consistent contrast and visual depth across all forms and modals in dark mode.
- Redesigned the Networks & IP Management tables (Target Networks and Group Subnet Allocations) to align with the Users and Groups design system, featuring full-width table containers, dedicated search and filter toolbars, row numbering, consistent 60px row heights with icon boxes, monospace CIDR/subnet badges, interactive group/node shortcut badges, streamlined dropdown action menus (`...`), non-clickable table rows, animated skeleton loaders, and illustrated empty states.
- Updated the groups directory table row behavior to match the users table, removing whole-row navigation in favor of explicit navigation via the action menu (`...`) and shortcut badges.
- Standardized route file hierarchy so all sub-pages are cleanly organized within their respective route folders (`routes/_layout/groups/` for directory and detail views, and `routes/_layout/users/` for directory and certificate views).
- Restructured `/groups` into a full-width Groups directory with direct navigation to the dedicated `/groups/$groupId` detail view.
- Aligned the `/groups` header and toolbar with the VPN Users layout, placing the search bar alongside quick filter pills (membership and routing) directly under the header outside the table container.
- Redesigned the groups table with a modern UI layout, inline group icon badges, interactive member and network shortcut buttons, a dropdown actions menu (`...`), row numbering, animated skeleton loaders, comprehensive empty states, and enhanced dark mode support.
- Redesigned the VPN users table with a cleaner modern UI, improved dark mode support, skeleton loaders, and quick filter tabs, removing redundant credential column in favor of streamlined actions.
- Redesigned the user certificates table with a modern layout, dedicated status column, skeleton loaders, and theme token styling.
- Replaced raw VPN session disconnect reasons in history with user-friendly status labels and explanations.
- Updated the certificate list to use the standard DataTable layout and the same action menu pattern as the user list.
- Standardized Admin and Staff role badges with consistent contrast and icon treatment in light and dark themes.
- Removed bulk certificate generation from the user list; certificates are now managed per user from the certificate page.
- Replaced user bulk controls with per-user status actions and row numbering in user and certificate tables.

## [2.3.3] - 2026-09-16

### Fixed

- Prevented `update-node.sh` from prompting for VPN engine, tunnel, firewall, or Managed DNS settings; updates now preserve the existing Agent configuration.
- Fixed archiving a node from the dashboard by sending the required JSON request body to the decommission endpoint.
- Allowed a new Agent registration on the same hostname and IP to issue a new token for an existing offline node while preserving its configuration and history.

### Added

- Detected an Agent node's country name during registration from public IP geolocation, with AWS, GCP, or Azure region metadata fallback and a `NODE_REGION` override.

## [2.3.2] - 2026-09-16

### Changed

- Published Manager and Agent Docker images as multi-architecture manifests for `linux/amd64` and `linux/arm64`.

### Fixed

- Forwarded unresolved names in managed private DNS zones to configured upstream DNS servers, allowing public records such as `sub.example.com` to resolve while a private record in `example.com` still takes precedence.

## [2.3.1] - 2026-09-16

### Added

- Added per-Node client isolation, disabled by default, for OpenVPN and WireGuard clients on the same VPN node.

### Changed

- Applied client isolation consistently across iptables, UFW, nftables, and firewalld engines.

## [2.3.0] - 2026-09-14

### Added

- Added native Linux Agent distribution as Bun-compiled `amd64` and `arm64` binaries, published with SHA-256 checksums in GitHub Releases.
- Added native Agent installation, update, logging, restart, and uninstall support through systemd; native nodes no longer require Docker or Node.js.
- Added native CoreDNS installation and `vpn-coredns.service` for Managed DNS nodes, with verified pinned CoreDNS downloads.
- Added `scripts/update-node.sh` to update existing native and Docker Agent installations without replacing node credentials in `/opt/vpn-agent/.env`.
- Added `scripts/update-manager.sh` to update the Manager while retaining its `.env`, release channel, and database volume.
- Added API support and dashboard controls for retrying failed Agent tasks.

### Changed

- Preserved Docker Compose Agent deployments during updates while making native systemd deployment the default for new nodes.
- Made Managed DNS Corefile deployment and rollback atomic, so CoreDNS only reads complete configurations.
- Improved Agent environment loading so Docker, systemd, and manual execution share the same validated `process.env` configuration path.

### Fixed

- Fixed Manager node decommissioning during uninstall by submitting a valid JSON request to the authenticated Agent endpoint.

## [2.2.0] - 2026-09-14

### Added

- Added Managed DNS with group-scoped CoreDNS listeners, private zones, DNS records, sinkhole/block policies, DNS revision health reporting, and dashboard administration.
- Added managed DNS synchronization, CoreDNS configuration generation, DNS listener lifecycle management, and firewall enforcement for supported engines.
- Added Managed DNS unit, integration, and full-loop VPN tests.

### Changed

- Expanded group network policies to each member credential and improved certificate policy management in the dashboard.
- Updated node configuration synchronization and Agent installation behavior for Managed DNS.

## [2.1.0] - 2026-09-14

### Added

- Added node decommissioning and restoration flows that revoke node credentials, close active sessions, cancel pending tasks, and retain node history.
- Added a decommissioned node status in the dashboard.

### Changed

- Updated Agent uninstall handling to decommission the node on the Manager before local cleanup.

## [2.0.0] - 2026-09-14

### Breaking Changes

- Reworked database schema and removed legacy tables and columns. Existing installations must back up their database and run the v2 migrations before deployment; rolling back to a v1 application against a migrated v2 database is unsupported.
- Replaced user `username` with `name` and standardized authentication on email addresses. Integrations and API clients must submit `email` where they previously submitted `username`.
- Replaced the legacy VPN identity model with credential-scoped identities. Existing automation that assumes one certificate or identity per user must use the credential-specific API data.
- Standardized the stable Agent image channel to `ghcr.io/adityadarma/vpn-agent:2`. Update custom deployment manifests that pin the previous stable image tag.

### Added

- Added credential-scoped VPN identities, credential naming, certificate expiry monitoring, automatic expiry revocation, and improved certificate renewal/revocation flows.
- Added tunnel-mode validation, dynamic VPN subnet handling, Manager credential discovery for local Agent installation, and beta release channels for installers.
- Added Agent task retries, pagination for user and task management, improved node/session visibility, and responsive dashboard updates.
- Added group-aware network routing, allocation management, and expanded policy application for member credentials.
- Added Managed DNS foundations: data model, zone/policy synchronization, Agent DNS listener and firewall enforcement, dashboard administration, CoreDNS lifecycle support, and end-to-end coverage.

### Changed

- Simplified deployment around SQLite and reduced Manager and Agent image size by removing unnecessary runtime files and dependencies.
- Updated Agent, Manager, installer, uninstaller, release workflow, and documentation behavior for versioned stable/beta channels.
- Removed GeoIP session fields and obsolete database tests, tables, and configuration.
- Improved API error handling, authentication wording, node selection, certificate UI, and network-management workflows.

### Fixed

- Improved Agent registration error reporting, CoreDNS image/version handling, DNS sync status handling, and concurrent DNS revision queueing.
- Improved OpenVPN and WireGuard installation, cleanup, firewall handling, and Agent live-test coverage across supported distributions.

## [1.1.7] - 2026-09-07

### Added

- Added a startup heartbeat flag and queued policy synchronization for newly registered agents.
- Added a prerouting firewall policy chain and rules.
- Added WireGuard peer certificate expiry checks and renewal.

### Changed

- Reduced the VPN Manager production image size by removing runtime-only `tsx`, `curl`, and shell package installations. Database migrations and seeds now run with Node.js, and container health checks use Node.js HTTP requests.

## [1.1.6] - 2026-09-07

### Added

- Added a prerouting firewall chain to apply policy rules more consistently.

## [1.1.5] - 2026-09-06

### Added

- Blocked VPN clients from accessing services running on the VPN node itself.

## [1.1.4] - 2026-09-06

### Added

- Added `iptables-legacy` detection when retrieving firewall rules.

## [1.1.3] - 2026-09-06

### Added

- Added `iptables-legacy` firewall support.
- Added UFW and firewalld firewall integration tests.
- Improved live firewall and WireGuard connectivity tests.

## [1.1.2] - 2026-09-06

### Added

- Reapplied policies when users or groups are changed.
- Added version and revision labels to Docker images.

### Changed

- Improved date formatting in the user interface.

## [1.1.1] - 2026-09-05

### Added

- Added `formatBrowserDateTime` for consistent browser-side date and time formatting.

## [1.1.0] - 2026-09-05

### Added

- Added atomic VPN session management and IP address assignment.
- Added a production Docker Compose configuration and updated installation scripts.
- Added `iptables` and `nftables` to the agent Docker image.
- Improved firewall handling tests and error reporting.

### Changed

- Restructured installation documentation.
- Standardized the API port on `3000` and updated environment defaults.
- Restructured documentation and installation guides ahead of the stable release.

### Fixed

- Prevented database destruction when the application shuts down.
- Disabled Vitest file parallelism for stable test execution.

## [1.0.0] - 2026-07-03

### Added

- Web dashboard and Fastify REST API for managing users, nodes, groups, networks, sessions, certificates, and VPN policies.
- SQLite, PostgreSQL, MySQL, and MariaDB support.
- OpenVPN and WireGuard support, including agent installation with VPN engine selection.
- Multi-region node management with automatic registration, heartbeats, configuration and certificate synchronization, and node removal on uninstall.
- Role-based access control, HTTP-only cookie authentication, and centralized audit logging.
- Client certificate generation, download, renewal, revocation, CRL management, and node-specific certificate storage.
- Active session tracking and history with virtual IPs, client metadata, geolocation, connection time, kick, block, and unblock actions.
- VPN groups, subnets, target networks, split tunneling, and dynamic IP assignment by group and node.
- Granular allow/deny network policies by CIDR, port, protocol, node, and VPN type.
- `nftables`, `iptables`, UFW, and firewalld support with auto-detection, rule synchronization, and uninstall cleanup.
- Docker deployment, Manager and Agent installation scripts, and Starlight documentation.

### Changed

- Migrated the frontend from Next.js to Vite and standardized the API port on `3000`.
- Replaced OpenVPN shell hooks with management interface and Unix socket monitoring for more reliable session tracking.
- Strengthened OpenVPN defaults with TLS-Crypt, AES-256-GCM, version-aware cipher selection, and Easy-RSA compatibility.

### Fixed

- Fixed VPN IP assignment and automatic WireGuard peer injection.
- Fixed certificate, CRL, firewall, and Docker volume cleanup during uninstall.
- Fixed cross-distribution OpenVPN process group compatibility and Debian-specific package removal.
- Fixed agent task validation, node authentication, SPA fallback, Docker health checks, and node reinstallation.
