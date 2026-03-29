# Deployment Guide

## Overview

VPN Manager uses a simplified deployment model with 2 Docker images:
- **Manager** (`vpn-manager:latest`) - Web UI + API in single container
- **Agent** (`vpn-agent:latest`) - VPN node agent

## Architecture

```
┌─────────────────────────────────┐
│   Manager Server                │
│  ┌──────────────────────────┐   │
│  │   vpn-manager:latest     │   │
│  │  ┌────────┐  ┌────────┐  │   │
│  │  │  Web   │  │  API   │  │   │
│  │  │ :3000  │  │ :3001  │  │   │
│  │  └────────┘  └────────┘  │   │
│  │   (Supervisor manages)   │   │
│  └──────────────────────────┘   │
│              │                  │
│     ┌────────┴────────┐         │
│     │    Database     │         │
│     │ (SQLite/PG/MY)  │         │
│     └─────────────────┘         │
└─────────────────────────────────┘
              │
              │ HTTPS API
              │
    ┌─────────┴─────────┐
    │                   │
┌───▼────────┐  ┌───────▼───┐
│ VPN Node 1 │  │ VPN Node 2│
│ ┌────────┐ │  │ ┌────────┐│
│ │ Agent  │ │  │ │ Agent  ││
│ └────────┘ │  │ └────────┘│
│ ┌────────┐ │  │ ┌────────┐│
│ │OpenVPN │ │  │ │OpenVPN ││
│ └────────┘ │  │ └────────┘│
└────────────┘  └───────────┘
```

## Images

### Manager Image
```
ghcr.io/adityadarma/vpn-manager:latest
```

**Contains:**
- Web UI (ReactJS) on port 3000
- API (Fastify) on port 3001
- Managed by supervisor

**Size:** ~450MB

**Use for:**
- Central management server
- Dashboard and API
- User/node/policy management

### Agent Image
```
ghcr.io/adityadarma/vpn-agent:latest
```

**Contains:**
- VPN node agent
- Status monitoring
- Task execution

**Size:** ~200MB

**Use for:**
- VPN server nodes
- Distributed deployment

## Deployment Steps

### 1. Deploy Manager

**Prerequisites:**
- Docker and Docker Compose installed
- Domain name (optional, for HTTPS)
- Ports 3000 and 3001 available

**Quick Install:**
```bash
curl -fsSL https://raw.githubusercontent.com/adityadarma/vpn-manager/main/scripts/install-manager.sh | sudo bash
```

**Manual Install:**
```bash
# Clone repository
git clone https://github.com/adityadarma/vpn-manager.git
cd vpn-manager

# Configure environment
cp .env.example .env
nano .env

# Required variables:
# JWT_SECRET=your-secure-random-string-min-32-chars
# VPN_TOKEN=your-vpn-token
# NODE_REGISTRATION_KEY=your-registration-key

# Build and start
docker compose build
docker compose up -d

# Check status
docker compose ps
docker compose logs -f manager
```

**Verify:**
```bash
# Check API
curl http://localhost:3001/api/v1/health

# Check Web UI
curl http://localhost:3000

# Or open in browser
open http://localhost:3000
```

### 2. Deploy Agent (on VPN Nodes)

**Prerequisites:**
- VPN server installed (OpenVPN or WireGuard)
- Docker installed
- Manager URL accessible
- Node registered in manager

**Quick Install:**
```bash
curl -fsSL https://raw.githubusercontent.com/adityadarma/vpn-manager/main/scripts/install-node.sh | sudo bash
```

**Manual Install:**
```bash
# Create .env.agent file
cat > .env.agent << EOF
AGENT_MANAGER_URL=https://manager.example.com
AGENT_NODE_ID=your-node-id
AGENT_SECRET_TOKEN=your-secret-token
VPN_TOKEN=your-vpn-token
EOF

# Download docker-compose
wget https://raw.githubusercontent.com/adityadarma/vpn-manager/main/docker-compose.agent.yml

# Start agent
docker compose -f docker-compose.agent.yml up -d

# Check status
docker compose -f docker-compose.agent.yml ps
docker compose -f docker-compose.agent.yml logs -f agent
```

**Verify:**
```bash
# Check agent logs
docker logs vpn-agent

# Should see:
# ✓ Connected to manager
# 💓 Heartbeat started
# 🔄 Task poller started
# 📊 Status monitor started
```

## Database Options

### SQLite (Default)
```bash
# No additional configuration needed
docker compose up -d
```

**Pros:**
- Simple setup
- No external database
- Good for small deployments

**Cons:**
- Single file
- Limited concurrency
- Not suitable for high traffic

### PostgreSQL
```bash
# Start with PostgreSQL
docker compose --profile postgres up -d
```

**Environment:**
```env
DATABASE_TYPE=postgres
DATABASE_URL=postgresql://vpn:vpn_secret@postgres:5432/vpn
```

**Pros:**
- Better performance
- Better concurrency
- Production ready

**Cons:**
- Additional container
- More complex setup

### MySQL/MariaDB
```bash
# Start with MariaDB
docker compose --profile mysql up -d
```

**Environment:**
```env
DATABASE_TYPE=mysql
DATABASE_URL=mysql://vpn:vpn_secret@mariadb:3306/vpn
```

**Pros:**
- Familiar for many users
- Good performance
- Production ready

**Cons:**
- Additional container
- More complex setup

## Scaling

### Vertical Scaling (Recommended)
Increase resources for manager container:

```yaml
services:
  manager:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
```

