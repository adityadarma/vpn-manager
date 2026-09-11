#!/usr/bin/env bash
# Managed DNS full-loop E2E: Manager + Agent + CoreDNS + live WireGuard tunnel.
#
# Covers what the component tests cannot: a registered node, an Agent polling
# real tasks, and a connected VPN client resolving DNS *through the tunnel*
# against its own group listener.
#
# Run only on an ephemeral Linux Docker host. Every resource is disposable and
# removed on exit.
set -euo pipefail

NETWORK="mdns-e2e-$RANDOM"
MANAGER="mdns-manager-$RANDOM"
AGENT="mdns-agent-$RANDOM"
COREDNS="mdns-coredns-$RANDOM"
CLIENT="mdns-client-$RANDOM"
DNS_VOLUME="mdns-vol-$RANDOM"
ADMIN_PASSWORD="e2e-admin-password-32-characters"
JWT_SECRET="e2e-jwt-secret-that-is-at-least-32-characters"
COREDNS_IMAGE="coredns/coredns:1.12.0"
PROBE_IMAGE="alpine:3.20"
COOKIE_JAR=$(mktemp)
FAILURES=0

# Node pool 10.8.0.0/16, group allocation 10.8.10.0/24, listener 10.8.10.53.
POOL_NET="10.8.0.0"; POOL_MASK="255.255.0.0"
GROUP_SUBNET="10.8.10.0/24"; LISTENER="10.8.10.53"
SERVER_VPN_IP="10.8.0.1"; CLIENT_VPN_IP="10.8.10.10"

cleanup() {
  docker rm -f "$CLIENT" "$COREDNS" "$AGENT" "$MANAGER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  docker volume rm "$DNS_VOLUME" >/dev/null 2>&1 || true
  rm -f "$COOKIE_JAR"
}
trap cleanup EXIT

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ok   $label ($actual)"
  else
    echo "  FAIL $label — expected '$expected', got '$actual'"
    FAILURES=$((FAILURES + 1))
  fi
}
# python3 rather than node: the script must run on a plain VPN node, which has
# no Node.js runtime outside the Agent container.
json() {
  python3 - "$1" "$2" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
for key in sys.argv[2].split('.'):
    if key:
        data = data[int(key)] if key.isdigit() else data[key]
print('' if data is None else data)
PY
}

# Latest task status for one action, or empty when none exists yet.
task_state() {
  python3 - "$1" "$2" <<'PY'
import json, sys
tasks = [t for t in json.loads(sys.argv[1]) if t.get('action') == sys.argv[2]]
if any(t.get('status') in ('pending', 'processing') for t in tasks):
    print('pending')
elif tasks:
    tasks.sort(key=lambda t: (t.get('created_at') or '', t.get('id') or ''), reverse=True)
    print(tasks[0].get('status') or '')
else:
    print('')
PY
}

task_error() {
  python3 - "$1" "$2" <<'PY'
import json, sys
tasks = [t for t in json.loads(sys.argv[1]) if t.get('action') == sys.argv[2]]
tasks.sort(key=lambda t: t.get('created_at') or '', reverse=True)
print((tasks[0].get('error_message') if tasks else None) or 'none')
PY
}
api() { curl -fsS -b "$COOKIE_JAR" -H 'Content-Type: application/json' "$@"; }

echo "==> Building images from the local worktree"
docker build -q -t mdns-manager:local . >/dev/null
docker build -q -t mdns-agent:local -f apps/agent/Dockerfile . >/dev/null
docker network create "$NETWORK" >/dev/null
docker volume create "$DNS_VOLUME" >/dev/null

echo "==> Starting Manager"
docker run -d --name "$MANAGER" --network "$NETWORK" --network-alias manager -p 3000 \
  -e NODE_ENV=production -e PORT=3000 -e HOST=0.0.0.0 \
  -e JWT_SECRET="$JWT_SECRET" -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  -e DATABASE_TYPE=sqlite -e DATABASE_SQLITE_PATH=/data/e2e.sqlite \
  mdns-manager:local >/dev/null
PORT=$(docker port "$MANAGER" 3000/tcp | head -1 | cut -d: -f2)

for _ in $(seq 1 60); do
  curl -fsS --connect-timeout 1 "http://127.0.0.1:$PORT/api/v1/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS --connect-timeout 2 "http://127.0.0.1:$PORT/api/v1/health" >/dev/null \
  || { echo "Manager never became ready"; docker logs "$MANAGER" | tail -20; exit 1; }
