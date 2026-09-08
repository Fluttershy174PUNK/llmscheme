---
name: block-llm
description: Maintains living logic schemes of the current project in .llmscheme/ (logic_scheme, code_scheme, ui_scheme), plus a human-readable SCHEME.md and an interactive scheme.html editor the user can open by double-click. Use whenever you explore, refactor, or extend a project's architecture, add or remove modules, trace data flow, answer "how does this work", or when the user says "update the scheme", "I edited the scheme - implement it". Also use proactively after any change that adds/removes a module or data flow, even if the user did not ask. Russian triggers: "схема проекта", "обнови схему", "нарисуй архитектуру", "как это работает", "я поправил схему - воплоти".
license: MIT
compatibility: Requires Node >= 22.18 and Bash. No network, no npm install in the
  target project. Interactive editor needs a Chromium-based browser (or use the
  agent-only workflow). This skill is a LOCAL tool: it never needs a service URL
  or an API key.
---

# block-llm — living logic schemes of the project

Schemes live in `<project>/.llmscheme/<type>_scheme/`. Each scheme dir contains
`scheme.json` (the data), `SCHEME.md` (readable export), `scheme.html`
(double-click editor) and `cache/` (journal, backups, autosaves). A scheme
describes WHAT exists (modules, data flows, screens), not how it is written.

## The three scheme types

The skill can maintain up to three independent schemes per project. Pick the one
the user actually asked for:

| `--type` | scheme dir | what it describes |
|---|---|---|
| `logic` | `.llmscheme/logic_scheme/` | modules + data flow (the default "architecture" view) |
| `code` | `.llmscheme/code_scheme/` | call graph / code structure (functions, classes, files) |
| `ui` | `.llmscheme/ui_scheme/` | screens, routes, UI components |

**If the user asks for a scheme but does not say which type, ASK.** Offer the
three options; never guess. Once they pick, pass it as `--type` to every
command. Each type is fully independent — separate rev counter, separate
journal, separate SCHEME.md.

Fast path — the scheme already exists: run `validate --json --type <T>` +
`get --json --type <T>` and work from the scheme. Do NOT re-init and do NOT
re-derive the architecture from scratch. No `.llmscheme/` found upward from cwd
and the user wants a scheme → run `init --type <T>` first, then build it node
by node.

Replace `<skill-dir>` below with the directory containing this SKILL.md.
(Claude Code: `<skill-dir>` = `${CLAUDE_SKILL_DIR}`.)

## Quick start

```bash
node <skill-dir>/cli/block.ts init [project] --type logic --name "Auth Flow"
node <skill-dir>/cli/block.ts get [project] --type logic --json
node <skill-dir>/cli/block.ts node add --type logic --shape rect --label "Parse args" --desc "reads argv" --ref src/args.ts
node <skill-dir>/cli/block.ts node add --type logic --shape table --label "Spec" --table-cols "name,kind" --table-rows "in|file;out|file"
node <skill-dir>/cli/block.ts edge add --type logic --from n1 --to n2 --label ok
node <skill-dir>/cli/block.ts validate [project] --type logic
```

Commands resolve `[project]` from the argument (a project root or a scheme dir),
else search upward from cwd. `--type` defaults to `logic`. Exit codes: 0 ok,
1 data error/conflict, 2 usage error. `--json` for machine-readable output.
No npm install, no network, no URL, no API key.

The CLI runs straight from `.ts` — Node 22.18+ strips the types, there is no
build step and nothing to install.

## Ritual: read the scheme before working

1. `validate --json --type <T>` — fix errors before code changes; keep warnings in mind.
2. `get --json --type <T>` — remember the `rev` (used for CAS on write).
3. Overview: read `SCHEME.md`. Node details: read `.llmscheme/<type>_scheme/scheme.json`.

## Ritual: sync the scheme with the project (the main value)

After changing code, run the checklist:

- new modules/files → new nodes with `--ref` pointing at real paths (refs are
  relative to the PROJECT root, not the scheme dir);
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
node <skill-dir>/cli/block.ts node add --type logic --label "Report" --ref src/report.ts --rev 7
```

SCHEME.md and scheme.html regenerate automatically on every write.

If `rev` grew unexpectedly (the human edited the scheme) → `diff --rev N`,
understand the intent, then continue. NEVER overwrite blindly.

## Reliability rules

- Read before write; pass `--rev` when you read the scheme earlier. On a
  conflict message, re-read with `get` and retry — do not force.
- Prefer the CLI over hand-editing `scheme.json`. If you (or the human) edited
  the JSON directly, run `sync` afterwards, or md/html will drift from json.
- Never delete `.llmscheme/<type>_scheme/cache/` while working (backups live there).
- `cache/` is git-ignored; commit scheme.json, scheme.html, VERSION, SCHEME.md.
- After a batch of writes run `doctor` — it checks json/md/html consistency,
  stale refs and the html size budget.
- This skill writes ONLY: `.llmscheme/`, and an idempotent `.gitignore` line +
  `AGENTS.md` section (on `init`). It never touches project code — code changes
  are your job on explicit user request.

## Deeper references (read only when needed)

- `references/SCHEME_FORMAT.md` — json format, validation rules, migrations.
  Read when working with the json directly, on format disputes, or before
  `upgrade`.
- `references/EDITOR.md` — scheme.html editor internals, save tiers (A/B/C),
  browser facts. Read when the user mentions the editor, browser, or their saved
  changes are not visible.

## Command map

`init` `get` `validate` `node add|update|remove` `edge add|update|remove`
`zone add|update|remove` `put` `sync` `render` `diff` `history` `restore`
`doctor` `upgrade` `version` — full options: run any command without arguments.