### Horizontal Scaling (Agents)
Deploy multiple agent nodes:

```bash
# Node 1
ssh node1.example.com
docker compose -f docker-compose.agent.yml up -d

# Node 2
ssh node2.example.com
docker compose -f docker-compose.agent.yml up -d

# Node 3
ssh node3.example.com
docker compose -f docker-compose.agent.yml up -d
```

## High Availability

### Manager HA
Use external load balancer:

```
┌──────────────┐
│ Load Balancer│
│  (HAProxy)   │
└──────┬───────┘
       │
   ┌───┴───┐
   │       │
┌──▼──┐ ┌──▼──┐
│Mgr 1│ │Mgr 2│
└─────┘ └─────┘
   │       │
   └───┬───┘
       │
  ┌────▼────┐
  │Database │
  │(PG/MY)  │
  └─────────┘
```

**Requirements:**
- External PostgreSQL/MySQL
- Shared session storage
- Load balancer (HAProxy, Nginx, etc.)

### Agent HA
Deploy multiple agents per region:

```
Region 1:
- node1-us-east
- node2-us-east (backup)

Region 2:
- node1-eu-west
- node2-eu-west (backup)
```

## Monitoring

### Manager Monitoring
```bash
# Check health
curl http://localhost:3001/api/v1/health

# Check logs
docker logs vpn-manager

# Check resource usage
docker stats vpn-manager
```

### Agent Monitoring
```bash
# Check logs
docker logs vpn-agent

# Check VPN status
docker exec vpn-agent cat /var/log/openvpn/status.log

# Check resource usage
docker stats vpn-agent
```

### Prometheus Metrics (Optional)
Add metrics endpoint:

```yaml
services:
  manager:
    environment:
      ENABLE_METRICS: "true"
      METRICS_PORT: "9090"
    ports:
      - "9090:9090"
```

## Backup

### Manager Backup
```bash
# Backup database (SQLite)
docker exec vpn-manager cp /data/vpn.sqlite /data/backup.sqlite
docker cp vpn-manager:/data/backup.sqlite ./backup-$(date +%Y%m%d).sqlite

# Backup database (PostgreSQL)
docker exec vpn-postgres pg_dump -U vpn vpn > backup-$(date +%Y%m%d).sql

# Backup environment
cp .env .env.backup
```

### Agent Backup
```bash
# Backup VPN config
tar -czf vpn-config-backup-$(date +%Y%m%d).tar.gz /etc/openvpn

# Backup certificates
tar -czf vpn-certs-backup-$(date +%Y%m%d).tar.gz /etc/openvpn/easy-rsa/pki
```

## Troubleshooting

### Manager Issues

**Manager not starting:**
```bash
# Check logs
docker logs vpn-manager

# Check environment
docker exec vpn-manager env | grep -E "JWT|DATABASE"

# Restart
docker compose restart manager
```

**Database connection failed:**
```bash
# Check database
docker compose ps postgres

# Check connection
docker exec vpn-manager nc -zv postgres 5432

# Check credentials
docker exec vpn-manager env | grep DATABASE_URL
```

**Web UI not accessible:**
```bash
# Check if running
docker ps | grep vpn-manager

# Check ports
netstat -tlnp | grep -E "3000|3001"

# Check logs
docker logs vpn-manager | grep -E "web|api"
```

### Agent Issues

**Agent not connecting:**
```bash
# Check logs
docker logs vpn-agent

# Check manager URL
docker exec vpn-agent env | grep AGENT_MANAGER_URL

# Test connection
docker exec vpn-agent curl -f $AGENT_MANAGER_URL/api/v1/health
```

**VPN status not updating:**
```bash
# Check status file
docker exec vpn-agent cat /var/log/openvpn/status.log

# Check socket
docker exec vpn-agent ls -la /run/openvpn/server.sock

# Restart agent
docker compose -f docker-compose.agent.yml restart
```

## Security

### Manager Security
- Use strong JWT_SECRET (min 32 chars)
- Use HTTPS (reverse proxy)
- Restrict API access (firewall)
- Regular updates
- Database encryption

### Agent Security
- Use secure tokens
- Restrict manager access
- VPN encryption (TLS-Crypt)
- Regular updates
- Audit logs

## Updates

### Update Manager
```bash
# Pull latest image
docker compose pull manager

# Restart with new image
docker compose up -d manager

# Check version
docker exec vpn-manager node --version
```

### Update Agent
```bash
# Pull latest image
docker compose -f docker-compose.agent.yml pull agent

# Restart with new image
docker compose -f docker-compose.agent.yml up -d agent

# Check version
docker logs vpn-agent | head
```

## Best Practices

1. **Use PostgreSQL for production** - Better performance and reliability
2. **Enable HTTPS** - Use reverse proxy (Nginx, Caddy)
3. **Regular backups** - Automate database backups
4. **Monitor resources** - Set up alerts for high usage
5. **Update regularly** - Keep images up to date
6. **Use strong secrets** - Generate random tokens
7. **Restrict access** - Use firewall rules
8. **Enable logging** - Centralized log management
9. **Test before deploy** - Use staging environment
10. **Document changes** - Keep deployment notes

## Support

For issues or questions:
- [Installation Guide](INSTALLATION.md)
- [Image Naming](IMAGE-NAMING.md)
- [Troubleshooting](TROUBLESHOOTING-ACTIVE-SESSIONS.md)
- [GitHub Issues](https://github.com/adityadarma/vpn-manager/issues)
