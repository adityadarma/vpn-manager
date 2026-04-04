# API Endpoints Documentation

Complete API reference for VPN Manager.

## Base URL

```
http://your-server:3001/api/v1
```

## Authentication

Most endpoints require authentication via JWT token:

```bash
Authorization: Bearer <jwt_token>
```

Some endpoints use alternative authentication:
- **VPN Hooks**: `X-VPN-Token` header
- **Agent**: `Authorization: Bearer <agent_secret_token>`
- **Node Registration**: Admin JWT or Registration Key

---

## Nodes

### List All Nodes

```http
GET /nodes
```

**Authentication:** Required (User or Admin)

**Response:**
```json
[
  {
    "id": "uuid",
    "hostname": "vpn-node-1",
    "ip_address": "203.0.113.1",
    "port": 1194,
    "region": "Singapore",
    "status": "online",
    "version": "1.0.0",
    "last_seen": "2024-03-18T10:30:00Z",
    "created_at": "2024-03-01T00:00:00Z"
  }
]
```

---

### Get Node by ID

```http
GET /nodes/:id
```

**Authentication:** Required (User or Admin)

**Response:**
```json
{
  "id": "uuid",
  "hostname": "vpn-node-1",
  "ip_address": "203.0.113.1",
  "port": 1194,
  "region": "Singapore",
  "status": "online",
  "version": "1.0.0",
  "last_seen": "2024-03-18T10:30:00Z",
  "created_at": "2024-03-01T00:00:00Z"
}
```

---

### Update Node Information

```http
PUT /nodes/:id
```

**Authentication:** Required (Admin only)

**Request Body:**
```json
{
  "hostname": "vpn-node-updated",
  "ip_address": "203.0.113.2",
  "region": "Tokyo"
}
```

**Notes:**
- All fields are optional
- At least one field must be provided
- Hostname and IP must be unique
- Region can be null

**Response:**
```json
{
  "id": "uuid",
  "hostname": "vpn-node-updated",
  "ip_address": "203.0.113.2",
  "region": "Tokyo",
  "status": "online",
  "version": "1.0.0",
  "last_seen": "2024-03-18T10:30:00Z",
  "created_at": "2024-03-01T00:00:00Z"
}
```

**Error Responses:**
- `404` - Node not found
- `409` - Hostname or IP already exists
- `400` - No valid fields to update

---

### Register Node

```http
POST /nodes/register
```

**Authentication:** Admin JWT OR Registration Key

**Request Body:**
```json
{
  "hostname": "vpn-node-1",
  "ip": "203.0.113.1",
  "port": 1194,
  "region": "Singapore",
  "version": "1.0.0",
  "registrationKey": "your-registration-key",
  "config": {
    "port": 1194,
    "protocol": "udp",
    "tunnel_mode": "split",
    "vpn_network": "10.8.0.0",
    "vpn_netmask": "255.255.255.0",
    "dns_servers": "8.8.8.8,1.1.1.1",
    "cipher": "AES-256-GCM"
  }
}
```

**Response:**
```json
{
  "id": "uuid",
  "token": "agent-secret-token",
  "message": "Node registered successfully"
}
```

**Notes:**
- Token is returned ONCE - must be saved securely
- Config is optional - defaults will be used if not provided
- Either admin JWT or valid registration key required

---

### Get Node Configuration

```http
GET /nodes/:id/config
```

**Authentication:** Required (User or Admin)

**Response:**
```json
{
  "port": 1194,
  "protocol": "udp",
  "tunnel_mode": "split",
  "vpn_network": "10.8.0.0",
  "vpn_netmask": "255.255.255.0",
  "dns_servers": "8.8.8.8,1.1.1.1",
  "push_routes": "192.168.1.0/24",
  "cipher": "AES-256-GCM",
  "auth_digest": "SHA256",
  "compression": "lz4-v2",
  "keepalive_ping": 10,
  "keepalive_timeout": 60,
  "max_clients": 100
}
```

---

### Update Node Configuration

