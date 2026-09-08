# PROJECT.md — repo hub for contributors

> **Who this is for:** people who want to **change the code** of
> llmscheme itself. If you just want to **use** it, read
> [README.md](README.md) instead.

This file is the "where things live" guide for the codebase. The
top-level [README.md](README.md) explains what the project does and
how to use it; this one explains how the project is organised and
how to add a feature.

---

## The one-sentence version

**Edit files in `src/`. Run `npm run verify`. Commit. The artifacts
in `SKILL/llmscheme/`, `SERVICE-MCP/llmscheme/`, and `dist/` regenerate
from `src/` and `npm run check` proves they match.**

---

## Map of the repo (v2 layout)

```
llmscheme/
│
├── src/                        ← THE source of truth. Edit here.
│   │
│   ├── core/                   ← The data model. Pure TypeScript, zero deps.
│   │                             Used by every other piece.
│   │                             • types.ts        — Scheme, SchemeNode, etc.
│   │                             • validate.ts     — error/warn rules
│   │                             • layout.ts       — auto-place nodes
│   │                             • diff.ts         — what changed
│   │                             • exportMd.ts     — Markdown output
│   │                             • saveSchema.ts   — atomic disk write
│   │                             • renderHtml.ts   — bake data into HTML
│   │                             • browser.ts      — same as index.ts, no node:fs
│   │                             • (10 files total, ~1300 lines)
│   │
│   ├── cli/                    ← The `block` command-line tool.
│   │                             One file, 16 subcommands, no bundler.
│   │
│   ├── service/                ← The HTTP service (REST + MCP).
│   │   ├── server.ts           ← Entry point
│   │   └── lib/                ← Routing, auth, store, schemes, pages, config
│   │
│   ├── editor/                 ← The browser-based visual editor.
│   │   ├── core/               ← Shared Svelte 5 component (canvas + inspector)
│   │   ├── skill/              ← file:// entry (tier A/B/C saves)
│   │   └── service/            ← http entry (tier S — PUT /api/scheme)
│   │
│   ├── console/                ← The web admin console (login, projects, users).
│   │                             Single Svelte 5 component, hash-routed.
│   │
│   ├── ui/                     ← Shared CSS — the pixel font and colour palette.
│   │                             One file. Imported by the editor and the console.
│   │
│   ├── build/                  ← Build scripts.
│   │   ├── build.ts            ← esbuild + svelte/compiler → 3 single-file HTML
│   │   ├── sync-skill.ts       ← SKILL/llmscheme/ sync (sha256-pinned)
│   │   └── check.ts            ← Verify the artifacts match the source
│   │
│   └── test/                   ← Tests (node:test, no frameworks).
│                                 73 tests: 33 core, 21 CLI, 19 service.
│
├── SKILL/llmscheme/            ← GENERATED. A verbatim copy of src/{core,cli}.
│                                 Drop this directory into your AI agent's skills
│                                 folder and the agent gains the `block` command.
│
├── SERVICE-MCP/llmscheme/      ← GENERATED + deploy config. The deploy image's
│   ├── editor.html             ← Self-contained editor (one file, ~110 KB)
│   ├── console.html            ← Self-contained console (one file, ~77 KB)
│   ├── assets/                 ← woff2 font files
│   ├── Dockerfile              ← Builds on node:22, no compile step
│   ├── docker-compose.yml
│   ├── .env.example
│   └── README.md               ← Operator's guide
│
├── HERMES-PLUGIN/llmscheme/    ← Hermes plugin (placeholder). v1 had only the
│                                 manifest; v2 ships a working plugin.mjs that
│                                 uses the same core.
│
├── DEMO-PROJECT/               ← A real demo project: cat generator (TUI + GIF + browser UI)
│   ├── src/cat.ts              ← TUI rendering (ANSI colours, no deps)
│   ├── src/gif.ts              ← GIF output (LZW + global colour table, no deps)
│   ├── src/run.ts              ← entry point
│   ├── cats.html               ← browser UI (generate button + pixel cat, no server)
│   ├── cats.txt                ← word list
│   ├── .llmscheme/logic_scheme/scheme.json  ← a real scheme (7 nodes, 6 edges, 1 zone)
│   ├── AGENTS.md               ← agent section
│   ├── README.md
│   └── .gitignore
│
├── .test_on_local_proxmox/     ← Real deploy + test for the dev sandbox.
│   ├── deploy.sh               ← build + rsync + docker compose up
│   ├── test.sh                 ← smoke test the deployed service
│   ├── test_dev.md             ← hermes skill reference for the sandbox
│   └── README.md
│
├── docs/                       ← User-facing guides (under src/docs/)
│   ├── SCHEME_FORMAT.md        ← JSON format, every field, validation rules
│   ├── EDITOR.md               ← Editor tiers + browser quirks
│   ├── LOGIN.md                ← Console + admin guide
│   └── MIGRATION.md            ← v1 → v2 changes
│
├── schemes/                    ← UI requirements (under src/schemes/)
│   └── UI-page.json
│
├── .github/workflows/
│   └── ci.yml                  ← Runs typecheck → test → build → check on push
│
├── package.json                ← Node ≥ 22.18, devDeps: esbuild + svelte
├── tsconfig.json               ← strict, erasableSyntaxOnly
├── svelte.config.js            ← svelte-check config (4 known a11y suppressions)
│
└── README.md  PROJECT.md  INTRO.md  LICENSE  PLAN.md  TODO.md  .llm
```

