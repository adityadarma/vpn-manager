# Changelog

All notable changes to VPN Manager are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Removed the DNS summary cards and item counts from the `Allocations` and `Private Zones` tab labels.
- Removed item counts from the audit `Administrative Logs` and `Failed Connection Attempts` tab labels.
- Removed item counts from session tabs and VPN node filter options.
- Removed the item count from the Tasks VPN node filter.
- Removed item counts from the `Group Policies`, `User Policies`, and `Global Policies` tab labels.

### Fixed

- Fixed `Retry Task` returning `415 Unsupported Media Type` by sending an explicit JSON request body.

## [2.7.1] - 2026-09-19

### Fixed

- Tasks no longer stay stuck on `Running` forever with no duration. Only the Agent's own result report moved a task out of `running`, so an Agent that died or failed to report left it there permanently — and unretryable, because `Retry Task` only accepts failed tasks. Tasks claimed more than 10 minutes ago are now timed out and marked failed.
- Task results are no longer lost when the Manager is briefly unreachable. Reporting was fire-and-forget, so the outcome of work the Agent had already applied could vanish. Delivery is now retried with backoff and spooled to disk if every attempt fails, surviving an Agent restart.
- Firewall commands now run with a 30-second timeout and wait up to 5 seconds for the `iptables` lock (`-w 5`). With neither, a lock held by Docker, ufw, or fail2ban blocked `apply_network_policy`, `add_firewall_rule`, and `remove_firewall_rule` indefinitely and the task hung.

### Added

- `tasks.started_at` records when an Agent claimed a task, separating execution time from time spent queued. Tasks already stuck in `running` are backfilled from `created_at`.

## [2.7.0] - 2026-09-19

### Changed

- The read-only `Network Routes` field in a node's Configuration now shows each route in `push "route ..."` form and states that the routes are pushed to clients connecting through the node rather than applied to the node itself. The previous bare `route ...` text described a server-side directive that is no longer written into `server.conf`.

## [2.6.2] - 2026-09-18

### Changed

- Removed the duplicate `Retry Task` button from the Execution Failure Diagnostic panel in the task details modal; retrying stays available from the modal footer.

### Fixed

- Target network CIDRs are no longer written into the target node's own `server.conf`. A network such as `172.31.0.0/20` is a destination the node reaches through its own NIC, and clients already learn it from the `route` lines in their generated `.ovpn` profile and the `push "route ..."` lines in their CCD. Adding it server-side installed a tunnel route on the node that outranked the NIC route and cut the node off from that network, including its default gateway when the CIDR covered it. Group VPN subnet pools, which genuinely sit behind the tunnel, still produce server-side `route` directives.

## [2.6.1] - 2026-09-18

### Changed

- Removed the `Edit Network` button from the network details modal; editing stays available from the row menu on the Networks page, matching the Group Details header.

### Fixed

- Fixed unassigning a target node on the Networks page leaving a stale `route` directive in that node's `server.conf`. Saving the network only refreshed the newly selected nodes, so a node that lost the assignment was never sent an `update_server_config` task and kept routing the network into the tunnel. Deleting a network had the same gap, because the `node_networks` rows cascade away before the affected nodes can be identified.
- The Agent now refuses to write a server-side `route` directive for a network the node is already attached to. Assigning a network such as `172.31.0.0/20` to a node whose own address is `172.31.10.64` installed a tunnel route that outranked the NIC route on metric, cutting the node off from its own subnet and gateway. The `update_server_config` task now fails with an error naming the conflicting interface and address instead of applying the route. Narrow the network CIDR so it excludes the node's own subnet, or remove that node from the network.

## [2.6.0] - 2026-09-18

### Changed

- A target network with no selected nodes is no longer treated as global; routes are pushed only to explicitly selected nodes. Review any network showing `No nodes` on the Networks page and select its target nodes.
- Replaced all remaining native browser `confirm()` prompts with themed in-app confirmation dialogs, including node decommission and permanent delete.
- Removed duplicate primary action buttons from empty states; each list now has a single entry point in its header.
- Removed the `Edit Group` and `Delete Group` buttons from the Group Details header; both remain available from the row menu on the Groups list.
- Removed the `Add Node` button from the dashboard header; node registration lives on the VPN Nodes page.
- Condensed dashboard Active Sessions entries to a single row, replacing the two-row card and `Online` badge with a status dot so more sessions fit without scrolling.
- Removed the `Account is active` checkbox from the user edit modal; enabling and disabling an account is handled by `Disable user` / `Enable user` in the row menu.
- The VPN Nodes page now always renders the dense table and the card/table view toggle is gone, matching every other list page. Agent version match colouring and the Managed DNS indicator moved from the card into the table, and `Configuration` and `Sync Certificates` now live in the row menu so each row has a single actions control.
- Removed the `Auto-refresh 10s` badge from the VPN Sessions header; the `Refresh` button still reports fetch progress and polling is unchanged.
- Session statistics now treat "today" as the viewer's calendar day instead of a rolling 24-hour window. The dashboard sends its IANA timezone to `GET /api/v1/sessions/stats?tz=`, so totals reset at local midnight; unknown or missing zones fall back to UTC. The response also reports `today_starts_at` and `time_zone`, and the `(24h)` card labels are gone.

