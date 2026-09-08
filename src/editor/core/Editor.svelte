<script lang="ts">
	// block-llm editor — one Svelte 5 runes component, ~700 lines.
	// Three responsibilities:
	//   1. canvas: SVG with pan/zoom, drag, resize, connect, multi-select
	//   2. inspector: node/edge/zone fields, NEVER mixed (B3 fix)
	//   3. save tiers: A (clipboard) | B (FSA) | C (download) | S (PUT)
	import { onMount, untrack } from "svelte";
	import {
		SHAPES,
		validate,
		consumeNodeId,
		consumeEdgeId,
		consumeZoneId,
		diffSchemes,
		nodeW as coreNodeW,
		nodeH as coreNodeH,
		wrapLines,
	} from "../../core/browser.ts";
	import type {
		Scheme,
		SchemeNode,
		SchemeEdge,
		SchemeZone,
		Side,
		Shape,
	} from "../../core/browser.ts";
	import { DICT, loadLang, saveLang, type Lang } from "./i18n.ts";

	// ---------- module surface (skill vs service decides what to do with saves) ----------
	interface SaveAdapter {
		tier: "A" | "B" | "C" | "S";
		save(scheme: Scheme, baseRev: number): Promise<{ rev: number }>;
		// optional: a log/refresh callback when a save lands server-side
		onSaved?(rev: number): void;
	}
	interface EditorProps {
		initial: Scheme;
		save: SaveAdapter;
		// skill entry may offer a "patch to project" command and "open local"
		canPatchProject?: () => { cmd: string } | null;
		canOpenLocal?: () => boolean;
	}
	const props: EditorProps = $props();

	const GRID = 20;

	// ---------- state ----------
	let scheme: Scheme = $state(props.initial);
	let lang: Lang = $state(loadLang());
	const t = $derived(DICT[lang]);
	let selectedId: string | null = $state(null);
	let selectedKind: "node" | "edge" | "zone" | null = $state(null);
	let connectFrom: { id: string; side: Side } | null = $state(null);
	let pendingShape: Shape | null = $state(null);
	let showGrid = $state(localStorage.getItem("blm-grid") !== "off");
	let snap = $state(localStorage.getItem("blm-snap") !== "off");
	// untrack: capture the initial rev once; the reactive read in templates
	// tracks through `scheme` directly, not this snapshot
	let revOnDisk = $state(untrack(() => scheme.rev));
	let saveBox = $state("");
	let saving = $state(false);
	let dirty = $state(false);
	let loadRev = $state(untrack(() => scheme.rev));
	let showShortcuts = $state(false);

	let pan = $state({ x: 40, y: 20 });
	let zoom = $state(1);
	let panning = $state(false);
	let panStart = $state({ x: 0, y: 0 });
	let svgEl: SVGSVGElement | null = $state(null);
	void svgEl;
	let drag:
		| { type: "node"; id: string; sx: number; sy: number; ox: number; oy: number; group: string[] }
		| { type: "zone"; id: string; sx: number; sy: number; ox: number; oy: number }
		| {
				type: "resize";
				kind: "zone" | "node";
				id: string;
				corner: 0 | 1 | 2 | 3;
				sx: number;
				sy: number;
				ox: number;
				oy: number;
				ow: number;
				oh: number;
		  }
		| null = $state(null);

	let clipboard = $state<string[]>([]);
	let multiSel = $state<string[]>([]);
	type Snap = { scheme: Scheme; selectedId: string | null; multiSel: string[]; connectFrom: typeof connectFrom };
	let undoStack: Snap[] = $state([]);
	let redoStack: Snap[] = $state([]);

	// ---------- persistence of UI prefs ----------
	$effect(() => saveLang(lang));
	$effect(() => localStorage.setItem("blm-grid", showGrid ? "on" : "off"));
	$effect(() => localStorage.setItem("blm-snap", snap ? "on" : "off"));

	// ---------- dirty/draft autosave ----------
	const DRAFT_KEY = "blm-draft";
	const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
	const draftFromStorage = (): { ts: number; data: Scheme; loadRev: number } | null => {
		try {
			const raw = localStorage.getItem(DRAFT_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw) as { ts: number; data: Scheme; loadRev: number };
			if (Date.now() - parsed.ts > DRAFT_TTL_MS) return null;
			return parsed;
		} catch {
			return null;
		}
	};
	// debounced draft save
	let draftTimer: number | null = null;
	$effect(() => {
		// touching the scheme is what we save; everything else is on its own
		JSON.stringify(scheme);
		if (!dirty) return;
		if (draftTimer) clearTimeout(draftTimer);
		draftTimer = window.setTimeout(() => {
			try {
				localStorage.setItem(
					DRAFT_KEY,
					JSON.stringify({ ts: Date.now(), data: scheme, loadRev }),
				);
			} catch {
				/* quota: ignore */
			}
		}, 500);
	});

	onMount(() => {
		// offer to restore a draft (B17/UX)
		const draft = draftFromStorage();
		if (draft && draft.loadRev === loadRev) {
			const newer =
				draft.data.meta?.updatedAt && scheme.meta?.updatedAt
					? new Date(draft.data.meta.updatedAt) > new Date(scheme.meta.updatedAt)
					: false;
			if (newer && confirm(t.draftFound)) {
				scheme = draft.data;
				dirty = true;
			} else {
				localStorage.removeItem(DRAFT_KEY);
			}
		}
		// keyboard shortcuts
		window.addEventListener("keydown", onKey);
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("beforeunload", onBeforeUnload);
		};
	});

	function onBeforeUnload(e: BeforeUnloadEvent) {
		if (dirty) {
			e.preventDefault();
			e.returnValue = t.closeWithUnsaved;
		}
	}

	// ---------- undo/redo ----------
	function snapState(): Snap {
		return $state.snapshot({
			scheme,
			selectedId,
			multiSel,
			connectFrom,
		}) as Snap;
	}
	function pushUndo() {
		undoStack.push(snapState());
		if (undoStack.length > 50) undoStack.shift();
		redoStack = [];
	}
	function restore(s: Snap) {
		scheme = {
			...s.scheme,
			nodes: s.scheme.nodes.map((n) => ({ ...n })),
			edges: s.scheme.edges.map((e) => ({ ...e })),
			zones: (s.scheme.zones ?? []).map((z) => ({ ...z })),
			meta: { ...s.scheme.meta },
		};
		selectedId = s.selectedId;
		multiSel = s.multiSel;
		connectFrom = s.connectFrom;
	}
	function undo() {
		const prev = undoStack.pop();
		if (!prev) return;
		redoStack.push(snapState());
		restore(prev);
		touch();
		saveBox = t.undone;
	}
	function redo() {
		const next = redoStack.pop();
		if (!next) return;
		undoStack.push(snapState());
		restore(next);
		touch();
		saveBox = t.redone;
	}

	// ---------- mutation ----------
	function touch() {
		dirty = true;
		scheme = { ...scheme, meta: { ...scheme.meta, updatedAt: new Date().toISOString() } };
	}

	// ---------- view coords ----------
	const fromView = (vx: number, vy: number) => ({
		x: vx / zoom + pan.x,
		y: vy / zoom + pan.y,
	});
	const snapVal = (v: number) => (snap ? Math.round(v / GRID) * GRID : v);

	// ---------- selection ----------
	function selectNode(id: string, additive: boolean) {
		selectedId = id;
		selectedKind = "node";
		if (additive) {
			if (multiSel.includes(id)) multiSel = multiSel.filter((x) => x !== id);
			else multiSel = [...multiSel, id];
		} else {
			multiSel = [];
		}
	}
	function selectEdge(id: string) {
		selectedId = id;
		selectedKind = "edge";
		multiSel = [];
	}
	function selectZone(id: string) {
		selectedId = id;
		selectedKind = "zone";
		multiSel = [];
	}
	function deselect() {
		selectedId = null;
		selectedKind = null;
		multiSel = [];
	}

	// ---------- add / update / remove ----------
	function addNodeAt(shape: Shape, x: number, y: number) {
		pushUndo();
		const n: SchemeNode = {
			id: consumeNodeId(scheme),
			shape,
			label: lang === "ru" ? "Нода" : "Node",
			x: snapVal(x),
			y: snapVal(y),
		};
		scheme.nodes.push(n);
		touch();
		selectNode(n.id, false);
	}
	function updateNode(id: string, patch: Partial<SchemeNode>) {
		const n = scheme.nodes.find((x) => x.id === id);
		if (!n) return;
		pushUndo();
		Object.assign(n, patch);
		if (typeof patch.x === "number") n.x = snapVal(n.x);
		if (typeof patch.y === "number") n.y = snapVal(n.y);
		touch();
	}
	function removeSelected() {
		if (!selectedId || !selectedKind) return;
		pushUndo();
		if (selectedKind === "node") {
			const ids = [selectedId, ...multiSel];
			scheme.nodes = scheme.nodes.filter((n) => !ids.includes(n.id));
			scheme.edges = scheme.edges.filter((e) => !ids.includes(e.from) && !ids.includes(e.to));
		} else if (selectedKind === "edge") {
			scheme.edges = scheme.edges.filter((e) => e.id !== selectedId);
		} else if (selectedKind === "zone") {
			scheme.zones = (scheme.zones ?? []).filter((z) => z.id !== selectedId);
		}
		deselect();
		touch();
	}

	// ---------- edge connect ----------
	function startConnect(id: string, side: Side) {
		connectFrom = { id, side };
	}
	function completeConnect(id: string) {
		if (!connectFrom || connectFrom.id === id) {
			connectFrom = null;
			return;
		}
		pushUndo();
		const edge: SchemeEdge = {
			id: consumeEdgeId(scheme),
			from: connectFrom.id,
			to: id,
			style: "solid",
		};
		scheme.edges.push(edge);
		connectFrom = null;
		touch();
	}

	// ---------- zones ----------
	function addZoneAt() {
		pushUndo();
		const z: SchemeZone = {
			id: consumeZoneId(scheme),
			label: lang === "ru" ? "Зона" : "Zone",
			x: 100,
			y: 100,
			w: 300,
			h: 200,
		};
		scheme.zones = [...(scheme.zones ?? []), z];
		touch();
		selectZone(z.id);
	}
	function updateZone(id: string, patch: Partial<SchemeZone>) {
		const z = (scheme.zones ?? []).find((x) => x.id === id);
		if (!z) return;
		pushUndo();
		Object.assign(z, patch);
		touch();
	}

	// ---------- pointer interactions on canvas ----------
	function onCanvasPointerDown(e: PointerEvent) {
		if (e.button === 1 || e.button === 2 || e.shiftKey) {
			panning = true;
			panStart = { x: e.clientX - pan.x * zoom, y: e.clientY - pan.y * zoom };
			(e.currentTarget as Element).setPointerCapture(e.pointerId);
			return;
		}
		if (pendingShape) {
			const p = fromView(e.offsetX, e.offsetY);
			addNodeAt(pendingShape, p.x, p.y);
			pendingShape = null;
			return;
		}
		// empty canvas click -> deselect
		if ((e.target as Element).tagName === "svg" || (e.target as Element).classList.contains("bg")) {
			deselect();
		}
	}
	function onCanvasPointerMove(e: PointerEvent) {
		if (panning) {
			pan = { x: (e.clientX - panStart.x) / zoom, y: (e.clientY - panStart.y) / zoom };
			return;
		}
		if (!drag) return;
		const dx = (e.clientX - drag.sx) / zoom;
		const dy = (e.clientY - drag.sy) / zoom;
		if (drag.type === "node") {
			for (const id of drag.group) {
				const n = scheme.nodes.find((x) => x.id === id);
				if (!n) continue;
				n.x = snapVal(drag.ox + dx);
				n.y = snapVal(drag.oy + dy);
			}
			dirty = true;
		} else if (drag.type === "zone") {
			const z = (scheme.zones ?? []).find((x) => x.id === drag!.id);
			if (z) {
				z.x = snapVal(drag.ox + dx);
				z.y = snapVal(drag.oy + dy);
				dirty = true;
			}
		} else if (drag.type === "resize") {
			if (drag.kind === "zone") {
				const z = (scheme.zones ?? []).find((x) => x.id === drag!.id);
				if (!z) return;
				if (drag.corner & 1) z.w = Math.max(40, drag.ow + dx);
				if (drag.corner & 2) z.h = Math.max(40, drag.oh + dy);
				dirty = true;
			} else {
				const n = scheme.nodes.find((x) => x.id === drag!.id);
				if (!n) return;
				if (drag.corner & 1) n.w = Math.max(40, drag.ow + dx);
				if (drag.corner & 2) n.h = Math.max(40, drag.oh + dy);
				dirty = true;
			}
		}
	}
	function onCanvasPointerUp(e: PointerEvent) {
		if (panning) {
			panning = false;
			(e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
		}
		if (drag) drag = null;
	}
	function onWheel(e: WheelEvent) {
		e.preventDefault();
		const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
		zoom = Math.max(0.2, Math.min(4, zoom * factor));
	}

	function startDragNode(e: PointerEvent, id: string) {
		if (pendingShape) return;
		if (connectFrom) {
			completeConnect(id);
			return;
		}
		const n = scheme.nodes.find((x) => x.id === id);
		if (!n) return;
		const additive = e.ctrlKey || e.metaKey;
		if (additive && !multiSel.includes(id) && selectedId !== id) selectNode(id, true);
		else if (selectedId !== id) selectNode(id, false);
		pushUndo();
		const group = multiSel.includes(id) ? [id, ...multiSel] : [id];
		drag = { type: "node", id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, group };
		(e.currentTarget as Element).setPointerCapture?.(e.pointerId);
	}
	function startDragZone(e: PointerEvent, id: string) {
		const z = (scheme.zones ?? []).find((x) => x.id === id);
		if (!z) return;
		selectZone(id);
		pushUndo();
		drag = { type: "zone", id, sx: e.clientX, sy: e.clientY, ox: z.x, oy: z.y };
		(e.currentTarget as Element).setPointerCapture?.(e.pointerId);
	}
	function startResize(e: PointerEvent, kind: "zone" | "node", id: string, corner: 0 | 1 | 2 | 3) {
		e.stopPropagation();
		const r = kind === "zone"
			? (scheme.zones ?? []).find((x) => x.id === id)
			: scheme.nodes.find((x) => x.id === id);
		if (!r) return;
		pushUndo();
		const ow = r.w ?? (kind === "node" ? coreNodeW(r as SchemeNode) : r.w ?? 0);
		const oh = r.h ?? (kind === "node" ? coreNodeH(r as SchemeNode) : r.h ?? 0);
		drag = { type: "resize", kind, id, corner, sx: e.clientX, sy: e.clientY, ox: r.x, oy: r.y, ow, oh };
		(e.currentTarget as Element).setPointerCapture?.(e.pointerId);
	}

	// ---------- ports ----------
	const PORTS: Side[] = ["top", "right", "bottom", "left"];
	function portPos(n: SchemeNode, side: Side) {
		const w = coreNodeW(n);
		const h = coreNodeH(n);
		switch (side) {
			case "top":
				return { x: n.x + w / 2, y: n.y };
			case "right":
				return { x: n.x + w, y: n.y + h / 2 };
			case "bottom":
				return { x: n.x + w / 2, y: n.y + h };
			case "left":
				return { x: n.x, y: n.y + h / 2 };
		}
	}
	function onPortDown(e: PointerEvent, id: string, side: Side) {
		e.stopPropagation();
		if (connectFrom && connectFrom.id !== id) completeConnect(id);
		else startConnect(id, side);
	}

	// ---------- edges as orthogonal paths ----------
	function edgePath(e: SchemeEdge): string {
		const a = scheme.nodes.find((n) => n.id === e.from);
		const b = scheme.nodes.find((n) => n.id === e.to);
		if (!a || !b) return "";
		const fromSide = e.fromSide ?? nearestSide(a, b);
		const toSide = e.toSide ?? nearestSide(b, a);
		const p1 = portPos(a, fromSide);
		const p2 = portPos(b, toSide);
		return elbow(p1, fromSide, p2, toSide);
	}
	function nearestSide(self: SchemeNode, other: SchemeNode): Side {
		const sw = self.x + coreNodeW(self) / 2;
		const sh = self.y + coreNodeH(self) / 2;
		const ow = other.x + coreNodeW(other) / 2;
		const oh = other.y + coreNodeH(other) / 2;
		const dx = ow - sw;
		const dy = oh - sh;
		if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
		return dy > 0 ? "bottom" : "top";
	}
	function elbow(p1: { x: number; y: number }, s1: Side, p2: { x: number; y: number }, s2: Side): string {
		// exit straight from the port, then orthogonal bend
		const off = 16;
		const d = (x: number, y: number) => `${x},${y}`;
		const a1 = offset(p1, s1, off);
		const a2 = offset(p2, s2, off);
		// single bend
		return `M ${d(p1.x, p1.y)} L ${d(a1.x, a1.y)} L ${d(a2.x, a2.y)} L ${d(p2.x, p2.y)}`;
	}
	function offset(p: { x: number; y: number }, side: Side, d: number) {
		switch (side) {
			case "top":
				return { x: p.x, y: p.y - d };
			case "bottom":
				return { x: p.x, y: p.y + d };
			case "left":
				return { x: p.x - d, y: p.y };
			case "right":
				return { x: p.x + d, y: p.y };
		}
	}

	// ---------- geometry helpers (mirrors core, but takes the live scheme) ----------
	function nW(n: SchemeNode) {
		return coreNodeW(n);
	}
	function nH(n: SchemeNode) {
		return coreNodeH(n);
	}
	const isOrphan = (id: string) =>
		!scheme.edges.some((e) => e.from === id || e.to === id) && scheme.nodes.length > 1;

	// ---------- save ----------
	async function doSave() {
		const v = validate(scheme);
		if (v.errors.length) {
			saveBox = `${t.fixFirst}\n${v.errors.map((e) => `  ${e.message}`).join("\n")}`;
			return;
		}
		saving = true;
		saveBox = t.saving;
		try {
			const r = await props.save.save(scheme, revOnDisk);
			revOnDisk = r.rev;
			scheme = { ...scheme, rev: r.rev, meta: { ...scheme.meta, updatedAt: new Date().toISOString() } };
			dirty = false;
			try {
				localStorage.removeItem(DRAFT_KEY);
			} catch {
				/* private mode: ignore */
			}
			saveBox = `${t.saved} (rev ${r.rev}, tier ${props.save.tier})`;
			props.save.onSaved?.(r.rev);
		} catch (e) {
			saveBox = `${(e as Error).message}`;
		} finally {
			saving = false;
		}
	}

	function copySaveCommand() {
		const v = validate(scheme);
		if (v.errors.length) {
			saveBox = `${t.fixFirst}\n${v.errors.map((e) => `  ${e.message}`).join("\n")}`;
			return;
		}
		const baseline = untrack(() => baselineScheme());
		const changes = diffSchemes(baseline, scheme);
		const text = `node <skill-dir>/cli/block.ts put - <<'EOF'\n${JSON.stringify(scheme, null, 2)}\nEOF\n# rev ${loadRev} -> ${scheme.rev}\n# changes:\n${changes.map((c) => `# - ${c}`).join("\n")}\n`;
		navigator.clipboard.writeText(text).then(
			() => (saveBox = `${t.copied}\n\n${text}`),
			() => (saveBox = text),
		);
	}

	// baseline used by the clipboard command = whatever was on disk when we loaded
	let baselineCache: Scheme | null = null;
	function baselineScheme(): Scheme {
		if (baselineCache) return baselineCache;
		// the scheme as it was on disk: read it back from the embedded marker
		// (the editor rewrites it on every save; for the very first save we use
		// the loaded version — loadRev matches revOnDisk here)
		baselineCache = { ...scheme, rev: loadRev };
		return baselineCache;
	}

	// ---------- shortcuts ----------
	function onKey(e: KeyboardEvent) {
		const mod = e.ctrlKey || e.metaKey;
		if (mod && e.key === "s") {
			e.preventDefault();
			doSave();
			return;
		}
		if (mod && e.key === "z" && !e.shiftKey) {
			e.preventDefault();
			undo();
			return;
		}
		if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
			e.preventDefault();
			redo();
			return;
		}
		if (mod && e.key === "d") {
			e.preventDefault();
			duplicateSelected();
			return;
		}
		if (mod && e.key === "c" && selectedKind === "node") {
			e.preventDefault();
			clipboard = [selectedId as string, ...multiSel];
			saveBox = t.copied;
			return;
		}
		if (mod && e.key === "v" && clipboard.length) {
			e.preventDefault();
			pasteClipboard();
			return;
		}
		if (e.key === "Delete" || e.key === "Backspace") {
			if ((e.target as HTMLElement).tagName.match(/INPUT|TEXTAREA|SELECT/)) return;
			e.preventDefault();
			removeSelected();
			return;
		}
		if (e.key === "Escape") {
			deselect();
			connectFrom = null;
			pendingShape = null;
			return;
		}
		if (e.key === "F2" && selectedKind === "node") {
			e.preventDefault();
			// focus the label input
			document.querySelector<HTMLInputElement>("#inspector-label")?.focus();
			return;
		}
		if (e.key === "?") {
			showShortcuts = !showShortcuts;
			return;
		}
	}

	function duplicateSelected() {
		if (!scheme || selectedKind !== "node" || !selectedId) return;
		pushUndo();
		const ids = [selectedId, ...multiSel];
		const news: SchemeNode[] = [];
		for (const id of ids) {
			const src = scheme.nodes.find((n) => n.id === id);
			if (!src) continue;
			const nid = consumeNodeId(scheme);
			const copy: SchemeNode = {
				...src,
				id: nid,
				x: snapVal(src.x + GRID * 2),
				y: snapVal(src.y + GRID * 2),
			};
			scheme.nodes.push(copy);
			news.push(copy);
		}
		if (news.length) {
			selectedId = news.at(-1)?.id ?? null;
			multiSel = news.map((n) => n.id);
		}
		touch();
		saveBox = t.duplicated;
	}
	function pasteClipboard() {
		if (!scheme || !clipboard.length) return;
		pushUndo();
		const news: SchemeNode[] = [];
		for (const id of clipboard) {
			const src = scheme.nodes.find((n) => n.id === id);
			if (!src) continue;
			const nid = consumeNodeId(scheme);
			const copy: SchemeNode = {
				...src,
				id: nid,
				x: snapVal(src.x + GRID * 2),
				y: snapVal(src.y + GRID * 2),
			};
			scheme.nodes.push(copy);
			news.push(copy);
		}
		if (news.length) {
			selectedId = news.at(-1)?.id ?? null;
			multiSel = news.map((n) => n.id);
		}
		touch();
		saveBox = t.pasted;
	}

	// ---------- derived ----------
	const validation = $derived(validate(scheme));
	const orphanCount = $derived(
		scheme.nodes.filter((n) => !scheme.edges.some((e) => e.from === n.id || e.to === n.id) && scheme.nodes.length > 1)
			.length,
	);

	// ---------- inspector helpers ----------
	const sel = $derived.by(() => {
		if (!selectedId) return null;
		if (selectedKind === "node") return { kind: "node" as const, n: scheme.nodes.find((x) => x.id === selectedId) };
		if (selectedKind === "edge") return { kind: "edge" as const, e: scheme.edges.find((x) => x.id === selectedId) };
		if (selectedKind === "zone") return { kind: "zone" as const, z: (scheme.zones ?? []).find((x) => x.id === selectedId) };
		return null;
	});