---

## Day-to-day commands

```bash
# install dev deps (one time)
npm install

# typecheck
npm run typecheck

# run all tests (73 of them)
npm test

# build the three HTML artifacts + regenerate SKILL/
npm run build
npm run sync-skill

# verify everything is consistent (typecheck + test + build + check)
npm run verify

# run the service locally
PORT=8080 DATA_DIR=./data \
    ADMIN_PASSWORD=changeme \
    node src/service/server.ts

# deploy to the dev sandbox
./.test_on_local_proxmox/deploy.sh
./.test_on_local_proxmox/test.sh
```

---

## "Where do I edit X?"

| If you want to change... | Edit this file |
|---|---|
| ...the data model (a new field on a node) | `src/core/types.ts` + `src/core/validate.ts` |
| ...the JSON format spec | `src/docs/SCHEME_FORMAT.md` |
| ...the Markdown export (the mermaid diagram) | `src/core/exportMd.ts` |
| ...the auto-layout algorithm | `src/core/layout.ts` |
| ...how a save is written to disk | `src/core/saveSchema.ts` |
| ...a CLI command (add a new flag, change behaviour) | `src/cli/block.ts` |
| ...a REST endpoint | `src/service/lib/routes.ts` |
| ...an MCP tool (add a tool, change its schema) | `src/service/lib/mcp.ts` (the `TOOLS` array + `callTool`) |
| ...how auth works (cookie, Bearer, API key) | `src/service/lib/auth.ts` + `src/service/lib/store.ts` |
| ...the editor canvas (drag, zoom, select) | `src/editor/core/Editor.svelte` |
| ...what the editor sends to the agent on SAVE | `src/editor/core/Editor.svelte` (the `copySaveCommand` function) |
| ...the web console (login screen, project list) | `src/console/App.svelte` |
| ...the colour palette or pixel font | `src/ui/pixel.css` |
| ...EN/RU translations | `src/editor/core/i18n.ts` |
| ...the build (which entries, what bundles) | `src/build/build.ts` |
| ...the on-disk format that the agent sees | `src/core/*` (then re-run `npm run sync-skill`) |
| ...the skill's user manual for the agent | `src/skill/SKILL.md` (it's a verbatim copy of `SKILL/llmscheme/SKILL.md` after sync) |
| ...the operator's guide for the docker image | `SERVICE-MCP/llmscheme/README.md` |
| ...the deploy script for the dev sandbox | `.test_on_local_proxmox/deploy.sh` |
| ...the current live snapshot for LLMs | `.llm` |
| ...the CI pipeline | `.github/workflows/ci.yml` |

---

## How the three artifacts are produced

```
src/editor/skill/main.ts  ──┐
src/editor/service/main.ts ─┼── esbuild + svelte/compiler ──→  3 single-file HTML
src/console/main.ts       ──┘                                       │
                                                                   ▼
                                              ┌────────────────────┴────────────────────┐
                                              │                                         │
                                              ▼                                         ▼
                              SERVICE-MCP/llmscheme/editor.html             SKILL/llmscheme/editor.html
                              SERVICE-MCP/llmscheme/console.html           dist/editor.html
                              (served by the HTTP service)                  (opened from file://)
```

The build script (`src/build/build.ts`) does:

1. Compile each `.svelte` component to JS + CSS
2. Bundle the JS with esbuild
3. Bundle the CSS (with the font either inlined as base64, or emitted
   to `assets/`)
4. Wrap the result in an HTML page with the scheme data baked into a
   `<script type="application/json" id="scheme-data">` tag

`npm run sync-skill` then copies `src/core/*` and `src/cli/block.ts`
into `SKILL/llmscheme/`, and copies `dist/editor.html` into
`SKILL/llmscheme/editor.html`. The sha256 of every file is recorded in
`SKILL/llmscheme/.manifest.json`.

`npm run check` then verifies:

- `SKILL/llmscheme/core/*.ts` and `src/core/*.ts` are byte-identical
- `SKILL/llmscheme/editor.html` is byte-identical to what `npm run
  build` just produced