```http
PUT /nodes/:id/config
```

**Authentication:** Required (Admin only)

**Request Body:**
```json
{
  "port": 1194,
  "protocol": "udp",
  "tunnel_mode": "split",
  "vpn_network": "10.8.0.0",
  "vpn_netmask": "255.255.255.0",
  "dns_servers": "8.8.8.8,1.1.1.1",
  "push_routes": "192.168.1.0/24,10.0.0.0/8",
  "cipher": "AES-256-GCM",
  "auth_digest": "SHA256",
  "compression": "lz4-v2",
  "keepalive_ping": 10,
  "keepalive_timeout": 60,
  "max_clients": 100
}
```

**Response:**
```json
{
  "message": "Configuration update scheduled",
  "taskId": "task-uuid"
}
```

**Notes:**
- Creates a task for agent to apply configuration
- Agent will update OpenVPN server config
- Check task status to verify completion

---

### Delete Node

```http
DELETE /nodes/:id
```

**Authentication:** Required (Admin only)

**Response:** `204 No Content`

---

### Node Heartbeat

```http
POST /nodes/heartbeat
```

**Authentication:** Agent token

**Request Body:**
```json
{
  "nodeId": "uuid",
  "caCert": "-----BEGIN CERTIFICATE-----...",
  "taKey": "-----BEGIN OpenVPN Static key-----..."
}
```

**Response:**
```json
{
  "ok": true
}
```

**Notes:**
- Called by agent every 30 seconds (default)
- Updates node status to "online"
- Optionally syncs CA cert and TLS key

---

### Poll Tasks

```http
GET /nodes/:id/tasks
```

**Authentication:** Agent token

**Response:**
```json
{
  "tasks": [
    {
      "id": "task-uuid",
      "action": "update_server_config",
      "payload": {
        "port": 1194,
        "protocol": "udp"
      },
      "created_at": "2024-03-18T10:30:00Z"
    }
  ]
}
```

**Notes:**
- Returns pending tasks for the node
- Tasks are marked as "running" when returned
- Agent must report task result after execution

---

### Sync Certificates

```http
POST /nodes/sync-certs
```

**Authentication:** Agent token

**Request Body:**
```json
{
  "ca_cert": "-----BEGIN CERTIFICATE-----...",
  "ta_key": "-----BEGIN OpenVPN Static key-----..."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Certificates synced successfully",
  "node_id": "uuid"
}
```

---

## VPN Hooks

### Record Connection

```http
POST /vpn/connect
```

**Authentication:** `X-VPN-Token` header

**Description:** Records VPN client connection and validates user status. Called by `vpn-connect.sh` hook when client connects.

**Request Body:**
```json
{
  "username": "john",
  "vpn_ip": "10.8.0.2",
  "node_id": "uuid",
  "real_ip": "192.168.1.100",
  "client_version": "OpenVPN 2.5.8",
  "device_name": "laptop-001"
}
```

**Response:**
```json
{
  "session_id": "session-uuid",
  "push_routes": ["192.168.1.0/24", "10.0.0.0/8"],
  "static_ip": "10.8.0.100"
}
```

**Status Codes:**
- `201` - Session created successfully
- `403` - Account disabled or expired
- `404` - User or node not found
- `503` - VPN_TOKEN not configured

---

### Record Disconnection

```http
POST /vpn/disconnect
```

**Authentication:** `X-VPN-Token` header

**Request Body:**
```json
{
  "username": "john",
  "node_id": "uuid",
  "bytes_sent": 1048576,
  "bytes_received": 2097152,
  "disconnect_reason": "normal"
}
```

**Response:**
```json
{
  "ok": true,
  "sessions_closed": 1
}
```

---

### Update Session Activity

```http
POST /vpn/activity
```

**Authentication:** `X-VPN-Token` header

**Request Body:**
```json
{
  "session_id": "session-uuid",
  "bytes_sent": 1048576,
  "bytes_received": 2097152,
  "latency_ms": 25,
  "packet_loss_percent": 0.5
}
```

