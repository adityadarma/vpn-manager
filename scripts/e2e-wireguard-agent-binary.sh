#!/usr/bin/env bash
# Full process E2E: compiled manager + compiled agent + real WireGuard peer.
# Run only on an ephemeral Linux Docker runner. It creates privileged network
# interfaces inside disposable containers and removes all resources on exit.
set -euo pipefail

NETWORK="vpn-agent-e2e-$RANDOM"
MANAGER="vpn-manager-e2e-$RANDOM"
AGENT="vpn-agent-e2e-$RANDOM"
CLIENT="vpn-client-e2e-$RANDOM"
ADMIN_PASSWORD="e2e-admin-password-32-characters"
JWT_SECRET="e2e-jwt-secret-that-is-at-least-32-characters"
COOKIE_JAR=$(mktemp)

cleanup() {
  docker rm -f "$CLIENT" "$AGENT" "$MANAGER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  rm -f "$COOKIE_JAR"
}
trap cleanup EXIT

docker build -t vpn-manager-e2e:local .
docker build -t vpn-agent-e2e:local -f apps/agent/Dockerfile .
docker network create "$NETWORK" >/dev/null

docker run -d --name "$MANAGER" --network "$NETWORK" --network-alias manager -p 3000 \
  -e NODE_ENV=production -e PORT=3000 -e HOST=0.0.0.0 \
  -e JWT_SECRET="$JWT_SECRET" -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  -e DATABASE_TYPE=sqlite -e DATABASE_SQLITE_PATH=/data/e2e.sqlite \
  vpn-manager-e2e:local >/dev/null

MANAGER_PORT=$(docker port "$MANAGER" 3000/tcp | cut -d: -f2)

READY=false
for _ in $(seq 1 60); do
  if curl --retry 0 --connect-timeout 1 -fsS "http://127.0.0.1:$MANAGER_PORT/api/v1/health" >/dev/null 2>&1; then
    READY=true
    break
  fi
  sleep 1
done
if [ "$READY" != true ]; then
  docker logs "$MANAGER"
  exit 1
fi

curl -fsS -c "$COOKIE_JAR" -X POST "http://127.0.0.1:$MANAGER_PORT/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASSWORD\"}" >/dev/null

REGISTER=$(curl -fsS -X POST "http://127.0.0.1:$MANAGER_PORT/api/v1/nodes/register" \
  -b "$COOKIE_JAR" -H 'Content-Type: application/json' \
  -d '{"hostname":"wg-e2e-node","ip":"172.30.0.10","port":51820,"vpn_type":"wireguard","version":"e2e"}')
NODE_ID=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).id)' "$REGISTER")
NODE_TOKEN=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).token)' "$REGISTER")

docker run -d --name "$AGENT" --network "$NETWORK" --network-alias agent --privileged \
  -e NODE_ENV=production -e VPN_TYPE=wireguard -e FIREWALL_ENGINE=none \
  -e AGENT_MANAGER_URL=http://manager:3000 -e AGENT_NODE_ID="$NODE_ID" \
  -e AGENT_SECRET_TOKEN="$NODE_TOKEN" -e VPN_TOKEN=e2e-vpn-event-token \
  -e AGENT_POLL_INTERVAL_MS=250 -e AGENT_HEARTBEAT_INTERVAL_MS=500 \
  --entrypoint sh vpn-agent-e2e:local -ec '
    mkdir -p /etc/wireguard
    wg genkey | tee /etc/wireguard/privatekey | wg pubkey > /etc/wireguard/publickey
    cat > /etc/wireguard/wg0.conf <<EOF
[Interface]
PrivateKey = $(cat /etc/wireguard/privatekey)
Address = 10.250.0.1/24
ListenPort = 51820
EOF
    wg-quick up wg0
    exec node /app/dist/index.js
  ' >/dev/null