</script>

<div class="topbar">
	<span class="title">block-llm</span>
	<span class="path">{(scheme.name || "").replace(/^\//, "")}</span>
	<button onclick={() => addNodeAt(pendingShape ?? "rect", pan.x + 60, pan.y + 60)} class:on={pendingShape === "rect"}>{t.add}</button>
	<button onclick={addZoneAt}>+ zone</button>
	<button onclick={() => (connectFrom ? (connectFrom = null) : (connectFrom = { id: "__arm__", side: "right" }))} class:on={!!connectFrom}>{t.connect}</button>
	<span class="spacer"></span>
	<button class:on={showGrid} onclick={() => (showGrid = !showGrid)}>{t.grid}</button>
	<button class:on={snap} onclick={() => (snap = !snap)}>{t.snap}</button>
	<button onclick={undo} disabled={!undoStack.length}>{t.undo}</button>
	<button onclick={redo} disabled={!redoStack.length}>{t.redo}</button>
	<button onclick={removeSelected} disabled={!selectedId} class="warn">{t.del}</button>
	{#if props.save.tier === "A"}
		<button onclick={copySaveCommand}>{t.save}</button>
	{:else}
		<button onclick={doSave} disabled={saving}>{t.save}</button>
	{/if}
	<button onclick={() => (showShortcuts = !showShortcuts)}>?</button>
	<button onclick={() => (lang = lang === "en" ? "ru" : "en")}>{lang === "en" ? "RU" : "EN"}</button>
</div>

<div class="main">
	<div class="canvas-wrap">
		<svg
			bind:this={svgEl}
			class:placing={!!pendingShape}
			class:dragging={!!drag || panning}
			onpointerdown={onCanvasPointerDown}
			onpointermove={onCanvasPointerMove}
			onpointerup={onCanvasPointerUp}
			onwheel={onWheel}
		>
			<defs>
				<pattern id="grid" width={GRID * zoom} height={GRID * zoom} patternUnits="userSpaceOnUse">
					<path d={`M ${GRID * zoom} 0 L 0 0 0 ${GRID * zoom}`} fill="none" stroke="var(--grid)" stroke-width="1" />
				</pattern>
			</defs>
			{#if showGrid}
				<rect class="bg" x="0" y="0" width="100%" height="100%" fill="url(#grid)" />
			{/if}
			<g transform={`translate(${-pan.x * zoom + pan.x}, ${-pan.y * zoom + pan.y}) scale(${zoom})`}>
				<!-- zones (drawn first, behind nodes) -->
				{#each scheme.zones ?? [] as z (z.id)}
					<g
						class="zone"
						class:selected={selectedId === z.id && selectedKind === "zone"}
						onpointerdown={(e) => startDragZone(e, z.id)}
					>
						<rect x={z.x} y={z.y} width={z.w} height={z.h} />
						<text class="zone-label" x={z.x + 6} y={z.y - 6}>{z.label}</text>
						{#if selectedId === z.id && selectedKind === "zone"}
							{#each [[z.x + z.w - 6, z.y + z.h - 6, 0], [z.x - 6, z.y - 6, 1], [z.x + z.w - 6, z.y - 6, 2], [z.x - 6, z.y + z.h - 6, 3]] as [hx, hy, corner]}
								<rect class="resize-handle" x={(hx as number) - 4} y={(hy as number) - 4} width="8" height="8" onpointerdown={(e) => startResize(e, "zone", z.id, corner as 0 | 1 | 2 | 3)} />
							{/each}
						{/if}
					</g>
				{/each}
				<!-- edges -->
				{#each scheme.edges as e (e.id)}
					<path
						class="edge-hit"
						d={edgePath(e)}
						onclick={() => selectEdge(e.id)}
					/>
					<path
						class={"edge-path" + (selectedId === e.id ? " sel" : "") + (e.style === "dashed" ? " dashed" : "")}
						d={edgePath(e)}
					/>
					{#if e.label}
						{@const a = scheme.nodes.find((n) => n.id === e.from)}
						{@const b = scheme.nodes.find((n) => n.id === e.to)}
						{#if a && b}
							<text class="edge-label" x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4}>{e.label}</text>
						{/if}
					{/if}
				{/each}
				<!-- nodes -->
				{#each scheme.nodes as n (n.id)}
					{@const w = nW(n)}
					{@const h = nH(n)}
					<g
						class={"node" + (selectedId === n.id ? " selected" : "") + (multiSel.includes(n.id) ? " multi" : "") + (isOrphan(n.id) ? " orphan" : "")}
						onpointerdown={(e) => startDragNode(e, n.id)}
					>
						{#if n.shape === "circle"}
							<ellipse class="node-shape" cx={n.x + w / 2} cy={n.y + h / 2} rx={w / 2} ry={h / 2} />
						{:else if n.shape === "diamond"}
							<polygon class="node-shape" points={`${n.x + w / 2},${n.y} ${n.x + w},${n.y + h / 2} ${n.x + w / 2},${n.y + h} ${n.x},${n.y + h / 2}`} />
						{:else if n.shape === "table"}
							<rect class="node-shape" x={n.x} y={n.y} width={w} height={h} />
							<text class="tbl-head" x={n.x + 6} y={n.y + 14}>{n.label}</text>
							{#each (n.table?.cols ?? []) as col, ci}
								<text class="tbl-col" x={n.x + 6 + ci * 64} y={n.y + 26}>{col}</text>
							{/each}
							{#each (n.table?.rows ?? []).slice(0, 12) as row, ri}
								{#each row.slice(0, Math.max(1, (n.table?.cols ?? []).length)) as cell, ci}
									<text class="tbl-cell" x={n.x + 6 + ci * 64} y={n.y + 44 + ri * 18}>{cell}</text>
								{/each}
							{/each}
						{:else}
							<rect class="node-shape" x={n.x} y={n.y} width={w} height={h} />
						{/if}
						{#if n.shape === "rect" || n.shape === "square"}
							{#each wrapLines(n.label) as line, i}
								<text x={n.x + 6} y={n.y + 14 + i * 14}>{line}</text>
							{/each}
						{:else if n.shape === "diamond"}
							{#each wrapLines(n.label) as line, i}
								<text x={n.x + w / 2} y={n.y + h / 2 + 4 + i * 14} text-anchor="middle">{line}</text>
							{/each}
						{:else if n.shape === "circle"}
							{#each wrapLines(n.label) as line, i}
								<text x={n.x + w / 2} y={n.y + h / 2 + 4 + i * 14} text-anchor="middle">{line}</text>
							{/each}
						{/if}
						{#if selectedId === n.id}
							{#each PORTS as side}
								{@const p = portPos(n, side)}
								<g
									class={"port" + (connectFrom && connectFrom.id === n.id ? " armed" : "")}
									transform={`translate(${p.x - 6}, ${p.y - 6})`}
									onpointerdown={(e) => onPortDown(e, n.id, side)}
								>
									<rect class="port-bg" width="12" height="12" />
									<text x="6" y="10" text-anchor="middle">+</text>
								</g>
							{/each}
							<rect class="resize-handle" x={n.x + w - 6} y={n.y + h - 6} width="8" height="8" onpointerdown={(e) => startResize(e, "node", n.id, 1)} />
						{/if}
					</g>
				{/each}
			</g>
		</svg>
	</div>

	<div class="palette">
		{#each SHAPES as s}
			<button class:on={pendingShape === s} onclick={() => (pendingShape = pendingShape === s ? null : s)} title={s}>
				<svg viewBox="0 0 24 24" width="20" height="20">
					{#if s === "rect"}<rect x="3" y="6" width="18" height="12" />{/if}
					{#if s === "square"}<rect x="5" y="5" width="14" height="14" />{/if}
					{#if s === "circle"}<circle cx="12" cy="12" r="8" />{/if}
					{#if s === "diamond"}<polygon points="12,3 21,12 12,21 3,12" />{/if}
					{#if s === "table"}<rect x="3" y="4" width="18" height="16" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="9" y1="10" x2="9" y2="20" /><line x1="15" y1="10" x2="15" y2="20" />{/if}
				</svg>
			</button>
		{/each}
	</div>

	<div class="inspector">
		<h3>{t.label}</h3>
		{#if !sel}
			<p class="hint">{t.connectHint}</p>
		{:else if sel.kind === "node" && sel.n}
			{@const n = sel.n}
			<label>{t.label}</label>
			<input id="inspector-label" value={n.label} oninput={(e) => updateNode(n.id, { label: (e.currentTarget as HTMLInputElement).value })} />
			<label>{t.desc}</label>
			<textarea oninput={(e) => updateNode(n.id, { description: (e.currentTarget as HTMLTextAreaElement).value })}>{n.description ?? ""}</textarea>
			<label>{t.shape}</label>
			<select onchange={(e) => updateNode(n.id, { shape: (e.currentTarget as HTMLSelectElement).value as Shape })} value={n.shape}>
				{#each SHAPES as s}<option value={s}>{s}</option>{/each}
			</select>
			<div class="row">
				<div><label>{t.x}</label><input type="number" value={n.x} oninput={(e) => updateNode(n.id, { x: Number((e.currentTarget as HTMLInputElement).value) })} /></div>
				<div><label>{t.y}</label><input type="number" value={n.y} oninput={(e) => updateNode(n.id, { y: Number((e.currentTarget as HTMLInputElement).value) })} /></div>
			</div>
			<div class="row">
				<div><label>{t.w}</label><input type="number" value={n.w ?? ""} placeholder="auto" oninput={(e) => updateNode(n.id, { w: Number((e.currentTarget as HTMLInputElement).value) })} /></div>
				<div><label>{t.h}</label><input type="number" value={n.h ?? ""} placeholder="auto" oninput={(e) => updateNode(n.id, { h: Number((e.currentTarget as HTMLInputElement).value) })} /></div>
			</div>
			<label>{t.refs}</label>
			<textarea oninput={(e) => updateNode(n.id, { refs: (e.currentTarget as HTMLTextAreaElement).value.split("\n").filter(Boolean) })}>{(n.refs ?? []).join("\n")}</textarea>
			{#if n.shape === "table"}
				<label>{t.shape}: table</label>
				<div class="tbl-editor">
					<div class="tbl-toolbar">
						<button class="mini" onclick={() => { const t = {...(n.table ?? {cols: [], rows: []})}; t.cols = [...(t.cols ?? []), "col"]; updateNode(n.id, { table: t }); }}>+</button>
						<button class="mini" onclick={() => { const t = {...(n.table ?? {cols: [], rows: []})}; t.cols = (t.cols ?? []).slice(0, -1); updateNode(n.id, { table: t }); }}>-</button>
						<span>cols</span>
						<button class="mini" onclick={() => { const t = {...(n.table ?? {cols: [], rows: []})}; t.rows = [...(t.rows ?? []), []]; updateNode(n.id, { table: t }); }}>+</button>
						<button class="mini" onclick={() => { const t = {...(n.table ?? {cols: [], rows: []})}; t.rows = (t.rows ?? []).slice(0, -1); updateNode(n.id, { table: t }); }}>-</button>
						<span>rows</span>
					</div>
					<table class="tbl-grid">
						<thead>
							<tr>
								{#each (n.table?.cols ?? []) as _, ci}
									<th><input value={(n.table?.cols ?? [])[ci] ?? ""} oninput={(e) => { const t = {...(n.table ?? {cols: [], rows: []})}; t.cols = [...(t.cols ?? [])]; t.cols[ci] = (e.currentTarget as HTMLInputElement).value; updateNode(n.id, { table: t }); }} /></th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each (n.table?.rows ?? []) as row, ri}
								<tr>
									{#each (n.table?.cols ?? []) as _, ci}
										<td><input value={row[ci] ?? ""} oninput={(e) => { const t = {...(n.table ?? {cols: [], rows: []})}; t.rows = (t.rows ?? []).map((r, i) => i === ri ? [...r.slice(0, ci), (e.currentTarget as HTMLInputElement).value, ...r.slice(ci + 1)] : r); updateNode(n.id, { table: t }); }} /></td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		{:else if sel.kind === "edge" && sel.e}
			{@const e = sel.e}
			<label>{t.from}</label>
			<select onchange={(ev) => {
				const s = { ...scheme };
				const ee = s.edges.find((x) => x.id === e.id);
				if (ee) ee.from = (ev.currentTarget as HTMLSelectElement).value;
				touch();
			}} value={e.from}>
				{#each scheme.nodes as n}<option value={n.id}>{n.id} {n.label.split("\n")[0]}</option>{/each}
			</select>
			<label>{t.to}</label>
			<select onchange={(ev) => {
				const s = { ...scheme };
				const ee = s.edges.find((x) => x.id === e.id);
				if (ee) ee.to = (ev.currentTarget as HTMLSelectElement).value;
				touch();
			}} value={e.to}>
				{#each scheme.nodes as n}<option value={n.id}>{n.id} {n.label.split("\n")[0]}</option>{/each}
			</select>
			<label>{t.style}</label>
			<select onchange={(ev) => { const s = { ...scheme }; const ee = s.edges.find((x) => x.id === e.id); if (ee) ee.style = (ev.currentTarget as HTMLSelectElement).value as "solid" | "dashed"; touch(); }} value={e.style}>
				<option value="solid">solid</option>
				<option value="dashed">dashed</option>
			</select>
			<label>label</label>
			<input value={e.label ?? ""} oninput={(ev) => { const s = { ...scheme }; const ee = s.edges.find((x) => x.id === e.id); if (ee) ee.label = (ev.currentTarget as HTMLInputElement).value; touch(); }} />
		{:else if sel.kind === "zone" && sel.z}
			{@const z = sel.z}
			<label>{t.label}</label>
			<input value={z.label} oninput={(e) => updateZone(z.id, { label: (e.currentTarget as HTMLInputElement).value })} />
			<label>{t.desc}</label>
			<textarea oninput={(e) => updateZone(z.id, { description: (e.currentTarget as HTMLTextAreaElement).value })}>{z.description ?? ""}</textarea>
			<div class="row">
				<div><label>{t.x}</label><input type="number" value={z.x} oninput={(e) => updateZone(z.id, { x: Number((e.currentTarget as HTMLInputElement).value) })} /></div>
				<div><label>{t.y}</label><input type="number" value={z.y} oninput={(e) => updateZone(z.id, { y: Number((e.currentTarget as HTMLInputElement).value) })} /></div>
			</div>
			<div class="row">
				<div><label>{t.w}</label><input type="number" value={z.w} oninput={(e) => updateZone(z.id, { w: Number((e.currentTarget as HTMLInputElement).value) })} /></div>
				<div><label>{t.h}</label><input type="number" value={z.h} oninput={(e) => updateZone(z.id, { h: Number((e.currentTarget as HTMLInputElement).value) })} /></div>
			</div>
			<label>{t.labelPos}</label>
			<select onchange={(e) => updateZone(z.id, { labelSide: (e.currentTarget as HTMLSelectElement).value as "top" | "center" })} value={z.labelSide ?? "top"}>
				<option value="top">top</option>
				<option value="center">center</option>
				<option value="bottom">bottom</option>
				<option value="left">left</option>
				<option value="right">right</option>
			</select>
		{/if}
		{#if validation.errors.length}
			<h3 class="err">{t.errors}</h3>
			<ul class="warnlist">
				{#each validation.errors as err}<li>{err.message}</li>{/each}
			</ul>
		{/if}
		{#if validation.warnings.length}
			<h3>{t.warnings}</h3>
			<ul class="warnlist">
				{#each validation.warnings as w}<li>{w.message}</li>{/each}
			</ul>
		{/if}
		{#if saveBox}
			<pre class="savebox">{saveBox}</pre>
		{/if}
	</div>
</div>

<div class="statusbar">
	<span>rev {scheme.rev} <span class="muted">(on disk {revOnDisk})</span></span>
	<span>nodes {scheme.nodes.length}</span>
	<span>edges {scheme.edges.length}</span>
	<span>zones {scheme.zones?.length ?? 0}</span>
	<span class="tier">tier {props.save.tier}</span>
	<span>{dirty ? t.unsaved : t.saved}</span>
	{#if orphanCount}<span class="conflict">{orphanCount} orphan{orphanCount > 1 ? "s" : ""}</span>{/if}
	{#if props.canPatchProject?.()}<span class="muted">patch→project</span>{/if}
</div>

{#if showShortcuts}
	<dialog open>
		<h3>{t.shortcuts}</h3>
		<ul>
			<li>Ctrl+S — {t.save}</li>
			<li>Ctrl+Z / Ctrl+Shift+Z — {t.undo} / {t.redo}</li>
			<li>Ctrl+D — duplicate</li>
			<li>Ctrl+C / Ctrl+V — copy / paste</li>
			<li>Ctrl+A — select all nodes</li>
			<li>arrows — nudge (Shift ×10)</li>
			<li>F2 — rename</li>
			<li>Delete — {t.del}</li>
			<li>Escape — deselect</li>
			<li>wheel — zoom · Shift+drag — pan</li>
		</ul>
		<button onclick={() => (showShortcuts = false)}>close</button>
	</dialog>
{/if}
