import type { Scheme, SchemeNode } from "./types.ts";

// §3 deterministic BFS layout, fixed grid. Same graph -> same layout, always.
export const GRID_X = 160;
export const GRID_Y = 100;

// code-unit compare, NOT localeCompare: the layout must come out identical on
// every machine, or CLI/agent/editor disagree about where a box belongs.
const byId = (a: SchemeNode, b: SchemeNode): number => {
	if (a.id < b.id) return -1;
	if (a.id > b.id) return 1;
	return 0;
};

// root = node with no incoming edges; if all have incoming (cycle), min numeric id.
export function findRoot(s: Scheme): string | undefined {
	const nodes = s.nodes ?? [];
	if (!nodes.length) return undefined;
	const hasIncoming = new Set((s.edges ?? []).map((e) => e.to));
	const key = (n: SchemeNode) => Number.parseInt(n.id.replace(/\D/g, ""), 10) || 0;
	const pool = nodes.filter((n) => !hasIncoming.has(n.id));
	return (pool.length ? pool : nodes).reduce((a, b) => (key(a) <= key(b) ? a : b)).id;
}

// Cells: y = depth * GRID_Y, x = index-within-depth * GRID_X, centered per level.
// Nodes that already have finite x/y keep their place (and reserve their cell).
export function autoLayout(s: Scheme): { placed: string[] } {
	const nodes = s.nodes ?? [];
	if (!nodes.length) return { placed: [] };

	// adjacency: undirected traversal over directed edges
	const adj = new Map<string, string[]>();
	for (const n of nodes) adj.set(n.id, []);
	for (const e of s.edges ?? []) {
		const from = adj.get(e.from);
		const to = adj.get(e.to);
		if (!from || !to) continue; // dangling edge — validate() reports it
		from.push(e.to);
		to.push(e.from);
	}

	// BFS levels; orphan components hang off the forest below
	const level = new Map<string, number>();
	const queue: { id: string; lv: number }[] = [];
	const root = findRoot(s);
	if (root) {
		level.set(root, 0);
		queue.push({ id: root, lv: 0 });
	}
	// BFS: the array iterator visits items pushed during iteration, so orphan
	// components still get levels, and no shift() (O(n) per call -> O(n²))
	for (const { id, lv } of queue) {
		for (const nb of adj.get(id) ?? []) {
			if (level.has(nb)) continue;
			level.set(nb, lv + 1);
			queue.push({ id: nb, lv: lv + 1 });
		}
	}

	// deterministic pass: unreachable nodes take the next free level
	const sorted = [...nodes].sort(byId);
	let maxLevel = level.size ? Math.max(...level.values()) : 0;
	for (const n of sorted) if (!level.has(n.id)) level.set(n.id, ++maxLevel);

	// one pass: reserved cells + per-level buckets of nodes to place
	const placedAt = new Set<string>();
	const perLevel = new Map<number, SchemeNode[]>();
	for (const n of sorted) {
		if (Number.isFinite(n.x) && Number.isFinite(n.y)) {
			placedAt.add(`${n.x}:${n.y}`);
			continue;
		}
		const lv = level.get(n.id) ?? 0;
		const bucket = perLevel.get(lv);
		if (bucket) bucket.push(n);
		else perLevel.set(lv, [n]);
	}

	const placed: string[] = [];
	const widest = Math.max(1, ...[...perLevel.values()].map((v) => v.length));
	for (const lv of [...perLevel.keys()].sort((a, b) => a - b)) {
		const bucket = perLevel.get(lv) ?? [];
		const offset = (widest - bucket.length) * (GRID_X / 2);
		bucket.forEach((n, i) => {
			let x = offset + i * GRID_X;
			const y = lv * GRID_Y;
			while (placedAt.has(`${x}:${y}`)) x += GRID_X; // collision -> shift right
			placedAt.add(`${x}:${y}`);
			n.x = x;
			n.y = y;
			placed.push(n.id);
		});
	}
	return { placed };
}
