# SCHEME_FORMAT.md — the `.block_llm/scheme.json` format

> **Who this is for:** anyone who wants to understand (or write by
> hand) the JSON file that llmscheme uses to describe a project. If
> you only ever use the CLI or the editor, you don't need to read
> this — the tools handle the format for you.

---

## What is a scheme, in plain English?

A scheme is a JSON file that describes your project's **structure**:
the boxes (modules, files, concepts) and the arrows (how data flows
between them). It's the *what*, not the *how* — it tells you what's
in the project and how it connects, not what each function does
line by line.

The file lives at `.block_llm/scheme.json` inside your project. The
CLI and the editor read and write it. `SCHEME.md` and
`.block_llm/scheme.html` are **generated** from it.

---

## The smallest possible scheme

```json
{
  "format": "block-llm",
  "version": 1,
  "rev": 0,
  "name": "My Project",
  "project": { "root": ".", "codePaths": [] },
  "nodes": [],
  "edges": [],
  "meta": {
    "updatedAt": "2026-01-01T00:00:00.000Z",
    "generator": "agent",
    "nextId": { "n": 1, "e": 1 }
  }
}
```

That's what `block init` creates. Now let's add things.

---

## Adding a node (a box on the diagram)

```json
{
  "id": "n1",
  "shape": "rect",
  "label": "Login page",
  "description": "Reads email + password from the user, calls the auth API.",
  "x": 100,
  "y": 80,
  "refs": ["src/login.ts"]
}
```

| Field | What it is | Required? |
|---|---|---|
| `id` | A unique string. Convention: `n1`, `n2`, `n3`... | yes |
| `shape` | One of: `rect`, `square`, `circle`, `ellipse`, `diamond`, `table` | yes |
| `label` | The text shown on the box. Use `\n` for line breaks. | yes |
| `description` | A longer note (for humans and for the AI) | no |
| `x`, `y` | Where the box sits on the canvas (pixels) | yes, but `autoLayout` can fill them in |
| `w`, `h` | Override the box size (otherwise the editor sizes it from the label) | no |
| `refs` | A list of file paths this node represents | no |
| `table` | For `shape: "table"` — column headers and rows | only for tables |

**Via the CLI:**

```bash
block node add --label "Login page" --ref src/login.ts --shape rect
```

---

## Adding an edge (an arrow between two boxes)

```json
{
  "id": "e1",
  "from": "n1",
  "to": "n2",
  "style": "solid",
  "label": "calls"
}
```

| Field | What it is |
|---|---|
| `id` | A unique string. Convention: `e1`, `e2`, `e3`... |
| `from` | The id of the source node |
| `to` | The id of the target node |
| `style` | `solid` (normal arrow) or `dashed` (optional / async / fallback flow) |
| `label` | Optional text on the arrow |
| `fromSide`, `toSide` | Where the arrow connects: `top`, `right`, `bottom`, `left` (otherwise the editor picks the closest side) |

**Via the CLI:**

```bash
block edge add --from n1 --to n2 --style solid --label "calls"
```

---

## Adding a zone (a dashed rectangle that groups things)

```json
{
  "id": "z1",
  "label": "Frontend",
  "x": 50,
  "y": 50,
  "w": 400,
  "h": 200,
  "labelSide": "top"
}
```

Zones are for "this stuff belongs together" — a layer, a subsystem,
a feature. They don't participate in CAS or diff; they're just
visual grouping.

**Via the CLI:**

```bash
block zone add --label "Frontend" --x 50 --y 50 --w 400 --h 200
```

---

## The `meta` block

```json
{
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "generator": "agent | human-editor | human-json",
  "nextId": { "n": 5, "e": 3 },
  "editor": { "rev": 12, "savedAt": "..." }
}
```

| Field | What it is |
|---|---|
| `updatedAt` | ISO timestamp of the last write. The Markdown export reads this so the export is idempotent. |
| `generator` | Who wrote the last change: an AI agent, a human through the editor, or a human editing the JSON. |
| `nextId.n` | The next id to use for a new node. Monotonically increasing — once a node gets id `n3`, no future node will ever reuse `n3`, even after `n3` is deleted. This keeps diff and history clean. |
| `nextId.e` | Same, for edges. |
| `editor.rev` | The revision that the editor currently has open. Optional; set by the browser editor. |

**You don't write `meta` by hand.** The CLI updates it on every
write.

---

## The `rev` field — what it is and why it matters

`rev` is a counter that starts at 0 and goes up by 1 on every write.
It's the "version" of the scheme.

Why does it exist? Because two writers can clobber each other:

1. Agent A reads the scheme. `rev = 7`.
2. Agent B reads the scheme. `rev = 7`.
3. Agent A writes its changes. `rev` is now 8.
4. Agent B writes its changes — *based on the version it read* — and
   the disk now says `rev = 8` with Agent A's changes. Agent B's
   changes are lost.

