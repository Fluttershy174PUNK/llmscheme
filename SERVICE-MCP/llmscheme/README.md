# llmscheme-service — single-page app + REST + MCP

> **Who this is for:** anyone who wants to run the llmscheme HTTP
> service (the thing that gives you a web console, a shared
> editor, a REST API, and an MCP endpoint in one container). If
> you just want to use the CLI or the standalone editor, you
> don't need this — read the top-level [README.md](../README.md)
> instead.

The service is a single Node.js binary (`src/service/server.ts`)
that serves:

- A **web console** at `http://localhost:8080/` (login, projects,
  users, settings)
- A **visual editor** at `http://localhost:8080/editor/<name>`
- A **REST API** at `http://localhost:8080/api/...` for scripts
- An **MCP endpoint** at `http://localhost:8080/mcp` for AI
  clients

One container, no build step at deploy time, no `npm install` in
production.

---

## Run it

### Option A: from source (development)

You need [Node.js 22.18 or newer](https://nodejs.org/).

```bash
# from the repo root:
npm install                  # one-time: dev deps (esbuild, svelte, typescript)
npm run build                # one-time: produces the HTML artifacts
npm run sync-skill           # one-time: updates skill/ from src/

# then:
ADMIN_PASSWORD=changeme \
PORT=8080 \
DATA_DIR=./data \
node src/service/server.ts
```

Open `http://localhost:8080/` in a browser. Log in as
`admin` / `changeme`. **Change the password on the settings page
before you do anything else.**

### Option B: with Docker

```bash
cd mcp-service
cp .env.example .env
# edit .env: set ADMIN_PASSWORD to something strong

docker compose up -d
```

The container runs the same `node src/service/server.ts` command.
Schemes, users, API keys and every cache live in `./data` next to the
compose file (bind-mounted into the container). Back up by copying that
directory.

The compose file refuses to start without `ADMIN_PASSWORD` set.

### Option C: a static binary (advanced)

`pkg`, `bun build`, or `nexe` can wrap the same entry point into
a single executable. The build is not provided in this repo, but
the entry point is just `node src/service/server.ts` — wrap that.

---

## Configuration

Every value has a working default except `ADMIN_PASSWORD`, which
the compose file refuses to start without.

| Env var | What it does | Default |
|---|---|---|
| `PORT` | HTTP port | `8080` |
| `ADMIN_LOGIN` | Bootstrap admin login on first start with empty db | `admin` |
| `ADMIN_PASSWORD` | Bootstrap admin password (**required** in compose) | `admin` |
| `DATA_DIR` | Where lightdb + schemes live | `/data` |
| `TOKEN_TTL_DAYS` | Session cookie lifetime | `30` |
| `DB_QUOTA_MB` | lightdb size cap (refuses writes past this) | `64` |
| `MAX_BODY_MB` | Request body cap (returns 413 past this) | `8` |
| `ORIGIN_ALLOWLIST` | Comma-separated browser origins for `/mcp` | empty (same-origin only) |

`ADMIN_PASSWORD` is only used on **first start** (when the db is
empty). After that, change passwords through the console or the
API.

---

## What runs on each URL

| URL | What it serves |
|---|---|
| `GET /` | The web console (login screen if unauthenticated, app if signed in) |
| `GET /admin` | Same as `/` |
| `GET /editor/<name>` | The visual editor with the scheme baked in (auto-creates the scheme on first open) |
| `GET /assets/<file>` | Font files (woff2), served with `Cache-Control: immutable` |
| `GET /health` | `{"ok":true}` — used by Docker healthcheck |
| `POST /mcp` | MCP endpoint (X-Api-Key auth) |
| `GET/POST/PUT/DELETE /api/...` | REST API (see below) |
| everything else | 404 |

---

## REST API

**Auth** (three ways, pick the one that fits):

- `Authorization: Bearer <token>` — for XHR and scripts
- `Cookie: ls_token=<token>` — for browsers (set automatically on login)
- `X-Api-Key: <key>` — for MCP and external scripts (separate from sessions)

**Public** (no auth): `POST /api/login`, `GET /api/readme`, `GET /health`.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/login` | `{login, password}` → `{token, expiresAt, role, login}` |
| `POST` | `/api/logout` | Revokes the current session (cookie or Bearer) |
| `GET`  | `/api/me` | Current user (no secrets) |
| `GET`  | `/api/readme` | `{markdown, url}` for the login page |
| `GET`  | `/api/users` | Admin only |
| `POST` | `/api/users` | Admin only: `{login, password, role?}` |
| `DELETE` | `/api/user/:id` | Admin only; can't delete self or last admin |
| `POST` | `/api/password` | `{password, current?, login?}` — admin can target others |
| `POST` | `/api/session/revoke-all` | Drop every session of self or `?login=` (admin) |
| `GET`  | `/api/keys` | Your own active keys (hash only, never the secret) |
| `GET`  | `/api/admin/keys` | All active keys (admin only) |
| `POST` | `/api/keys` | Issue a new key; the secret is shown once |
| `POST` | `/api/keys/rotate` | Revoke all + issue new (destructive, confirm in UI) |
| `POST` | `/api/keys/:hash/revoke` | Revoke one |
| `GET`  | `/api/mcp-config` | **Read-only**: `{url, hasKey, activeKeys, hint}` |
| `GET`  | `/api/schemes` | List; `?user=all` admin only |
| `POST` | `/api/schemes` | `{name, scheme?}` |
| `GET`  | `/api/scheme/:name` | Full scheme |
| `GET`  | `/api/scheme/:name/md` | `SCHEME.md` export (text/markdown) |
| `GET`  | `/api/scheme/:name/diff` | `?rev=N` — changes since rev |
| `GET`  | `/api/scheme/:name/log` | `?limit=N` — journal tail |
| `PUT`  | `/api/scheme/:name` | CAS write of whole scheme (400 on bad body) |
| `DELETE` | `/api/scheme/:name` | Delete the scheme dir |
| `POST/PUT/DELETE` | `/api/scheme/:name/node\|edge\|zone` | Granular ops |

For the full request/response shapes, read
[docs/SCHEME_FORMAT.md](../docs/SCHEME_FORMAT.md) and the
integration tests in `src/test/service.test.ts`.

---

## MCP

One endpoint, both eras. Auth is `X-Api-Key` only.

### Modern era (preferred): `2026-07-28`

- Advertise by sending `MCP-Protocol-Version: 2026-07-28` header
- `POST /mcp` with method `server/discover` →
  `{supportedVersions, capabilities, serverInfo, _meta}`
- Every request may carry `_meta["io.modelcontextprotocol/protocolVersion"]`
- `Mcp-Method` / `Mcp-Name` headers must agree with the body
  (returns `-32020` if not)
- Unknown version → `400` with the list of supported versions
  (`-32025`)

### Legacy era: `2025-*`

- `POST /mcp` with method `initialize` → echoes the requested
  `protocolVersion` (or the modern one if the client asks for
  something we don't speak)
- `ping`, `tools/list`, `tools/call`

### The 12 tools

| Name | Annotations | What it does |
|---|---|---|
| `list_schemes` | readOnly | Names of the authenticated user |
| `get_scheme` | readOnly | Full scheme JSON |
| `get_scheme_md` | readOnly | SCHEME.md export |
| `create_scheme` | write | Empty or with `{rev: 0}` payload |
| `put_scheme` | write | CAS; payload rev must match disk |
| `delete_scheme` | destructive | Drop scheme dir |
| `node_add` | write | x/y optional → autoLayout |
| `node_update` | idempotent | Partial fields |
| `node_remove` | destructive | Edges to the node go too |
| `edge_add` | write | from/to/style/label |
| `edge_remove` | destructive | By id |
| `diff` | readOnly | Changes since a rev |

`annotations` tell the MCP client how careful to be: read-only
tools are safe to call speculatively, destructive ones should be
confirmed with the user, idempotent ones converge.

### Origin validation

A browser sending a request to `/mcp` includes an `Origin`
header. v2 validates it:

- No `Origin` header → fine (non-browser client)
- `Origin` matches the request's `Host` → fine
- `Origin` is in `ORIGIN_ALLOWLIST` → fine
- Anything else → `403 origin <x> not allowed`

This blocks DNS-rebinding attacks where a malicious page on
host A drives the server through host B.

---

## Security

- **Sessions** are HttpOnly cookies OR bearer tokens. Closing
  the browser does not invalidate the token (it expires after
  `TOKEN_TTL_DAYS`).
- **GETs never mutate state.** A read of `/api/mcp-config` does
  not issue or revoke keys (a v1 bug that broke live MCP clients
  on every page load).
- **Body limit** is enforced per request; oversized bodies
  destroy the socket with `413`.
- **Query string is never logged.** A `?t=<token>` in the URL
  would have been a v1 bug that put a live session credential
  into docker logs.
- **A password change drops every session** for the user.
- **Rotate-revokes are explicit POSTs** that the UI confirms
  before calling.
- **Origin allowlist** is enforced on `/mcp`.
- **Scrypt** for password hashing (memory-hard, slow).

---

## On-disk format

Lightdb: `DATA_DIR/lightdb.json` — users + tokens + API keys.
Quota is checked before the file grows, so a runaway database
stops early instead of filling the disk.

Schemes: `DATA_DIR/schemes/<user-id>/<name>/` — the same shape v1
used. Each scheme is a directory with:

- `scheme.json` — the data
- `.block_llm/scheme.html` — the editor
- `SCHEME.md` — the export
- `.block_llm/cache/` — autosaves + journal + backups

A live v1 service upgrades in place by replacing the container.
No migration step.

---

## Operational notes

### Healthcheck

```yaml
# in docker-compose.yml:
healthcheck:
  test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
  interval: 30s
  timeout: 3s
  retries: 3
```

### Graceful shutdown

The service handles `SIGTERM` and `SIGINT`: it stops accepting
new connections, drains in-flight requests (up to 5s), and exits
cleanly. The Docker `stop` command gives it 10s by default,
which is plenty.

### Logs

Plain text to stdout, one line per request:

```
2026-09-08T17:16:58.885Z INFO GET /editor/test -> 200 2ms
2026-09-08T17:16:58.892Z INFO POST /api/login -> 200 44ms
```

The query string is never included. Pipe to your log aggregator
of choice.

### Backup

```bash
# the minimum: copy lightdb + schemes
tar czf backup-$(date +%F).tgz DATA_DIR/lightdb.json DATA_DIR/schemes/
```

Schemes are independent directories, so you can also back up
individual users or projects with `tar czf user-1.tgz
DATA_DIR/schemes/1/`.

### Reset

```bash
# stop the service
docker compose down

# delete just the user database (keeps schemes on disk)
rm DATA_DIR/lightdb.json

# start the service — admin is re-bootstrapped from env
docker compose up -d
```

This wipes all users and sessions. Schemes are untouched.

### Full reset (loses everything)

```bash
docker compose down -v      # removes the container and any anonymous volumes
rm -rf data/                # the bind-mounted state directory

docker compose up -d
```

---

## Troubleshooting

### "401 on every request"

Your session token may have been issued by an old version. Log
out, log back in. Or check that the cookie domain matches the
request host (cookies are host-scoped).

### "GET /api/mcp-config does nothing"

That's correct in v2. It only reports state. To rotate keys,
use `POST /api/keys/rotate` (or the "rotate" button in the
console).

### "MCP returns 403 origin not allowed"

Set `ORIGIN_ALLOWLIST` to a comma-separated list of allowed
origins. For a local Claude Desktop, `http://localhost` is usually
enough. For a public deployment, list the exact origins you
expect (scheme + host + optional port).

### "lightdb quota exceeded"

`DB_QUOTA_MB` defaults to 64 MB. If your lightdb is hitting
that, you have thousands of users. Bump the quota, or migrate
to SQLite (out of scope for v2; see [../PROJECT.md](../PROJECT.md)
"Osознанные упрощения").

### "Body too large (413)"

`MAX_BODY_MB` defaults to 8 MB. A fully built scheme is well
under that. If you hit it, you're probably POSTing a huge file
— check the client, not the server.
