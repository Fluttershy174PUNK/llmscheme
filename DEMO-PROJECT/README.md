# demo — TUI cat generator

> A worked example for the **block-llm** skill: a real project with a
> real scheme, kept under 200 lines so an agent can read the whole
> thing in one window.

The program picks a random adjective and a random noun from
`cats.txt` and either prints a coloured ASCII cat to the terminal
(TUI mode) or renders a short looping animated GIF (GIF mode).

## Run

```bash
# TUI mode — print one cat
node src/run.ts

# GIF mode — write an animated GIF
node src/run.ts --gif cat.gif

# see the GIF
xdg-open cat.gif
```

The TUI output looks like:

```
╭────────────────────────────────────────╮
│ ♥  cat-generator (TUI v1.0)            │
│                                        │
│    /\_____/     /*\_____/*\            
│   /  o   o  \    /  o   o  \           
│  ( =  ^  = )   ( =  ^  = )            
│   \__^__//       \__^__//              
│    /   \         /   \                 
│   /     \___     /     \___            
│                                        │
│  name: cosmic void                      │
│  (press Ctrl+C to quit)                
╰────────────────────────────────────────╯
```

## Scheme

The logic scheme lives in `.llmscheme/logic_scheme/scheme.json` and
 describes the data flow:

```
cats.txt ──> pickAdj() / pickNoun() ──> compose() ──> render() / gif() ──> stdout / file
```

Open `.llmscheme/logic_scheme/scheme.html` in a browser to see it
visually, or `node <skill-dir>/cli/block.ts get . --type logic` to
read it as JSON.

## What this demo teaches the skill

- A project with **5 nodes + 5 edges + 1 zone** (a small CLI tool)
- **refs** pointing at the source files (`src/cat.ts`, `src/gif.ts`)
- The full **ritual**: init --type logic → get → node add → validate → doctor
- The **three scheme types**: logic (this one), code, ui — one project,
  up to three independent schemes
