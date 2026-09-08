# LOGIN.md — the web console (login + admin screens)

> **Who this is for:** anyone running the llmscheme HTTP service
> (`node src/service/server.ts`) who needs to understand the web
> console at `http://localhost:8080/`. If you only use the CLI or
> the standalone editor, skip this file.

---

## What is the console?

The console is a small web app that lives at the root of the HTTP
service. It lets a team share schemes: admins create user accounts,
every user logs in and edits their own schemes, and the same JSON
format is used by the CLI, the editor, and the REST/MCP APIs.

The console is **one** single-file HTML page (~77 KB). It runs the
same Svelte runtime as the editor, just with different components.

---

## The four screens

The console has four screens, selected by the URL hash:

| URL | Screen | Who sees it |
|---|---|---|
| `/#/login` | Login form | Everyone (no auth needed) |
| `/#/projects` | Project list | After login |
| `/#/users` | User management | Admins only |
| `/#/settings` | Your own password + API keys | After login |

You can also use `/#/logout` to sign out, but there are buttons
for that in the top bar.

---

## First start — what happens when the database is empty

The very first time you start the service (with an empty `DATA_DIR`),
it creates an admin account from environment variables:

```bash
ADMIN_LOGIN=admin
ADMIN_PASSWORD=admin    # CHANGE THIS
```

If `ADMIN_PASSWORD` is not set, it defaults to `admin` and the
service prints a warning. **The docker-compose setup refuses to
start without it set.**

### If you forgot the admin password

There's no "forgot password" flow (by design — it's a self-hosted
tool, there's no email server). The only way back is:

1. Stop the service.
2. Delete `DATA_DIR/lightdb.json` (the user database — NOT the
   `schemes/` directory).
3. Restart the service. It will create a fresh admin from the env
   vars.

**This wipes all users and sessions.** Your schemes on disk are
untouched.

---

## The login screen

The login screen has:

- A small pixel-art cat (just decoration)
- A form with two fields: login and password
- A "reset admin password" collapsible help section (pointing to
  the procedure above)
- A live README panel on the right — the contents of the project
  root's `README.md`, rendered as Markdown

The form submits when you press Enter. If the credentials are
wrong, the error message shows under the form. After three failed
attempts in a row, the server adds a small delay to slow down
brute-force attacks.

---

## The projects screen

This is the home screen after login. It shows a table of all your
schemes (or all schemes across all users, if you're an admin and
toggle the "show all users' projects" switch).

| Column | What it means |
|---|---|
| project | The project name (or `—` for a scheme that isn't in a project) |
| scheme | The scheme name |
| edit | A link that opens the scheme in the editor |
| user | (admin only) Which user owns this scheme |
| last edit | When the scheme was last modified |
| del | A delete button (asks for confirmation) |

The "edit" link takes you to `/editor/<scheme-name>`, which loads
the scheme in the browser editor. The first time you open a
project, the server **auto-creates** the scheme if it doesn't
exist yet — so you can start editing without a separate "create"
step.

### Creating a new project

Click the **new project** button in the top-right. A dialog asks
for the project name. Type it, confirm, and the project appears
in the table. The first scheme is auto-created when you click
"edit" on it.

### Deleting a project or scheme

Click the red `×` button. The console asks you to type the project
or scheme name to confirm. This is intentional — destructive
actions need a second confirmation that's hard to do by accident.

---

## The users screen (admin only)

If you're logged in as an admin, the **users** tab appears in the
top nav. It shows a table of all users:

| Column | What it means |
|---|---|
| login | The user's login name |
| role | `admin` or `user` |
| api keys | How many active API keys this user has |
| created | When the account was created |
| actions | Per-user buttons (see below) |

### Per-user actions

- **pass** — change this user's password (admin can do this for
  any user, including themselves)
- **mcp** — show the MCP configuration (URL + hasKey) for this
  user. **Read-only** — clicking it just shows a dialog, nothing
  changes on the server.
