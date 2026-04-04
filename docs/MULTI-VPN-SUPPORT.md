# Multi-VPN Support

VPN Manager agent supports multiple VPN server types through a driver abstraction layer.

## Supported VPN Types

### ✅ OpenVPN (Production Ready)
- **Status**: Fully implemented and tested
- **Communication**: TCP Management Interface (port 7505)
- **Features**: Real-time monitoring, client disconnect, metrics
- **Requirements**: OpenVPN with management interface enabled

### ✅ WireGuard (Experimental)
- **Status**: Implemented, needs testing
- **Communication**: Command-line tool (`wg` command)
- **Features**: Client listing, metrics, status monitoring
- **Requirements**: WireGuard installed, proper permissions
- **Limitations**: Client disconnect requires public key mapping

### 🔜 Future Support
- IPSec/IKEv2
- SoftEther VPN
- Tailscale
- ZeroTier

## Architecture

### Driver Pattern

All VPN implementations follow the `VpnDriver` interface:

```typescript
interface VpnDriver {
  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean
  getServerInfo(): Promise<VpnServerInfo>
  getClients(): Promise<VpnClient[]>
  disconnectClient(commonName: string): Promise<void>
  getStatus(): Promise<VpnStatus>
  getMetrics(): Promise<VpnMetrics>
  sendCommand(command: string): Promise<string>
}
```

### Driver Factory

The agent uses a factory pattern to create the appropriate driver:

```typescript
function createVpnDriver(env: AgentEnv): VpnDriver {
  switch (env.VPN_TYPE) {
    case 'openvpn':
      return new OpenVpnDriver(...)
    case 'wireguard':
      return new WireGuardDriver(...)
    default:
      throw new Error(`Unsupported VPN type: ${env.VPN_TYPE}`)
  }
}
```

## Configuration

### OpenVPN Setup

**1. Configure environment:**

```env
VPN_TYPE=openvpn
VPN_MANAGEMENT_HOST=127.0.0.1
VPN_MANAGEMENT_PORT=7505
VPN_MANAGEMENT_PASSWORD=
```

**2. OpenVPN server configuration:**

```conf
# /etc/openvpn/server/server.conf
management 127.0.0.1 7505
management-client-auth
status /var/log/openvpn/status.log
status-version 3
```

**3. Start agent:**

```bash
docker compose up -d
```

### WireGuard Setup

**1. Install WireGuard:**

```bash
# Ubuntu/Debian
sudo apt install wireguard wireguard-tools

# CentOS/RHEL
sudo yum install wireguard-tools

# Arch Linux
sudo pacman -S wireguard-tools
```

**2. Configure WireGuard interface:**

```bash
# Create interface configuration
sudo nano /etc/wireguard/wg0.conf
```

```conf
[Interface]
Address = 10.8.0.1/24
ListenPort = 51820
PrivateKey = <server-private-key>

[Peer]
PublicKey = <client-public-key>
AllowedIPs = 10.8.0.2/32
```

**3. Start WireGuard:**

```bash
sudo wg-quick up wg0
sudo systemctl enable wg-quick@wg0
```

**4. Configure agent environment:**

```env
VPN_TYPE=wireguard
```

**5. Grant agent permissions:**

```bash
# Option 1: Run agent as root (not recommended)
# Option 2: Add agent user to sudoers for wg command
echo "vpn-agent ALL=(ALL) NOPASSWD: /usr/bin/wg" | sudo tee /etc/sudoers.d/vpn-agent

# Option 3: Use capabilities (recommended)
sudo setcap cap_net_admin+ep /usr/bin/wg
```

**6. Start agent:**

```bash
docker compose up -d
```

## Usage Examples

### Switching VPN Types

**From OpenVPN to WireGuard:**

```bash
# Stop agent
docker compose down

# Update .env
sed -i 's/VPN_TYPE=openvpn/VPN_TYPE=wireguard/' .env

# Start agent
docker compose up -d
```

**From WireGuard to OpenVPN:**

```bash
# Stop agent
docker compose down

# Update .env
sed -i 's/VPN_TYPE=wireguard/VPN_TYPE=openvpn/' .env

# Start agent
docker compose up -d
```

### Testing Driver

**OpenVPN:**

```bash
# Check management interface
telnet 127.0.0.1 7505

# Commands:
> status 3
> version
> help
```

**WireGuard:**

```bash
# Check interface
sudo wg show wg0

# Check peers
sudo wg show wg0 peers

# Check dump
sudo wg show wg0 dump
```

## Driver Comparison

| Feature | OpenVPN | WireGuard |
|---------|---------|-----------|
| **Real-time monitoring** | ✅ Yes (TCP socket) | ⚠️ Polling only |
| **Client disconnect** | ✅ Yes | ⚠️ Limited |
| **Bandwidth tracking** | ✅ Yes | ✅ Yes |
| **Connection time** | ✅ Yes | ✅ Yes (handshake) |
| **Client identification** | ✅ Common name | ⚠️ Public key |
| **Performance** | Good | Excellent |
| **Setup complexity** | Medium | Low |
| **Security** | Excellent | Excellent |

## Adding New VPN Driver

### Step 1: Create Driver Class

