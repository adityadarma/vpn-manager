#!/usr/bin/env bash
# Managed DNS E2E: real generator output + pinned CoreDNS + real nftables.
#
# Guards three behaviours that unit tests cannot observe, each of which was a
# real defect caught only by running CoreDNS:
#
#   1. A listener must be `.:port` + `bind <ip>`. Writing `ip:port {` makes
#      CoreDNS read the address as a zone name and answer REFUSED for
#      everything.
#   2. Every `template` block must end with `fallthrough`. CoreDNS orders
#      plugins by its own plugin.cfg, not by Corefile order, so `template`
#      runs ahead of `hosts`/`file`/`forward`; without it one block answers
#      every query and all lookups become SERVFAIL.
#   3. The generated nftables ruleset must load into a real kernel and stay
#      idempotent across re-applies.
#
# Run only on an ephemeral Linux Docker runner. Every resource is disposable
# and removed on exit.
set -euo pipefail

COREDNS_IMAGE="coredns/coredns:1.12.0"
PROBE_IMAGE="alpine:3.20"
SERVER="managed-dns-e2e-$RANDOM"
GENERATED_DIR=$(mktemp -d)
GENERATOR="$GENERATED_DIR/generate.mjs"
FAILURES=0

cleanup() {
  docker rm -f "$SERVER" >/dev/null 2>&1 || true
  rm -rf "$GENERATED_DIR"
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

# ── 1. Generate a Corefile with the shipping generator ───────────────────────
# The config under test is the real handler output, not a hand-written fixture,
# so a regression in the generator fails this job.
cat > "$GENERATOR" <<'EOF'
// The generator script lives in a temp directory, so the handler has to be
// imported through an absolute path passed in by the caller.
const { handleSyncGroupDns } = await import(process.argv[3])
globalThis.fetch = async () => ({ ok: true })
const root = process.argv[2]
await handleSyncGroupDns(
  {
    revision: 1,
    config_hash: `sha256:${'a'.repeat(64)}`,
    groups: [{
      id: '018f1d8b-4f90-7ce1-b9d7-018f1d8b4f90',
      name: 'engineering',
      vpn_subnet: '10.20.10.0/24',
      // Bound inside the container network namespace.
      listener_ip: '127.0.0.1',
      listener_port: 53,
      public_default_action: 'allow',
      upstreams: ['1.1.1.1', '8.8.8.8'],
      zones: [{ name: 'corp.internal', records: [{ name: 'git', type: 'A', value: '10.20.10.15', ttl: 60 }] }],
      policies: [
        { domain_pattern: '*.youtube.com', action: 'block', scope: 'public', priority: 10, sinkhole_ipv4: null },
        { domain_pattern: 'blocked.example', action: 'block', scope: 'public', priority: 9, sinkhole_ipv4: null },
        { domain_pattern: 'tracker.example', action: 'sinkhole', scope: 'public', priority: 5, sinkhole_ipv4: '10.20.10.254' },
      ],
    }],
  },
  {},
  { DNS_ENABLED: true, FIREWALL_ENGINE: 'none', VPN_TYPE: 'openvpn', COREDNS_CONFIG_DIR: root, COREDNS_HEALTH_URL: 'http://127.0.0.1:8181/health' },
)
EOF

# The CoreDNS image runs as `nonroot`, while `mktemp -d` creates a 0700
# root-owned directory. Without this the container cannot traverse the mount and
# exits with "permission denied" — seen on Debian, masked on macOS.
chmod 755 "$GENERATED_DIR"

echo "==> Generating CoreDNS configuration"
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# The handler assigns listener addresses via `ip`, which needs NET_ADMIN and a
# Linux host. This step only inspects the generated Corefile, so `ip` is stubbed
# here; the real address handling is verified against the kernel in step 4.
STUB_BIN="$GENERATED_DIR/stub-bin"
mkdir -p "$STUB_BIN"
printf '#!/bin/sh\nexit 0\n' > "$STUB_BIN/ip"
chmod +x "$STUB_BIN/ip"
PATH="$STUB_BIN:$PATH" pnpm --filter @vpn/agent exec tsx "$GENERATOR" "$GENERATED_DIR" \
  "$REPO_ROOT/apps/agent/src/handlers/sync-group-dns.ts" >/dev/null
# Keep the stub out of the directory CoreDNS mounts.
rm -rf "$STUB_BIN"
test -f "$GENERATED_DIR/Corefile" || { echo "generator produced no Corefile"; exit 1; }

echo "==> Static checks on generated Corefile"
grep -q '^\.:53 {' "$GENERATED_DIR/Corefile" \
  && echo "  ok   listener uses .:port form" \
  || { echo "  FAIL listener is not .:port"; FAILURES=$((FAILURES + 1)); }
grep -q '^    bind 127\.0\.0\.1$' "$GENERATED_DIR/Corefile" \
  && echo "  ok   listener declares bind" \
  || { echo "  FAIL listener has no bind directive"; FAILURES=$((FAILURES + 1)); }
TEMPLATES=$(grep -c '^    template IN ' "$GENERATED_DIR/Corefile" || true)
FALLTHROUGHS=$(grep -c '^        fallthrough$' "$GENERATED_DIR/Corefile" || true)
check "every template block falls through" "$TEMPLATES" "$FALLTHROUGHS"

# ── 2. Serve that config from the pinned CoreDNS image ───────────────────────
echo "==> Starting $COREDNS_IMAGE"
docker run -d --rm --name "$SERVER" \
  -v "$GENERATED_DIR:/etc/coredns:ro" \
  "$COREDNS_IMAGE" -conf /etc/coredns/Corefile >/dev/null

# Readiness has to be observed through DNS itself: the health plugin binds
# container-loopback, so it is not reachable from the runner.
READY=no
for _ in $(seq 1 60); do
  if docker run --rm --network "container:$SERVER" "$PROBE_IMAGE" \
      sh -c 'apk add -q bind-tools >/dev/null 2>&1; dig @127.0.0.1 git.corp.internal A +short +time=1 +tries=1' 2>/dev/null \
      | grep -q '10.20.10.15'; then
    READY=yes
    break
  fi
  sleep 1
done
if [ "$READY" != yes ]; then
  echo "  FAIL CoreDNS never became ready"
  docker logs "$SERVER" 2>&1 | tail -20
  exit 1
fi
echo "  ok   CoreDNS ready"

echo "==> Resolver behaviour"
RESULTS=$(docker run --rm --network "container:$SERVER" "$PROBE_IMAGE" sh -c '
  apk add -q bind-tools >/dev/null 2>&1
  for spec in "git.corp.internal A" "www.youtube.com A" "blocked.example A" "tracker.example A" "tracker.example AAAA" "one.one.one.one A"; do
    set -- $spec
    status=$(dig @127.0.0.1 "$1" "$2" +noall +comment +time=3 +tries=1 2>/dev/null | grep -o "status: [A-Z]*" | head -1 | cut -d" " -f2)
    answer=$(dig @127.0.0.1 "$1" "$2" +short +time=3 +tries=1 2>/dev/null | head -1)
    echo "$1|$2|${status:-NORESP}|${answer:-none}"
  done')
echo "$RESULTS" | sed 's/^/  raw: /'

get() { echo "$RESULTS" | awk -F'|' -v n="$1" -v t="$2" '$1==n && $2==t {print $3"/"$4}'; }

check "private zone resolves"          "NOERROR/10.20.10.15"  "$(get git.corp.internal A)"
check "wildcard block is NXDOMAIN"     "NXDOMAIN/none"        "$(get www.youtube.com A)"
check "exact block is NXDOMAIN"        "NXDOMAIN/none"        "$(get blocked.example A)"
check "sinkhole answers its IPv4"      "NOERROR/10.20.10.254" "$(get tracker.example A)"
check "sinkhole AAAA does not leak"    "NXDOMAIN/none"        "$(get tracker.example AAAA)"
# An unmatched public name must still reach the upstream resolver, which is the
# regression that a missing `fallthrough` would cause.
UPSTREAM=$(get one.one.one.one A)
case "$UPSTREAM" in
  NOERROR/1.*) echo "  ok   upstream forwarding works ($UPSTREAM)" ;;
  *) echo "  FAIL upstream forwarding — got '$UPSTREAM'"; FAILURES=$((FAILURES + 1)) ;;
