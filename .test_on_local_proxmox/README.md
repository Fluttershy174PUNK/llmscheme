# .test_on_local_proxmox — real deploy + test

> This directory contains the **real** deploy and test scripts for
> the dev sandbox LXC 999 (10.0.20.250). The `test_dev.md` file is
> a hermes skill reference for the sandbox environment; the two
> shell scripts are what you actually run.

## Files

| file | purpose |
|---|---|
| `test_dev.md` | hermes skill: describes the LXC 999 sandbox (SSH, docker, layout) |
| `test_dev.md~` | backup of the above (gitignored) |
| `deploy.sh` | build on host → rsync to sandbox → docker compose up |
| `test.sh` | smoke-test the deployed service (health, login, scheme CRUD, MCP) |

## Usage

```bash
# one-time setup
sudo apt install sshpass         # for password-based ssh
export DEV_PASSWORD='…'           # from test_dev.md
export ADMIN_PASSWORD='changeme'  # what the service admin login uses

# deploy
./.test_on_local_proxmox/deploy.sh

# test (in a separate terminal, after deploy)
./.test_on_local_proxmox/test.sh

# open the console
xdg-open http://10.0.20.250:8080/
```

Both scripts exit 0 on success, non-zero on failure. `deploy.sh` is
safe to re-run; it does a fresh `git pull` equivalent via `rsync
--delete`, then a full rebuild and a `docker compose down && up -d`.

## What gets deployed

The sandbox gets a clone of the repo at `~/llmscheme/` with:

- `src/` — all source code
- `SKILL/llmscheme/` — the built skill (after `npm run sync-skill`)
- `SERVICE-MCP/llmscheme/` — the built service HTML artifacts
  (after `npm run build`), Dockerfile, docker-compose.yml
- `package.json` + `package-lock.json` — so `npm install` works
- everything else from the repo, EXCEPT `node_modules/`, `.git/`,
  `dist/`, and the v1 backup at `../llmscheme-v1/`

## What does NOT get deployed

- `node_modules/` — installed on the sandbox via `npm install`
- `.git/` — the sandbox doesn't need git history
- `dist/` — build intermediate, regenerated
- `*.log` — noise
- `.test_on_local_proxmox/test_dev.md~` — emacs/vim backup

## The test script (what it checks)

1. `/health` returns `{"ok":true}` — the service is up
2. Login with `admin` / `$ADMIN_PASSWORD` works
3. A new scheme can be created via the REST API
4. A node can be added to the scheme
5. The scheme can be read back, `rev` is ≥ 1
6. `validate` returns no errors
7. The MCP `server/discover` endpoint responds
8. The test scheme can be deleted (cleanup)

If any step fails, the script exits non-zero and prints which step.

## What to do if the deploy breaks

1. Check the sandbox: `ssh dev@10.0.20.250`
2. Check the container: `docker ps -a`, `docker logs llmscheme`
3. Check the service: `curl http://10.0.20.250:8080/health`
4. Re-run deploy: `ADMIN_PASSWORD=… ./.test_on_local_proxmox/deploy.sh`
5. If the sandbox is wedged, recreate it (see test_dev.md)
