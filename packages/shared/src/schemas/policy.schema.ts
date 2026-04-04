import { z } from 'zod'

export const CreatePolicySchema = z.object({
  userId: z.string().uuid().optional().nullable(),
  groupId: z.string().uuid().optional().nullable(),
  nodeId: z.string().uuid().optional().nullable(),
  targetNetwork: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/, 'Must be a valid IP or CIDR (e.g. 192.168.1.10/32)'),
  protocol: z.enum(['tcp', 'udp', 'icmp', 'all']).default('all'),
  targetPort: z.string().optional().nullable().describe('Specific port (e.g. 5432) or port range (e.g. 80:443)'),
  action: z.enum(['allow', 'deny']).default('allow'),
  priority: z.number().int().min(0).max(1000).default(100),
  description: z.string().max(500).optional().nullable(),
}).refine(
  (data) => !(data.userId && data.groupId),
  { message: 'Cannot specify both userId and groupId' }
)

export type CreatePolicyInput = z.infer<typeof CreatePolicySchema>
