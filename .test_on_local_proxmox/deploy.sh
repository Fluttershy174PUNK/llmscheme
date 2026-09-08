#!/usr/bin/env bash
# deploy.sh — build locally, rsync, docker compose up on the dev sandbox LXC 999.
#
# Usage: DEV_PASSWORD=... ADMIN_PASSWORD=... ./.test_on_local_proxmox/deploy.sh
#
# Why build LOCALLY: the sandbox has docker + rsync but no Node, and the
# Dockerfile deliberately does not build anything (it ships pre-built
# artifacts). So `npm run build` runs here, then rsync pushes source + built
# HTML, and the sandbox just runs `docker compose up -d --build`.
#
# No sshpass dependency: SSH_ASKPASS supplies the password non-interactively.

set -euo pipefail

REMOTE="${REMOTE:-dev@10.0.20.250}"
REMOTE_DIR="${REMOTE_DIR:-llmscheme}" # relative to the dev home
ADMIN_PASSWORD="${ADMIN_PASSWORD:?ADMIN_PASSWORD env var is required}"
DEV_PASSWORD="${DEV_PASSWORD:?DEV_PASSWORD env var is required}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# .test_on_local_proxmox/ lives at the repo root, so up one level is the repo
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---- SSH without sshpass: use SSH_ASKPASS ----
ASKPASS="$(mktemp)"
printf '#!/bin/sh\necho "%s"\n' "$DEV_PASSWORD" >"$ASKPASS"
chmod +x "$ASKPASS"
trap 'rm -f "$ASKPASS"' EXIT
export SSH_ASKPASS="$ASKPASS" SSH_ASKPASS_REQUIRE=force DISPLAY=:0
SSH=(ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no)
RSYNC_RSH="ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no"

if ! command -v rsync >/dev/null 2>&1; then
  echo "ERROR: rsync is required locally." >&2
  exit 1
fi

cd "$REPO_DIR"
echo "→ repo: $REPO_DIR"
echo "→ target: $REMOTE:~/$REMOTE_DIR"

# ---- 1. build locally (Node is HERE, not on the sandbox) ----
echo "→ building artifacts locally..."
npm install --no-audit --no-fund
npm run build
npm run sync-skill
npm run check

# ---- 2. rsync source + built artifacts (exclude build detritus) ----
echo "→ rsyncing..."
"${SSH[@]}" "$REMOTE" "mkdir -p '$REMOTE_DIR'"
RSYNC_RSH="$RSYNC_RSH" rsync -az --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='dist' \
  --exclude='*.log' \
  --exclude='data/' \
  --exclude='llmscheme-service-mcp/' \
  --exclude='.test_on_local_proxmox/test_dev.md~' \
  "$REPO_DIR/" \
  "$REMOTE:$REMOTE_DIR/"

# ---- 3. docker compose up (build inside docker, no Node on host needed) ----
echo "→ starting the service via docker compose..."
"${SSH[@]}" "$REMOTE" \
  "bash -lc 'set -e; cd \"$REMOTE_DIR/SERVICE-MCP/llmscheme\"; \
    [ -f .env ] || cp .env.example .env; \
    sed -i \"s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMIN_PASSWORD}|\" .env; \
    docker compose down --remove-orphans 2>/dev/null || true; \
    docker compose up -d --build; \
    docker compose ps'"

# ---- 4. wait for health ----
echo "→ waiting for /health..."
for i in $(seq 1 60); do
  if "${SSH[@]}" "$REMOTE" "curl -fsS http://127.0.0.1:8080/health" >/dev/null 2>&1; then
    echo "  → /health OK after ${i}s"
    break
  fi
  sleep 2
done

# ---- 5. final state ----
echo
echo "→ service status:"
"${SSH[@]}" "$REMOTE" "curl -sS http://127.0.0.1:8080/health && echo"
echo
echo "✓ deploy complete. Console: http://10.0.20.250:8080/"
echo "  login: admin / \$ADMIN_PASSWORD"