- **rotate** — revoke all of this user's API keys and issue a new
  one. Destructive: the old key stops working immediately. The
  console asks for confirmation, and the new secret is shown
  **once** — copy it now, you can't see it again.
- **×** — delete the user. The console won't let you delete
  yourself or the last remaining admin.

### Creating a new user

The **new user** button asks for a login and a password. The
account is created with the `user` role by default. You can't
create admins through the UI (admins are bootstrapped from the
env vars or upgraded by another admin through the API — by
design, you can't accidentally make everyone an admin).

---

## The settings screen

The **settings** tab is for managing your own account. It has
three sections:

### Change your password

Type your new password, click **change**. Your current session
is dropped — you'll be sent back to the login screen. All your
other sessions (other browsers, other devices) are dropped too.

### API keys

A table of your active API keys. Each row shows:

- The key's hash (first 12 characters — the full hash is too long
  to display)
- When it was created
- A **revoke** button

Click **new key** to issue a new one. The secret is shown once,
in a dialog. **Copy it immediately** — the server only stores the
hash, so it can never show you the full secret again. If you lose
it, rotate (which revokes all your keys and issues a new one).

### MCP configuration

A read-only panel showing the MCP server's URL and whether you
have any active keys. This is the same info as the `mcp` button
on the users screen, but for your own account.

---

## The top bar — what every button does

The bar at the top of every screen has:

- **llmscheme** (logo) — click to go to the projects screen
- **projects / users / settings** (nav) — switch screens (the
  **users** tab is admin-only)
- **{login} ({role})** — your identity; read-only
- **logout all** — sign out of every device/session at once
- **logout** — sign out of this browser only
- **EN/RU** — language toggle (persists in `localStorage`)

---

## Auth lifecycle (for the curious)

- A login creates a session token (a random 64-hex string). The
  server stores `sha256(token)` in `lightdb.json`.
- The token is sent to your browser as a cookie named `ls_token`,
  marked `HttpOnly` and `SameSite=Lax`. JavaScript can't read it
  (that's the point of `HttpOnly`).
- For scripts and MCP clients, the same token works as a Bearer
  header: `Authorization: Bearer <token>`.
- The token expires after `TOKEN_TTL_DAYS` (default 30 days). The
  cookie also has a `Max-Age` of the same value.
- **Logout** drops the token that was used to call it (so the
  cookie-based logout from the browser works end-to-end, not just
  the Bearer-based logout from a script).
- **Logout all** drops every token for your user, across all
  devices.
- **Changing your password** drops every token for your user too.

---

## What can an admin do that a regular user can't?

| Action | Regular user | Admin |
|---|---|---|
| Edit their own schemes | ✓ | ✓ |
| Create new projects | ✓ | ✓ |
| See the users tab | ✗ | ✓ |
| Create new users | ✗ | ✓ |
| Change another user's password | ✗ | ✓ (with `?login=`) |
| Rotate another user's API keys | ✗ | ✓ (with `?login=`) |
| See another user's schemes | ✗ | ✓ (with `?user=all`) |
| Delete another user | ✗ | ✓ (but not self, not last admin) |

Everything admin-specific is gated. The console sends a
`?login=<other-user>` query parameter when an admin acts on
someone else's behalf, and the server rejects the request if
the caller isn't an admin.

---

## Troubleshooting

### "I see a blank screen after login"

Your session token may have expired. Click **logout** in the top
bar, log in again, and the page will reload.

### "The 'new project' button does nothing"

The dialog is open in a popup — check behind the main window or
look for a new browser tab. Some browsers block the dialog if
it's a cross-origin frame; click the main window first to make
sure it has focus.

### "I clicked 'rotate key' and now my MCP client stopped working"

That's the point of rotate. The old key is dead. Paste the new
key into your MCP client configuration and restart it.

### "The console says 'auth required' even though I just logged in"

Your cookie was cleared (by a browser restart, a privacy
extension, or by clicking "logout all"). Log in again.
