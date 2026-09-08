# llmscheme — living logic schemes for humans and LLMs

A scheme is the project's **WHAT** (modules + data flow) in one file the human,
the LLM and the editor all read the same way. Edit a node in the browser, the
agent reads the same JSON, the export regenerates. Three entry points over
one core:

| consumer | entry | auth | offline? |
|---|---|---|---|
| **LLM agent** (Claude Code, etc.) | `skill/block.ts` | none | yes |
| **HTTP service + MCP** (humans + scripts) | `src/service/server.ts` | cookie / Bearer / X-Api-Key | n/a |
| **single-file browser editor** (humans) | `mcp-service/editor.html` | session | yes (from file://) |

Node ≥ 22.18. No runtime dependencies. The CLI and the service run straight
from `.ts` (native type-stripping); only the three HTML artifacts are built.

## Quick start

```bash
# the skill lives in skill/ — copy it anywhere an LLM can `node` it:
node skill/cli/block.ts init my-project --name "Auth Flow"
cd my-project
node ../skill/cli/block.ts node add --label "Login" --ref src/login.ts
node ../skill/cli/block.ts node add --label "Token store" --ref src/tokens.ts
node ../skill/cli/block.ts edge add --from n1 --to n2
node ../skill/cli/block.ts validate
```

A human opens `.block_llm/scheme.html` in a browser. The same scheme is
also reachable through the service:

```bash
npm install                     # one-time, dev deps
npm run build                   # produces dist/editor.html + mcp-service/editor.html + mcp-service/console.html
npm run sync-skill              # mirrors src/ → skill/ with a sha256 manifest
PORT=8080 DATA_DIR=./data node src/service/server.ts
```

## The three layers

- **`src/core/`** — types, validate, ids, layout, diff, exportMd, saveSchema,
  pathjail, gitmd, renderHtml. Pure TypeScript, zero deps. The browser-safe
  subset is re-exported from `src/core/browser.ts` (no `node:fs`).
- **`src/cli/`** — the single-binary CLI, 12 commands (`init` `get` `validate`
  `node` `edge` `zone` `put` `pull` `sync` `render` `diff` `history` `restore`
  `doctor` `upgrade` `version`). CAS by `rev` on every write.
- **`src/service/`** — HTTP service. Same REST surface as v1 plus the v2
  MCP dual-era (`2026-07-28` + legacy `2025-*`). GETs never mutate state.
- **`src/editor/`** — Svelte 5 runes, three entry points: `skill` (file://,
  tier A/B/C saves), `service` (PUT to the API, tier S), both built from
  one shared `Editor.svelte`.

## Repo map

```
src/        — sources. edit here.
skill/      — artifact: verbatim copy of src/{core,cli}, editor.html, SKILL.md. SHA256-pinned by .manifest.json.
mcp-service/— artifact: editor.html + console.html + assets/ for the docker image. No code; the image runs src/.
demo/       — "cat generator" demo project, scheme + images.
plugin/     — minimal hermes plugin manifest + entry, uses the same core.
e2e/        — browser e2e (puppeteer).
docs/       — MIGRATION / SCHEME_FORMAT / EDITOR / LOGIN.
schemes/    — UI-page.json is the live source of UI requirements.
```

Two rules (the whole golden section of the v1 README, shrunk):

1. **Edit `src/`.** `skill/` and `mcp-service/` are generated; rebuild and
   `npm run check` to prove they match.
2. **The on-disk format is v1-compatible.** A live service upgrades in place
   with no migration.

## Documentation

- [docs/SCHEME_FORMAT.md](docs/SCHEME_FORMAT.md) — json format, validation
- [docs/EDITOR.md](docs/EDITOR.md) — scheme.html / save tiers / file:// facts
- [docs/LOGIN.md](docs/LOGIN.md) — login + console + admin guide
- [docs/MIGRATION.md](docs/MIGRATION.md) — v1 → v2 changes
- [skill/SKILL.md](skill/SKILL.md) — what an LLM agent sees
- [mcp-service/README.md](mcp-service/README.md) — service deploy + REST + MCP
- [PROJECT.md](PROJECT.md) — repo hub
- [schemes/UI-page.json](schemes/UI-page.json) — UI requirements (35 nodes, 8 zones)

## License

MIT.