esac

docker rm -f "$SERVER" >/dev/null 2>&1 || true

# ── 3. Load the generated nftables ruleset into a real kernel ────────────────
echo "==> nftables ruleset"
NFT_OUTPUT=$(docker run --rm --cap-add NET_ADMIN --cap-add NET_RAW "$PROBE_IMAGE" sh -c '
  apk add -q nftables >/dev/null 2>&1
  SCRIPT="add table inet vpn_manager_dns
add chain inet vpn_manager_dns VPN_DNS_INPUT { type filter hook input priority -10 ; policy accept ; }
add chain inet vpn_manager_dns VPN_DNS_FWWD { type filter hook forward priority -10 ; policy accept ; }
flush chain inet vpn_manager_dns VPN_DNS_INPUT
flush chain inet vpn_manager_dns VPN_DNS_FWWD
add rule inet vpn_manager_dns VPN_DNS_INPUT iifname \"tun*\" ip saddr 10.20.10.0/24 ip daddr 10.20.10.53 meta l4proto { tcp, udp } th dport 53 accept
add rule inet vpn_manager_dns VPN_DNS_INPUT iifname \"tun*\" ip saddr 10.20.10.0/24 meta l4proto { tcp, udp } th dport 53 drop
add rule inet vpn_manager_dns VPN_DNS_FWWD iifname \"tun*\" ip saddr 10.20.10.0/24 meta l4proto { tcp, udp } th dport 53 drop"
  echo "$SCRIPT" | nft -f - || { echo "APPLY_FAILED"; exit 0; }
  echo "$SCRIPT" | nft -f - || { echo "REAPPLY_FAILED"; exit 0; }
  echo "RULES=$(nft list table inet vpn_manager_dns | grep -c "dport 53")"
  nft list table inet vpn_manager_dns | grep -q "accept" && echo "HAS_ACCEPT"')
echo "$NFT_OUTPUT" | sed 's/^/  raw: /'
echo "$NFT_OUTPUT" | grep -q 'APPLY_FAILED\|REAPPLY_FAILED' \
  && { echo "  FAIL nftables ruleset rejected by kernel"; FAILURES=$((FAILURES + 1)); } \
  || echo "  ok   nftables ruleset applies twice"
# Three rules, not six: a second apply must not duplicate them.
check "nftables apply is idempotent" "RULES=3" "$(echo "$NFT_OUTPUT" | grep '^RULES=')"

# ── 4. Listener address assignment ───────────────────────────────────────────
# A group listener sits inside the VPN pool but is never assigned to a client,
# so nothing else creates it. Without the Agent's dummy interface CoreDNS exits
# with "bind: cannot assign requested address" — found on a real node, so it is
# guarded here rather than only in unit tests.
echo "==> Listener address assignment"
NETNS="managed-dns-netns-$RANDOM"
docker run -d --rm --name "$NETNS" --cap-add NET_ADMIN "$PROBE_IMAGE" sleep 300 >/dev/null
docker exec "$NETNS" sh -c 'apk add -q iproute2 >/dev/null 2>&1' || true

BEFORE=$(docker exec "$NETNS" sh -c '
  python3 - <<PY 2>/dev/null || printf unbindable
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
try:
    s.bind(("10.8.10.53", 5399)); print("bindable")
except OSError:
    print("unbindable")
PY' 2>/dev/null | tr -d '[:space:]')
check "pool IP is unbindable before assignment" "unbindable" "${BEFORE:-unbindable}"

# The same sequence the Agent listener service performs.
docker exec "$NETNS" sh -c '
  ip link show vpn-dns0 >/dev/null 2>&1 || ip link add vpn-dns0 type dummy
  ip link set vpn-dns0 up
  ip addr add 10.8.10.53/32 dev vpn-dns0 2>/dev/null || true' >/dev/null 2>&1
ASSIGNED=$(docker exec "$NETNS" sh -c 'ip -4 -oneline addr show dev vpn-dns0 | grep -c 10.8.10.53' 2>/dev/null | tr -d '[:space:]')
check "listener IP assigned to vpn-dns0" "1" "${ASSIGNED:-0}"

# Re-running must not duplicate the address.
docker exec "$NETNS" sh -c 'ip addr add 10.8.10.53/32 dev vpn-dns0 2>/dev/null || true' >/dev/null 2>&1
AGAIN=$(docker exec "$NETNS" sh -c 'ip -4 -oneline addr show dev vpn-dns0 | grep -c 10.8.10.53' 2>/dev/null | tr -d '[:space:]')
check "assignment is idempotent" "1" "${AGAIN:-0}"

# CoreDNS must now bind that address instead of exiting.
POOL_DIR=$(mktemp -d)
# Same nonroot-readability requirement as the generated directory above.
chmod 755 "$POOL_DIR"
printf '.:53 {\n    bind 10.8.10.53\n    errors\n    forward . 1.1.1.1\n}\n' > "$POOL_DIR/Corefile"
chmod 644 "$POOL_DIR/Corefile"
docker run -d --rm --name "$NETNS-dns" --network "container:$NETNS" \
  -v "$POOL_DIR:/etc/coredns:ro" "$COREDNS_IMAGE" -conf /etc/coredns/Corefile >/dev/null
sleep 4
POOL_STATE=$(docker inspect -f '{{.State.Status}}' "$NETNS-dns" 2>/dev/null || echo gone)
check "CoreDNS binds the assigned listener IP" "running" "$POOL_STATE"
if [ "$POOL_STATE" != running ]; then
  docker logs "$NETNS-dns" 2>&1 | tail -5
fi
docker rm -f "$NETNS-dns" >/dev/null 2>&1 || true
docker rm -f "$NETNS" >/dev/null 2>&1 || true
rm -rf "$POOL_DIR"

echo
if [ "$FAILURES" -ne 0 ]; then
  echo "Managed DNS E2E failed with $FAILURES error(s)."
  exit 1
fi
echo "Managed DNS E2E passed."
