# EDITOR.md — the visual editor (scheme.html)

> **Who this is for:** anyone who wants to edit a scheme by clicking
> and dragging instead of typing CLI commands. If you only use the
> CLI, skip this file.

---

## What is the editor?

`.block_llm/scheme.html` is a **self-contained single-file web page**
that opens in any modern browser — Firefox, Chrome, Safari, Edge.
It's about 110–135 KB. It has the entire editor inlined: the
Svelte runtime, the font, the styles, the scheme data. No internet
required, no server required.

You can open it by double-clicking in your file manager, or:

```bash
# macOS
open .block_llm/scheme.html

# Linux
xdg-open .block_llm/scheme.html

# Windows
start .block_llm/scheme.html
```

---

## What you see when you open it

The page is divided into three regions:

```
┌─────────────────────────────────────────────┐
│ top toolbar: add, undo/redo, save, lang, ... │
├──────────────┬────────────┬──────────────────┤
│              │            │                  │
│  canvas      │  palette   │   inspector      │
│  (nodes,     │  (shapes)  │   (edit the      │
│  edges,      │            │   selected       │
│  zones)      │            │   node/edge/     │
│              │            │   zone)          │
│              │            │                  │
└──────────────┴────────────┴──────────────────┴──── status bar
```

- **Top toolbar**: add a node, add a zone, undo/redo, grid, snap,
  delete, save, language toggle, help (?)
- **Canvas** (left): your scheme — click and drag to move things
- **Palette** (middle): the five shape buttons (rect, square,
  circle, diamond, table)
- **Inspector** (right): fields for the selected node/edge/zone
- **Status bar** (bottom): the current rev, dirty flag, tier
  indicator, node/edge counts

---

## The basic moves

| You want to... | Do this |
|---|---|
| Move a node | Click and drag it |
| Resize a node | Select it, drag the bottom-right corner |
| Select a node | Click it |
| Select multiple nodes | Ctrl+click (or Cmd+click on Mac) |
| Move a group | Select multiple, then drag any one of them |
| Delete the selection | Press Delete or Backspace |
| Add a new node | Click a shape in the palette, then click the canvas |
| Connect two nodes | Click the green `+` on the source, then the `+` on the target |
| Add a zone | Click `+ zone` in the toolbar, then drag on the canvas |
| Pan the canvas | Shift+drag the empty area |
| Zoom in/out | Mouse wheel |
| Reset to fit | (press the `fit` button if your toolbar has one) |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z (or Cmd+Z / Cmd+Shift+Z) |
| Rename the selected | Press F2 |
| Deselect | Press Escape |

---

## The inspector — three different "kinds"

The right panel changes depending on what you selected. There are
**three different forms** — v1 had a bug where editing a node also
showed edge fields, and editing an edge showed node fields. v2 keeps
them strictly separate.

### When a **node** is selected

You see: label, description, shape (dropdown), position (x, y),
size (w, h), refs (one path per line), and — if the shape is
`table` — an editable table grid with +/- buttons for columns and
rows.

### When an **edge** is selected

You see: from (dropdown of all nodes), to (dropdown of all nodes),
style (solid / dashed), label.

### When a **zone** is selected

You see: label, description, position (x, y), size (w, h), and
label position (top / center / bottom / left / right).

The three forms never overlap. The wrong fields simply aren't
shown.

---

## Saving — the four "tiers"

The editor can save your changes in four different ways, called
*tiers*. The right one depends on how the editor was opened:

| Tier | When it works | What it does |
|---|---|---|
| **A** | Always (universal fallback) | Generates a command for your agent. You paste it into your terminal; the agent runs `block put` and commits. |
| **B** | Chromium-based browsers (Chrome, Edge, Brave) | Opens a "Save As" dialog and writes the files directly. No agent needed. |
| **C** | Firefox (no File System Access API) | Downloads a file. You then run `block sync --from <downloaded-file>` to commit. |
| **D** | (none in v2) | — |

Tier A is the most important: **it always works**, because it
doesn't depend on any browser feature. The editor's SAVE button
always shows Tier A. The status bar shows the active tier.

### Tier A in detail

When you hit SAVE and Tier A is active, the editor:

1. Diffs your changes against the version you loaded.
2. Generates a ready-to-paste command:

   ```bash
   node <skill-dir>/cli/block.ts put - --rev 7 <<'EOF'
   {
     "format": "block-llm",
     "version": 1,
     ...
   }
   EOF
   # rev 7 -> 8
   # changes:
   # - node n1.label: "Login" -> "Login page"
   # - edge e1 added: n1 -> n2
   ```

