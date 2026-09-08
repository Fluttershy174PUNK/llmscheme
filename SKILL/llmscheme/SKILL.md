---
name: block-llm
description: Maintains a living logic scheme of the current project in .block_llm/scheme.json, plus a human-readable SCHEME.md and an interactive scheme.html editor the user can open by double-click. Use whenever you explore, refactor, or extend a project's architecture, add or remove modules, trace data flow, answer "how does this work", or when the user says "update the scheme", "I edited the scheme - implement it". Also use proactively after any change that adds/removes a module or data flow, even if the user did not ask. Russian triggers: "схема проекта", "обнови схему", "нарисуй архитектуру", "как это работает", "я поправил схему - воплоти".
license: MIT
compatibility: Requires Node >= 22.18 and Bash. No network, no npm install in the
  target project. Interactive editor needs a Chromium-based browser (or use the
  agent-only workflow).
---

# block-llm — living logic scheme of the project

The scheme lives in `<project>/.block_llm/scheme.json`. `SCHEME.md` (project
root) and `.block_llm/scheme.html` (double-click editor) are generated exports.
The scheme describes WHAT exists (modules, data flows), not how it is written.

Fast path — the scheme already exists: run `validate --json` + `get --json`
(see the ritual below) and work from the scheme. Do NOT re-init and do NOT
re-derive the architecture from scratch. No `.block_llm/` found upward from cwd
and the user wants a scheme → run `init` first, then build it node by node.

Replace `<skill-dir>` below with the directory containing this SKILL.md.
(Claude Code: `<skill-dir>` = `${CLAUDE_SKILL_DIR}`.)

## Quick start

```bash
node <skill-dir>/cli/block.ts init [project] --name "Auth Flow"
node <skill-dir>/cli/block.ts get [project] --json
node <skill-dir>/cli/block.ts node add --shape rect --label "Parse args" --desc "reads argv" --ref src/args.ts
node <skill-dir>/cli/block.ts node add --shape table --label "Spec" --table-cols "name,kind" --table-rows "in|file;out|file"
node <skill-dir>/cli/block.ts edge add --from n1 --to n2 --label ok
node <skill-dir>/cli/block.ts validate [project]
```

Commands resolve `[project]` from the argument, else search upward from cwd.
Exit codes: 0 ok, 1 data error/conflict, 2 usage error. `--json` for
machine-readable output. No npm install, no network.

The CLI runs straight from `.ts` — Node 22.18+ strips the types, there is no
build step and nothing to install.

## Ritual: read the scheme before working

1. `validate --json` — fix errors before code changes; keep warnings in mind.
2. `get --json` — remember the `rev` (used for CAS on write).
3. Overview: read `SCHEME.md`. Node details: read `.block_llm/scheme.json`.

## Ritual: sync the scheme with the project (the main value)

After changing code, run the checklist:

- new modules/files → new nodes with `--ref` pointing at real paths;
- new data flows → edges (solid = normal flow, dashed = async/optional);
- removed things → remove nodes/edges, leave no corpses;
- node `--desc` — brief facts (what it does, not how);
- `--label` may contain `\n` — the box grows downward (mermaid renders `<br/>`);
- `--shape table` + `--table-cols "a,b,c"` + `--table-rows "r1c1|r1c2;r2c1|r2c2"`
  — table element (up to 10 columns, 50 rows; `;` separates rows, `|` cells);
- `--w N --h N` — explicit size (the human may have resized the box in the
  editor; never clear those without a reason);
- `validate` shows stale refs → update them or delete the node.

Then write with the remembered revision:

```bash
node <skill-dir>/cli/block.ts node add --label "Report" --ref src/report.ts --rev 7
```

SCHEME.md and scheme.html regenerate automatically on every write.

If `rev` grew unexpectedly (the human edited the scheme) → `diff --rev N`,
understand the intent, then continue. NEVER overwrite blindly.

## Working with a deployed service

If an llmscheme service is running and the user wants its scheme locally:

```bash
node <skill-dir>/cli/block.ts pull --url http://host:8080 --key llm_xxx --name web/auth [project]
```

`pull` is the ONLY command that touches the network, and only with the `--url`
and `--key` the user gave you. Everything else is offline. It lands the scheme
under the local rev, so later CAS writes keep working; the service keeps its own
history. The same scheme is also reachable over MCP (`get_scheme`, `put_scheme`,
`node_add`, …) if your client has the service configured — same core, same CAS
semantics.

## Reliability rules

- Read before write; pass `--rev` when you read the scheme earlier. On a
  conflict message, re-read with `get` and retry — do not force.
- Prefer the CLI over hand-editing `scheme.json`. If you (or the human) edited
  the JSON directly, run `sync` afterwards, or md/html will drift from json.
- Never delete `.block_llm/cache/` while working (backups live there).
- `cache/` is git-ignored; commit scheme.json, scheme.html, VERSION, SCHEME.md.
- After a batch of writes run `doctor` — it checks json/md/html consistency,
  stale refs and the html size budget.
- This skill writes ONLY: `.block_llm/`, `SCHEME.md`, and an idempotent
  `.gitignore` line + `AGENTS.md` section (on `init`). It never touches project
  code — code changes are your job on explicit user request.

## Deeper references (read only when needed)

- `references/SCHEME_FORMAT.md` — json format, validation rules, migrations.
  Read when working with the json directly, on format disputes, or before
  `upgrade`.
- `references/EDITOR.md` — scheme.html editor internals, save tiers (A/B/C/S),
  browser facts. Read when the user mentions the editor, browser, or their saved
  changes are not visible.

## Command map

`init` `get` `validate` `node add|update|remove` `edge add|update|remove`
`zone add|update|remove` `put` `pull` `sync` `render` `diff` `history`
`restore` `doctor` `upgrade` `version` — full options: run any command without
arguments.
