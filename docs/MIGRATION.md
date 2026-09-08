# MIGRATION.md — upgrading from v1 to v2

> **Who this is for:** anyone running a v1 llmscheme service who
> wants to upgrade to v2. If you started with v2, skip this file.

---

## The good news first

**The on-disk format is unchanged.** Your existing `lightdb.json`
and `data/schemes/<user-id>/<name>/` directories work with v2
without any conversion. A live v1 service upgrades in place by
replacing the container — no migration step, no data import, no
"export from v1, import to v2" dance.

You can verify this yourself: stop v1, start v2 with the same
`DATA_DIR`, log in with the same credentials, open any scheme,
edit it, save it. It just works.

---

## What changed on the wire (REST + MCP)

A handful of v1 endpoints changed their behavior. Most are
**safer** in v2 (fewer accidental side effects), a few are
**new**, and zero are removed.

### Removed (use the replacement instead)

| v1 endpoint | What it did | v2 replacement |
|---|---|---|
| `GET /api/mcp-config` | Revoked every API key and issued a new one (a destructive side effect of a read!) | `POST /api/keys/rotate` — explicit, confirmed |
| `?t=<token>` in URLs | Used by the v1 editor to pass a session token to itself | Use the `ls_token` cookie. No token in URLs. |

### New

| Endpoint | What it does |
|---|---|
| `POST /api/session/revoke-all` | Sign out of every device |
| `POST /api/keys/:hash/revoke` | Revoke one API key |
| `POST /api/password` | Change your own password (or another user's, as admin) |
| `GET /api/readme` | The README rendered on the login page |
| `GET /api/admin/keys` | Every active key across all users (admin only) |
| Modern MCP era | `server/discover` (2026-07-28), `_meta` on every request, `Mcp-Method` / `Mcp-Name` headers, `annotations` on all tools |

### Changed behavior

| Endpoint | v1 | v2 |
|---|---|---|
| `PUT /api/scheme/:name` with malformed body | Returned 500 | Returns **400** (validate-then-CAS) |
| `/editorial`, `/editorFOO` | Created scheme folders with garbage names | Return **404**, no side effects |
| `POST /api/logout` (cookie session) | Did not revoke the cookie token | Revokes the cookie token too |
| `POST /api/password` | Just changed the password | Changes the password **and drops every session** for that user |

---

## What changed for an LLM agent (CLI)

The CLI is almost the same. The subcommands are unchanged:
`init`, `get`, `node add|update|remove`, `edge add|update|remove`,
`zone add|update|remove`, `put`, `sync`, `render`, `diff`,
`history`, `restore`, `doctor`, `validate`, `upgrade`, `version`.

**New subcommand:**

```bash
# pull a scheme FROM a service INTO the local project
block pull --url http://host:8080 \
          --key llm_xxxxxxxxxxxxxxxxxxxxxxxx \
          --name web/auth
```

This is the one networked command in the CLI. All others are
purely local. `pull` is useful when a team uses the service for
collaboration and the agent needs to bring a scheme into its
local `.block_llm/` to work on it offline.

**The ritual is the same:**

1. `validate --json` — fix any errors first
2. `get --json` — read the current state, remember the `rev`
3. Make your changes
4. `node add` / `edge add` / etc. with `--rev N` (the rev you read)
5. `doctor` — confirm JSON, MD, and HTML all agree

---

## What changed in the browser editor

| v1 | v2 |
|---|---|
| One editor for both file:// and service | Two entries: `editor/skill/main.ts` (file://) and `editor/service/main.ts` (http). Both share one `Editor.svelte` component. |
| `serverMode = !location.pathname.endsWith(".html")` (a runtime check) | Physical separation: the skill entry doesn't have any `/api/` code, the service entry doesn't have `PRISTINE_HTML` |
| SAVE = either FSA (Chromium) or download (Firefox) | SAVE = Tier A (clipboard command) always, plus Tier B/C/S depending on browser and entry point |
| Inspector mixed node and edge fields (bug B3) | Inspector has three separate forms, one per `sel.kind` |
| No redo | Undo + redo (Ctrl+Z / Ctrl+Shift+Z) |
| No dirty indicator, no `beforeunload` | Dirty flag in the status bar, `beforeunload` warning when closing with unsaved changes |
| Hardcoded Russian | EN/RU toggle, shared with the console |
| Lang via `window.__lang` (a script-scope `let` invisible to inline onclick) | Lang as reactive state, `localStorage`-persisted |

---

## What changed in the console

| v1 | v2 |
|---|---|
| Hardcoded Russian | EN/RU toggle |
| No password change UI | Settings page: change own password |
| No user column in the projects table | 6-column table including user (admin only) |
| "Del project" was a single click | Double confirmation: type the project name |
| "Regenerate" was a single click | Confirmation dialog + the new secret shown once |
| `/api/mcp-config` (GET) revoked keys | Read-only `mcp-config`; explicit `POST /api/keys/rotate` to rotate |

---

## What changed on disk (almost nothing)

| Path | v1 → v2 |
|---|---|
| `lightdb.json` | Same shape; same data |
| `data/schemes/<uid>/<name>/scheme.json` | Same shape; same data |
| `data/schemes/<uid>/<name>/.block_llm/cache/` | Same journal + autosaves; tighter rotation cap (`AUTOSAVE_KEEP` defaults to 10 in v2, was unlimited) |
| `data/schemes/<uid>/<name>/.block_llm/scheme.html` | New format (rebuilt by v2 on next write) — but v1's format was 99% identical, so v2 reads it fine |
| `SCHEME.md` | Same format; now idempotent (reads `meta.updatedAt`) |

If you have backups of old `cache/` directories from v1, you can
keep them. v2 will read them on first start; the rotation cap
will trim the extras on the next write.

---

## Upgrade steps (the actual procedure)

### If you run the Docker image

```bash
# 1. stop the old container
docker compose down

# 2. pull the new image (or rebuild from source)
docker pull your-registry/llmscheme-service:2.0.0
# OR, if you build locally:
git pull && npm install && npm run build

# 3. start the new container with the same DATA_DIR
docker compose up -d
```

That's it. Your schemes and users are exactly where you left
them. The new code reads the old format.

### If you run the binary directly

```bash
# 1. stop the old service
pkill -f "node.*server.ts"

# 2. replace the source tree
git pull
npm install
npm run build
npm run sync-skill

# 3. start the new service with the same env
PORT=8080 DATA_DIR=./data ADMIN_PASSWORD=... \
    node src/service/server.ts
```

### After upgrading

1. Open `http://your-host:8080/`. Log in as before.
2. Go to **Settings** → change your password (it's been a while,
   right?).
3. Open one of your schemes. The editor will rebuild the HTML
   view on first save. Until then, the old `scheme.html` still
   works.
4. If you were using a v1 MCP client, you may need to update
   your config: the modern era (`2026-07-28`) is preferred, but
   legacy (`2025-11-25`, `2025-06-18`) still works.
5. Done. The v1 skill (`skill/`) was replaced by the v2 one. If
   you have agents mounting it, no changes needed — the command
   surface is identical.

---

## What to do if something breaks

### "I get 401 on every request"

Your session token may have been issued by v1 and v2 doesn't
recognize its hash format. Log out, log back in. This re-issues
the token with v2's format.

### "My `?t=<token>` URL stopped working"

v2 doesn't accept tokens in URLs. Use the cookie (browsers
already have it) or pass `Authorization: Bearer <token>` (scripts
and MCP clients).

### "A scheme I had in v1 won't open"

Open it in the editor and run **SAVE**. v2 will rewrite the
`scheme.html` and `SCHEME.md` in its format. The underlying
`scheme.json` is unchanged.

### "The MCP client lost its key"

v1's `GET /api/mcp-config` issued a new key as a side effect.
v2's GET is read-only. Use `POST /api/keys/rotate` (or the
"rotate" button in the console) to issue a new one, then paste
it into your MCP client config.

---

## Rolling back

If v2 doesn't work for you, the old v1 image still runs. v1
and v2 read the same on-disk format, so a rollback is:

```bash
# stop v2
docker compose down

# start v1 with the same DATA_DIR
docker run -d --name llmscheme -p 8080:8080 \
    -v /var/lib/llmscheme:/data \
    -e ADMIN_PASSWORD=... \
    your-registry/llmscheme-service:1.0.0
```

Your data is untouched. The only thing you lose is the v2
features (redo, dirty indicator, modern MCP era, EN/RU toggle,
etc.).
