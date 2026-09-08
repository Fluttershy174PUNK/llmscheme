import type { Scheme } from "./types.ts";

// "What changed" between two revisions — §5 diff and the editor's tier-A header.
// Pure; shared by CLI diff, the editor and the service /diff endpoint.
//
// v1 hand-rolled per-field checks and silently ignored zones, w/h, refs, table
// and edge sides: a human could resize and move boxes in the browser and the
// diff still said "no changes since load". One generic pass over all three
// collections covers every field and is shorter than the old code.
const NODE_FIELDS = ["label", "shape", "description", "x", "y", "w", "h", "refs", "table"] as const;
const EDGE_FIELDS = ["from", "to", "style", "label", "description", "fromSide", "toSide"] as const;
const ZONE_FIELDS = ["label", "description", "x", "y", "w", "h", "labelSide"] as const;

const same = (a: unknown, b: unknown) =>
	a === b || (typeof a === "object" && JSON.stringify(a ?? null) === JSON.stringify(b ?? null));

// T carries an index signature: SchemeNode/Edge/Zone all declare
// `[k: string]: unknown`, so field names from the *_FIELDS lists index cleanly.
function diffCollection<T extends { id: string; [k: string]: unknown }>(
	kind: string,
	a: T[],
	b: T[],
	fields: readonly string[],
	describe: (x: T) => string,
): string[] {
	const out: string[] = [];
	const am = new Map(a.map((x) => [x.id, x]));
	const bm = new Map(b.map((x) => [x.id, x]));
	for (const [id, x] of am) if (!bm.has(id)) out.push(`- ${kind} ${id} ${describe(x)}`);
	for (const [id, x] of bm) {
		const o = am.get(id);
		if (!o) {
			out.push(`+ ${kind} ${id} ${describe(x)}`);
			continue;
		}
		for (const f of fields)
			if (!same(o[f], x[f]))
				out.push(
					`~ ${kind} ${id}.${f}: ${JSON.stringify(o[f] ?? "")} -> ${JSON.stringify(x[f] ?? "")}`,
				);
	}
	return out;
}

export function diffSchemes(a: Scheme, b: Scheme): string[] {
	const changes: string[] = [];
	if (a.name !== b.name) changes.push(`~ name: ${a.name} -> ${b.name}`);
	changes.push(
		...diffCollection("node", a.nodes ?? [], b.nodes ?? [], NODE_FIELDS, (n) => `"${n.label}"`),
		...diffCollection(
			"edge",
			a.edges ?? [],
			b.edges ?? [],
			EDGE_FIELDS,
			(e) => `${e.from}->${e.to}${e.label ? ` "${e.label}"` : ""}`,
		),
		...diffCollection("zone", a.zones ?? [], b.zones ?? [], ZONE_FIELDS, (z) => `"${z.label}"`),
	);
	return changes;
}