### Fixed

- Restored the read-only `Network Routes` and `Managed DNS Listeners` fields in the node configuration modal. The API had kept returning both, but the dashboard stopped rendering them, so there was no way to see which routes and DNS listeners were being written into the generated server config.
- Fixed network routes bypassing node scoping when assigning a network to a group, which could leak a node-specific route to every node.
- Fixed unchecked Target Nodes checkboxes rendering as solid white boxes on the Networks page, which made unselected nodes look selected in dark mode.
- Fixed the type check failing on the Managed DNS shield icon on the VPN Nodes page. `@types/react@19.3.0` no longer declares `title` on `SVGAttributes`, so passing `title` to a Lucide icon is now a type error; the tooltip moved to a wrapping `span` and the icon carries `aria-label` and `role="img"` instead.

## [2.5.0] - 2026-09-17

### Added

- Added authenticated Server-Sent Events for live dashboard, VPN session, node, task, audit, DNS, user, certificate, network, policy, and group refreshes.
- Added lightweight five-second Agent traffic telemetry so active VPN session counters update without increasing heartbeat frequency.

### Changed

- Batched changed traffic counters into chunked SQLite updates, supporting high-density VPN nodes without one database update per active client.
- Changed Agent task polling to bounded 25-second long polling, reducing idle HTTP requests while preserving atomic task claims.

### Fixed

- Prevented duplicate active OpenVPN sessions when heartbeat recovery and event-monitor connection reports describe the same tunnel.

## [2.4.1] - 2026-09-17

### Added

- Added running Agent version indicators on Node cards with match status coloring.

### Changed

- Overhauled Dashboard (`/`) with real-time KPI metrics, 24h bandwidth telemetry, infrastructure monitor, and live sessions stream.
- Overhauled VPN Nodes (`/nodes`) with stat cards, search, status/engine filter pills, card/table view toggle, and accessible confirmation dialogs.

## [2.4.0] - 2026-09-17

### Added

- Added a dedicated Group Details page at `/groups/$groupId` with full-width tabbed management for member assignments and network routing.
- Added an interactive Agent deployment-mode prompt during manual node installation to choose native systemd or Docker Compose.

### Changed

- Overhauled UI and UX across core management pages—Profile (`/profile`), Tasks (`/tasks`), VPN Sessions (`/sessions`), Audit Logs (`/audit`), Groups (`/groups`), Networks (`/networks`), and Policies (`/policies`)—standardizing on real-time metric cards, full-width tables with row numbering, semantic action/status badges, and deep inspection modals.
- Standardized default table pagination to 10 rows per page across all views (Users, Tasks, Sessions, and Audit Logs) and aligned backend API query fallback limits.
- Updated browser favicon (`favicon.svg`) to match the emerald rounded shield brand icon from the sidebar and login screen.
- Updated DNS Domain Policies (`/dns`) to show all policies across client groups by default with group filtering and explicit group assignment.
- Standardized route file hierarchy, dark-mode form inputs, and direct action buttons across application views.

### Fixed

- Fixed pagination navigation glitch on first "Next" click by preserving previous query data during page transitions across all tables.
- Fixed modal dialog vertical clipping on compact viewports with pinned headers/footers and smooth internal scrolling.
- Fixed DNS domain policy group selector forcibly selecting the first group.
- Fixed dark mode appearance for the native date picker indicator in certificate creation modals.
- Preserved client credential labels instead of defaulting to `Unknown Device` during OpenVPN client synchronization.

### Removed

- Removed obsolete subnet references and "Assigned VPN IP" column from group views in favor of certificate- and session-level IP tracking.
- Removed user bulk controls in favor of per-item management and dedicated certificate administration.

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
