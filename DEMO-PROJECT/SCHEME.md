# cats (TUI cat generator)

**format:** block-llm v1
**rev:** 1
**name:** cats
**nodes:** 5
**edges:** 4

## Pipeline

```
cats.txt ──> pickAdj() ──┐
                         ├─> compose() ──> render() / gif() ──> stdout / file
cats.txt ──> pickNoun() ─┘
```

## Nodes

- **n1** cats.txt — word list, one cat per line
- **n2** pickAdj() — selects a random adjective
- **n3** pickNoun() — selects a random noun
- **n4** compose() — adjective + noun = cat name
- **n5** render() — print to terminal / write GIF
