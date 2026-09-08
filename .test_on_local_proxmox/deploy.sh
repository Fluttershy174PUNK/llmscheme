#!/usr/bin/env bash
# deploy.sh — build the service and deploy it to the dev sandbox LXC 999.
#
# Usage: ./.test_on_local_proxmox/deploy.sh
#
# What it does:
#   1. ssh to dev@10.0.20.250 and create ~/llmscheme/ if missing
#   2. rsync the repo (excluding node_modules, .git, dist) to the sandbox
#   3. npm install + npm run build on the sandbox
#   4. docker compose up -d the service from SERVICE-MCP/llmscheme/
#   5. wait for /health to return 200
#   6. tail the logs
#
# Required env:
#   DEV_PASSWORD  — ssh password for dev@10.0.20.250 (from test_dev.md)
#
# This is the "real" deploy that replaces the v1-era copy-paste workflow.
# It is safe to re-run: the sandbox gets a fresh build every time.

set -euo pipefail

# ---- config ----
REMOTE="${REMOTE:-dev@10.0.20.250}"
REMOTE_DIR="${REMOTE_DIR:-~/llmscheme}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?ADMIN_PASSWORD env var is required (e.g. export ADMIN_PASSWORD=changeme)}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ---- preflight ----
if ! command -v sshpass >/dev/null 2>&1; then
  echo "ERROR: sshpass is required. Install with: sudo apt install sshpass" >&2
  exit 1
fi
if ! command -v rsync >/dev/null 2>&1; then
  echo "ERROR: rsync is required." >&2
  exit 1
fi

cd "$REPO_DIR"
echo "→ repo: $REPO_DIR"
echo "→ target: $REMOTE:$REMOTE_DIR"

# ---- 1. prepare the remote directory ----
echo "→ preparing remote directory..."
sshpass -p "$DEV_PASSWORD" ssh -o StrictHostKeyChecking=no "$REMOTE" \
  "mkdir -p '$REMOTE_DIR'"

# ---- 2. rsync the source (exclude build artefacts) ----
echo "→ rsyncing source..."
sshpass -p "$DEV_PASSWORD" rsync -az --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='dist' \
  --exclude='*.log' \
  --exclude='.test_on_local_proxmox/test_dev.md~' \
  "$REPO_DIR/" \
  "$REMOTE:$REMOTE_DIR/"

# ---- 3. build on the sandbox ----
echo "→ installing deps and building on the sandbox..."
sshpass -p "$DEV_PASSWORD" ssh -o StrictHostKeyChecking=no "$REMOTE" \
  "bash -lc 'set -e; cd \"$REMOTE_DIR\"; \
    echo \"  node \$(node -v)\"; \
    echo \"  npm \$(npm -v)\"; \
    [ -d node_modules ] || npm install --no-audit --no-fund; \
    npm run build; \
    npm run sync-skill; \
    npm run check'"

# ---- 4. docker compose up ----
echo "→ starting the service via docker compose..."
sshpass -p "$DEV_PASSWORD" ssh -o StrictHostKeyChecking=no "$REMOTE" \
  "bash -lc 'set -e; cd \"$REMOTE_DIR/SERVICE-MCP/llmscheme\"; \
    [ -f .env ] || cp .env.example .env; \
    sed -i \"s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=${ADMIN_PASSWORD}/\" .env; \
    docker compose down --remove-orphans 2>/dev/null || true; \
    docker compose up -d --build; \
    echo; echo \"  service:\"; \
    docker compose ps'"

# ---- 5. wait for health ----
echo "→ waiting for /health..."
for i in $(seq 1 30); do
  if sshpass -p "$DEV_PASSWORD" ssh -o StrictHostKeyChecking=no "$REMOTE" \
    "curl -fsS http://127.0.0.1:8080/health" >/dev/null 2>&1; then
    echo "  → /health OK after ${i}s"
    break
  fi
  sleep 1
done

# ---- 6. final state ----
echo
echo "→ service status:"
sshpass -p "$DEV_PASSWORD" ssh -o StrictHostKeyChecking=no "$REMOTE" \
  "curl -sS http://127.0.0.1:8080/health && echo"
echo
echo "→ last 20 log lines:"
sshpass -p "$DEV_PASSWORD" ssh -o StrictHostKeyChecking=no "$REMOTE" \
  "docker compose -f \"$REMOTE_DIR/SERVICE-MCP/llmscheme/docker-compose.yml\" logs --tail=20 llmscheme || true"

echo
echo "✓ deploy complete. Console: http://10.0.20.250:8080/"
echo "  login:    admin"
echo "  password: \$ADMIN_PASSWORD (set above)"
