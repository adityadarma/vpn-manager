# VPN Manager Architecture

## Overview

VPN Manager uses a scalable, modular architecture:
- **API** - Fastify REST API (control plane)
- **Web UI** - ReactJS dashboard
- **Agent** - Node.js worker (node controller)
- **VPN Server** - OpenVPN, WireGuard, or other VPN providers

## Architecture

```
Manager (API + Web UI)
         ↓ HTTPS
    VPN Node (Agent)
         ↓ Driver Layer
    ┌────────────────────┐
    │  OpenVPN Driver    │ → TCP Management Interface (port 7505)
    │  WireGuard Driver  │ → wg command-line tool
    │  Custom Driver     │ → Your VPN API
    └────────────────────┘
         ↓
    VPN Server (OpenVPN/WireGuard/etc)
```

## Key Principles

1. **Loose Coupling** - Agent uses driver abstraction (no systemd dependency)
2. **Security First** - Agent runs without NET_ADMIN privileges
3. **Real-time** - Live client data via management interface
4. **Extensible** - Driver pattern for multiple VPN providers
5. **Multi-VPN Support** - Switch between OpenVPN, WireGuard, and more

## VPN Driver Interface

```typescript
interface VpnDriver {
  connect(): Promise<void>
  disconnect(): Promise<void>
  getClients(): Promise<VpnClient[]>
  disconnectClient(name: string): Promise<void>
  getMetrics(): Promise<VpnMetrics>
}
```

### Supported VPN Types

- ✅ **OpenVPN** - Production ready (TCP Management Interface)
- ✅ **WireGuard** - Experimental (command-line tool)
- 🔜 **IPSec/IKEv2** - Planned
- 🔜 **Custom VPN** - Easy to add via driver pattern

See [Multi-VPN Support](./MULTI-VPN-SUPPORT.md) for details.

## Communication

### OpenVPN
Agent → OpenVPN via TCP port 7505 (Management Interface)

**OpenVPN Config:**
```conf
management 127.0.0.1 7505
management-client-auth
status /var/log/openvpn/status.log
status-version 3
```

### WireGuard
Agent → WireGuard via `wg` command-line tool

**Requirements:**
- WireGuard installed
- Proper permissions for `wg` command

## Agent Responsibilities

- Monitor VPN via driver interface
- Send heartbeat with real-time client data
- Execute tasks from API
- Manage certificates
- Support multiple VPN types

## Deployment

**Recommended:**
- VPN Server on host (systemd)
- Agent in Docker container
- No special privileges needed

**Install:**
```bash
curl -fsSL https://raw.githubusercontent.com/adityadarma/vpn-manager/main/scripts/install-node.sh | sudo bash
```

## Benefits

- ✅ No systemd dependency
- ✅ No NET_ADMIN required
- ✅ Real-time monitoring
- ✅ Easy to extend (WireGuard, IPSec)
- ✅ Better security
- ✅ Multi-VPN support
