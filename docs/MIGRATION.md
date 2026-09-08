# MIGRATION.md — v1 → v2

The on-disk format is **unchanged**. A live v1 service upgrades in place
by replacing the container — no migration step.

## What changed on the wire

### Removed

- `?t=<token>` in URL: was used by the v1 editor to pass a session
  token to itself, leaked via Referer and access log. Removed (B9).
  Use the cookie.
- `GET /api/mcp-config` revoking keys: was a destructive side effect
  of a read. Now a clean read; rotate is an explicit `POST` (B13).

### Added

- `POST /api/session/revoke-all` — sign out everywhere
- `POST /api/keys/:hash/revoke` — revoke one key
- `POST /api/keys/rotate` — revoke all + issue new (replace the v1 GET)
- `POST /api/password` — change own password (or someone else's, admin)
- `GET /api/readme` — live README for the login page
- `GET /api/admin/keys` — admin view of every active key

### Changed

- `PUT /api/scheme/:name` returns 400 (not 409, not 500) for malformed
  bodies — B7/B8. Validate-then-CAS.
- `/editorial` and `/editorFOO` return 404 without creating directories —
  B5. The route is exactly `/editor/<name>`.
- `/api/logout` works for cookie-based sessions (not only Bearer) — B6.
- A password change drops every session for the user.

### New MCP era (2026-07-28)

The MCP endpoint speaks both legacy (`initialize`, 2025-*) and modern
(`server/discover`, 2026-07-28). All 12 tools carry `annotations`. Origin
is validated (403 on a foreign browser). Tool handlers are shared with
REST, no duplicate dispatch table.

## What changed on disk

Nothing. `lightdb.json` keeps the same shape; `data/schemes/<uid>/<name>/`
is byte-compatible. v1 backups, journal entries, autosave rotation —
all readable by v2.

## What changed for an LLM agent

- The CLI is the same: `init` / `get` / `node add` / `edge add` /
  `validate` / `put` / `diff` / `doctor` / `pull` / `sync` / etc.
- `pull` is new: bring a service scheme into the local project
  (`block pull --url --key --name`).
- Same ritual: read with `get --json`, write with the remembered rev.

## Upgrade steps

1. Stop the v1 container.
2. Pull v2.
3. Start v2 with the same `DATA_DIR`. The new code reads the old
   lightdb without changes.
4. Open the console: passwords and tokens keep working.
5. (Optional) clean `cache/` after a few days — the new `AUTOSAVE_KEEP`
   cap (default 10) is tighter than v1's unlimited.
