import type { Scheme, SchemeNode } from "./types.ts";

// §3 deterministic BFS layout, fixed grid. Same graph -> same layout, always.
export const GRID_X = 160;
export const GRID_Y = 100;

// root = node with no incoming edges; if all have incoming (cycle), min numeric id.
export function findRoot(s: Scheme): string | undefined {
	const nodes = s.nodes ?? [];
	if (!nodes.length) return undefined;
	const hasIncoming = new Set((s.edges ?? []).map((e) => e.to));
	const roots = nodes.filter((n) => !hasIncoming.has(n.id));
	const pool = roots.length ? roots : nodes;
	const key = (n: SchemeNode) =>
		Number.parseInt(n.id.replace(/\D/g, ""), 10) || 0;
	return pool.reduce((a, b) => (key(a) <= key(b) ? a : b)).id;
}

// cells: y = depth * GRID_Y, x = index-within-depth * GRID_X, centered per level.
// Nodes with explicit x/y are left untouched; their cells are skipped.
export function autoLayout(s: Scheme): { placed: string[] } {
	const nodes = s.nodes ?? [];
	if (!nodes.length) return { placed: [] };
	const byId = new Map(nodes.map((n) => [n.id, n]));

	// adjacency (undirected traversal, directed edges)
	const adj = new Map<string, string[]>();
	for (const n of nodes) adj.set(n.id, []);
	for (const e of s.edges ?? []) {
		if (byId.has(e.from) && byId.has(e.to)) {
			adj.get(e.from)!.push(e.to);
			adj.get(e.to)!.push(e.from);
		}
	}

	const root = findRoot(s)!;
	// BFS levels over unvisited nodes (orphan components hang off the BFS forest)
	const level = new Map<string, number>([[root, 0]]);
	const queue = [root];
	while (queue.length) {
		const cur = queue.shift()!;
		for (const nb of adj.get(cur) ?? []) {
			if (!level.has(nb)) {
				level.set(nb, level.get(cur)! + 1);
				queue.push(nb);
			}
		}
	}
	// anything unreachable gets the next free level (deterministic by id order)
	const sorted = [...nodes].map((n) => n.id).sort();
	let maxLevel = Math.max(0, ...level.values());
	for (const id of sorted) {
		if (!level.has(id)) level.set(id, ++maxLevel);
	}

	const occupied = new Set(
		nodes
			.filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y))
			.map((n) => `${n.x}:${n.y}`),
	);
	const perLevel = new Map<number, string[]>();
	for (const id of sorted) {
		if (Number.isFinite(byId.get(id)!.x) && Number.isFinite(byId.get(id)!.y))
			continue;
		const lv = level.get(id)!;
		if (!perLevel.has(lv)) perLevel.set(lv, []);
		perLevel.get(lv)!.push(id);
	}

	const placed: string[] = [];
	const maxCount = Math.max(1, ...[...perLevel.values()].map((v) => v.length));
	const levelsSorted = [...perLevel.keys()].sort((a, b) => a - b);
	for (const lv of levelsSorted) {
		const ids = perLevel.get(lv)!;
		const offset = (maxCount - ids.length) * (GRID_X / 2);
		ids.forEach((id, i) => {
			let x = offset + i * GRID_X;
			const y = lv * GRID_Y;
			while (occupied.has(`${x}:${y}`)) x += GRID_X; // grid collision -> shift right
			occupied.add(`${x}:${y}`);
			const n = byId.get(id)!;
			n.x = x;
			n.y = y;
			placed.push(id);
		});
	}
	return { placed };
}
