#!/usr/bin/env bash
# Managed DNS full-loop E2E on the OpenVPN engine.
#
# The WireGuard full-loop already covers Manager + Agent + CoreDNS. This variant
# exists because the OpenVPN path differs in ways Managed DNS depends on:
#
#   - the firewall matches `tun*` instead of `wg*`
#   - clients are addressed through CCD `ifconfig-push`, not `allowed-ips`
#   - the Agent talks to a management socket rather than the `wg` tool
#
# Kept separate from e2e-managed-dns-fullloop.sh rather than parameterised: the
# server and client bring-up share almost no steps, and the proven WireGuard
# script should not carry that risk.
#
# Run only on an ephemeral Linux Docker host. Every resource is disposable.
set -euo pipefail

NETWORK="ovpn-e2e-$RANDOM"
MANAGER="ovpn-manager-$RANDOM"
AGENT="ovpn-agent-$RANDOM"
COREDNS="ovpn-coredns-$RANDOM"
CLIENT="ovpn-client-$RANDOM"
DNS_VOLUME="ovpn-vol-$RANDOM"
ADMIN_PASSWORD="e2e-admin-password-32-characters"
JWT_SECRET="e2e-jwt-secret-that-is-at-least-32-characters"
COREDNS_IMAGE="coredns/coredns:1.14.7"
PROBE_IMAGE="alpine:3.20"
COOKIE_JAR=$(mktemp)
FAILURES=0

# Node pool 10.8.0.0/16, group allocation 10.8.10.0/24, listener 10.8.10.53.
POOL_NET="10.8.0.0"; POOL_MASK="255.255.0.0"
GROUP_SUBNET="10.8.10.0/24"; LISTENER="10.8.10.53"
SERVER_VPN_IP="10.8.0.1"; CLIENT_VPN_IP="10.8.10.10"
CLIENT_CN="e2e_ovpn_client"

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
api() { curl -fsS -b "$COOKIE_JAR" -H 'Content-Type: application/json' "$@"; }

command -v modprobe >/dev/null 2>&1 && modprobe tun 2>/dev/null || true
[ -c /dev/net/tun ] || { echo "/dev/net/tun is missing on the host; OpenVPN cannot run"; exit 1; }

echo "==> Building images from the local worktree"
docker build -q -t ovpn-manager:local . >/dev/null
docker build -q -t ovpn-agent:local -f apps/agent/Dockerfile . >/dev/null
docker network create "$NETWORK" >/dev/null
docker volume create "$DNS_VOLUME" >/dev/null

echo "==> Starting Manager"
docker run -d --name "$MANAGER" --network "$NETWORK" --network-alias manager -p 3000 \
  -e NODE_ENV=production -e PORT=3000 -e HOST=0.0.0.0 \
  -e JWT_SECRET="$JWT_SECRET" -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  -e DATABASE_TYPE=sqlite -e DATABASE_SQLITE_PATH=/data/e2e.sqlite \
  -e RATE_LIMIT_MAX=10000 \
  ovpn-manager:local >/dev/null
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

echo "==> Registering an OpenVPN node"
REG=$(api -X POST "http://127.0.0.1:$PORT/api/v1/nodes/register" \
  -d '{"hostname":"ovpn-node","ip":"172.31.0.10","port":1194,"vpn_type":"openvpn","version":"e2e"}')
NODE_ID=$(json "$REG" '.id'); NODE_TOKEN=$(json "$REG" '.token')
api -X PUT "http://127.0.0.1:$PORT/api/v1/nodes/$NODE_ID/config" -d "{
  \"port\":1194,\"protocol\":\"udp\",\"tunnel_mode\":\"full\",
  \"vpn_network\":\"$POOL_NET\",\"vpn_netmask\":\"$POOL_MASK\",
  \"dns_servers\":\"9.9.9.9\",\"push_routes\":\"\",
  \"cipher\":\"AES-256-GCM\",\"auth_digest\":\"SHA256\",\"compression\":\"none\",
  \"keepalive_ping\":10,\"keepalive_timeout\":120,\"max_clients\":50,
  \"custom_push_directives\":\"\",\"firewall_engine\":\"none\"}" >/dev/null
