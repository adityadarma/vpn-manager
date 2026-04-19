import { z } from 'zod'

export const RegisterNodeSchema = z.object({
  hostname: z.string().min(1),
  ip: z.string().ip(),
  port: z.number().int().min(1).max(65535).default(1194),
  region: z.string().optional(),
  version: z.string().min(1),
})

export const HeartbeatSchema = z.object({
  nodeId: z.string().uuid(),
  caCert: z.string().optional(),
  taKey: z.string().optional(),
  firewallRules: z.string().optional(),
  firewallEngine: z.string().optional(),
  
  // Real-time VPN data from management interface
  clients: z.array(z.object({
    commonName: z.string(),
    realAddress: z.string(),
    virtualAddress: z.string(),
    bytesReceived: z.number(),
    bytesSent: z.number(),
    connectedSince: z.string().or(z.date()),
    lastActivity: z.string().or(z.date()).optional(),
  })).optional(),
  
  metrics: z.object({
    totalClients: z.number(),
    totalBytesReceived: z.number(),
    totalBytesSent: z.number(),
    uptime: z.number(),
  }).optional(),
  
  serverInfo: z.object({
    version: z.string(),
    uptime: z.number(),
    mode: z.string(),
  }).optional(),
})

export const NodeIdParamSchema = z.object({
  id: z.string().uuid(),
})

export type RegisterNodeInput = z.infer<typeof RegisterNodeSchema>
export type HeartbeatInput = z.infer<typeof HeartbeatSchema>
