# llmscheme

> **One sentence:** a tool that keeps a "map" of your project's modules
> and data flow in a single file — readable by you, an AI assistant, and
> a visual editor, all the same way.

Think of it like an auto-updated diagram for your code. Instead of
drawing boxes and arrows in a slide deck that goes stale the moment
someone renames a file, the diagram lives in `.block_llm/scheme.json`
and regenerates every time you save.

---

## What's in this repo (v2 layout)

```
llmscheme/
├── SKILL/llmscheme/          ← drop-in skill for AI agents
├── SERVICE-MCP/llmscheme/    ← Docker-deployable HTTP service
├── HERMES-PLUGIN/llmscheme/  ← hermes plugin (placeholder)
├── DEMO-PROJECT/             ← demo: test the skill in a real project
├── src/                      ← all source code (edit here)
├── .llm                      ← current structure + plan (for LLMs)
├── .test_on_local_proxmox/   ← real deploy + test scripts
├── README.md  PROJECT.md  INTRO.md  LICENSE
│   ├── docs/                 ← in-depth guides (moved under src/)
├── schemes/                  ← UI requirements
└── PLAN.md  TODO.md          ← historical planning
```

- **SKILL/llmscheme/** is a self-contained copy of `src/{core,cli}`.
  Drop it into your agent's skills directory and it gets the `block`
  command.
- **SERVICE-MCP/llmscheme/** is the Docker image. The Dockerfile runs
  `node src/service/server.ts` directly — no build step in the image.
- **HERMES-PLUGIN/llmscheme/** is a placeholder until the hermes plugin
  spec is final.
- **DEMO-PROJECT/** is a real project with a scheme. Use it to test
  the skill end-to-end.

---

## Table of contents

1. [What problem does this solve?](#what-problem-does-this-solve)
2. [What is a "scheme"?](#what-is-a-scheme)
3. [The three ways to use it](#the-three-ways-to-use-it)
4. [Quick start (5 minutes)](#quick-start-5-minutes)
5. [How it works (the 30-second version)](#how-it-works-the-30-second-version)
6. [For LLM agents](#for-llm-agents)
7. [For humans (browser editor)](#for-humans-browser-editor)
8. [For operators (HTTP service)](#for-operators-http-service)
9. [Glossary](#glossary)
10. [Troubleshooting](#troubleshooting)
11. [Where to read next](#where-to-read-next)

---

## What problem does this solve?

When you (or an AI) work on a real codebase, you constantly need to
answer:

- "What modules does this project have?"
- "Where does data flow from here to there?"
- "What does this file actually do?"
- "Is this `ref` still pointing at a real file?"

Most projects answer those questions by either:

- **Grep + guess** — slow, error-prone, breaks the moment the code changes
- **Hand-written docs** — go stale the moment the code changes
- **A wiki nobody updates** — same problem

**llmscheme** keeps a single file (`.block_llm/scheme.json`) that
describes the **WHAT** of the project — the boxes (modules) and the
arrows (data flow) — and regenerates a human-readable `SCHEME.md` and
an interactive `scheme.html` from it on every change. The file is the
source of truth. The Markdown and the HTML are just pretty views.

---

## What is a "scheme"?

A scheme is a JSON file with this shape:

```json
{
  "name": "Auth Flow",
  "nodes": [
    { "id": "n1", "label": "Login",   "refs": ["src/login.ts"] },
    { "id": "n2", "label": "Tokens",  "refs": ["src/tokens.ts"] }
  ],
  "edges": [
    { "id": "e1", "from": "n1", "to": "n2" }
  ]
}
```

That's it. A scheme is just a list of **nodes** (things in your project)
connected by **edges** (how data flows between them). You can also add
**zones** (dashed rectangles that group things) and **labels** (free
text on each shape).

Open `.block_llm/scheme.html` in a browser and you get a clickable,
draggable diagram. Open `.block_llm/SCHEME.md` in any text editor and
you get a Markdown summary. Both are generated from the same JSON.

---

## The three ways to use it

| Who | How | What they get |
|---|---|---|
| **LLM agent** (Claude Code, Cursor, etc.) | Command-line tool (`block`) | A skill it can read + write |
| **Human** (you) | Browser editor | Click & drag visual editor |
| **Operator** (you, in production) | HTTP service + MCP | Web UI for multiple users |

All three read the **same** on-disk format. Edit in the browser, the
CLI sees the change. Edit via the CLI, the browser sees the change.

---

## Quick start (5 minutes)

You need [Node.js 22.18 or newer](https://nodejs.org/) installed. If you
already have a recent Node, you're good.

### Step 1: install the dev tools (one time)

```bash
git clone <this-repo> llmscheme
cd llmscheme
npm install
```

This installs `esbuild` and `svelte` (the build tools). The CLI and
the service don't need them at runtime — only the HTML editor build
does.

### Step 2: try the skill in a fresh project

```bash
mkdir my-project && cd my-project
node /path/to/llmscheme/SKILL/llmscheme/cli/block.ts init --name "My Project"
```

That creates `.block_llm/scheme.json`, a `.gitignore` line, and an
`AGENTS.md` section. It also writes `SCHEME.md` (the readable summary)
and `.block_llm/scheme.html` (the browser editor).

### Step 3: add a few nodes

```bash
node /path/to/llmscheme/SKILL/llmscheme/cli/block.ts node add \
    --label "Login page" --ref src/login.ts

node /path/to/llmscheme/SKILL/llmscheme/cli/block.ts node add \
    --label "Token store" --ref src/tokens.ts

node /path/to/llmscheme/SKILL/llmscheme/cli/block.ts edge add \
    --from n1 --to n2
```

Each `node add` adds one box; `edge add` draws an arrow.

### Step 4: open the visual editor

Double-click `.block_llm/scheme.html` in your file manager, or:

```bash
xdg-open .block_llm/scheme.html      # Linux
open .block_llm/scheme.html          # macOS
start .block_llm/scheme.html         # Windows
```

The page works **without** a web server. It opens straight from
`file://` because everything is self-contained.

### Step 5: check everything is healthy

```bash
node /path/to/llmscheme/SKILL/llmscheme/cli/block.ts doctor
node /path/to/llmscheme/SKILL/llmscheme/cli/block.ts validate
```

`doctor` checks that `scheme.json`, `SCHEME.md`, and `scheme.html`
agree. `validate` checks the JSON for errors (broken edges, unknown
shapes, etc.).

### Step 6: test the demo project

```bash
cd /path/to/llmscheme/DEMO-PROJECT
cat .block_llm/scheme.json          # a real scheme
cat SCHEME.md                       # its markdown export
open .block_llm/scheme.html         # the browser editor
node src/run.ts                     # the actual program
```

---

## How it works (the 30-second version)

```
         ┌─────────────────┐
         │  scheme.json    │  ← single source of truth
         │  (your data)    │
         └────────┬────────┘
                  │
      ┌───────────┼───────────┐
      │           │           │
      ▼           ▼           ▼
   block.ts   SCHEME.md   scheme.html
   (CLI)     (Markdown)  (browser)
      │           │           │
      ▼           ▼           ▼
    Agent      Humans      Humans
   reads+     (any text    (visual
   writes      editor)      editor)
```

- `scheme.json` is the truth.
- `block.ts` is the CLI tool. It reads + writes `scheme.json` and
  regenerates the other two files on every save.
- `SCHEME.md` is auto-generated Markdown (for grep, for LLMs, for code
  review).
- `scheme.html` is a self-contained browser editor (no server needed).

When you (or the agent) run `node add` or `edge add`, the CLI:

1. Updates `.block_llm/scheme.json`
2. Regenerates `SCHEME.md` (with mermaid diagram + tables)
3. Regenerates `.block_llm/scheme.html` (with the new data baked in)

If you edit `scheme.html` in the browser and hit SAVE, the editor
gives you back a command to paste into your agent — the agent then
runs `block put` which does the same three steps.

---

## For LLM agents

Drop the `SKILL/llmscheme/` directory into your agent's skills folder
(for Claude Code: `${CLAUDE_SKILL_DIR}`). The agent will then have a
`block` command available with subcommands like `init`, `get`,
`node add`, `edge add`, `validate`, `diff`, `doctor`, `pull`, `sync`,
`restore`, `history`, `render`, `upgrade`, `version`.

The agent's job is to keep the scheme in sync with the code. The
ritual is:

1. `validate --json` — fix any errors before changing code
2. `get --json` — read the current state, remember the `rev` number
3. Make the code change
4. `node add` / `node update` / `edge add` / etc. with `--rev N` (the
   rev you read in step 2)
5. `doctor` to confirm JSON + MD + HTML are all consistent

Full reference: [SKILL/llmscheme/SKILL.md](SKILL/llmscheme/SKILL.md) —
this is what the agent sees.

---

## For humans (browser editor)

Open `.block_llm/scheme.html` in a browser. You get:

- **Click and drag** a node to move it
- **Drag the bottom-right corner** of a node to resize it
- **Click a node** to select it; **Ctrl+click** to multi-select
- **Right sidebar**: edit the selected node's label, description,
  shape, position, refs
- **Top toolbar**: add a node, add a zone, connect two nodes (click
  the green `+` port on one node, then the `+` port on another),
  undo/redo, delete, save
- **Grid and snap** toggles in the top-right
- **Language** toggle (EN / RU) in the top-right

When you hit **SAVE**, the editor gives you three options:

- **Tier A** (always works): a copy-pasteable command for your agent.
  Run it in your terminal; the agent commits the change.
- **Tier B** (Chromium browsers): a "Save As" dialog writes the files
  directly. No agent needed.
- **Tier S** (when the editor is served by the HTTP service): a
  direct write to the server.

For the full editor manual, see
[SKILL/llmscheme/references/EDITOR.md](SKILL/llmscheme/references/EDITOR.md).

---

## For operators (HTTP service)

The HTTP service is for when you want a shared, multi-user setup —
a team with one scheme per project, or a web-facing console for
admins. It exposes:

- A **web console** at `http://localhost:8080/` (login, projects,
  users, settings)
- A **visual editor** at `http://localhost:8080/editor/<scheme-name>`
- A **REST API** at `http://localhost:8080/api/...` for scripts
- An **MCP endpoint** at `http://localhost:8080/mcp` for AI clients

### Start the service

```bash
cd llmscheme
npm install
npm run build              # one-time: produces the HTML artifacts
npm run sync-skill         # one-time: updates SKILL/ from src/

ADMIN_PASSWORD=changeme PORT=8080 \
    DATA_DIR=./data \
    node src/service/server.ts
```

Open `http://localhost:8080/` in a browser. Log in as `admin` /
`changeme`. **Change the password on the settings page immediately.**

### Or run it with Docker

```bash
cd SERVICE-MCP/llmscheme
cp .env.example .env
# edit .env: set ADMIN_PASSWORD to something strong

docker compose up -d
```

The container runs the same `node src/service/server.ts` command.
Schemes and user accounts live in the `llm-data` named volume.

### Deploy to the dev sandbox (proxmox LXC 999)

```bash
export DEV_PASSWORD='…'           # from .test_on_local_proxmox/test_dev.md
export ADMIN_PASSWORD='changeme'
./.test_on_local_proxmox/deploy.sh     # build + rsync + docker up
./.test_on_local_proxmox/test.sh        # smoke test
```

Full operator reference:
[SERVICE-MCP/llmscheme/README.md](SERVICE-MCP/llmscheme/README.md).

---

## Glossary

| Term | What it means |
|---|---|
| **scheme** | The JSON file (`.block_llm/scheme.json`) that describes your project's structure |
| **node** | A box on the diagram — a module, file, or concept in your project |
| **edge** | An arrow between two nodes — a data flow, dependency, or call |
| **zone** | A dashed rectangle that groups nodes — a layer, subsystem, or "this stuff belongs together" |
| **rev** | A revision number. Starts at 0, increments on every write. Used for CAS to prevent two writers from clobbering each other |
| **CAS** | Compare-And-Swap. A write that succeeds only if the on-disk `rev` matches what the writer read. |
| **core** | The data model + validation library. Pure TypeScript, zero dependencies. |
| **skill** | A directory an AI agent loads to gain new capabilities. Here, `SKILL/llmscheme/`. |
| **MCP** | Model Context Protocol. A standard way for AI assistants to call tools on a server. |
| **tier** | A save strategy for the browser editor: A = command for the agent, B = direct file write, C = download, S = HTTP PUT to the service |
| **wrap** | Auto-wrap long labels to fit a box. Set to 34 characters wide. |

---

## Troubleshooting

### "I get a warning that my `ref` is stale"

```
stale-ref: src/foo.ts does not exist
```

The path in your node's `refs` array points to a file that doesn't
exist anymore. Either:

- Rename the file in your code, then update the scheme
- Delete the node

### "Two writers clobbered each other"

```
conflict: scheme changed on disk (rev 7 → 8), re-read and retry
```

Someone wrote to the scheme between when you read it and when you
tried to write. Re-run `get --json` to see the new `rev`, and retry
your write with `--rev N` set to the new value.

### "The CLI says `node` is not found"

You're using Node < 22.18, or the path to the CLI is wrong.

- `node --version` should be 22.18 or newer
- The path you typed actually points at `SKILL/llmscheme/cli/block.ts`

### "The browser editor shows a blank canvas"

If the scheme has no nodes, the editor shows a welcome seed
(3 nodes, 2 edges) so you have something to work with. Add a real
scheme with `block init` and refresh.

### "The MCP endpoint returns 403 origin not allowed"

Your browser sent an `Origin` header that the server doesn't trust.
Set `ORIGIN_ALLOWLIST` in the server's environment to a
comma-separated list of allowed origins.

### "I forgot the admin password"

Stop the service. Delete `DATA_DIR/lightdb.json`. Restart with
`ADMIN_PASSWORD=...` in the environment. **This wipes all users and
sessions** but leaves your schemes on disk intact.

---

## Where to read next

- **If you're an LLM agent** (or configuring one):
  [SKILL/llmscheme/SKILL.md](SKILL/llmscheme/SKILL.md)
- **If you're using the browser editor:**
  [SKILL/llmscheme/references/EDITOR.md](SKILL/llmscheme/references/EDITOR.md)
  or [src/docs/EDITOR.md](src/docs/EDITOR.md)
- **If you're running the HTTP service:**
  [SERVICE-MCP/llmscheme/README.md](SERVICE-MCP/llmscheme/README.md)
  or [src/docs/LOGIN.md](src/docs/LOGIN.md)
- **If you want to know the JSON format inside-out:**
  [src/docs/SCHEME_FORMAT.md](src/docs/SCHEME_FORMAT.md)
- **If you're upgrading from v1:**
  [src/docs/MIGRATION.md](src/docs/MIGRATION.md)
- **If you're contributing code:**
  [PROJECT.md](PROJECT.md)
- **If you want a live snapshot of the project:**
  [.llm](.llm)
- **If you want to deploy to the dev sandbox:**
  [.test_on_local_proxmox/README.md](.test_on_local_proxmox/README.md)

---

## License

MIT.
