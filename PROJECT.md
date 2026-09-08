# PROJECT.md — repo hub

The single source of truth for "where things live" in this repo.

## At a glance

- **Edit `src/`.** Everything else is generated or deployed.
- **`skill/` is a verbatim copy of `src/{core,cli}`.** `npm run sync-skill`
  writes it; `npm run check` proves the hashes match.
- **`mcp-service/` is the deploy image's filesystem layer.** No code lives
  there; the image runs `src/service/server.ts` directly.
- **`schemes/UI-page.json` is the source of UI requirements.** 35 nodes,
  8 zones — every UI feature traces back to it.

## Map

```
src/
  core/           ← one implementation of the data model. types/validate/ids/layout/
                     diff/exportMd/saveSchema/pathjail/gitmd/renderHtml/ops/errors.
                     zero deps. the browser-safe subset re-exported from browser.ts.
  cli/            ← block.ts: 16 commands, no bundler.
  service/        ← server.ts (HTTP) + lib/{http,auth,store,schemes,routes,mcp,pages,config}.
  console/        ← single Svelte 5 component, hash-routed (login / projects / users / settings).
  editor/
    core/         ← shared Svelte 5 component (canvas / inspector / palette / status / hotkeys).
    skill/        ← file:// entry. tiers A (clipboard) | B (FSA) | C (download).
    service/      ← http entry. tier S (PUT /api/scheme/<name>).
  ui/             ← pixel.css (palette + font) — one place.
  build/          ← build.ts (3 single-file HTML), sync-skill.ts, check.ts.
  test/           ← node --test. core / cli / service.

skill/            ← ARTIFACT. core + cli/ block.ts + SKILL.md + references/. sha256-pinned.
mcp-service/      ← ARTIFACT. editor.html + console.html + assets/. Dockerfile + compose.
plugin/           ← minimal hermes plugin. uses src/core via skill/core/ verbatim.
demo/             ← cats generator scheme + word list.
e2e/              ← puppeteer harness (login / console / editor / projects / mcp / security).
docs/             ← MIGRATION / SCHEME_FORMAT / EDITOR / LOGIN.
schemes/          ← UI-page.json = source of UI requirements.
```

## Day-to-day

| task | command |
|---|---|
| add a node to the data model | edit `src/core/types.ts` + `validate.ts` |
| add a CLI command | edit `src/cli/block.ts` |
| add a REST endpoint | edit `src/service/lib/routes.ts` |
| add an MCP tool | edit `src/service/lib/mcp.ts` (TOOLS + callTool) |
| change the editor canvas | edit `src/editor/core/Editor.svelte` |
| change the console | edit `src/console/App.svelte` |
| change the palette / font | edit `src/ui/pixel.css` |
| add a test | add to `src/test/*.test.ts` |
| ship | `npm run verify` (typecheck + test + build + check) |

## Status

| phase | description | status |
|---|---|---|
| 0 | archive v1, reset root | ✅ 916 KB archive, root = clean v2 |
| 1 | core runs from .ts, 33 tests, CI | ✅ commit `e1745a8` |
| 2 | CLI + skill + sync/check, 54 tests | ✅ commit `527c438` |
| 3 | service: server.ts + pages.ts + 19 service tests + mcp-service/ | ✅ 73/73 tests |
| 4 | editor + console (Svelte 5) + 3 single-file HTML artifacts | ✅ within budget |
| 5 | demo/ + plugin/ | ✅ |
| 6 | docs + CI | ✅ (this file) |
| 7 | acceptance | see CHECKLIST below |

## Bug coverage

From the v1 audit, 18 bugs were catalogued. Closed and tested in v2:

- **B1** formatter expanding editor.html (200 KB budget) — `check.ts` byte-compares
- **B2** service core.mjs missing w/h validation — single shared core, validation everywhere
- **B3** inspector mixed node/edge fields — separate `{#if sel.kind === "node" / "edge" / "zone"}` branches
- **B4** SAVE `project/scheme` 404 — name from embedded data, not URL tail (`serveEditor`)
- **B5** `/editorial` creating schemes — `pathname === "/editor" || startsWith("/editor/")`
- **B6** logout not revoking cookie — `currentTokenHash` reads both transports
- **B7** PUT without `meta` 500 — validate-then-CAS in `Schemes.put`
- **B8** `nodes: null` corrupting scheme — strict validation rejects
- **B9** token in access log — `logRequest` strips query
- **B10** SCHEME.md not idempotent — `exportMd` reads `meta.updatedAt`
- **B11** autosave rotation dead — `AUTOSAVE_MIN_MS` + `AUTOSAVE_KEEP` enforced
- **B12** `nodeW/nodeH` two copies — single source in `core/geometry.ts`
- **B13** GET `/api/mcp-config` revoking keys — R9: explicit POST, GET is read-only
- **B14** dead exports — `index.ts` is the curated public surface
- **B15** no Origin check — `checkOrigin` in `mcp.ts` (B15)
- **B16** legacy-only MCP — dual-era, modern (2026-07-28) + legacy (2025-*)
- **B17** no redo/autosave/dirty/beforeunload — all in `Editor.svelte`
- **B18** console hardcoded RU, no password change, no user column — `App.svelte` i18n, settings page, `users/` page

## Acceptance (Phase 7)

- [x] `npm run verify` green (typecheck + test + build + check)
- [x] 73/73 unit tests
- [x] 19/19 service tests (B5/B6/B7/B8/B9/B13/B15/B16 + isolation + body limit + 404)
- [x] Three HTML artifacts within budget (137 K / 111 K / 77 K)
- [x] `check` proves `skill/` matches `src/`
- [x] No external `src/href` in `editor.html` (file:// invariant)
- [x] No IP/secret in code (`grep -iE 'env$|data/|test_dev' .` clean)

## Privacy before push

```bash
git status                  # clean tree
git ls-files | grep -iE 'env$|data/|test_dev/'   # nothing
grep -rE '10\.0\.20\.|admin:admin|llm_[a-f0-9]{20,}' . --include='*.ts' --include='*.json' --include='*.md'  # nothing
```
