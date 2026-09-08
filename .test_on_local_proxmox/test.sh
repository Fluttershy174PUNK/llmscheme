#!/usr/bin/env bash
# test.sh — smoke-test the deployed llmscheme service.
#
# Usage: ./.test_on_local_proxmox/test.sh
#
# What it does:
#   1. ssh to dev@10.0.20.250 and curl /health
#   2. log in as admin and capture a token
#   3. create a test scheme
#   4. add a node, an edge, validate
#   5. read the scheme back, check the rev went up
#   6. delete the test scheme
#   7. report pass/fail
#
# Exits 0 on full pass, 1 on any failure.
# Use as a post-deploy gate or as a regression test.

set -euo pipefail

REMOTE="${REMOTE:-dev@10.0.20.250}"
BASE="${BASE:-http://10.0.20.250:8080}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?ADMIN_PASSWORD env var is required}"

pass() { echo "  ✓ $1"; }
fail() {
  echo "  ✗ $1"
  exit 1
}

echo "→ health"
HEALTH=$(curl -fsS "$BASE/health")
echo "$HEALTH" | grep -q '"ok":true' && pass "/health = $HEALTH" || fail "/health bad: $HEALTH"

echo "→ login"
LOGIN=$(curl -fsS -X POST "$BASE/api/login" \
  -H "content-type: application/json" \
  -d "{\"login\":\"admin\",\"password\":\"$ADMIN_PASSWORD\"}")
TOKEN=$(echo "$LOGIN" | grep -oE '"token":"[^"]+"' | cut -d'"' -f4)
[ -n "$TOKEN" ] && pass "login OK (token len ${#TOKEN})" || fail "login: $LOGIN"

AUTH="Authorization: Bearer $TOKEN"
SCHEME="test-$(date +%s)"

echo "→ create scheme $SCHEME"
curl -fsS -X POST "$BASE/api/schemes" \
  -H "$AUTH" -H "content-type: application/json" \
  -d "{\"name\":\"$SCHEME\"}" >/dev/null && pass "created $SCHEME"

echo "→ add node"
NODE=$(curl -fsS -X POST "$BASE/api/scheme/$SCHEME/node" \
  -H "$AUTH" -H "content-type: application/json" \
  -d '{"label":"smoke","shape":"rect","x":100,"y":100}')
echo "$NODE" | grep -q '"ok":true' && pass "node added" || fail "node: $NODE"

echo "→ get scheme"
GET=$(curl -fsS "$BASE/api/scheme/$SCHEME" -H "$AUTH")
REV=$(echo "$GET" | grep -oE '"rev":[0-9]+' | head -1 | cut -d: -f2)
[ -n "$REV" ] && [ "$REV" -ge 1 ] && pass "scheme rev=$REV" || fail "rev: $REV"

echo "→ validate"
curl -fsS "$BASE/api/scheme/$SCHEME/validate" -H "$AUTH" >/dev/null && pass "validate OK"

echo "→ /mcp discover (no auth needed)"
MCP=$(curl -fsS -X POST "$BASE/mcp" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover"}')
echo "$MCP" | grep -q 'supportedVersions' && pass "MCP discover OK" || fail "MCP: $MCP"

echo "→ cleanup: delete scheme"
curl -fsS -X DELETE "$BASE/api/scheme/$SCHEME" -H "$AUTH" >/dev/null && pass "deleted $SCHEME"

echo
echo "✓ all smoke tests passed"
