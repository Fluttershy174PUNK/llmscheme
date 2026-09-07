---
name: block-llm
description: Maintains a living logic scheme of the current project in .block_llm/scheme.json, plus a human-readable SCHEME.md and an interactive scheme.html editor the user can open by double-click. Use whenever you explore, refactor, or extend a project's architecture, add or remove modules, trace data flow, answer "how does this work", or when the user says "update the scheme", "I edited the scheme - implement it". Also use proactively after any change that adds/removes a module or data flow, even if the user did not ask. Russian triggers: "схема проекта", "обнови схему", "нарисуй архитектуру", "как это работает", "я поправил схему - воплоти".
license: MIT
compatibility: Requires Node >= 20 and Bash. No network, no npm install in the
  target project. Interactive editor needs a Chromium-based browser (or use the
  agent-only workflow).
---

# block-llm — living logic scheme of the project

The scheme lives in `<project>/.block_llm/scheme.json`. `SCHEME.md` (project
root) and `.block_llm/scheme.html` (double-click editor) are generated exports.
The scheme describes WHAT exists (modules, data flows), not how it is written.

Fast path — scheme already exists: run `validate --json` + `get --json` (see
the ritual below) and answer/work from the scheme; do NOT re-init and do NOT
re-derive the architecture from scratch. No `.block_llm/` found upward from cwd
and the user wants a scheme → run `init` first, then build it node by node.

Replace `<skill-dir>` below with the directory containing this SKILL.md.
(Claude Code: `<skill-dir>` = `${CLAUDE_SKILL_DIR}`.)

## Quick start

```bash
node <skill-dir>/block_llm_tools/block.mjs init [project] --name "Auth Flow"
node <skill-dir>/block_llm_tools/block.mjs get [project] --json
node <skill-dir>/block_llm_tools/block.mjs node add --shape rect --label "Parse args" --desc "reads argv" --ref src/args.ts
node <skill-dir>/block_llm_tools/block.mjs node add --shape table --label "Spec" --table-cols "name,kind" --table-rows "in|file;out|file"
node <skill-dir>/block_llm_tools/block.mjs edge add --from n1 --to n2 --label ok
node <skill-dir>/block_llm_tools/block.mjs validate [project]
```

Commands resolve `[project]` from the argument, else search upward from cwd.
Exit codes: 0 ok, 1 data error/conflict, 2 usage error. `--json` for
machine-readable output. No npm install, no network.

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
- `--label` может содержать `\n` — элемент растянется вниз по строкам (в mermaid это `<br/>`);
- `--shape table` + `--table-cols "a,b,c"` + `--table-rows "r1c1|r1c2;r2c1|r2c2"` —
  табличный элемент (до 10 колонок, до 50 строк; `;` разделяет строки, `|` — ячейки);
- `validate` shows stale refs → update them or delete the node.

Then write with the remembered revision:

```bash
node <skill-dir>/block_llm_tools/block.mjs node add --label "Report" --ref src/report.ts --rev 7
```

SCHEME.md and scheme.html regenerate automatically on every write.

If `rev` grew unexpectedly (the human edited the scheme) → `diff --rev N`,
understand the intent, then continue. NEVER overwrite blindly.

## Reliability rules

- Read before write; pass `--rev` when you read the scheme earlier. On a
  conflict message, re-read with `get` and retry — do not force.
- Prefer CLI over hand-editing `scheme.json`. If you (or the human) edited the
  JSON directly, run `sync` afterwards, or md/html will drift from json.
- Never delete `.block_llm/cache/` while working (backups live there).
- `cache/` is git-ignored; commit scheme.json, scheme.html, VERSION, SCHEME.md.
- After a batch of writes run `doctor` — it checks json/md/html consistency
  and the html size budget.
- This skill writes ONLY: `.block_llm/`, `SCHEME.md`, and an idempotent
  `.gitignore` line (on `init`). It never touches project code — code changes
  are your job on explicit user request.

## Deeper references (read only when needed)

- `block_llm_core/references/SCHEME_FORMAT.md` — json format, validation
  rules, migrations. Read when working with the json directly, on format
  disputes, or before `upgrade`.
- `block_llm_core/references/EDITOR.md` — scheme.html editor internals, save
  tiers (A/B/S), browser facts. Read when the user mentions the editor,
  browser, or their saved changes are not visible.

If a llmscheme-service (docker) is deployed and the user wants the scheme
there, use its REST/MCP API instead of the CLI — see llmscheme-service-mcp/README.md
in the project repository (same core, same CAS semantics; editor served at
/editor/<name>?t=<token>).

## Command map

`init` `get` `validate` `node add|update|remove` `edge add|update|remove`
`put` `sync` `render` `diff` `history` `restore` `doctor` `upgrade` `version`
— full options: run any command without arguments.
