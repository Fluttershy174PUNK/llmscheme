# LOGIN.md — login + console + admin guide

The console is `mcp-service/console.html` (served at `/` and `/admin`). It
is the same single-page app, four hash-routed screens:

- `#/login` — form
- `#/projects` — list of your schemes
- `#/users` — admin only
- `#/settings` — own password + own api keys

## First start

When the data dir is empty, the server bootstraps an admin from the
`ADMIN_LOGIN` / `ADMIN_PASSWORD` env vars (default `admin` / `admin`).
**Change the password on the settings screen before opening the port
to anything public** — the docker-compose example refuses to start without
`ADMIN_PASSWORD` set.

If you are locked out, the only way back is to delete
`DATA_DIR/lightdb.json` and restart with a fresh `ADMIN_PASSWORD` env.

## Login form

- login + password
- Enter submits
- error renders under the form
- "reset admin password" is a help text, not a form: see above

The right-hand panel shows the live README (the project root's
`README.md`, served at `/api/readme`). The skill spec's UI node `n1`
"actual gitlab readme and link" maps to this.

## Projects screen

- table: `project · scheme · edit · user (admin only) · last edit · del`
- `?user=all` slider (admin): see every user's schemes
- `new project` button: prompts for a name, POSTs `/api/schemes`
- `del` button: requires typing the project name to confirm (B3-style
  destructive confirmation; not a `confirm()` dialog)
- `edit` link → opens the server-side editor at `/editor/<name>`

The server auto-creates a scheme on first open, so the first edit lands
in rev 1 with no separate POST round-trip.

## Users screen (admin only)

- table: `login · role · api keys · created · actions`
- actions per row: `pass` (change the user's password — admin can target
  another user), `mcp` (show the MCP config: URL + hasKey), `rotate`
  (revoke all + issue a new api key, requires confirmation — R9/B13),
  `×` (delete user; cannot delete self or last admin)
- `new user` button: prompts for login + password, POSTs `/api/users`
- `logout` button: revokes the current session
- `logout all` button: revokes every session for the current user,
  including this one — you will be signed out

## Settings screen

- **change password**: prompts for new password, POSTs `/api/password`,
  your session is dropped, you sign in again
- **api keys**: list of your active keys (`hash` + createdAt), with
  `revoke` per key, and `new key` button. The secret is shown once at
  creation time, then only the hash.
- **mcp**: read-only view of `{url, hasKey, activeKeys, hint}` (B13:
  GET never mutates state)

## Lang

A toggle in the top bar. Persists in `localStorage` under `blm-lang`.
Both the console and the editor share the same dictionary
(`src/editor/core/i18n.ts`), so EN/RU works the same in both.

## Auth lifecycle

- Token: 64-hex sha256, stored in the `ls_token` HttpOnly cookie
  (Set-Cookie on /api/login, cleared on logout / password change /
  revoke-all).
- TTL: `TOKEN_TTL_DAYS` (default 30). Closing the browser does not
  invalidate the cookie.
- B6 fix: logout reads the cookie's token hash, not just the
  Authorization header, so a session is always revoked end-to-end.
- A password change drops every session for the user.
- `revoke-all` (the button) drops every session for the current user.
