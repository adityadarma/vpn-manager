import { z } from 'zod'
import type { TaskAction } from '../types/task'

/**
 * Per-action task payload schemas.
 *
 * Tasks are instructions the manager sends to node agents, which execute them
 * with root privileges. `POST /api/v1/tasks` previously accepted any action
 * name with a free-form payload object, so an admin (or anything able to write
 * to the tasks table) could reach every code path in the agent with arbitrary
 * values.
 *
 * These schemas are the manager-side half of the fix: an action must be one of
 * the known values, and its payload must match the shape that action's handler
 * actually expects. The agent still validates independently — a compromised
 * manager must not be trusted — but this closes the API surface.
 */

// ── Shared primitives ────────────────────────────────────────────────────────

/** Mirrors CreateUserSchema and the agent's assertUsername. */
export const UsernameSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Username may only contain letters, numbers, underscore, hyphen')

const Ipv4Schema = z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/, 'Must be an IPv4 address')
const Ipv4OrCidrSchema = z
  .string()
  .regex(/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/, 'Must be an IPv4 address or CIDR')
const PortStringSchema = z
  .string()
  .regex(/^\d{1,5}(:\d{1,5})?$/, 'Must be a port or port range (e.g. 80:443)')

/**
 * No control characters — these values reach config files and sockets.
 *
 * A factory rather than a single schema so length bounds can be applied before
 * the refinement (`.refine()` returns ZodEffects, which has no `.min()`/`.max()`).
 */
const safeLine = (opts: { min?: number; max?: number } = {}) => {
  let base = z.string()
  if (opts.min !== undefined) base = base.min(opts.min)
  if (opts.max !== undefined) base = base.max(opts.max)
  return base.refine((v) => !/[\r\n\u0000]/.test(v), 'Must not contain control characters')
}

/** Default: no length bound, just control-character rejection. */
const SafeLine = safeLine()

/**
 * A certificate or public key.
 *
 * Deliberately NOT single-line: for OpenVPN these fields carry a full PEM
 * (`user_node_certificates.client_cert` is "PEM format"), and the sessions
 * routes copy that same PEM into the `public_key` field of kick payloads. For
 * WireGuard it is a one-line base64 key instead. So allow newlines, but bound
 * the length and forbid NUL.
 *
 * These values are not interpolated into shell commands — the WireGuard driver
 * runs assertWgKey before using one as a peer key.
 */
const CertOrKeySchema = z
  .string()
  .max(16000)
  .refine((v) => !v.includes('\u0000'), 'Must not contain NUL')

export const TunnelModeSchema = z.enum(['full', 'split'])
export const VpnTypeSchema = z.enum(['openvpn', 'wireguard'])

/**
 * A single OpenVPN/firewall config token: cipher, digest, compression algorithm,
 * protocol, firewall engine name.
 *
 * These are written into server.conf as `<directive> <value>` and are never
 * passed to a shell, so the property that has to hold is that a value cannot
 * introduce a *new* directive or argument: no newlines, no whitespace, no
 * quotes, no shell metacharacters. That is what this regex enforces.
 *
 * A closed enum was tried first and turned out to be wrong, because these
 * columns legitimately drift outside any list the UI offers:
 *
 *  - `POST /nodes/sync-config` lets an agent write values it parsed straight out
 *    of an existing server.conf (openvpn.driver.ts handles `case 'auth'`,
 *    `case 'cipher'`, `case 'comp-lzo'`, `case 'proto'`), so an older server
 *    yields e.g. `auth SHA1` or `comp-lzo yes`.
 *  - the agent's own default firewall engine is `auto` (agent config/env.ts),
 *    and every heartbeat writes it to the node row.
 *
 * With an enum, such a node became uneditable: GET /nodes/:id/config returned
 * the stored value and PUT rejected the very same value with a 400.
 */
const CONFIG_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:+-]*$/

const configToken = (label: string) =>
  z
    .string()
    .min(1)
    .max(64)
    .regex(
      CONFIG_TOKEN_RE,
      `${label} must be a single config token (letters, digits, and . _ : + -)`,
    )

/**
 * Values the UI offers today. Kept exported for reference and for callers that
 * want to present a choice; validation itself is deliberately more permissive
 * so pre-existing nodes stay editable.
 */
export const KNOWN_PROTOCOLS = ['udp', 'tcp'] as const
export const KNOWN_CIPHERS = ['AES-256-GCM', 'AES-128-GCM', 'AES-256-CBC'] as const
export const KNOWN_AUTH_DIGESTS = ['SHA256', 'SHA384', 'SHA512'] as const
export const KNOWN_COMPRESSIONS = ['lz4-v2', 'lz4', 'lzo', 'none'] as const
export const KNOWN_FIREWALL_ENGINES = [
  'iptables',
  'nftables',
  'ufw',
  'firewalld',
  'none',
  'auto',
] as const