api -X PUT "http://127.0.0.1:$PORT/api/v1/nodes/$NODE_ID" -d '{"managed_dns_enabled":true}' >/dev/null
check "node registered as openvpn" "openvpn" "$(json "$(api "http://127.0.0.1:$PORT/api/v1/nodes/$NODE_ID")" '.vpn_type')"

echo "==> Starting Agent with a real OpenVPN server"
docker run --rm -v "$DNS_VOLUME:/cfg" "$PROBE_IMAGE" sh -c \
  'printf ".:53 {\n    bind 127.0.0.1\n    health 127.0.0.1:8181\n    reload 2s\n    errors\n}\n" > /cfg/Corefile && chmod 644 /cfg/Corefile' >/dev/null

# The Agent image has no openvpn binary, so it is added here. Production nodes
# run OpenVPN on the host instead.
docker run -d --name "$AGENT" --network "$NETWORK" --network-alias agent --privileged \
  --device /dev/net/tun:/dev/net/tun \
  -v "$DNS_VOLUME:/etc/vpn-manager/coredns" \
  -e NODE_ENV=production -e VPN_TYPE=openvpn -e FIREWALL_ENGINE=nftables \
  -e AGENT_MANAGER_URL=http://manager:3000 -e AGENT_NODE_ID="$NODE_ID" \
  -e AGENT_SECRET_TOKEN="$NODE_TOKEN" -e VPN_TOKEN=e2e-vpn-event-token \
  -e AGENT_POLL_INTERVAL_MS=250 -e AGENT_HEARTBEAT_INTERVAL_MS=500 \
  -e DNS_ENABLED=true -e COREDNS_CONFIG_DIR=/etc/vpn-manager/coredns \
  -e COREDNS_HEALTH_URL=http://127.0.0.1:8181/health \
  --entrypoint sh ovpn-agent:local -ec "
    apk add --no-cache openvpn >/dev/null 2>&1
    mkdir -p /etc/openvpn/easy-rsa /etc/openvpn/server /etc/openvpn/ccd /run/openvpn /var/log/openvpn
    cp -r /usr/share/easy-rsa/* /etc/openvpn/easy-rsa/ 2>/dev/null || true
    cd /etc/openvpn/easy-rsa
    ./easyrsa init-pki >/dev/null 2>&1
    EASYRSA_BATCH=1 ./easyrsa build-ca nopass >/dev/null 2>&1
    EASYRSA_BATCH=1 ./easyrsa build-server-full server nopass >/dev/null 2>&1
    EASYRSA_BATCH=1 ./easyrsa gen-crl >/dev/null 2>&1
    EASYRSA_BATCH=1 ./easyrsa build-client-full $CLIENT_CN nopass >/dev/null 2>&1
    cp pki/ca.crt pki/issued/server.crt pki/private/server.key pki/crl.pem /etc/openvpn/server/ 2>/dev/null
    openvpn --genkey secret /etc/openvpn/server/tls-crypt.key >/dev/null 2>&1

    # Pin the client into the group subnet so the DNS firewall rules, which
    # match on that subnet, are actually exercised.
    printf 'ifconfig-push $CLIENT_VPN_IP $POOL_MASK\n' > /etc/openvpn/ccd/$CLIENT_CN

    cat > /etc/openvpn/server/server.conf <<EOF
port 1194
proto udp
dev tun0
ca /etc/openvpn/server/ca.crt
cert /etc/openvpn/server/server.crt
key /etc/openvpn/server/server.key
dh none
tls-crypt /etc/openvpn/server/tls-crypt.key
server $POOL_NET $POOL_MASK
topology subnet
client-config-dir /etc/openvpn/ccd
client-to-client
management /run/openvpn/server.sock unix
status /var/log/openvpn/status.log 1
status-version 3
keepalive 10 120
verb 3
EOF
    openvpn --config /etc/openvpn/server/server.conf --daemon
    for i in \$(seq 1 40); do ip -4 addr show tun0 2>/dev/null | grep -q inet && break; sleep 0.5; done
    ip -4 -oneline addr show tun0 > /tmp/tun-state 2>&1 || true
    exec node /app/dist/index.js
  " >/dev/null

docker run -d --name "$COREDNS" --network "container:$AGENT" \
  -v "$DNS_VOLUME:/etc/coredns:ro" \
  "$COREDNS_IMAGE" -conf /etc/coredns/Corefile >/dev/null

TUN_UP=no
for _ in $(seq 1 60); do
  docker exec "$AGENT" sh -c 'ip -4 addr show tun0 2>/dev/null | grep -q inet' >/dev/null 2>&1 && { TUN_UP=yes; break; }
  [ "$(docker inspect -f '{{.State.Status}}' "$AGENT" 2>/dev/null)" != running ] && break
  sleep 1
done
check "OpenVPN server tun0 is up" "yes" "$TUN_UP"
if [ "$TUN_UP" != yes ]; then
  docker logs "$AGENT" 2>&1 | tail -20 | sed 's/^/  agent: /'
fi
check "Agent running"  "running" "$(docker inspect -f '{{.State.Status}}' "$AGENT")"
check "CoreDNS running" "running" "$(docker inspect -f '{{.State.Status}}' "$COREDNS")"
check "management socket present" "yes" \
  "$(docker exec "$AGENT" sh -c '[ -S /run/openvpn/server.sock ] && echo yes || echo no' 2>/dev/null || echo no)"

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
[ "$STATE" != done ] && docker logs "$AGENT" 2>&1 | tail -20 | sed 's/^/  agent: /'

DNS_STATUS=$(api "http://127.0.0.1:$PORT/api/v1/nodes/$NODE_ID/dns/status")
check "node reports healthy DNS" "healthy" "$(json "$DNS_STATUS" '.status')"
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
check "listener IP on vpn-dns0"  "1" \
  "$(docker exec "$AGENT" sh -c "ip -4 -oneline addr show dev vpn-dns0 2>/dev/null | grep -c $LISTENER" || echo 0)"
# The OpenVPN path must produce tun* rules, not the wg* form. Matched with -F
# because the rule text contains both quotes and a `*`, which made an escaped
# regex fail with "Trailing backslash" through nested shell quoting.
# `grep -c` prints 0 but exits non-zero when nothing matches, so a `|| echo 0`
# fallback appends a second line and the value becomes "0\n0". Normalise to a
# single token instead.
# `|| true` must sit inside the remote shell: with `set -euo pipefail` a
# zero-match grep exit code propagates through the pipeline and kills this
# script mid-run, which looked like truncated output rather than a failure.
count_rules() {
  local matched
  matched=$(docker exec "$AGENT" sh -c "nft list table inet vpn_manager_dns 2>/dev/null | grep -cF '$1' || true" 2>/dev/null | head -1 | tr -d '[:space:]')
  printf '%s' "${matched:-0}"
}
TUN_RULES=$(count_rules 'iifname "tun'); TUN_RULES=${TUN_RULES:-0}
WG_RULES=$(count_rules 'iifname "wg'); WG_RULES=${WG_RULES:-0}
[ "${TUN_RULES:-0}" -ge 1 ] \
  && echo "  ok   nftables rules match tun interfaces ($TUN_RULES rules)" \
  || { echo "  FAIL nftables has no tun rules"; FAILURES=$((FAILURES + 1)); }
check "no wireguard rules on an openvpn node" "0" "${WG_RULES:-0}"

echo "==> Connecting an OpenVPN client and resolving through the tunnel"
CA=$(docker exec "$AGENT" cat /etc/openvpn/easy-rsa/pki/ca.crt)
CRT=$(docker exec "$AGENT" cat "/etc/openvpn/easy-rsa/pki/issued/$CLIENT_CN.crt")
KEY=$(docker exec "$AGENT" cat "/etc/openvpn/easy-rsa/pki/private/$CLIENT_CN.key")
TC=$(docker exec "$AGENT" cat /etc/openvpn/server/tls-crypt.key)
AGENT_IP=$(docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$AGENT")

CLIENT_DIR=$(mktemp -d); chmod 755 "$CLIENT_DIR"
{
  printf 'client\ndev tun\nproto udp\nremote %s 1194\nresolv-retry infinite\nnobind\npersist-key\npersist-tun\nremote-cert-tls server\nverb 3\n' "$AGENT_IP"
  printf '<ca>\n%s\n</ca>\n' "$CA"
  printf '<cert>\n%s\n</cert>\n' "$CRT"
  printf '<key>\n%s\n</key>\n' "$KEY"
  printf '<tls-crypt>\n%s\n</tls-crypt>\n' "$TC"
} > "$CLIENT_DIR/client.ovpn"
chmod 644 "$CLIENT_DIR/client.ovpn"

docker run -d --name "$CLIENT" --network "$NETWORK" --privileged \
  --device /dev/net/tun:/dev/net/tun \
  -v "$CLIENT_DIR:/cfg:ro" \
  --entrypoint sh ovpn-agent:local -ec '
    apk add --no-cache openvpn bind-tools >/dev/null 2>&1
    openvpn --config /cfg/client.ovpn --daemon --log /tmp/client.log
    for i in $(seq 1 60); do ip -4 addr show tun0 2>/dev/null | grep -q inet && break; sleep 0.5; done
    command -v dig >/dev/null && touch /tmp/client-ready
    sleep infinity
  ' >/dev/null

CLIENT_READY=no
for _ in $(seq 1 90); do
  docker exec "$CLIENT" test -f /tmp/client-ready >/dev/null 2>&1 && { CLIENT_READY=yes; break; }
  [ "$(docker inspect -f '{{.State.Status}}' "$CLIENT" 2>/dev/null)" != running ] && break
  sleep 1
done
check "client finished setup" "yes" "$CLIENT_READY"
CLIENT_ADDR=$(docker exec "$CLIENT" sh -c "ip -4 -oneline addr show dev tun0 2>/dev/null | grep -oE 'inet [0-9.]+' | awk '{print \$2}'" 2>/dev/null || echo none)
check "client received its CCD address" "$CLIENT_VPN_IP" "${CLIENT_ADDR:-none}"
if [ "$CLIENT_READY" != yes ] || [ "${CLIENT_ADDR:-none}" != "$CLIENT_VPN_IP" ]; then
  docker exec "$CLIENT" sh -c 'tail -20 /tmp/client.log' 2>/dev/null | sed 's/^/  client: /' || true
fi

TUNNEL_UP=no
for _ in $(seq 1 40); do
  docker exec "$CLIENT" ping -c1 -W1 "$SERVER_VPN_IP" >/dev/null 2>&1 && { TUNNEL_UP=yes; break; }
  sleep 0.5
done
check "tunnel carries traffic to the node" "yes" "$TUNNEL_UP"

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

if [ "$FAILURES" -ne 0 ]; then
  echo "  --- diagnostics ---"
  echo "  corefile:   $(docker exec "$AGENT" sh -c 'head -3 /etc/vpn-manager/coredns/Corefile 2>/dev/null | tr "\n" " "')"
  echo "  addresses:  $(docker exec "$AGENT" sh -c 'ip -4 -oneline addr show 2>/dev/null | awk "{print \$2\":\"\$4}" | tr "\n" " "')"
  echo "  nft:        $(docker exec "$AGENT" sh -c 'nft list table inet vpn_manager_dns 2>/dev/null | grep -cE "accept|drop"' || echo 0) rules"
  echo "  coredns:    $(docker logs "$COREDNS" 2>&1 | grep -vE 'GOMAXPROCS|SHA512' | tail -3 | tr '\n' ';')"
fi
rm -rf "$CLIENT_DIR"

echo
if [ "$FAILURES" -ne 0 ]; then
  echo "OpenVPN Managed DNS E2E failed with $FAILURES error(s)."
  exit 1
fi
echo "OpenVPN Managed DNS E2E passed."