curl -fsS -c "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASSWORD\"}" >/dev/null
echo "  ok   Manager ready and authenticated"

echo "==> Registering node and enabling Managed DNS"
REG=$(api -X POST "http://127.0.0.1:$PORT/api/v1/nodes/register" \
  -d '{"hostname":"mdns-node","ip":"172.31.0.10","port":51820,"vpn_type":"wireguard","version":"e2e"}')
NODE_ID=$(json "$REG" '.id'); NODE_TOKEN=$(json "$REG" '.token')

# Widen the node pool to /16 so a /24 group allocation fits inside it.
api -X PUT "http://127.0.0.1:$PORT/api/v1/nodes/$NODE_ID/config" -d "{
  \"port\":51820,\"protocol\":\"udp\",\"tunnel_mode\":\"full\",
  \"vpn_network\":\"$POOL_NET\",\"vpn_netmask\":\"$POOL_MASK\",
  \"dns_servers\":\"9.9.9.9\",\"push_routes\":\"\",
  \"cipher\":\"AES-256-GCM\",\"auth_digest\":\"SHA256\",\"compression\":\"none\",
  \"keepalive_ping\":10,\"keepalive_timeout\":120,\"max_clients\":50,
  \"custom_push_directives\":\"\",\"firewall_engine\":\"none\"}" >/dev/null
api -X PUT "http://127.0.0.1:$PORT/api/v1/nodes/$NODE_ID" -d '{"managed_dns_enabled":true}' >/dev/null
echo "  ok   node registered ($NODE_ID)"

echo "==> Starting Agent with Managed DNS enabled"
# A bootstrap Corefile lets CoreDNS come up before the first sync writes the
# real one. Production instead relies on `restart: unless-stopped`, which retries
# until the Agent has written a config.
#
# `reload` is mandatory here: without it CoreDNS keeps serving this bootstrap
# config forever and never picks up the generated revision, while its health
# endpoint still reports OK.
docker run --rm -v "$DNS_VOLUME:/cfg" alpine:3.20 sh -c \
  'printf ".:53 {\n    bind 127.0.0.1\n    health 127.0.0.1:8181\n    reload 2s\n    errors\n}\n" > /cfg/Corefile' >/dev/null

docker run -d --name "$AGENT" --network "$NETWORK" --network-alias agent --privileged \
  -v "$DNS_VOLUME:/etc/vpn-manager/coredns" \
  -e NODE_ENV=production -e VPN_TYPE=wireguard -e FIREWALL_ENGINE=nftables \
  -e AGENT_MANAGER_URL=http://manager:3000 -e AGENT_NODE_ID="$NODE_ID" \
  -e AGENT_SECRET_TOKEN="$NODE_TOKEN" -e VPN_TOKEN=e2e-vpn-event-token \
  -e AGENT_POLL_INTERVAL_MS=250 -e AGENT_HEARTBEAT_INTERVAL_MS=500 \
  -e DNS_ENABLED=true -e COREDNS_CONFIG_DIR=/etc/vpn-manager/coredns \
  -e COREDNS_HEALTH_URL=http://127.0.0.1:8181/health \
  --entrypoint sh mdns-agent:local -ec "
    mkdir -p /etc/wireguard
    wg genkey | tee /etc/wireguard/privatekey | wg pubkey > /etc/wireguard/publickey
    cat > /etc/wireguard/wg0.conf <<EOF
[Interface]
PrivateKey = \$(cat /etc/wireguard/privatekey)
Address = $SERVER_VPN_IP/16
ListenPort = 51820
EOF
    wg-quick up wg0
    exec node /app/dist/index.js
  " >/dev/null

# CoreDNS shares the Agent network namespace so it can bind the listener
# address the Agent creates on vpn-dns0, exactly as host networking does.
docker run -d --name "$COREDNS" --network "container:$AGENT" \
  -v "$DNS_VOLUME:/etc/coredns:ro" \
  "$COREDNS_IMAGE" -conf /etc/coredns/Corefile >/dev/null
sleep 4
check "Agent running" "running" "$(docker inspect -f '{{.State.Status}}' "$AGENT")"
check "CoreDNS running" "running" "$(docker inspect -f '{{.State.Status}}' "$COREDNS")"

