# demo — cat generator

A tiny program that prints a randomly composed cat name (adjective + noun)
on each run. Used as a worked example for the block-llm skill: a real
project with a real scheme, kept under 100 lines of code so the agent can
read the whole thing in one window.

## Run

```bash
node src/run.ts
# => cosmic void
# => derpy agent
# => turbo kefir
```

## Scheme

`.block_llm/scheme.json` describes the data flow: `cats.txt` → `pickAdj`

+ `pickNoun` → `compose` → `print`. Open `.block_llm/scheme.html` in a
browser to edit it visually, or `node <skill-dir>/cli/block.ts get`.
