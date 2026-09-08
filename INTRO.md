# INTRO.md — start page for the HTTP service

> This page is shown to **operators** when they first hit the service.
> It is the service's "hello, this is what you just installed" — not
> the user-facing login screen (that's in `SERVICE-MCP/llmscheme/
> console.html`). The console itself has its own welcome flow.

---

## Welcome to llmscheme

You're running a single binary that gives you:

1. A **web console** for admins (login, projects, users, settings)
2. A **visual editor** for editing schemes by clicking and dragging
3. A **REST API** for scripts
4. An **MCP endpoint** for AI assistants

One container, no build step at deploy time.

---

## First things first

```bash
# 1. open the console
http://localhost:8080/

# 2. log in with the bootstrap admin
login:    admin
password: changeme   (or whatever ADMIN_PASSWORD you set)

# 3. CHANGE THE PASSWORD
click "settings" in the top bar → change password

# 4. create your first user (if you are not the admin)
#    or your first project (if you are)
#    the console walks you through it
```

---

## What's in this repo

```
.
├── SKILL/llmscheme/              ← the agent skill (drop into Claude Code)
├── SERVICE-MCP/llmscheme/        ← the deployable service (Docker)
├── HERMES-PLUGIN/llmscheme/      ← hermes plugin (placeholder)
├── DEMO-PROJECT/                 ← demo: test the skill in a real project
├── src/                          ← all source code (edit here)
├── .llm                          ← current structure + plan (for LLMs)
├── .test_on_local_proxmox/       ← deploy + test on proxmox LXC
├── PLAN.md  TODO.md              ← historical planning docs
├── PROJECT.md  README.md         ← this repo
├── LICENSE                       ← MIT
├── INTRO.md                      ← you are here
└── src/docs/                     ← in-depth guides
```

---

## Quick reference

| Task | Command |
|---|---|
| Start the service | `node src/service/server.ts` |
| Start via Docker | `cd SERVICE-MCP/llmscheme && docker compose up` |
| Run tests | `npm test` |
| Typecheck | `npm run typecheck` |
| Build HTML artifacts | `npm run build` |
| Verify everything | `npm run verify` |
| Sync skill to artifacts | `npm run sync-skill` |
| Check artifacts match src | `npm run check` |

---

## Three ways to use llmscheme

### 1. The skill (for AI agents)

```bash
# drop SKILL/llmscheme/ into your agent's skills directory
# (for Claude Code: ${CLAUDE_SKILL_DIR})

# the agent then has these commands:
node <skill-dir>/cli/block.ts init my-project
node <skill-dir>/cli/block.ts node add --label "Login" --ref src/login.ts
node <skill-dir>/cli/block.ts validate
```

### 2. The browser editor (for humans, offline)

```bash
# in any project with a scheme:
xdg-open .block_llm/scheme.html     # Linux
open .block_llm/scheme.html         # macOS
```

The page is self-contained. It opens straight from `file://` — no
web server needed. Click and drag to edit. SAVE gives you a
copy-pasteable command for your agent.

### 3. The service (for teams, shared editing)

```bash
# open the console
http://localhost:8080/

# log in, create projects, edit schemes in the browser
# or via the REST API:
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/schemes
```

---

## Need help?

- **README.md** — what llmscheme is, 5-minute quick start, glossary
- **PROJECT.md** — repo map for contributors, day-to-day commands
- **src/docs/** — in-depth guides (format, editor, console, migration)
- **PLAN.md** — historical: the v2 plan from the v1 audit
- **TODO.md** — historical: what was left to do (all done now)

For the operator's guide, see
[SERVICE-MCP/llmscheme/README.md](SERVICE-MCP/llmscheme/README.md).