echo "==> Configuring group allocation, zone and policy"
GROUP=$(api -X POST "http://127.0.0.1:$PORT/api/v1/groups" \
  -d "{\"name\":\"engineering\",\"vpn_subnet\":\"$GROUP_SUBNET\"}")
GROUP_ID=$(json "$GROUP" '.id')
api -X PUT "http://127.0.0.1:$PORT/api/v1/groups/$GROUP_ID/nodes/$NODE_ID/dns" -d "{
  \"enabled\":true,\"vpn_subnet\":\"$GROUP_SUBNET\",\"listener_ip\":\"$LISTENER\",
  \"listener_port\":53,\"public_default_action\":\"allow\",
  \"upstreams\":[\"1.1.1.1\",\"8.8.8.8\"]}" >/dev/null
ZONE=$(api -X POST "http://127.0.0.1:$PORT/api/v1/dns/zones" -d '{"name":"corp.internal"}')
ZONE_ID=$(json "$ZONE" '.id')
api -X POST "http://127.0.0.1:$PORT/api/v1/dns/zones/$ZONE_ID/records" \
  -d '{"name":"git","type":"A","value":"10.8.10.15","ttl":60}' >/dev/null
api -X PUT "http://127.0.0.1:$PORT/api/v1/groups/$GROUP_ID/dns/zones" \
  -d "{\"zone_ids\":[\"$ZONE_ID\"]}" >/dev/null
api -X POST "http://127.0.0.1:$PORT/api/v1/groups/$GROUP_ID/dns/policies" \
  -d '{"domain_pattern":"*.youtube.com","action":"block","scope":"public","priority":10}' >/dev/null
api -X POST "http://127.0.0.1:$PORT/api/v1/groups/$GROUP_ID/dns/policies" \
  -d '{"domain_pattern":"tracker.example","action":"sinkhole","scope":"public","priority":5,"sinkhole_ipv4":"10.8.10.254"}' >/dev/null
echo "  ok   desired state configured"

echo "==> Agent applies the DNS revision from a real task"
# Sends `{}` because this helper always sets a JSON content type, and Fastify
# rejects an empty body when one is declared. The dashboard omits the header.
api -X POST "http://127.0.0.1:$PORT/api/v1/nodes/$NODE_ID/dns/sync" -d '{}' >/dev/null
STATE=""
APPLIED=0
LATEST=1
for _ in $(seq 1 80); do
  TASKS=$(api "http://127.0.0.1:$PORT/api/v1/tasks?nodeId=$NODE_ID")
  STATE=$(task_state "$TASKS" sync_group_dns)
  DNS_STATUS=$(api "http://127.0.0.1:$PORT/api/v1/nodes/$NODE_ID/dns/status")
  APPLIED=$(json "$DNS_STATUS" '.revision')
  LATEST=$(python3 - "$DNS_STATUS" <<'PY'
import json, sys
revisions = json.loads(sys.argv[1]).get('revisions') or []
print(max((r.get('revision') or 0) for r in revisions) if revisions else 0)
PY
)
  if [ "$STATE" = done ] && [ -n "$APPLIED" ] && [ -n "$LATEST" ] && [ "$APPLIED" -gt 0 ] && [ "$APPLIED" = "$LATEST" ]; then
    break
  fi
  [ "$STATE" = failed ] && break
  sleep 0.5
done
check "sync_group_dns task completed" "done" "$STATE"
if [ "$STATE" != done ]; then
  echo "  --- agent logs ---"; docker logs "$AGENT" 2>&1 | tail -25
  echo "  --- task error ---"; task_error "$TASKS" sync_group_dns 2>/dev/null || true
fi

DNS_STATUS=$(api "http://127.0.0.1:$PORT/api/v1/nodes/$NODE_ID/dns/status")
check "node reports healthy DNS"    "healthy" "$(json "$DNS_STATUS" '.status')"
APPLIED=$(json "$DNS_STATUS" '.revision')
LATEST=$(python3 - "$DNS_STATUS" <<'PY'
import json, sys
revisions = json.loads(sys.argv[1]).get('revisions') or []
print(max((r.get('revision') or 0) for r in revisions) if revisions else 0)
PY
)
check "applied revision is the newest" "$LATEST" "$APPLIED"
[ "${APPLIED:-0}" -gt 0 ] && echo "  ok   applied revision is non-zero ($APPLIED)" \
  || { echo "  FAIL applied revision is zero"; FAILURES=$((FAILURES + 1)); }