**Response:**
```json
{
  "ok": true
}
```

---

## Sessions

### List Active Sessions

```http
GET /sessions
```

**Authentication:** Required (User or Admin)

**Query Parameters:**
- `user_id` - Filter by user ID
- `node_id` - Filter by node ID
- `active` - Filter active sessions (true/false)

**Response:**
```json
[
  {
    "id": "session-uuid",
    "user_id": "user-uuid",
    "username": "john",
    "node_id": "node-uuid",
    "node_hostname": "vpn-node-1",
    "vpn_ip": "10.8.0.2",
    "real_ip": "192.168.1.100",
    "client_version": "OpenVPN 2.5.8",
    "device_name": "laptop-001",
    "bytes_sent": 1048576,
    "bytes_received": 2097152,
    "connected_at": "2024-03-18T10:00:00Z",
    "last_activity_at": "2024-03-18T10:30:00Z",
    "disconnected_at": null
  }
]
```

---

### Get Session Details

```http
GET /sessions/:id
```

**Authentication:** Required (User or Admin)

**Response:**
```json
{
  "id": "session-uuid",
  "user_id": "user-uuid",
  "username": "john",
  "node_id": "node-uuid",
  "node_hostname": "vpn-node-1",
  "vpn_ip": "10.8.0.2",
  "real_ip": "192.168.1.100",
  "client_version": "OpenVPN 2.5.8",
  "device_name": "laptop-001",
  "bytes_sent": 1048576,
  "bytes_received": 2097152,
  "connected_at": "2024-03-18T10:00:00Z",
  "last_activity_at": "2024-03-18T10:30:00Z",
  "disconnected_at": null,
  "disconnect_reason": null,
  "connection_duration_seconds": 1800,
  "activities": [
    {
      "recorded_at": "2024-03-18T10:15:00Z",
      "bytes_sent_delta": 524288,
      "bytes_received_delta": 1048576,
      "latency_ms": 25,
      "packet_loss_percent": 0.5
    }
  ]
}
```

---

### Get Session Statistics

```http
GET /sessions/stats
```

**Authentication:** Required (User or Admin)

**Response:**
```json
{
  "total_sessions": 150,
  "active_sessions": 25,
  "total_users": 50,
  "total_bandwidth": 10737418240,
  "avg_session_duration": 3600
}
```

---

### Kick User Session

```http
POST /sessions/:id/kick
```

**Authentication:** Required (Admin only)

**Response:**
```json
{
  "message": "Session kick task created",
  "taskId": "task-uuid"
}
```

**Notes:**
- Creates a task for agent to disconnect user
- Agent will terminate OpenVPN connection
- Session will be marked as disconnected with reason "admin_kick"

---

## Tasks

### List Tasks

```http
GET /tasks
```

**Authentication:** Required (User or Admin)

**Query Parameters:**
- `nodeId` - Filter by node ID
- `status` - Filter by status (pending/running/done/failed)

**Response:**
```json
[
  {
    "id": "task-uuid",
    "node_id": "node-uuid",
    "node_hostname": "vpn-node-1",
    "action": "update_server_config",
    "payload": "{...}",
    "status": "done",
    "result": "{...}",
    "error_message": null,
    "created_at": "2024-03-18T10:00:00Z",
    "completed_at": "2024-03-18T10:01:00Z"
  }
]
```

---

### Create Task

```http
POST /tasks
```

**Authentication:** Required (Admin only)

**Request Body:**
```json
{
  "node_id": "node-uuid",
  "action": "sync_certificates",
  "payload": {}
}
```

**Response:**
```json
{
  "id": "task-uuid",
  "node_id": "node-uuid",
  "action": "sync_certificates",
  "status": "pending",
  "created_at": "2024-03-18T10:00:00Z"
}
```

---

### Report Task Result

```http
POST /tasks/:id/result
```

**Authentication:** Agent token

**Request Body:**
```json
{
  "status": "success",
  "result": {
    "message": "Configuration updated successfully"
  },
  "errorMessage": null
}
```