```typescript
// apps/agent/src/drivers/myvpn.driver.ts
import type { VpnDriver, VpnClient, VpnServerInfo, VpnStatus, VpnMetrics } from './vpn-driver.interface'

export class MyVpnDriver implements VpnDriver {
  async connect(): Promise<void> {
    // Connect to VPN management interface
  }

  async disconnect(): Promise<void> {
    // Disconnect from VPN management interface
  }

  isConnected(): boolean {
    // Check connection status
  }

  async getServerInfo(): Promise<VpnServerInfo> {
    // Get VPN server information
  }

  async getClients(): Promise<VpnClient[]> {
    // Get list of connected clients
  }

  async disconnectClient(commonName: string): Promise<void> {
    // Disconnect a specific client
  }

  async getStatus(): Promise<VpnStatus> {
    // Get current VPN status
  }

  async getMetrics(): Promise<VpnMetrics> {
    // Get VPN metrics
  }

  async sendCommand(command: string): Promise<string> {
    // Send raw command to VPN
  }
}
```

### Step 2: Export Driver

```typescript
// apps/agent/src/drivers/index.ts
export * from './myvpn.driver'
```

### Step 3: Update Config Schema

```typescript
// apps/agent/src/config/env.ts
const AgentEnvSchema = z.object({
  // ...
  VPN_TYPE: z.enum(['openvpn', 'wireguard', 'myvpn']).default('openvpn'),
  
  // Add VPN-specific settings
  MYVPN_HOST: z.string().default('127.0.0.1'),
  MYVPN_PORT: z.coerce.number().int().default(8080),
})
```

### Step 4: Update Factory

```typescript
// apps/agent/src/index.ts
function createVpnDriver(env: AgentEnv): VpnDriver {
  switch (env.VPN_TYPE) {
    case 'openvpn':
      return new OpenVpnDriver(...)
    case 'wireguard':
      return new WireGuardDriver(...)
    case 'myvpn':
      return new MyVpnDriver(env.MYVPN_HOST, env.MYVPN_PORT)
    default:
      throw new Error(`Unsupported VPN type: ${env.VPN_TYPE}`)
  }
}
```

### Step 5: Update Environment Files

```env
# .env.example
VPN_TYPE=myvpn
MYVPN_HOST=127.0.0.1
MYVPN_PORT=8080
```

### Step 6: Test Driver

```bash
# Set VPN type
export VPN_TYPE=myvpn

# Start agent
pnpm dev:agent

# Check logs
docker logs vpn-agent -f
```

## Best Practices

### 1. Error Handling

```typescript
async getClients(): Promise<VpnClient[]> {
  try {
    // Get clients from VPN
    return clients
  } catch (err) {
    console.error('[driver] Failed to get clients:', err)
    return [] // Return empty array on error
  }
}
```

### 2. Connection Retry

```typescript
async connect(): Promise<void> {
  let retries = 3
  while (retries > 0) {
    try {
      // Attempt connection
      this.connected = true
      return
    } catch (err) {
      retries--
      if (retries === 0) throw err
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
  }
}
```

### 3. Graceful Degradation

```typescript
// In heartbeat.ts
if (driver.isConnected()) {
  try {
    const clients = await driver.getClients()
    // Send to API
  } catch (err) {
    console.warn('Failed to get clients, continuing...')
  }
}
```

### 4. Logging

```typescript
console.log('[driver] Connected to VPN')
console.warn('[driver] Connection unstable')
console.error('[driver] Failed to disconnect client:', err)
```

## Troubleshooting

### OpenVPN Driver

**Issue: Cannot connect to management interface**

```bash
# Check if management interface is enabled
grep management /etc/openvpn/server/server.conf

# Check if port is listening
netstat -tlnp | grep 7505

# Test connection
telnet 127.0.0.1 7505
```

**Issue: Authentication failed**

```bash
# Check password file
cat /etc/openvpn/mgmt.pass

# Update agent config
VPN_MANAGEMENT_PASSWORD=your-password
```

### WireGuard Driver

**Issue: Permission denied**

```bash
# Check permissions
ls -la /usr/bin/wg

# Grant capabilities
sudo setcap cap_net_admin+ep /usr/bin/wg

# Or run as root (not recommended)
sudo docker compose up -d
```

**Issue: Interface not found**

```bash
# Check interface name
ip link show

# Start interface
sudo wg-quick up wg0
```

## Performance Considerations

### OpenVPN
- **Pros**: Real-time updates via TCP socket
- **Cons**: Slightly higher CPU usage for encryption
- **Best for**: Enterprise deployments, complex routing

### WireGuard
- **Pros**: Faster, lower latency, modern cryptography
- **Cons**: Polling-based monitoring (no real-time events)
- **Best for**: High-performance needs, mobile clients

## Security Considerations

### OpenVPN
- Management interface should only listen on localhost
- Use password protection for management interface
- Restrict access with firewall rules

### WireGuard
- Protect private keys with proper file permissions
- Use strong pre-shared keys (PSK) for additional security
- Regularly rotate keys

## Future Enhancements

- [ ] Auto-detect VPN type
- [ ] Support multiple VPN types simultaneously
- [ ] Driver health checks
- [ ] Driver metrics and monitoring
- [ ] Driver-specific configuration validation
- [ ] Hot-reload driver configuration
- [ ] Driver plugin system

---
