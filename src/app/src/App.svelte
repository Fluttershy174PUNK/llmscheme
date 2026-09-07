<script lang="ts">
	// block-llm editor — pixel constructor (§4.2). Runes mode (Svelte 5).
	import { onMount } from "svelte";
import type {
		Scheme,
		SchemeNode,
		SchemeEdge,
		SchemeZone,
		Side,
		Shape,
} from "../../core/src/types.ts";
import { SHAPES } from "../../core/src/types.ts";
	import { validate } from "../../core/src/validate.ts";
	import { consumeNodeId, consumeEdgeId, consumeZoneId } from "../../core/src/ids.ts";
	import { autoLayout } from "../../core/src/layout.ts";
	import { diffSchemes } from "../../core/src/diff.ts";
	import { exportMd } from "../../core/src/exportMd.ts";
	import { extractSchemeJson, DATA_MARKER } from "../../core/src/renderHtml.ts";
	import { PRISTINE_HTML } from "./pristine.ts";

	const SIDES: Side[] = ["top", "bottom", "left", "right"];

	interface WindowWithFsa {
		showSaveFilePicker?: (opts?: { suggestedName?: string }) => Promise<FileSystemFileHandle>;
	}
	const fsa = () => (window as WindowWithFsa).showSaveFilePicker;

	let scheme = $state<Scheme | null>(null);
	let errors = $state<string[]>([]);
	let warnings = $state<string[]>([]);
	let selectedId = $state<string | null>(null);
	let selectedKind = $state<"node" | "edge" | "zone" | null>(null);
	let connectFrom = $state<{ id: string; side: Side } | null>(null);
	let connectMode = $state(false);
	// shape palette: active pick for "click canvas to drop a node" (empty = drag-mode off)
	let pendingShape = $state<Shape | null>(null);
	// grid + snap (persisted UI preference)
	const GRID = 20;
	let showGrid = $state(localStorage.getItem("blm-grid") !== "off");
	let snap = $state(localStorage.getItem("blm-snap") !== "off");
	let revOnDisk = $state(0);
	let saveBox = $state("");
	let lang = $state<"en" | "ru">(
		(localStorage.getItem("blm-lang") as "en" | "ru") ?? "en",
	);
	let tier = $state<"A" | "B" | "S">("A");
	let hasFsa = $state(false);
	let svgEl = $state<SVGSVGElement | null>(null);

	let pan = $state({ x: 40, y: 20 });
	let zoom = $state(1);
	let panning = false;
	let panStart = { x: 0, y: 0 };
	// drag payload: node move (single or multi) | zone move | zone resize | node resize
	type Drag =
		| { type: "node"; node: SchemeNode; dx: number; dy: number; group?: { n: SchemeNode; dx: number; dy: number }[] }
		| { type: "zone"; zone: SchemeZone; dx: number; dy: number }
		| { type: "resize"; zone: SchemeZone; corner: 0 | 1 | 2 | 3; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number }
		| { type: "nresize"; node: SchemeNode; corner: 1 | 3; sx: number; sy: number; ow: number; oh: number };
	let drag: Drag | null = null;

	// --- clipboard / undo / multi-select (ctrl+click) ---
	let clipboard = $state<string[]>([]);
	let multiSel = $state<string[]>([]); // extra selected node ids (ctrl+click)
	type Snap = { scheme: Scheme };
	let undoStack: Snap[] = [];
	function pushUndo() {
		if (!scheme) return;
		undoStack.push({ scheme: $state.snapshot(scheme) as Scheme });
		if (undoStack.length > 50) undoStack.shift();
	}
	function undo() {
		const prev = undoStack.pop();
		if (!prev || !scheme) return;
		Object.assign(scheme, prev.scheme);
		selectedId = null;
		multiSel = [];
		touch();
		saveBox = lang === "ru" ? "отменено" : "undone";
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
				...$state.snapshot(src),
				id: nid,
				x: src.x + GRID * 2,
				y: src.y + GRID * 2,
			};
			delete (copy as Record<string, unknown>).w;
			delete (copy as Record<string, unknown>).h;
			if (src.w !== undefined) copy.w = src.w;
			if (src.h !== undefined) copy.h = src.h;
			scheme.nodes.push(copy);
			news.push(copy);
		}
		if (!news.length) return;
		selectedId = news.at(-1)!.id;
		selectedKind = "node";
		multiSel = news.map((n) => n.id);
		touch();
		saveBox = lang === "ru" ? `вставлено: ${news.length}` : `pasted: ${news.length}`;
	}

	const schemeDir = $derived(
		(() => {
			try {
				const p = decodeURIComponent(location.pathname);
				return p.slice(0, p.lastIndexOf("/")) || "/";
			} catch {
				return "";
			}
		})(),
	);

	// --- i18n (EN default + RU) ---
	// server mode: editor served by llmscheme-service (docker) — SAVE goes to the API
	const serverMode = !location.pathname.endsWith(".html");
	let serverToken = $state("");

	const T = {
		en: {
			add: "+ node", connect: "connect", del: "delete", save: "SAVE",
			zone: "+ zone", label: "label", desc: "description", shape: "shape",
			refs: "refs (one per line)", x: "x", y: "y", w: "w", h: "h",
			edge: "edge", zone2: "zone", style: "style", from: "from", to: "to",
			side: "side", labelPos: "caption on",
			orphan: "orphan", warnings: "warnings",
			whatChanged: "changes vs loaded rev", saved: "written to files",
			copied: "copied to clipboard", mdSaved: "SCHEME.md downloaded",
			connectHint: "connect: click a + port on the source, then a port on the target",
			fixFirst: "FIX ERRORS FIRST:",
		},
		ru: {
			add: "+ нода", connect: "связь", del: "удалить", save: "ЗАПИСАТЬ",
			zone: "+ зона", label: "подпись", desc: "описание", shape: "форма",
			refs: "refs (по одному в строке)", x: "x", y: "y", w: "ширина", h: "высота",
			edge: "ребро", zone2: "зона", style: "стиль", from: "из", to: "в",
			side: "сторона", labelPos: "подпись на",
			orphan: "сирота", warnings: "предупреждения",
			whatChanged: "изменения против загруженной ревизии", saved: "записано в файлы",
			copied: "скопировано в буфер", mdSaved: "SCHEME.md скачан",
			connectHint: "связь: клик по + порту источника, затем по порту цели",
			fixFirst: "СНАЧАЛА ИСПРАВЬ ОШИБКИ:",
		},
	};
	const t = $derived(T[lang]);

	// --- geometry: real per-node size (label wraps grow the box; tables are sized by rows) ---
	function labelLines(n: SchemeNode): string[] {
		return n.label.split("\n");
	}
	// word-wrap each explicit newline to ~34 chars so long labels fit the box;
	// the auto box width mirrors this (nodeW counts the longest wrapped line)
	function wrapLines(n: SchemeNode): string[] {
		const out: string[] = [];
		for (const raw of labelLines(n)) {
			if (raw.length <= 34) {
				out.push(raw);
				continue;
			}
			let cur = "";
			for (const word of raw.split(" ")) {
				if (cur && (cur + " " + word).length > 34) {
					out.push(cur);
					cur = word;
				} else cur = cur ? cur + " " + word : word;
			}
			if (cur) out.push(cur);
		}
		return out.length ? out : [""];
	}
	// mirror of core nodeW/nodeH (browser copy; core exports are for md/CLI)
	// explicit n.w/n.h (resize handles) override the label-based estimate
	function nodeW(n: SchemeNode): number {
		if (typeof n.w === "number") return n.w;
		if (n.shape === "table") {
			const cols = Math.max(1, n.table?.cols?.length ?? 1);
			return Math.max(160, 26 + cols * 64);
		}
		if (n.shape === "circle") return Math.max(80, 24 + wrapLines(n)[0].length * 7);
		return Math.max(120, 20 + Math.max(...wrapLines(n).map((l) => l.length)) * 7);
	}
	function nodeH(n: SchemeNode): number {
		if (typeof n.h === "number") return n.h;
		if (n.shape === "table") {
			const rows = (n.table?.rows?.length ?? 0) + 1;
			return 28 + rows * 18;
		}
		if (n.shape === "circle") return nodeW(n);
		return Math.max(40, wrapLines(n).length * 14 + 12);
	}

	function nodePath(n: SchemeNode): string {
		const w = nodeW(n);
		const h = nodeH(n);
		switch (n.shape) {
			case "circle": {
				const r = Math.min(w, h) / 2;
				const cx = n.x + w / 2;
				const cy = n.y + h / 2;
				return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`;
			}
			case "diamond":
				return `M ${n.x + w / 2} ${n.y} L ${n.x + w} ${n.y + h / 2} L ${n.x + w / 2} ${n.y + h} L ${n.x} ${n.y + h / 2} Z`;
			case "square": {
				const s = Math.max(w, h); // square grows with the label, stays square
				return `M ${n.x} ${n.y} h ${s} v ${s} h ${-s} Z`;
			}
			default:
				return `M ${n.x} ${n.y} h ${w} v ${h} h ${-w} Z`;
		}
	}

	function anchor(n: SchemeNode, side: Side): { x: number; y: number } {
		const w = nodeW(n);
		const h = nodeH(n);
		switch (side) {
			case "top": return { x: n.x + w / 2, y: n.y };
			case "bottom": return { x: n.x + w / 2, y: n.y + h };
			case "left": return { x: n.x, y: n.y + h / 2 };
			default: return { x: n.x + w, y: n.y + h / 2 };
		}
	}

	const sideDir: Record<Side, { x: number; y: number }> = {
		top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
	};

	function autoSide(from: SchemeNode, towards: SchemeNode): Side {
		const dx = towards.x - from.x;
		const dy = towards.y - from.y;
		if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
		return dy >= 0 ? "bottom" : "top";
	}

	// deterministic orthogonal route honoring requested sides (§3: no waypoints)
	function edgePath(e: SchemeEdge): string {
		const a = scheme?.nodes.find((n) => n.id === e.from);
		const b = scheme?.nodes.find((n) => n.id === e.to);
		if (!a || !b) return "";
		const as = e.fromSide ?? autoSide(a, b);
		const bs = e.toSide ?? autoSide(b, a);
		const p1 = anchor(a, as);
		const p2 = anchor(b, bs);
		const d1 = sideDir[as];
		const d2 = sideDir[bs];
		const m1 = { x: p1.x + d1.x * 18, y: p1.y + d1.y * 18 };
		const m2 = { x: p2.x + d2.x * 18, y: p2.y + d2.y * 18 };
		const h1 = d1.y === 0; // from-side is horizontal (left/right)
		const h2 = d2.y === 0;
		if (h1 && h2) {
			const cx = (m1.x + m2.x) / 2;
			return `M ${p1.x} ${p1.y} L ${m1.x} ${m1.y} L ${cx} ${m1.y} L ${cx} ${m2.y} L ${m2.x} ${m2.y} L ${p2.x} ${p2.y}`;
		}
		if (!h1 && !h2) {
			const cy = (m1.y + m2.y) / 2;
			return `M ${p1.x} ${p1.y} L ${m1.x} ${m1.y} L ${m1.x} ${cy} L ${m2.x} ${cy} L ${m2.x} ${m2.y} L ${p2.x} ${p2.y}`;
		}
		if (h1) {
			return `M ${p1.x} ${p1.y} L ${m1.x} ${m1.y} L ${m2.x} ${m1.y} L ${m2.x} ${m2.y} L ${p2.x} ${p2.y}`;
		}
		return `M ${p1.x} ${p1.y} L ${m1.x} ${m1.y} L ${m1.x} ${m2.y} L ${m2.x} ${m2.y} L ${p2.x} ${p2.y}`;
	}

	function edgeMid(e: SchemeEdge): { x: number; y: number } {
		const a = scheme?.nodes.find((n) => n.id === e.from);
		const b = scheme?.nodes.find((n) => n.id === e.to);
		if (!a || !b) return { x: 0, y: 0 };
		return {
			x: (a.x + nodeW(a) / 2 + b.x + nodeW(b) / 2) / 2,
			y: (a.y + nodeH(a) / 2 + b.y + nodeH(b) / 2) / 2 - 8,
		};
	}

	// --- zones: membership = node center inside rect ---
	function zoneMembers(z: SchemeZone): SchemeNode[] {
		return (
			scheme?.nodes.filter(
				(n) => n.x + nodeW(n) / 2 >= z.x && n.x + nodeW(n) / 2 <= z.x + z.w &&
					n.y + nodeH(n) / 2 >= z.y && n.y + nodeH(n) / 2 <= z.y + z.h,
			) ?? []
		);
	}

	function zoneLabelPos(z: SchemeZone): { x: number; y: number; anchor: string } {
		const side: string = z.labelSide ?? "top";
		switch (side) {
			case "bottom": return { x: z.x + z.w / 2, y: z.y + z.h + 12, anchor: "middle" };
			case "left": return { x: z.x - 6, y: z.y + 14, anchor: "end" };
			case "right": return { x: z.x + z.w + 6, y: z.y + 14, anchor: "start" };
			case "center": return { x: z.x + z.w / 2, y: z.y + 14, anchor: "middle" };
			default: return { x: z.x + z.w / 2, y: z.y - 6, anchor: "middle" };
		}
	}

	// --- pointer: drag node/zone, pan canvas ---
	function svgPoint(ev: PointerEvent): { x: number; y: number } {
		const rect = svgEl!.getBoundingClientRect();
		return {
			x: (ev.clientX - rect.left - pan.x) / zoom,
			y: (ev.clientY - rect.top - pan.y) / zoom,
		};
	}

	function onPortDown(ev: PointerEvent, n: SchemeNode, side: Side) {
		ev.stopPropagation();
		if (!scheme) return;
		if (!connectMode) { connectMode = true; connectFrom = { id: n.id, side }; return; }
		if (!connectFrom) { connectFrom = { id: n.id, side }; return; }
		if (connectFrom.id !== n.id) {
			pushUndo();
			scheme.edges.push({
				id: consumeEdgeId(scheme),
				from: connectFrom.id,
				to: n.id,
				style: "solid",
				fromSide: connectFrom.side,
				toSide: side,
			});
			const e = scheme.edges.at(-1)!;
			selectedId = e.id;
			selectedKind = "edge";
			touch();
		}
		connectFrom = null;
		connectMode = false;
	}

	function onNodeDown(ev: PointerEvent, n: SchemeNode) {
		ev.stopPropagation();
		if (connectMode) return; // nodes not clickable while wiring; use ports
		// ctrl/meta+click: toggle node in the multi-selection, no drag
		if (ev.ctrlKey || ev.metaKey) {
			if (multiSel.includes(n.id)) multiSel = multiSel.filter((i) => i !== n.id);
			else multiSel = [...multiSel, n.id];
			selectedId = n.id;
			selectedKind = "node";
			return;
		}
		selectedId = n.id;
		selectedKind = "node";
		const p = svgPoint(ev);
		const moving = multiSel.includes(n.id)
			? scheme!.nodes.filter((x) => multiSel.includes(x.id))
			: [n];
		drag = {
			type: "node",
			node: n,
			dx: p.x - n.x,
			dy: p.y - n.y,
			// extra nodes to move with the dragged one (multi-selection)
			group: moving.map((m) => ({ n: m, dx: p.x - m.x, dy: p.y - m.y })),
		} as Drag;
	}

	function onZoneDown(ev: PointerEvent, z: SchemeZone) {
		ev.stopPropagation();
		selectedId = z.id;
		selectedKind = "zone";
		const p = svgPoint(ev);
		drag = { type: "zone", zone: z, dx: p.x - z.x, dy: p.y - z.y };
	}

	function onResizeDown(ev: PointerEvent, z: SchemeZone, corner: 0 | 1 | 2 | 3) {
		ev.stopPropagation();
		const p = svgPoint(ev);
		drag = { type: "resize", zone: z, corner, sx: p.x, sy: p.y, ox: z.x, oy: z.y, ow: z.w, oh: z.h };
	}

	// node resize: bottom-right / bottom-left corner handles set explicit w/h
	function onNodeResizeDown(ev: PointerEvent, n: SchemeNode, corner: 1 | 3) {
		ev.stopPropagation();
		const p = svgPoint(ev);
		drag = { type: "nresize", node: n, corner, sx: p.x, sy: p.y, ow: nodeW(n), oh: nodeH(n) };
	}

	function onSvgDown(ev: PointerEvent) {
		panning = true;
		panStart = { x: ev.clientX - pan.x, y: ev.clientY - pan.y };
		svgEl?.setPointerCapture(ev.pointerId);
	}

	function onSvgMove(ev: PointerEvent) {
		if (!drag) {
			if (!panning) return;
			pan = { x: ev.clientX - panStart.x, y: ev.clientY - panStart.y };
			return;
		}
		const p = svgPoint(ev);
		// snap-to-grid (toggleable, default on): 20px, on drag move & canvas drop
		const snapv = (v: number) => (snap ? Math.round(v / GRID) * GRID : Math.round(v));
		if (drag.type === "node") {
			drag.node.x = snapv(p.x - drag.dx);
			drag.node.y = snapv(p.y - drag.dy);
			// multi-selection: move the whole group with the same delta
			if (drag.group)
				for (const g of drag.group) {
					if (g.n === drag.node) continue;
					g.n.x = snapv(p.x - g.dx);
					g.n.y = snapv(p.y - g.dy);
				}
		} else if (drag.type === "zone") {
			drag.zone.x = snapv(p.x - drag.dx);
			drag.zone.y = snapv(p.y - drag.dy);
		} else if (drag.type === "nresize") {
			const dx = Math.round(p.x - drag.sx);
			const dy = Math.round(p.y - drag.sy);
			// corner 1 = bottom-right (w+h grow), 3 = bottom-left (h grows, x shifts)
			if (drag.corner === 1) {
				drag.node.w = Math.max(60, drag.ow + dx);
				drag.node.h = Math.max(30, drag.oh + dy);
			} else {
				drag.node.h = Math.max(30, drag.oh + dy);
			}
		} else {
			const dx = Math.round(p.x - drag.sx);
			const dy = Math.round(p.y - drag.sy);
			// corners: 0=TL 1=TR 2=BL 3=BR
			if (drag.corner === 0 || drag.corner === 2) { drag.zone.x = snapv(drag.ox + dx); drag.zone.w = drag.ow - dx; }
			if (drag.corner === 1 || drag.corner === 3) { drag.zone.w = drag.ow + dx; }
			if (drag.corner === 0 || drag.corner === 1) { drag.zone.y = snapv(drag.oy + dy); drag.zone.h = drag.oh - dy; }
			if (drag.corner === 2 || drag.corner === 3) { drag.zone.h = drag.oh + dy; }
		}
	}

	function onSvgUp() { drag = null; panning = false; }

	function onWheel(ev: WheelEvent) {
		if (!svgEl) return;
		ev.preventDefault();
		const rect = svgEl.getBoundingClientRect();
		const mx = ev.clientX - rect.left;
		const my = ev.clientY - rect.top;
		const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
		const nz = Math.min(4, Math.max(0.25, zoom * factor));
		pan = { x: mx - (mx - pan.x) * (nz / zoom), y: my - (my - pan.y) * (nz / zoom) };
		zoom = nz;
	}

	// --- model ops ---
	function touch() {
		if (!scheme) return;
		const v = validate(scheme);
		errors = v.errors.map((e) => e.message);
		warnings = v.warnings.map((w) => w.message);
	}

	function addNode() {
		if (!scheme) return;
		pushUndo();
		const n: SchemeNode = {
			id: consumeNodeId(scheme),
			shape: pendingShape ?? "rect",
			label: lang === "ru" ? "новая" : "new",
			x: 40,
			y: 40,
		};
		scheme.nodes.push(n);
		selectedId = n.id;
		selectedKind = "node";
		multiSel = [];
		touch();
	}

	// palette: click canvas (not a node) with a shape armed -> drop node there
	function onCanvasClick(ev: MouseEvent) {
		if (!scheme || !pendingShape) return;
		const p = svgPoint(ev as unknown as PointerEvent);
		const sx = snap ? Math.round((p.x - 60) / GRID) * GRID : Math.round(p.x - 60);
		const sy = snap ? Math.round((p.y - 20) / GRID) * GRID : Math.round(p.y - 20);
		const n: SchemeNode = {
			id: consumeNodeId(scheme),
			shape: pendingShape,
			label: lang === "ru" ? "новая" : "new",
			x: sx,
			y: sy,
		};
		scheme.nodes.push(n);
		selectedId = n.id;
		selectedKind = "node";
		pendingShape = null;
		touch();
	}

	function addZone() {
		if (!scheme) return;
		pushUndo();
		const z: SchemeZone = {
			id: consumeZoneId(scheme),
			label: lang === "ru" ? "зона" : "zone",
			x: -pan.x / zoom + 60, y: -pan.y / zoom + 60, w: 320, h: 200,
			labelSide: "top",
		};
		scheme.zones ??= [];
		scheme.zones.push(z);
		selectedId = z.id;
		selectedKind = "zone";
		touch();
	}

	function removeSelected() {
		if (!scheme || !selectedId) return;
		pushUndo();
		const ids = new Set([...multiSel, selectedId]);
		if (selectedKind === "zone") {
			scheme.zones = (scheme.zones ?? []).filter((z) => z.id !== selectedId);
		} else if (selectedKind === "edge") {
			scheme.edges = scheme.edges.filter((e) => e.id !== selectedId);
		} else {
			scheme.nodes = scheme.nodes.filter((n) => !ids.has(n.id));
			scheme.edges = scheme.edges.filter((e) => !ids.has(e.from) && !ids.has(e.to));
		}
		selectedId = null;
		selectedKind = null;
		multiSel = [];
		touch();
	}

	const selected = $derived.by(() => {
		if (!scheme || !selectedId) return null;
		if (selectedKind === "zone") return scheme.zones?.find((z) => z.id === selectedId) ?? null;
		if (selectedKind === "edge") return scheme.edges.find((e) => e.id === selectedId) ?? null;
		return scheme.nodes.find((n) => n.id === selectedId) ?? null;
	});

	// --- table editor helpers (inspector widget) ---
	function setCols(n: SchemeNode, count: number) {
		const c = Math.max(1, Math.min(10, count));
		const cols = Array.from({ length: c }, (_, i) => n.table?.cols?.[i] ?? `col${i + 1}`);
		n.table = { ...n.table, cols };
		touch();
	}
	function setRows(n: SchemeNode, count: number) {
		const r = Math.max(1, Math.min(50, count));
		const width = n.table?.cols?.length ?? 1;
		const rows = Array.from({ length: r }, (_, i) =>
			n.table?.rows?.[i] ?? Array.from({ length: width }, () => ""),
		);
		n.table = { ...n.table, rows };
		touch();
	}
	function setCol(n: SchemeNode, i: number, value: string) {
		const cols = [...(n.table?.cols ?? [])];
		cols[i] = value;
		n.table = { ...n.table, cols };
		touch();
	}
	function setCell(n: SchemeNode, ri: number, ci: number, value: string) {
		const rows = (n.table?.rows ?? []).map((r) => [...r]);
		const width = n.table?.cols?.length ?? 1;
		rows[ri] = Array.from({ length: width }, (_, i) => rows[ri]?.[i] ?? "");
		rows[ri][ci] = value;
		n.table = { ...n.table, rows };
		touch();
	}

	function autoPlace() {
		if (!scheme) return;
		for (const n of scheme.nodes) {
			(n as Partial<SchemeNode>).x = undefined;
			(n as Partial<SchemeNode>).y = undefined;
		}
		autoLayout(scheme);
		touch();
	}

	const orphanIds = $derived.by(() => {
		if (!scheme) return new Set<string>();
		return new Set(
			scheme.nodes
				.filter((n) => !scheme!.edges.some((e) => e.from === n.id || e.to === n.id))
				.map((n) => n.id),
		);
	});

	// --- save tiers (§8) ---
	function schemeJson(): string {
		return `${JSON.stringify($state.snapshot(scheme), null, 2)}\n`;
	}

	function schemeMd(): string {
		return exportMd(scheme!, validate(scheme!));
	}

	function download(name: string, text: string) {
		const a = document.createElement("a");
		a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
		a.download = name;
		a.click();
	}

	async function saveMd() {
		download("SCHEME.md", schemeMd());
		saveBox = t.mdSaved;
	}

	// journal of the current scheme (server mode): write ops with revs
	async function showLog() {
		try {
			const res = await fetch(
				`/api/scheme/${encodeURIComponent(schemeName())}/log`,
				{ headers: { authorization: `Bearer ${serverToken}` } },
			);
			const data = await res.json();
			if (!res.ok) {
				saveBox = `${res.status}: ${data.error ?? "log unavailable"}`;
				return;
			}
			const rows: string[] = (data.entries ?? []).map(
				(e: { ts: string; actor: string; rev: number; op: string; summary: string }) =>
					`${e.ts.slice(0, 19)} ${e.actor} rev=${e.rev} ${e.op}: ${e.summary}`,
			);
			saveBox = rows.length ? rows.join("\n") : "(empty journal)";
		} catch (e) {
			saveBox = `log failed: ${(e as Error).message}`;
		}
	}

	function tierACommands(): string {
		const base = "node <skill-dir>/block_llm_tools/block.mjs";
		const snap = $state.snapshot(scheme)!;
		const changes = schemeLoaded ? diffSchemes(schemeLoaded, snap) : [];
		const header = changes.length
			? `# changes vs loaded rev ${revOnDisk}:\n# ${changes.join("\n# ")}\n`
			: "# no changes since load\n";
		const body = `${base} put - --rev ${revOnDisk} <<'EOF'\n${JSON.stringify(snap, null, 2)}\nEOF`;
		return header + body;
	}

	let schemeLoaded: Scheme | null = null;

	function editorHtmlSelf(): string {		const script = `<script type="application/json" id="${DATA_MARKER}">${JSON.stringify($state.snapshot(scheme), null, 2).replace(/</g, "\\u003c")}<\/script>`;
		const re = new RegExp(`<script type="application/json" id="${DATA_MARKER}">[\\s\\S]*?<\\/script>`);
		return PRISTINE_HTML.replace(re, () => script);
	}

	async function serverSave() {
		// Tier S — server mode: the service serves the editor WITHOUT .html;
		// token comes from the URL (?t=...) put there by the service.
		if (!scheme) return;
		scheme.meta.generator = "human-editor";
		touch();
		if (errors.length) {
			saveBox = `${t.fixFirst}\n${errors.join("\n")}`;
			return;
		}
		try {
			const res = await fetch("/api/scheme/" + encodeURIComponent(schemeName()), {
				method: "PUT",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${serverToken}`,
				},
				body: schemeJson(),
			});
			const data = await res.json();
			if (!res.ok) {
				saveBox = `${res.status}: ${data.error ?? "save failed"}`;
				return;
			}
			revOnDisk = data.rev;
			if (scheme) scheme.rev = data.rev;
			saveBox = t.saved;
		} catch (e) {
			saveBox = `server save failed: ${(e as Error).message}`;
		}
	}

	// scheme name in server mode = last path segment of /editor/<name>
	function schemeName(): string {
		const seg = location.pathname.split("/").filter(Boolean).at(-1);
		return seg ?? "default";
	}

	async function doSave() {
		if (serverMode) return serverSave();
		if (!scheme) return;
		scheme.meta.generator = "human-editor";
		touch();
		if (errors.length) {
			saveBox = `${t.fixFirst}\n${errors.join("\n")}`;
			return;
		}
		if (tier === "B" && hasFsa) {
			try {
				const jh = await fsa()!({ suggestedName: "scheme.json" });
				const mh = await fsa()!({ suggestedName: "SCHEME.md" });
				const hh = await fsa()!({ suggestedName: "scheme.html" });
				const writes: [FileSystemFileHandle, string][] = [
					[jh, schemeJson()], [mh, schemeMd()], [hh, editorHtmlSelf()],
				];
				for (const [handle, text] of writes) {
					const w = await handle.createWritable();
					await w.write(text);
					await w.close();
				}
				saveBox = t.saved;
				return;
			} catch (e) {
				if ((e as Error).name === "AbortError") return;
				tier = "A";
			}
		}
		saveBox = tierACommands();
		try {
			await navigator.clipboard.writeText(saveBox);
			saveBox += `\n\n> ${t.copied}`;
		} catch { /* manual selection still works */ }
	}

	onMount(() => {
		try {
			scheme = extractSchemeJson(PRISTINE_HTML);
			schemeLoaded = $state.snapshot(scheme) as Scheme;
			revOnDisk = scheme.rev;
			touch();
			const q = new URLSearchParams(location.search);
			if (q.get("t")) serverToken = q.get("t")!;
		} catch (e) {
			errors = [(e as Error).message];
		}
		hasFsa = typeof fsa() === "function";
		tier = serverMode ? "S" : hasFsa ? "B" : "A";
	});
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === "Escape") {
			connectMode = false;
			connectFrom = null;
		}
		// ignore hotkeys while typing in inputs/textarea/select
		const tag = (e.target as HTMLElement)?.tagName;
		if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
		const inSel = () => [...multiSel, selectedId].filter(Boolean) as string[];
		if ((e.ctrlKey || e.metaKey) && e.key === "c" && selectedId) {
			clipboard = inSel().length ? inSel() : [selectedId];
			saveBox = `copied: ${clipboard.join(", ")}`;
		} else if ((e.ctrlKey || e.metaKey) && e.key === "v" && clipboard.length) {
			pasteClipboard();
		} else if ((e.ctrlKey || e.metaKey) && e.key === "z") {
			undo();
		} else if (e.key === "Delete" && selectedId) {
			removeSelected();
		}
	}}
/>

<div class="topbar">
	<span class="title">{scheme?.name ?? "block-llm"}</span>
	<span class="rev">rev {scheme?.rev ?? "-"}</span>
	<span class="path" title={schemeDir}>{schemeDir}</span>
	<span class="spacer"></span>
	<button onclick={() => { lang = lang === "en" ? "ru" : "en"; localStorage.setItem("blm-lang", lang); }}>{lang === "en" ? "RU" : "EN"}</button>
	<button onclick={addNode}>{t.add}</button>
	<button onclick={addZone}>{t.zone}</button>
	<button class:on={connectMode} onclick={() => { connectMode = !connectMode; connectFrom = null; }} title={t.connectHint}>{t.connect}</button>
	<button class:on={showGrid} onclick={() => { showGrid = !showGrid; localStorage.setItem("blm-grid", showGrid ? "on" : "off"); }} title="grid">#</button>
	<button class:on={snap} onclick={() => { snap = !snap; localStorage.setItem("blm-snap", snap ? "on" : "off"); }} title="snap to grid">⊕</button>
	<button onclick={autoPlace}>auto</button>
	<button onclick={undo} disabled={!undoStack.length} title="ctrl+z">↩</button>
	<button onclick={removeSelected} disabled={!selected}>{t.del}</button>
	{#if !serverMode}<button onclick={saveMd} title="SCHEME.md">↓md</button>{/if}
	{#if serverMode}<button onclick={showLog} title="write journal of this scheme">log</button>{/if}
	<button onclick={doSave}>{t.save}</button>
</div>

<div class="main">
	<div class="canvas-wrap">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<svg
			bind:this={svgEl}
			class:dragging={panning}
			class:placing={!!pendingShape}
			onpointerdown={onSvgDown}
			onpointermove={onSvgMove}
			onpointerup={onSvgUp}
			onwheel={onWheel}
			onclick={onCanvasClick}
		>
			<defs>
				<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
					<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--edge)" />
				</marker>
				<pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
					<path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--grid)" stroke-width="1" />
				</pattern>
			</defs>
			{#if showGrid}<rect x="0" y="0" width="100%" height="100%" fill="url(#grid)" />{/if}
			<g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
				<!-- zones: behind everything -->
				{#each scheme?.zones ?? [] as z (z.id)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<g class="zone" class:selected={selectedId === z.id}>
						<rect
							x={z.x} y={z.y} width={z.w} height={z.h}
							onpointerdown={(ev) => onZoneDown(ev, z)}
						/>
						{#if selectedId === z.id}
							{#each [[z.x, z.y], [z.x + z.w, z.y], [z.x, z.y + z.h], [z.x + z.w, z.y + z.h]] as c, i}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<circle
									class="resize-handle" cx={c[0]} cy={c[1]} r="5"
									onpointerdown={(ev) => onResizeDown(ev, z, i as 0 | 1 | 2 | 3)}
								/>
							{/each}
						{/if}
						<text
							class="zone-label" x={zoneLabelPos(z).x} y={zoneLabelPos(z).y}
							text-anchor={zoneLabelPos(z).anchor}
						>{z.label}</text>
					</g>
				{/each}

				<!-- edges -->
				{#each scheme?.edges ?? [] as e (e.id)}
					<g>
						<!-- wide transparent hit path = whole arrow is clickable -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<path class="edge-hit" d={edgePath(e)}
							onpointerdown={(ev) => { ev.stopPropagation(); selectedId = e.id; selectedKind = "edge"; }} />
						<path class="edge-path" class:dashed={e.style === "dashed"} d={edgePath(e)}
							class:sel={selectedId === e.id} marker-end="url(#arrow)" />
						{#if e.label}
							<text class="edge-label" x={edgeMid(e).x} y={edgeMid(e).y}>{e.label}</text>
						{/if}
					</g>
				{/each}

				<!-- nodes: on top of zones -->
				{#each scheme?.nodes ?? [] as n (n.id)}
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<g
						class="node"
						class:selected={selectedId === n.id}
						class:orphan={orphanIds.has(n.id)}
						class:member={scheme?.zones?.some((z) => zoneMembers(z).includes(n))}
						onpointerdown={(ev) => onNodeDown(ev, n)}
					>
					<path class="node-shape" d={nodePath(n)} />
					{#if n.shape === "table"}
						<!-- table: header = node label, then cols/rows grid -->
						{@const w = nodeW(n)}
						{@const cols = n.table?.cols ?? []}
						{@const colW = cols.length ? w / cols.length : w}
						<text class="tbl-head" x={n.x + w / 2} y={n.y + 13} text-anchor="middle">{n.label}</text>
						{#each cols as c, ci}
							<text class="tbl-col" x={n.x + colW * ci + 3} y={n.y + 25}>{c}</text>
						{/each}
						{#each n.table?.rows ?? [] as row, ri}
							{#each row.slice(0, cols.length) as cell, ci}
								<text class="tbl-cell" x={n.x + colW * ci + 3} y={n.y + 28 + 18 * (ri + 1)}>{cell}</text>
							{/each}
						{/each}
					{:else}
						<!-- multiline label: tspans grow the box downward; long lines wrap to the box width -->
						{@const lines = wrapLines(n)}
						{@const h = nodeH(n)}
						<text
							x={n.x + nodeW(n) / 2}
							y={n.y + h / 2 - (lines.length - 1) * 7 + 3}
							text-anchor="middle"
						>{#each lines as line, li (li)}<tspan x={n.x + nodeW(n) / 2} dy={li === 0 ? 0 : 14}>{line}</tspan>{/each}</text>
					{/if}
				</g>
					<!-- resize handles: bottom corners, only when selected (not tables — they size by content) -->
					{#if selectedId === n.id && n.shape !== "table"}
						{@const w = nodeW(n)}
						{@const h = nodeH(n)}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<circle
							class="resize-handle" cx={n.x + w} cy={n.y + h} r="5"
							onpointerdown={(ev) => onNodeResizeDown(ev, n, 1)}
						/>
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<circle
							class="resize-handle" cx={n.x} cy={n.y + h} r="5"
							onpointerdown={(ev) => onNodeResizeDown(ev, n, 3)}
						/>
					{/if}
					<!-- ports: plus circles on 4 sides (connect mode or selected/hover) -->
					{#if connectMode || selectedId === n.id}
						{#each SIDES as side (side)}
							{@const a = anchor(n, side)}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<g class="port" class:armed={connectFrom?.id === n.id && connectFrom.side === side}
								onpointerdown={(ev) => onPortDown(ev, n, side)}>
								<circle cx={a.x} cy={a.y} r="9" class="port-bg" />
								<text x={a.x} y={a.y + 3.5} text-anchor="middle">+</text>
							</g>
						{/each}
					{/if}
				{/each}
			</g>
		</svg>
	</div>

	<div class="inspector">
		{#if selected && selectedKind === "node"}
			{@const n = selected as SchemeNode}
			<h3>{n.id}</h3>
			<label>{t.label}
				<!-- textarea (not input): Enter inserts \n, the node grows downward -->
				<textarea
					rows={Math.max(2, wrapLines(n).length)}
					bind:value={n.label}
					oninput={touch}
				></textarea></label>
			<label>{t.desc}
				<textarea bind:value={n.description} oninput={touch}></textarea></label>
			<label>{t.shape}
				<select bind:value={n.shape} onchange={touch}>
					<option value="rect">rect</option>
					<option value="square">square</option>
					<option value="circle">circle</option>
					<option value="diamond">diamond</option>
					<option value="table">table</option>
				</select></label>
			{#if n.shape === "table"}
				{@const tb = n.table ?? {}}
				<div class="tbl-editor">
					<div class="tbl-toolbar">
						<span>cols {tb.cols?.length ?? 0}/10</span>
						<button class="mini" title="add column" onclick={() => { setCols(n, (tb.cols?.length ?? 0) + 1); }}>+</button>
						<button class="mini" title="remove column" disabled={(tb.cols?.length ?? 0) <= 1} onclick={() => { setCols(n, (tb.cols?.length ?? 1) - 1); }}>−</button>
						<span>rows {tb.rows?.length ?? 0}/50</span>
						<button class="mini" title="add row" disabled={(tb.rows?.length ?? 0) >= 50} onclick={() => { setRows(n, (tb.rows?.length ?? 0) + 1); }}>+</button>
						<button class="mini" title="remove row" disabled={(tb.rows?.length ?? 0) <= 1} onclick={() => { setRows(n, (tb.rows?.length ?? 1) - 1); }}>−</button>
					</div>
					<table class="tbl-grid">
						<thead><tr>
							{#each tb.cols ?? [] as c, ci (ci)}
								<th><input value={c} oninput={(e) => { setCol(n, ci, e.currentTarget.value); }} placeholder={"col" + (ci + 1)} /></th>
							{/each}
						</tr></thead>
						<tbody>
						{#each tb.rows ?? [] as row, ri (ri)}
							<tr>
								{#each Array.from({ length: tb.cols?.length ?? 0 }) as _, ci (ci)}
									<td><input value={row?.[ci] ?? ""} oninput={(e) => { setCell(n, ri, ci, e.currentTarget.value); }} /></td>
								{/each}
							</tr>
						{/each}
						</tbody>
					</table>
				</div>
			{/if}
			<label>{t.refs}
				<textarea
					value={(n.refs ?? []).join("\n")}
					oninput={(e) => { n.refs = e.currentTarget.value.split("\n").filter(Boolean); touch(); }}
				></textarea></label>
			<div class="row">
				<span><label>{t.x}<input type="number" bind:value={n.x} oninput={touch} /></label></span>
				<span><label>{t.y}<input type="number" bind:value={n.y} oninput={touch} /></label></span>
			</div>
			{#if n.shape !== "table"}
				<div class="row">
					<span><label>{t.w}<input type="number" bind:value={n.w} placeholder="auto" oninput={touch} /></label></span>
					<span><label>{t.h}<input type="number" bind:value={n.h} placeholder="auto" oninput={touch} /></label></span>
				</div>
				{#if n.w !== undefined || n.h !== undefined}
					<button class="mini" onclick={() => { delete n.w; delete n.h; touch(); }} title="auto-size from label">auto-size</button>
				{/if}
			{/if}
			{@const e = selected as SchemeEdge}
			<h3>{e.id} ({t.edge})</h3>
			<label>{t.label}
				<input bind:value={e.label} oninput={touch} /></label>
			<label>{t.desc}
				<textarea bind:value={e.description} oninput={touch}></textarea></label>
			<label>{t.style}
				<select bind:value={e.style} onchange={touch}>
					<option value="solid">solid</option>
					<option value="dashed">dashed</option>
				</select></label>
			<div class="row">
				<span><label>{t.from} {t.side}
					<select bind:value={e.fromSide} onchange={touch}>
						<option value={undefined}>auto</option>
						{#each SIDES as s}<option value={s}>{s}</option>{/each}
					</select></label></span>
				<span><label>{t.to} {t.side}
					<select bind:value={e.toSide} onchange={touch}>
						<option value={undefined}>auto</option>
						{#each SIDES as s}<option value={s}>{s}</option>{/each}
					</select></label></span>
			</div>
		{:else if selected && selectedKind === "zone"}
			{@const z = selected as SchemeZone}
			<h3>{z.id} ({t.zone2})</h3>
			<label>{t.label}
				<input bind:value={z.label} oninput={touch} /></label>
			<label>{t.desc}
				<textarea bind:value={z.description} oninput={touch}></textarea></label>
			<label>{t.labelPos}
				<select bind:value={z.labelSide} onchange={touch}>
					<option value="top">top</option>
					<option value="bottom">bottom</option>
					<option value="left">left</option>
					<option value="right">right</option>
					<option value="center">center</option>
				</select></label>
			<div class="row">
				<span><label>{t.x}<input type="number" bind:value={z.x} oninput={touch} /></label></span>
				<span><label>{t.y}<input type="number" bind:value={z.y} oninput={touch} /></label></span>
			</div>
			<div class="row">
				<span><label>{t.w}<input type="number" bind:value={z.w} oninput={touch} /></label></span>
				<span><label>{t.h}<input type="number" bind:value={z.h} oninput={touch} /></label></span>
			</div>
			<p class="hint">{zoneMembers(z).length} nodes inside</p>
		{:else}
			<h3>block-llm</h3>
			<p class="hint">{t.connectHint}</p>
		{/if}
		{#if warnings.length}
			<label>{t.warnings}</label>
			<ul class="warnlist">
				{#each warnings as w}<li>{w}</li>{/each}
			</ul>
		{/if}
		{#if errors.length}
			<ul class="warnlist" style="color: var(--err)">
				{#each errors as w}<li>{w}</li>{/each}
			</ul>
		{/if}
		{#if saveBox}
			<label>{t.whatChanged}</label>
			<div class="savebox">{saveBox}</div>
		{/if}
		{#if selectedId}
			<button class="danger" onclick={removeSelected}>{t.del} {selectedId}</button>
		{/if}
	</div>
	<!-- shape palette: right edge, under the inspector -->
	<div class="palette">
		{#each SHAPES as s}
			<button
				class:on={pendingShape === s}
				onclick={() => (pendingShape = pendingShape === s ? null : s)}
				title={s}
			>
				<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
					{#if s === "rect"}
						<rect x="3" y="7" width="18" height="10" />
					{:else if s === "square"}
						<rect x="6" y="6" width="12" height="12" />
					{:else if s === "circle"}
						<circle cx="12" cy="12" r="8" />
					{:else if s === "table"}
						<rect x="3" y="4" width="18" height="16" />
						<line x1="3" y1="9" x2="21" y2="9" />
						<line x1="3" y1="14" x2="21" y2="14" />
					{:else}
						<path d="M 12 4 L 20 12 L 12 20 L 4 12 Z" />
					{/if}
				</svg>
			</button>
		{/each}
	</div>
</div>

<div class="statusbar">
	<span>rev {scheme?.rev ?? "-"}</span>
	<span class="tier">tier {tier}{hasFsa ? "" : " (no fsa)"}</span>
	<span class="spacer"></span>
	<span>{scheme?.nodes.length ?? 0} nodes / {scheme?.edges.length ?? 0} edges / {scheme?.zones?.length ?? 0} zones</span>
</div>
