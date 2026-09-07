import type { Scheme } from "./types.ts";

// §3 watermark: freed ids are NEVER reused. n1.. / e1..
// If the watermark lags behind existing ids (hand-edited json / restore of a
// foreign payload), the counter self-heals: skip ids that are already taken.
export function nextNodeId(s: Scheme): string {
	const taken = new Set((s.nodes ?? []).map((n) => n.id));
	let n = s.meta.nextId.n;
	while (taken.has(`n${n}`)) n++;
	s.meta.nextId.n = n;
	return `n${n}`;
}
export function nextEdgeId(s: Scheme): string {
	const taken = new Set([
		...(s.edges ?? []).map((e) => e.id),
		...(s.zones ?? []).map((z) => z.id),
	]);
	let e = s.meta.nextId.e;
	while (taken.has(`e${e}`) || taken.has(`z${e}`)) e++;
	s.meta.nextId.e = e;
	return `e${e}`;
}
export function consumeNodeId(s: Scheme): string {
	const id = nextNodeId(s);
	s.meta.nextId.n++;
	return id;
}
export function consumeEdgeId(s: Scheme): string {
	const id = nextEdgeId(s);
	s.meta.nextId.e++;
	return id;
}

// zones share the e-counter with a z prefix (z1, z2...); no separate watermark
export function consumeZoneId(s: Scheme): string {
	const id = nextEdgeId(s).replace("e", "z");
	s.meta.nextId.e++;
	return id;
}

export function emptyScheme(name: string) {
	return {
		format: "block-llm",
		version: 1,
		rev: 0,
		name,
		project: { root: ".", codePaths: ["src/"] },
		nodes: [],
		edges: [],
		zones: [],
		meta: {
			updatedAt: new Date().toISOString(),
			generator: "agent",
			nextId: { n: 1, e: 1 },
		},
	};
}
