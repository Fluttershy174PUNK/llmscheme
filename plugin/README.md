# llmscheme hermes plugin (placeholder)

A minimal hermes plugin over the same `core/` the CLI uses, so a write
through the plugin and a write through the CLI produce the same on-disk
format (rev+1, atomic, CAS). The plugin surface follows the same
operations as `block.ts`: `get`, `nodeAdd/Update/Remove`, `edgeAdd/Remove`,
`md`.

When the hermes plugin spec is final we will replace this entry with the
spec-compliant shape; the operations above are the building blocks any
spec is likely to want.

v1 had only the manifest — the `.mjs` was missing, so the plugin never
actually loaded. v2 ships a working entry.
