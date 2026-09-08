# cats

rev: 1

**format:** block-llm v1
**rev:** 1
**name:** cats
**nodes:** 2
**edges:** 1

## Flow

```
n1 (cats.txt) ─┬─> n2 (pickAdj()) ─┐
                └─> n3 (pickNoun()) ─┴─> n4 (compose()) ─> n5 (print())
```