To prevent this, every write is a **Compare-And-Swap**: "I want to
write, but only if the disk is still at the rev I read." If it
isn't, the write is rejected with `conflict: ...`. The writer
re-reads, merges, and retries.

**Via the CLI:**

```bash
# 1. read and remember the rev
block get --json
#  → { "rev": 7, ... }

# 2. write, naming the rev you read
block node add --label "New node" --rev 7
#  → if the disk is still 7: ok, rev is now 8
#  → if the disk is 8: conflict, re-read and retry
```

---

## Validation: what's an error vs. a warning?

`block validate` checks the JSON and reports two kinds of issues:

### Errors — the write is rejected

| Code | What it means |
|---|---|
| `format` | The `format` field isn't `"block-llm"` |
| `version` | The `version` is newer than the installed skill (update the skill) |
| `bad rev` | `rev` isn't a number |
| `name` | The scheme has no name |
| `nodes must be an array` | `nodes` is `null` or not an array |
| `edges must be an array` | Same for edges |
| `meta required` | `meta` is missing or lacks `updatedAt` / `generator` / `nextId` |
| `duplicate id` | Two nodes (or two edges) share the same id |
| `unknown shape` | A node's `shape` isn't one of the five known shapes |
| `bad edge` | An edge's `from` or `to` points to a node that doesn't exist |
| `bad w/h` | A node's `w` or `h` is below 20 (or negative) |

### Warnings — the write is allowed

| Code | What it means |
|---|---|
| `stale-ref` | A path in a node's `refs` doesn't exist on disk |
| `orphan` | A node has no edges (and there are 2+ nodes total) |
| `empty label` | A node has an empty `label` |
| `no code paths` | `project.codePaths` is empty — the editor won't know where to find source files |

---

## Tables

Nodes with `shape: "table"` have a `table` field:

```json
{
  "id": "n5",
  "shape": "table",
  "label": "HTTP endpoints",
  "x": 400, "y": 200,
  "table": {
    "cols": ["method", "path", "auth"],
    "rows": [
      ["GET",  "/api/users",  "yes"],
      ["POST", "/api/login",  "no"]
    ]
  }
}
```

Limits:

- Max **10** columns
- Max **50** rows
- Cells are strings (no nested objects)

---

## The `refs` field — pointing at real files

`refs` connects a node to file paths in your project. The CLI uses
this to flag **stale refs** (a path that no longer exists):

```bash
block node add --label "Login page" --ref src/login.ts
block validate
# → stale-ref: src/login.ts does not exist  (warning)
```

This is the main signal that the scheme is out of sync with the
code. After you rename or delete a file, either update the
scheme or delete the node.

`refs` are relative to the project root (the directory containing
`.block_llm/`).

---

## Migrations and versioning

- `version` in the JSON is the **format version**, not the scheme
  version. It bumps when the JSON shape itself changes.
- Current format version: `1`.
- `block upgrade` checks compatibility: if the JSON is newer than
  the installed skill can read, it fails with `update the skill`.
- The on-disk format is **backward compatible**: a v1 CLI reads
  v2 schemes and vice versa, as long as `version` is the same.

If you ever need to migrate (the format does change occasionally),
`block upgrade` will tell you what to do. For most projects,
nothing is needed.

---

## Editing by hand

You can. The CLI just reads and writes the same JSON. A few
guidelines:

- Use a JSON-aware editor (VS Code, vim with a JSON plugin) to
  catch syntax errors.
- After every edit, run `block sync` to regenerate `SCHEME.md` and
  `scheme.html`. Or just run `block doctor` to see whether they
  agree.
- Don't change `meta.nextId` to a number below an existing node
  id. The id system uses the watermark to prevent reuse.
- Don't change `rev` to a value other than the disk's current `rev`
  - 1. The CLI handles that automatically; if you do it by hand,
  the next CLI write will get a CAS conflict and refuse.

---

## Quick reference card

| What you want | How |
|---|---|
| Init a scheme | `block init --name "..."` |
| Add a node | `block node add --label "..." --ref path.ts` |
| Update a node | `block node update --id n1 --label "..."` |
| Remove a node | `block node remove --id n1` |
| Add an edge | `block edge add --from n1 --to n2` |
| Add a zone | `block zone add --label "..." --x 0 --y 0 --w 400 --h 200` |
| See the current scheme | `block get --json` |
| See the current rev | `block get --json \| jq .rev` |
| Write the whole scheme | `block put - < new-scheme.json` |
| See what changed | `block diff --rev 5` |
| Roll back | `block restore --rev 5` |
| Check for errors | `block validate` |
| Sanity check | `block doctor` |
