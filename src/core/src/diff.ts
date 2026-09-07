import type { Scheme } from "./types.ts";

// "what changed" between two scheme revisions (§5 diff, §8 Tier A "what changed").
// Pure — shared by CLI diff and the browser editor.
export function diffSchemes(a: Scheme, b: Scheme): string[] {
	const changes: string[] = [];
	const an = new Map((a.nodes ?? []).map((n) => [n.id, n]));
	const bn = new Map((b.nodes ?? []).map((n) => [n.id, n]));
	for (const [id, n] of an)
		if (!bn.has(id)) changes.push(`- node ${id} "${n.label}"`);
	for (const [id, n] of bn) {
		if (!an.has(id)) {
			changes.push(`+ node ${id} "${n.label}"`);
			continue;
		}
		const o = an.get(id)!;
		for (const k of ["label", "shape", "description"] as const) {
			if ((o[k] ?? "") !== (n[k] ?? ""))
				changes.push(
					`~ node ${id}.${k}: ${JSON.stringify(o[k] ?? "")} -> ${JSON.stringify(n[k] ?? "")}`,
				);
		}
		if (o.x !== n.x || o.y !== n.y)
			changes.push(`~ node ${id} moved to ${n.x},${n.y}`);
	}
	const ae = new Map((a.edges ?? []).map((e) => [e.id, e]));
	const be = new Map((b.edges ?? []).map((e) => [e.id, e]));
	for (const [id, e] of ae)
		if (!be.has(id)) changes.push(`- edge ${id} ${e.from}->${e.to}`);
	for (const [id, e] of be) {
		if (!ae.has(id)) {
			changes.push(
				`+ edge ${id} ${e.from}->${e.to}${e.label ? ` "${e.label}"` : ""}`,
			);
			continue;
		}
		const o = ae.get(id)!;
		if (o.from !== e.from || o.to !== e.to)
			changes.push(`~ edge ${id}: ${o.from}->${o.to} => ${e.from}->${e.to}`);
		if (o.style !== e.style)
			changes.push(`~ edge ${id}.style: ${o.style} -> ${e.style}`);
		if ((o.label ?? "") !== (e.label ?? ""))
			changes.push(`~ edge ${id}.label: -> ${JSON.stringify(e.label ?? "")}`);
	}
	if (a.name !== b.name) changes.push(`~ name: ${a.name} -> ${b.name}`);
	return changes;
}
