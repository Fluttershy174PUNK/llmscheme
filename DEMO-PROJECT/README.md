# demo — cat generator (TUI + GIF + browser UI)

> A worked example for the **block-llm** skill: a real project with a
> real scheme. Small enough to read in one window, complete enough to
> exercise the whole skill ritual.

The program picks a random adjective + noun from `cats.txt` and renders
it three ways:

| entry | what | how to run |
|---|---|---|
| `src/run.ts` | TUI cat (ANSI colours) | `node src/run.ts` |
| `src/run.ts --gif` | animated GIF | `node src/run.ts --gif cat.gif` |
| `cats.html` | browser UI (button + pixel cat) | `xdg-open cats.html` |

## Run

```bash
# TUI mode
node src/run.ts

# GIF mode
node src/run.ts --gif cat.gif
xdg-open cat.gif

# browser UI (no Node, no server)
xdg-open cats.html
```

## Scheme

The logic scheme lives in `.llmscheme/logic_scheme/` and describes the
data flow:

```text
cats.txt ──> pickAdj() / pickNoun() ──> compose() ──> render() / gif() ──> stdout / file
     └────> cats.html (browser UI: generate button → pixel cat)
```

Open `.llmscheme/logic_scheme/scheme.html` in a browser to edit it
visually, or read it as JSON:

```bash
node <skill-dir>/cli/block.ts get . --type logic
node <skill-dir>/cli/block.ts validate . --type logic
node <skill-dir>/cli/block.ts doctor . --type logic
```

## What this demo exercises

- **7 nodes + 6 edges + 1 zone** (TUI, GIF and browser UI are all
  separate nodes with `--ref` pointing at the real files)
- **refs** to `cats.txt`, `src/cat.ts`, `src/gif.ts`, `src/run.ts`,
  `cats.html`
- the full **ritual**: `init --type logic` → `get` → `node add` →
  `edge add` → `validate` → `doctor`
- the **three scheme types**: logic (this one), code, ui — one project,
  up to three independent schemes