export const ProtocolSchema = configToken('protocol')
export const CipherSchema = configToken('cipher')
export const AuthDigestSchema = configToken('auth_digest')
export const CompressionSchema = configToken('compression')
export const FirewallEngineSchema = configToken('firewall_engine')

/**
 * CCD `extra_lines`.
 *
 * These are written verbatim into a per-client config file read by OpenVPN, so
 * an arbitrary string here means arbitrary OpenVPN directives. In practice the
 * manager only ever generates `push "route <ip> <netmask>"` (see
 * cidrsToPushRoutes in the API's ip-pool service), so we allow exactly that
 * plus a small set of harmless client directives.
 */
const CcdExtraLineSchema = SafeLine.refine(
  (line) => {
    const v = line.trim()
    if (v.length === 0 || v.length > 200) return false
    return (
      /^push\s+"route\s+(\d{1,3}\.){3}\d{1,3}\s+(\d{1,3}\.){3}\d{1,3}"$/.test(v) ||
      /^push\s+"dhcp-option\s+(DNS|DOMAIN)\s+[A-Za-z0-9._-]+"$/.test(v) ||
      /^ifconfig-push\s+(\d{1,3}\.){3}\d{1,3}\s+(\d{1,3}\.){3}\d{1,3}$/.test(v) ||
      v === 'disable'
    )
  },
  'Unsupported CCD directive',
)

/**
 * `custom_push_directives` for the server config.
 *
 * Written into server.conf, which runs with `script-security 2`. Directives
 * like `up`, `down`, `plugin` or `client-connect` execute commands, so an
 * allowlist of the first token is required — a denylist would be unsafe.
 */
const CUSTOM_PUSH_ALLOWED = new Set([
  'dhcp-option',
  'route',
  'route-gateway',
  'redirect-gateway',
  'register-dns',
  'block-outside-dns',
  'ping',
  'ping-restart',
  'persist-key',
  'persist-tun',
  'comp-lzo',
  'compress',
])

