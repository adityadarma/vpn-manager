# Changelog

All notable changes to VPN Manager are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
