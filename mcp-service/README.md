# llmscheme-service — single-page app + REST + MCP

The service: a Node 22+ binary (`src/service/server.ts`) that serves the
console, the editor, the REST API, and the MCP endpoint. One container, no
build step, no `npm install` in production.

## Run

```bash
# from the repo root, build the artifacts once (esbuild + svelte/compiler):
npm run build

# then either:
node src/service/server.ts            # directly, default port 8080
docker compose -f mcp-service/docker-compose.yml up
```

Required env on first start (see `.env.example`):

| var | purpose | default |
|---|---|---|
| `ADMIN_LOGIN` | bootstrap admin login on empty db | `admin` |
| `ADMIN_PASSWORD` | bootstrap admin password | `admin` (CHANGE) |
| `DATA_DIR` | where lightdb + schemes live | `/data` |
| `PORT` | HTTP port | `8080` |
| `TOKEN_TTL_DAYS` | session cookie lifetime | `30` |
| `DB_QUOTA_MB` | lightdb size cap | `64` |
| `MAX_BODY_MB` | request body cap | `8` |
| `ORIGIN_ALLOWLIST` | comma-separated browser origins for `/mcp` | empty |

## REST API

Auth: `Authorization: Bearer <token>` (from `/api/login`) or `X-Api-Key: <key>`
(MCP/scripts). Public: `/api/login`, `/api/readme`. Health: `/health`.

| method | path | notes |
|---|---|---|
| `POST` | `/api/login` | `{login, password}` → `{token, expiresAt, role, login}` |
| `POST` | `/api/logout` | revokes the calling session (B6: works for cookie too) |
| `GET`  | `/api/me` | current user (no secrets) |
| `GET`  | `/api/readme` | `{markdown, url}` for the login page |
| `GET`  | `/api/users` | admin only |
| `POST` | `/api/users` | admin only: `{login, password, role?}` |
| `DELETE` | `/api/user/:id` | admin only, can't delete self / last admin |
| `POST` | `/api/password` | `{password, current?, login?}` — admin can target others |
| `POST` | `/api/session/revoke-all` | drop every session of self or `?login=` (admin) |
| `GET`  | `/api/keys` | own active api keys (no secret) |
| `GET`  | `/api/admin/keys` | all active keys, admin only |
| `POST` | `/api/keys` | issue a new key; `{apiKey, mcpConfig}` shown once |
| `POST` | `/api/keys/rotate` | revoke all + issue new (destructive, confirm first) |
| `POST` | `/api/keys/:hash/revoke` | revoke one |
| `GET`  | `/api/mcp-config` | read-only: `{url, hasKey, activeKeys, hint}` |
| `GET`  | `/api/schemes` | list; `?user=all` admin only |
| `POST` | `/api/schemes` | `{name, scheme?}` |
| `GET`  | `/api/scheme/:name` | full scheme |
| `GET`  | `/api/scheme/:name/md` | SCHEME.md export (text/markdown) |
| `GET`  | `/api/scheme/:name/diff` | `?rev=N` — changes since rev |
| `GET`  | `/api/scheme/:name/log` | `?limit=N` — journal tail |
| `PUT`  | `/api/scheme/:name` | CAS write of whole scheme (B7/B8: 400 on bad body) |
| `DELETE` | `/api/scheme/:name` | deletes the scheme dir |
| `POST/PUT/DELETE` | `/api/scheme/:name/node\|edge\|zone` | granular ops |

## MCP

One endpoint, both eras. Auth is `X-Api-Key` only.

- **modern** (`2026-07-28`): advertise with `MCP-Protocol-Version` header.
  - `server/discover` → `{supportedVersions, capabilities, serverInfo, _meta}`
  - every request may carry `_meta["io.modelcontextprotocol/protocolVersion"]`
  - `Mcp-Method` / `Mcp-Name` headers must agree with the body (-32020)
- **legacy** (`2025-11-25`, `2025-06-18`, `2025-03-26`): `initialize` echoes
  the requested `protocolVersion`; `ping`, `tools/list`, `tools/call`.
- All 12 tools carry `annotations` (`readOnlyHint`, `destructiveHint`,
  `idempotentHint`) so MCP clients can decide what to confirm.
- `Origin` is validated (B15) — a foreign origin is 403, no origin is fine
  (non-browser clients), same-origin is fine.

### Tool list

| name | annotations | what |
|---|---|---|
| `list_schemes` | readOnly | names of the authenticated user |
| `get_scheme` | readOnly | full scheme JSON |
| `get_scheme_md` | readOnly | SCHEME.md export |
| `create_scheme` | write | empty or with `{rev: 0}` payload |
| `put_scheme` | write | CAS; payload rev must match disk |
| `delete_scheme` | destructive | drop scheme dir |
| `node_add` | write | x/y optional → autoLayout |
| `node_update` | idempotent | partial fields |
| `node_remove` | destructive | edges to the node go too |
| `edge_add` | write | from/to/style/label |
| `edge_remove` | destructive | by id |
| `diff` | readOnly | changes since a rev |

## Pages

- `GET /` and `GET /admin` — same file: `console.html`. Returns the file
  whether or not the visitor is signed in; an XHR from a stale session gets
  401. The console decides login vs app shell in JS.
- `GET /editor/<name>` — `editor.html` with the scheme embedded. Auto-creates
  the scheme on first open so a brand-new project is one URL away from the
  editor.
- `GET /assets/<font>.woff2` — immutable, 1 year. The font is served next
  to the HTML, not base64-inlined (saves ~26 KB per page on every load).

## On-disk format

Lightdb (`DATA_DIR/lightdb.json`): users + tokens + API keys. Quota enforced
BEFORE the file grows. Schemes live in `DATA_DIR/schemes/<user-id>/<name>/` —
the exact same on-disk shape v1 used, so a live container upgrades in place
with no migration.

## Security notes

- Sessions are HttpOnly cookies OR bearer tokens. GETs never mutate state.
- Body limit is enforced per request; oversized bodies destroy the socket.
- Query string is never logged.
- A password change drops every session for the user.
- Rotate-revokes are explicit POSTs that the UI confirms before calling.
- Origin allowlist is enforced on `/mcp`.