3. Copies it to your clipboard.
4. Shows the same text in the status bar so you can paste it
   manually if the clipboard didn't work.

You paste it into your terminal, your agent picks it up, runs
`block put`, and the change is committed. The editor on the next
load will show the new state.

---

## The grid and snap

The canvas has a faint grid by default. Two toggles in the top
toolbar:

- **Grid** — show or hide the grid lines
- **Snap** — snap nodes to the grid when dragging

The grid spacing is 20 pixels by default. Snapping makes positions
clean and tidy but can feel restrictive; turn it off if you want
to place things precisely.

The two preferences are saved in `localStorage` per browser, so
they persist between sessions.

---

## Keyboard shortcuts

| Keys | Action |
|---|---|
| Ctrl+S (Cmd+S) | Save (Tier A: copy command) |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z (Cmd+Shift+Z) | Redo |
| Ctrl+Y | Redo (alternative) |
| Ctrl+D (Cmd+D) | Duplicate the selected node |
| Ctrl+C | Copy the selected node to the internal clipboard |
| Ctrl+V | Paste from the internal clipboard |
| Ctrl+A | Select all nodes |
| Arrow keys | Nudge the selection by one grid step |
| Shift+Arrow keys | Nudge by 10 grid steps |
| F2 | Rename (focuses the label input) |
| Delete / Backspace | Delete the selection |
| Escape | Deselect, or cancel connect-mode |
| ? | Toggle the shortcuts help panel |
| Shift+drag | Pan the canvas |
| Wheel | Zoom in / out |

---

## Languages

The top-right corner has a language toggle (EN / RU). The choice
is saved in `localStorage` (key `blm-lang`) and shared between
the editor and the console (they read the same dictionary).

---

## The status bar — what those numbers mean

The status bar at the bottom shows, left to right:

- `rev N` — the current revision you're working on
- `(on disk M)` — the revision that's saved on disk
- `nodes X` — how many nodes the scheme has
- `edges Y` — how many edges
- `zones Z` — how many zones
- `tier A/B/S` — which save strategy is active
- `unsaved` (red) — you have changes that haven't been committed
- `saved` (green) — disk matches your view
- `N orphan(s)` — N nodes that have no edges (warning)
- `patch→project` — the skill entry has a "patch to project" command available

---

## Opening a local file

If you have a `scheme.json` from somewhere else (say, a colleague
emailed it to you), you can open it in the editor:

1. In the editor, click the **open local** button in the toolbar
   (if the skill entry shows it).
2. Pick the file.
3. The editor loads it as an in-memory scheme. To save it as your
   own, use SAVE — Tier A will give you a `block put` command.

The HTTP-service version of the editor doesn't have this button
(schemes there live on the server, not in your filesystem).

---

## Browser quirks (Firefox specifically)

Firefox doesn't implement the File System Access API, so:

- Tier B doesn't work (no "Save As" dialog). The editor
  automatically falls back to Tier A.
- Opening a `file://` URL with `showSaveFilePicker` undefined
  means the editor uses the simpler "blob download" path (Tier C)
  for the auto-save draft. The draft lives in `localStorage` and
  is restored on next open.

This is by design. Tier A is the universal fallback.

---

## FAQ

### "I hit SAVE but nothing happened"

Tier A copies a command to your clipboard. If the clipboard
wasn't writable (some restrictive browsers or a missing
permission), the editor also shows the same text in the status
bar at the bottom. Copy it from there and paste it into your
terminal.

### "The canvas is blank but the scheme has nodes"

The nodes may be off-screen. Click `fit` in the toolbar (if
present) or zoom out with the mouse wheel until they appear.

### "I pressed Ctrl+S and got a dialog about a JSON file"

You're in Tier B (Chromium). The browser wants to save the
current state to a file. Pick a location; the file will be
`scheme.json`. Move it into your project's `.block_llm/`
directory and run `block sync` (or just close the editor — the
CLI will pick it up next time).

### "I have unsaved changes but I need to close the tab"

The editor shows a browser dialog (`beforeunload` warning)
asking you to confirm. Click "Leave" to close. Tier A always
gives you a copy-pasteable command before this happens (look at
the status bar at the bottom — the command is there too).