- `editor.html` is within the 200 KB budget
- `console.html` is within the 80 KB budget
- `editor.html` has no external `src=` or `href=` (file:// invariant)
- The two woff2 font subsets are inlined as base64 (so the file works
  from `file://`)

If any of these checks fail, the build is broken — don't ship it.

---

## Phase status (v2)

| phase | description | status |
|---|---|---|
| 0 | archive v1, reset root | ✅ 916 KB archive, root = clean v2 |
| 1 | core runs from .ts, 33 tests, CI | ✅ commit `e1745a8` |
| 2 | CLI + skill + sync/check, 54 tests | ✅ commit `527c438` |
| 3 | service: server.ts + pages.ts + 19 service tests + SERVICE-MCP/ | ✅ 73/73 tests |
| 4 | editor + console (Svelte 5) + 3 single-file HTML artifacts | ✅ within budget |
| 5 | DEMO-PROJECT/ + HERMES-PLUGIN/ | ✅ |
| 6 | docs (README, PROJECT, INTRO, .llm) | ✅ (this file) |
| 7 | acceptance | ✅ see below |

---

## Bug coverage

The v1 audit catalogued 18 bugs. All closed and tested in v2:

| # | What v1 did wrong | How v2 fixed it |
|---|---|---|
| B1 | Formatter rewrote the built editor.html, breaking the size budget | `check.ts` byte-compares the artifact |
| B2 | The service's bundled `core.mjs` lacked `w/h` validation | One shared core; validation runs everywhere |
| B3 | The inspector mixed node fields and edge fields in one `{#if}` block | Separate branches per `sel.kind === "node" \| "edge" \| "zone"` |
| B4 | Saving `project/scheme` returned 404 | The scheme name comes from the embedded data, not the URL tail |
| B5 | `/editorial` and `/editorFOO` created scheme folders with garbage names | The route is exactly `/editor` or `/editor/<name>`, not `startsWith("/editor")` |
| B6 | Logout didn't revoke the cookie session, only the Bearer | `currentTokenHash` reads whichever transport carried the credential |
| B7 | `PUT` without a `meta` field returned 500 | `Schemes.put` validates first, then checks CAS — bad body = 400 |
| B8 | `nodes: null` corrupted the scheme on disk | Strict validation rejects the write, the on-disk scheme stays healthy |
| B9 | `?t=<token>` in the access log | `logRequest` strips the query string |
| B10 | `SCHEME.md` wasn't idempotent (different `updatedAt` every render) | `exportMd` reads `meta.updatedAt` from the scheme |
| B11 | Autosave rotation was a no-op | `AUTOSAVE_MIN_MS` + `AUTOSAVE_KEEP` actually enforce the cap |
| B12 | `nodeW` / `nodeH` existed in two copies (editor vs core) that drifted | One source of truth in `src/core/geometry.ts` |
| B13 | A `GET` to `/api/mcp-config` revoked every key and issued a new one | `GET` is read-only; rotate is an explicit `POST` with confirmation |
| B14 | Dead exports (`jailReal`, `dirSizeLimitExceeded`, etc.) | `src/core/index.ts` is the curated public surface |
| B15 | No Origin check on the MCP endpoint | `checkOrigin` returns 403 on a foreign browser Origin |
| B16 | MCP spoke only the 2025-era protocol | Dual-era: modern (`2026-07-28`, `server/discover`, `_meta`) and legacy (`initialize`) |
| B17 | No redo, no autosave, no dirty flag, no `beforeunload` | All four in `Editor.svelte` |
| B18 | The console was hardcoded Russian, no password change, no user column | `App.svelte` i18n + settings page + users screen |

---

## Acceptance checklist (Phase 7)

- [x] `npm run verify` green (typecheck + test + build + check)
- [x] 73/73 unit tests + 19/19 service tests
- [x] Three HTML artifacts within budget (137 K / 111 K / 77 K)
- [x] `check` proves `SKILL/llmscheme/` matches `src/`
- [x] No external `src/href` in `editor.html` (file:// invariant)
- [x] No IP/secret in code
- [x] All 18 v1 bugs (B1–B18) closed and covered by a test
- [x] v2 layout: `SKILL/llmscheme/`, `SERVICE-MCP/llmscheme/`, `HERMES-PLUGIN/llmscheme/`, `DEMO-PROJECT/`
- [x] Offline editor no longer blank (welcome seed in `src/editor/skill/main.ts`)
- [x] `INTRO.md` (service start page) and `.llm` (live snapshot) exist
- [x] `.test_on_local_proxmox/deploy.sh` and `test.sh` are real deploy scripts

---

## Privacy checklist (before pushing)

```bash
git status                                          # clean tree
git ls-files | grep -iE 'env$|data/|test_dev/'     # nothing
grep -rE '10\.0\.20\.|admin:admin|llm_[a-f0-9]{20,}' \
    . --include='*.ts' --include='*.json' --include='*.md'   # nothing
```