const CustomPushDirectivesSchema = z
  .string()
  .max(2000)
  .refine((raw) => !/[\r\u0000]/.test(raw), 'Must not contain carriage returns or NUL')
  .refine((raw) => {
    return raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .every((line) => {
        // Strip an optional leading `push "..."` wrapper the agent also accepts.
        const inner = /^push\s+"(.*)"$/.exec(line)?.[1] ?? line
        if (/["'`$;&|<>\\]/.test(inner)) return false
        const first = inner.split(/\s+/)[0] ?? ''
        return CUSTOM_PUSH_ALLOWED.has(first)
      })
  }, 'Contains an unsupported or unsafe OpenVPN directive')

// ── Per-action payloads ──────────────────────────────────────────────────────

const CreateVpnUserPayload = z.object({
  username: UsernameSchema,
})

const RevokeVpnUserPayload = z.object({
  username: UsernameSchema,
  client_cert: CertOrKeySchema.optional().nullable(),
})

const GenerateClientCertPayload = z.object({
  username: UsernameSchema,
  // Reaches EasyRSA as an env var value only, never as argv or a shell word.
  password: z.string().min(1).max(200).optional().nullable(),
  validDays: z.number().int().min(0).max(36500).optional().nullable(),
})

const GenerateClientConfigPayload = z.object({
  username: UsernameSchema,
  serverIp: safeLine({ min: 1, max: 253 }),
  serverPort: z.number().int().min(1).max(65535).optional(),
  protocol: ProtocolSchema.optional(),
  cipher: CipherSchema.optional(),
  authDigest: AuthDigestSchema.optional(),
  clientPrivateKey: z.string().max(8000).optional().nullable(),
  clientVpnIp: Ipv4Schema.optional().nullable(),
  dns: safeLine({ max: 200 }).optional().nullable(),
})

const KickVpnSessionPayload = z.object({
  common_name: UsernameSchema,
  permanent: z.union([z.boolean(), z.literal('true'), z.literal('false')]).optional(),
  public_key: CertOrKeySchema.optional().nullable(),
  vpn_ip: Ipv4Schema.optional().nullable(),
})

const UnkickVpnSessionPayload = z.object({
  common_name: UsernameSchema,
  public_key: CertOrKeySchema.optional().nullable(),
  vpn_ip: Ipv4Schema.optional().nullable(),
  netmask: Ipv4Schema.optional().nullable(),
})

const WriteClientCcdPayload = z.object({
  username: UsernameSchema,
  vpn_ip: Ipv4Schema,
  netmask: Ipv4Schema.optional(),
  extra_lines: z.array(CcdExtraLineSchema).max(100).optional(),
  public_key: CertOrKeySchema.optional().nullable(),
})

const DeleteClientCcdPayload = z.object({
  username: UsernameSchema,
  public_key: CertOrKeySchema.optional().nullable(),
})

const UpdateServerConfigPayload = z
  .object({
    port: z.number().int().min(1).max(65535),
    protocol: ProtocolSchema,
    tunnel_mode: TunnelModeSchema,
    vpn_network: Ipv4Schema,
    vpn_netmask: Ipv4Schema,
    dns_servers: z
      .string()
      .max(200)
      .refine(
        (v) =>
          v
            .split(',')
            .map((d) => d.trim())
            .filter(Boolean)
            .every((d) => /^(\d{1,3}\.){3}\d{1,3}$/.test(d)),
        'dns_servers must be a comma-separated list of IPv4 addresses',
      ),
    push_routes: z
      .string()
      .max(1000)
      .refine(
        (v) =>
          v
            .split(',')
            .map((r) => r.trim())
            .filter(Boolean)
            .every((r) => /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(r)),
        'push_routes must be a comma-separated list of IPv4 CIDRs',
      )
      .optional()
      .nullable(),
    cipher: CipherSchema,
    auth_digest: AuthDigestSchema.optional(),
    compression: CompressionSchema,
    keepalive_ping: z.number().int().min(1).max(3600),
    keepalive_timeout: z.number().int().min(1).max(3600),
    max_clients: z.number().int().min(1).max(100000).optional(),
    group_subnets: z.array(Ipv4OrCidrSchema).max(200).optional(),
    custom_push_directives: CustomPushDirectivesSchema.optional().nullable(),
    firewall_engine: FirewallEngineSchema.optional(),
  })
  // The agent overrides firewall_engine/vpn_type from its own env, and callers
  // sometimes include extra descriptive fields. Strip unknown keys rather than
  // rejecting, but keep every known field strictly typed.
  .passthrough()

const FirewallRulePayload = z.object({
  sourceIp: Ipv4OrCidrSchema,
  destNetwork: Ipv4OrCidrSchema,
  firewall_engine: FirewallEngineSchema.optional(),
})

const PolicyEntrySchema = z.object({
  id: z.string(),
  action: z.enum(['allow', 'deny']),
  protocol: z.enum(['tcp', 'udp', 'icmp', 'all']),
  target_network: Ipv4OrCidrSchema,
  target_port: PortStringSchema.optional().nullable(),
  priority: z.number().int(),
  user_ip: Ipv4Schema.optional().nullable(),
  group_subnet: Ipv4OrCidrSchema.optional().nullable(),
  user_id: z.string().optional().nullable(),
  group_id: z.string().optional().nullable(),
  node_id: z.string().optional().nullable(),
})

const ApplyNetworkPolicyPayload = z.object({
  policies: z.array(PolicyEntrySchema).max(1000),
  firewall_engine: FirewallEngineSchema.optional(),
  vpn_type: VpnTypeSchema.optional(),
})

/** Actions that legitimately carry no parameters. */
const EmptyPayload = z.object({}).passthrough()

/**
 * The authoritative action → payload map.
 *
 * Keys double as the action allowlist: anything absent here is rejected.
 */
export const TASK_PAYLOAD_SCHEMAS = {
  create_vpn_user: CreateVpnUserPayload,
  revoke_vpn_user: RevokeVpnUserPayload,
  generate_client_cert: GenerateClientCertPayload,
  generate_client_config: GenerateClientConfigPayload,
  kick_vpn_session: KickVpnSessionPayload,
  unkick_vpn_session: UnkickVpnSessionPayload,
  write_client_ccd: WriteClientCcdPayload,
  delete_client_ccd: DeleteClientCcdPayload,
  update_server_config: UpdateServerConfigPayload,
  add_firewall_rule: FirewallRulePayload,
  remove_firewall_rule: FirewallRulePayload,
  apply_network_policy: ApplyNetworkPolicyPayload,
  reload_openvpn: EmptyPayload,
  sync_certificates: EmptyPayload,
  sync_server_config: EmptyPayload,
} as const satisfies Record<TaskAction, z.ZodTypeAny>

export const TASK_ACTIONS = Object.keys(TASK_PAYLOAD_SCHEMAS) as TaskAction[]

export function isKnownTaskAction(action: unknown): action is TaskAction {
  return typeof action === 'string' && action in TASK_PAYLOAD_SCHEMAS
}

export type TaskPayloadValidationResult =
  | { ok: true; action: TaskAction; payload: Record<string, unknown> }
  | { ok: false; error: string }

/**
 * Validates an action name and its payload together.
 *
 * Used by `POST /api/v1/tasks` on the manager and available to the agent for
 * symmetric checking.
 */
export function validateTaskPayload(
  action: unknown,
  payload: unknown,
): TaskPayloadValidationResult {
  if (!isKnownTaskAction(action)) {
    return {
      ok: false,
      error: `Unknown action "${String(action)}". Supported actions: ${TASK_ACTIONS.slice()
        .sort()
        .join(', ')}`,
    }
  }

  const schema = TASK_PAYLOAD_SCHEMAS[action]
  const parsed = schema.safeParse(payload ?? {})
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    return { ok: false, error: `Invalid payload for "${action}" — ${detail}` }
  }

  return { ok: true, action, payload: parsed.data as Record<string, unknown> }
}