check "listener IP on vpn-dns0"     "1"       "$(docker exec "$AGENT" sh -c "ip -4 -oneline addr show dev vpn-dns0 2>/dev/null | grep -c $LISTENER" || echo 0)"
check "nftables DNS table present"  "1"       "$(docker exec "$AGENT" sh -c 'nft list tables 2>/dev/null | grep -c vpn_manager_dns' || echo 0)"

echo "==> Connecting a VPN client and resolving through the tunnel"
CLIENT_PRIVATE=$(docker run --rm --entrypoint wg mdns-agent:local genkey)
CLIENT_PUBLIC=$(printf '%s\n' "$CLIENT_PRIVATE" | docker run -i --rm --entrypoint wg mdns-agent:local pubkey)
SERVER_PUBLIC=$(docker exec "$AGENT" cat /etc/wireguard/publickey)
AGENT_IP=$(docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$AGENT")
docker exec "$AGENT" wg set wg0 peer "$CLIENT_PUBLIC" allowed-ips "$CLIENT_VPN_IP/32" >/dev/null

# Writes /tmp/client-ready only after every setup step succeeded. Polling that
# marker removes the race where the tunnel answered before `dig` was installed
# or before the tunnel route existed, which produced misleading NORESP results.
docker run -d --name "$CLIENT" --network "$NETWORK" --privileged \
  --entrypoint sh mdns-agent:local -ec "
    apk add -q bind-tools
    ip link add wgc0 type wireguard
    printf '%s\n' '$CLIENT_PRIVATE' > /tmp/pk
    wg set wgc0 private-key /tmp/pk peer '$SERVER_PUBLIC' \
      endpoint '$AGENT_IP:51820' allowed-ips 10.8.0.0/16,1.1.1.1/32 persistent-keepalive 1
    ip addr add $CLIENT_VPN_IP/32 dev wgc0
    ip link set wgc0 up
    ip route add 10.8.0.0/16 dev wgc0
    # Sends one external resolver through the tunnel so the node firewall is
    # actually on the path. A split-tunnel client would reach 1.1.1.1 straight
    # out of its own default route, which the node can never police.
    ip route add 1.1.1.1/32 dev wgc0
    command -v dig >/dev/null
    touch /tmp/client-ready
    sleep infinity
  " >/dev/null

CLIENT_READY=no
for _ in $(seq 1 60); do
  docker exec "$CLIENT" test -f /tmp/client-ready >/dev/null 2>&1 && { CLIENT_READY=yes; break; }
  [ "$(docker inspect -f '{{.State.Status}}' "$CLIENT" 2>/dev/null)" != running ] && break
  sleep 0.5
done
check "client finished setup" "yes" "$CLIENT_READY"
if [ "$CLIENT_READY" != yes ]; then
  echo "  --- client state: $(docker inspect -f '{{.State.Status}} exit={{.State.ExitCode}}' "$CLIENT" 2>/dev/null || echo gone)"
  docker logs "$CLIENT" 2>&1 | tail -8 | sed 's/^/  client: /'
fi

TUNNEL_UP=no
for _ in $(seq 1 40); do
  docker exec "$CLIENT" ping -c1 -W1 "$SERVER_VPN_IP" >/dev/null 2>&1 && { TUNNEL_UP=yes; break; }
  sleep 0.5
done
check "tunnel carries traffic to the node" "yes" "$TUNNEL_UP"
# The resolver must be reached through the tunnel, not the container bridge.
check "listener routed over the tunnel" "wgc0" \
  "$(docker exec "$CLIENT" sh -c "ip route get $LISTENER 2>/dev/null | grep -oE 'dev [a-z0-9]+' | awk '{print \$2}'" 2>/dev/null || echo none)"

RESULTS=$(docker exec "$CLIENT" sh -c '
  for spec in "git.corp.internal A" "www.youtube.com A" "tracker.example A" "one.one.one.one A"; do
    set -- $spec
    st=$(dig @'"$LISTENER"' "$1" "$2" +noall +comment +time=3 +tries=1 2>/dev/null | grep -o "status: [A-Z]*" | head -1 | cut -d" " -f2)
    an=$(dig @'"$LISTENER"' "$1" "$2" +short +time=3 +tries=1 2>/dev/null | head -1)
    echo "$1|${st:-NORESP}|${an:-none}"
  done' 2>/dev/null)
echo "$RESULTS" | sed 's/^/  raw: /'
get() { echo "$RESULTS" | awk -F'|' -v n="$1" '$1==n {print $2"/"$3}'; }

check "private zone via tunnel"   "NOERROR/10.8.10.15"  "$(get git.corp.internal)"
check "blocked domain via tunnel" "NXDOMAIN/none"       "$(get www.youtube.com)"
check "sinkhole via tunnel"       "NOERROR/10.8.10.254" "$(get tracker.example)"
UP=$(get one.one.one.one)
case "$UP" in
  NOERROR/1.*) echo "  ok   upstream forwarding via tunnel ($UP)" ;;
  *) echo "  FAIL upstream forwarding via tunnel — got '$UP'"; FAILURES=$((FAILURES + 1)) ;;
