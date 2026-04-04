import { z } from 'zod'

const AgentEnvSchema = z.object({
  AGENT_PORT: z.coerce.number().int().default(3002),
  AGENT_MANAGER_URL: z.string().url('AGENT_MANAGER_URL must be a valid URL'),
  AGENT_NODE_ID: z.string().min(36, 'AGENT_NODE_ID must be set after registration'),
  AGENT_SECRET_TOKEN: z.string().min(1, 'AGENT_SECRET_TOKEN is required'),
  AGENT_POLL_INTERVAL_MS: z.coerce.number().int().default(5_000),
  AGENT_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().default(30_000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  VPN_TOKEN: z.string().min(1, 'VPN_TOKEN is required for event reporting'),
  
  // VPN Type Selection
  VPN_TYPE: z.enum(['openvpn', 'wireguard']).default('openvpn'),
  
  // OpenVPN Management Interface (Unix Socket)
  OPENVPN_SOCKET_PATH: z.string().default('/run/openvpn/server.sock'),
  
  // WireGuard Settings
  WIREGUARD_INTERFACE: z.string().default('wg0'),
  
  // Firewall Engine (auto tries to detect iptables vs nftables)
  FIREWALL_ENGINE: z.enum(['iptables', 'nftables', 'ufw', 'firewalld', 'none', 'auto']).default('auto'),
})

export type AgentEnv = z.infer<typeof AgentEnvSchema>

export function loadAgentEnv(): AgentEnv {
  const result = AgentEnvSchema.safeParse(process.env)

  if (!result.success) {
    console.error('❌ Invalid agent configuration:')
    console.error(result.error.flatten().fieldErrors)
    process.exit(1)
  }

  return result.data
}