**Response:**
```json
{
  "ok": true
}
```

---

## Audit Logs

### Get Connection Attempts

```http
GET /audit/connection-attempts
```

**Authentication:** Required (Admin only)

**Query Parameters:**
- `user_id` - Filter by user ID
- `limit` - Limit results (default: 100)

**Response:**
```json
[
  {
    "id": "uuid",
    "user_id": "user-uuid",
    "username": "john",
    "real_ip": "192.168.1.100",
    "failure_reason": "invalid_password",
    "error_details": "Password mismatch",
    "attempted_at": "2024-03-18T10:00:00Z"
  }
]
```

---

### Get Connection Attempt Statistics

```http
GET /audit/connection-attempts/stats
```

**Authentication:** Required (Admin only)

**Response:**
```json
{
  "total_attempts": 50,
  "by_reason": {
    "invalid_password": 30,
    "account_disabled": 10,
    "account_expired": 5,
    "invalid_credentials": 5
  },
  "recent_attempts": [...]
}
```

---

## Error Responses

All endpoints may return these error responses:

### 400 Bad Request
```json
{
  "error": "Bad Request",
  "message": "Validation error message"
}
```

### 401 Unauthorized
```json
{
  "error": "Unauthorized",
  "message": "Authentication required"
}
```

### 403 Forbidden
```json
{
  "error": "Forbidden",
  "message": "Insufficient permissions"
}
```

### 404 Not Found
```json
{
  "error": "Not Found",
  "message": "Resource not found"
}
```

### 409 Conflict
```json
{
  "error": "Conflict",
  "message": "Resource already exists"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal Server Error",
  "message": "An unexpected error occurred"
}
```

---

## Rate Limiting

API endpoints are rate-limited to prevent abuse:

- **Default**: 100 requests per minute per IP
- **Authentication endpoints**: 10 requests per minute per IP

Rate limit headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1647604800
```

---

## Webhooks (Coming Soon)

Future support for webhooks to notify external systems of events:
- User connected
- User disconnected
- Certificate expiring
- Node offline
- Task completed

---

## SDK Examples

### JavaScript/TypeScript

```typescript
import axios from 'axios'

const api = axios.create({
  baseURL: 'http://your-server:3001/api/v1',
  headers: {
    'Authorization': `Bearer ${jwtToken}`
  }
})

// List nodes
const nodes = await api.get('/nodes')

// Update node
await api.put('/nodes/node-uuid', {
  hostname: 'new-hostname',
  region: 'Tokyo'
})

// Get active sessions
const sessions = await api.get('/sessions', {
  params: { active: true }
})
```

### Python

```python
import requests

api_url = 'http://your-server:3001/api/v1'
headers = {'Authorization': f'Bearer {jwt_token}'}

# List nodes
response = requests.get(f'{api_url}/nodes', headers=headers)
nodes = response.json()

# Update node
requests.put(
    f'{api_url}/nodes/{node_id}',
    headers=headers,
    json={'hostname': 'new-hostname', 'region': 'Tokyo'}
)

# Get active sessions
response = requests.get(
    f'{api_url}/sessions',
    headers=headers,
    params={'active': True}
)
sessions = response.json()
```

### cURL

```bash
# List nodes
curl -H "Authorization: Bearer $JWT_TOKEN" \
  http://your-server:3001/api/v1/nodes

# Update node
curl -X PUT \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"hostname":"new-hostname","region":"Tokyo"}' \
  http://your-server:3001/api/v1/nodes/$NODE_ID

# Get active sessions
curl -H "Authorization: Bearer $JWT_TOKEN" \
  "http://your-server:3001/api/v1/sessions?active=true"
```

---

## Postman Collection

Import the Postman collection for easy API testing:

[Download Postman Collection](../postman/vpn-manager.postman_collection.json)

---

## OpenAPI Specification

View the complete OpenAPI/Swagger specification:

```
http://your-server:3001/documentation
```

Or download the spec:

```bash
curl http://your-server:3001/documentation/json > openapi.json
```