esac

# Resolver failures are ambiguous from the client side alone, so dump the node
# state that distinguishes "CoreDNS not bound" from "firewall dropped it".
if [ "$FAILURES" -ne 0 ]; then
  echo "  --- node diagnostics ---"
  echo "  active corefile listener: $(docker exec "$AGENT" sh -c 'head -3 /etc/vpn-manager/coredns/Corefile 2>/dev/null | tr "\n" " "')"
  echo "  addresses:  $(docker exec "$AGENT" sh -c 'ip -4 -oneline addr show 2>/dev/null | awk "{print \$2\":\"\$4}" | tr "\n" " "')"
  echo "  udp53 bound: $(docker exec "$AGENT" sh -c 'ss -lunp 2>/dev/null | grep ":53" | head -3 | tr "\n" ";"' || echo unknown)"
  # Queried from inside the Agent network namespace, because the Agent image
  # itself ships no dig. This separates "CoreDNS not answering" from
  # "tunnel or firewall dropped the request".
  echo "  from netns: $(docker run --rm --network "container:$AGENT" "$PROBE_IMAGE" sh -c \
    "apk add -q bind-tools >/dev/null 2>&1; dig @$LISTENER git.corp.internal A +short +time=2 +tries=1 2>/dev/null | head -1" || echo none)"
  echo "  client dig: $(docker exec "$CLIENT" sh -c 'command -v dig || echo MISSING')"
  echo "  client ping listener: $(docker exec "$CLIENT" sh -c "ping -c1 -W2 $LISTENER >/dev/null 2>&1 && echo reachable || echo unreachable")"
  echo "  client route: $(docker exec "$CLIENT" sh -c "ip route get $LISTENER 2>/dev/null | head -1")"
  echo "  coredns:    $(docker logs "$COREDNS" 2>&1 | grep -vE 'GOMAXPROCS|SHA512' | tail -4 | tr '\n' ';')"
  echo "  nft input:  $(docker exec "$AGENT" sh -c 'nft list chain inet vpn_manager_dns VPN_DNS_INPUT 2>/dev/null | grep -cE "accept|drop"' || echo 0) rules"
fi

# The firewall must stop a client from using any resolver but its own.
#
# Checked only once the group resolver has answered. An empty result is
# meaningless on its own — a missing dig or a dead tunnel produces the same
# silence, which previously made this assertion pass for the wrong reason.
if [ "$(get git.corp.internal)" = "NOERROR/10.8.10.15" ]; then
  # Success means an A record came back. A drop shows up either as empty output
  # or as dig's own "communications error ... timed out" line, which `+short`
  # prints on stdout — so emptiness alone is not the right test.
  BYPASS=$(docker exec "$CLIENT" sh -c \
    'dig @1.1.1.1 example.com A +short +time=2 +tries=1 2>/dev/null | grep -oE "^[0-9]{1,3}(\.[0-9]{1,3}){3}$" | head -1' || true)
  if [ -z "$(printf '%s' "$BYPASS" | tr -d '[:space:]')" ]; then
    echo "  ok   external resolver bypass blocked (no A record returned)"
  else
    echo "  FAIL external resolver reachable — got '$BYPASS'"
    FAILURES=$((FAILURES + 1))
  fi
else
  echo "  skip external resolver bypass — group resolver never answered, result would be meaningless"
fi

echo
if [ "$FAILURES" -ne 0 ]; then
  echo "Managed DNS full-loop E2E failed with $FAILURES error(s)."
  exit 1
fi
echo "Managed DNS full-loop E2E passed."