CLIENT_PRIVATE=$(docker run --rm --entrypoint sh vpn-agent-e2e:local -ec 'wg genkey')
CLIENT_PUBLIC=$(printf '%s\n' "$CLIENT_PRIVATE" | docker run -i --rm --entrypoint wg vpn-agent-e2e:local pubkey)

TASK=$(curl -fsS -X POST "http://127.0.0.1:$MANAGER_PORT/api/v1/tasks" \
  -b "$COOKIE_JAR" -H 'Content-Type: application/json' \
  -d "{\"node_id\":\"$NODE_ID\",\"action\":\"write_client_ccd\",\"payload\":{\"username\":\"e2e_wg_user\",\"vpn_ip\":\"10.250.0.2\",\"public_key\":\"$CLIENT_PUBLIC\"}}")
TASK_ID=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).id)' "$TASK")

for _ in $(seq 1 40); do
  STATUS=$(curl -fsS "http://127.0.0.1:$MANAGER_PORT/api/v1/tasks?nodeId=$NODE_ID" -b "$COOKIE_JAR")
  STATE=$(node -e 'const t=JSON.parse(process.argv[1]).find(x=>x.id===process.argv[2]);process.stdout.write(t?.status||"")' "$STATUS" "$TASK_ID")
  [ "$STATE" = done ] && break
  [ "$STATE" = failed ] && { docker logs "$AGENT"; exit 1; }
  sleep .25
done
[ "$STATE" = done ]

SERVER_PUBLIC=$(docker exec "$AGENT" cat /etc/wireguard/publickey)
AGENT_IP=$(docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$AGENT")
docker run -d --name "$CLIENT" --network "$NETWORK" --privileged \
  --entrypoint sh vpn-agent-e2e:local -ec "
    ip link add wgclient0 type wireguard
    printf '%s\\n' '$CLIENT_PRIVATE' > /tmp/privatekey
    wg set wgclient0 private-key /tmp/privatekey peer '$SERVER_PUBLIC' endpoint '$AGENT_IP:51820' allowed-ips 10.250.0.1/32 persistent-keepalive 1
    ip addr add 10.250.0.2/32 dev wgclient0
    ip link set wgclient0 up
    ip route add 10.250.0.1/32 dev wgclient0
    ping -c 3 -W 1 10.250.0.1
    sleep infinity
  " >/dev/null

for _ in $(seq 1 20); do
  docker logs "$CLIENT" 2>&1 | grep -q 'bytes from 10.250.0.1' && break
  sleep .25
done
docker logs "$CLIENT" 2>&1 | grep -q 'bytes from 10.250.0.1'

KICK_TASK=$(curl -fsS -X POST "http://127.0.0.1:$MANAGER_PORT/api/v1/tasks" \
  -b "$COOKIE_JAR" -H 'Content-Type: application/json' \
  -d "{\"node_id\":\"$NODE_ID\",\"action\":\"kick_vpn_session\",\"payload\":{\"common_name\":\"e2e_wg_user\",\"permanent\":true,\"public_key\":\"$CLIENT_PUBLIC\"}}")
KICK_TASK_ID=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).id)' "$KICK_TASK")

for _ in $(seq 1 40); do
  STATUS=$(curl -fsS "http://127.0.0.1:$MANAGER_PORT/api/v1/tasks?nodeId=$NODE_ID" -b "$COOKIE_JAR")
  STATE=$(node -e 'const t=JSON.parse(process.argv[1]).find(x=>x.id===process.argv[2]);process.stdout.write(t?.status||"")' "$STATUS" "$KICK_TASK_ID")
  [ "$STATE" = done ] && break
  [ "$STATE" = failed ] && { docker logs "$AGENT"; exit 1; }
  sleep .25
done
[ "$STATE" = done ]
docker exec "$CLIENT" sh -ec 'if ping -I wgclient0 -c 1 -W 1 10.250.0.1; then exit 1; fi'

echo "Compiled manager + compiled agent + real WireGuard tunnel/task E2E passed"
