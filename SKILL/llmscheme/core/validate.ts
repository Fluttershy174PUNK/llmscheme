import {
	SHAPES,
	EDGE_STYLES,
	SIDES,
	SUPPORTED_VERSION,
	MAX_TABLE_COLS,
	MAX_TABLE_ROWS,
	type Scheme,
	type Validation,
	type Issue,
} from "./types.ts";

// Errors forbid the write, warnings don't. Pure — the same in CLI, browser and
// server, which is what keeps all three consumers in agreement.
//
// Structure first, content second: nodes/edges/meta must exist and be the right
// kind BEFORE anything reads them. Skipping this is how v1 accepted
// `{"nodes": null}` — it validated clean, got saved, and every later read of
// that scheme died with a 500 (the scheme was broken permanently).
export function validate(s: Scheme): Validation {
	const errors: Issue[] = [];
	const warnings: Issue[] = [];
	const err = (code: string, message: string, id?: string) =>
		errors.push({ level: "error", code, message, id });
	const warn = (code: string, message: string, id?: string) =>
		warnings.push({ level: "warn", code, message, id });

	// --- top level
	if (!s || typeof s !== "object" || Array.isArray(s)) {
		err("scheme", "scheme must be an object");
		return { errors, warnings };
	}
	if (s.format !== "block-llm")
		err("format", `format must be "block-llm", got ${JSON.stringify(s.format)}`);
	if (!Number.isInteger(s.version) || s.version < 1)
		err("version", `bad version ${JSON.stringify(s.version)}`);
	else if (s.version > SUPPORTED_VERSION)
		err(
			"version",
			`scheme version ${s.version} > supported ${SUPPORTED_VERSION}, update the skill`,
		);
	if (!Number.isInteger(s.rev) || s.rev < 0) err("rev", `bad rev ${JSON.stringify(s.rev)}`);
	if (!s.name || typeof s.name !== "string") err("name", "name is required");

	// --- required containers: must be present AND be arrays
	const nodesOk = Array.isArray(s.nodes);
	const edgesOk = Array.isArray(s.edges);
	if (!nodesOk) err("nodes", `nodes must be an array, got ${JSON.stringify(s.nodes)}`);
	if (!edgesOk) err("edges", `edges must be an array, got ${JSON.stringify(s.edges)}`);
	if (s.zones !== undefined && !Array.isArray(s.zones))
		err("zones", `zones must be an array, got ${JSON.stringify(s.zones)}`);

	// --- meta: writers bump meta.updatedAt and meta.nextId on every save
	if (!s.meta || typeof s.meta !== "object" || Array.isArray(s.meta)) {
		err("meta", "meta object is required (updatedAt, generator, nextId)");
	} else {
		if (typeof s.meta.updatedAt !== "string" || !s.meta.updatedAt)
			err("meta", "meta.updatedAt must be a non-empty string");
		if (!["agent", "human-editor", "human-json"].includes(s.meta.generator))
			err(
				"meta",
				`meta.generator must be agent|human-editor|human-json, got ${JSON.stringify(s.meta.generator)}`,
			);
		const nid = s.meta.nextId;
		if (!nid || typeof nid !== "object" || !Number.isInteger(nid.n) || !Number.isInteger(nid.e))
			err("meta", "meta.nextId must be {n: int, e: int}");
	}

	if (s.project === undefined) {
		// optional in v2: the service stores schemes without a project root
	} else if (
		!s.project ||
		typeof s.project !== "object" ||
		typeof s.project.root !== "string" ||
		!Array.isArray(s.project.codePaths)
	) {
		err("project", "project must be {root: string, codePaths: string[]}");
	}

	const nodes = nodesOk ? s.nodes : [];
	const edges = edgesOk ? s.edges : [];

	// --- nodes
	// id -> label for nodes that passed the object check (label feeds the orphan
	// warning without a second O(n) scan)
	const seen = new Map<string, string>();
	for (const n of nodes) {
		if (!n || typeof n !== "object" || Array.isArray(n)) {
			err("node", `node must be an object, got ${JSON.stringify(n)}`);
			continue;
		}
		if (typeof n.id !== "string" || !n.id) {
			err("id", "node without id");
			continue;
		}
		if (seen.has(n.id)) err("dup-id", `duplicate id ${n.id}`, n.id);
		seen.set(n.id, n.label);
		if (!SHAPES.includes(n.shape))
			err("shape", `node ${n.id}: unknown shape ${JSON.stringify(n.shape)}`, n.id);
		if (typeof n.label !== "string" || !n.label.trim())
			warn("label", `node ${n.id}: empty label`, n.id);
		if (n.description !== undefined && typeof n.description !== "string")
			err("desc", `node ${n.id}: description must be a string`, n.id);
		if (!Number.isFinite(n.x) || !Number.isFinite(n.y))
			err("coords", `node ${n.id}: x/y must be numbers`, n.id);
		// resize overrides: a bad w/h silently collapsed boxes in the editor
		if (n.w !== undefined && (!Number.isFinite(n.w) || n.w < 20))
			err("size", `node ${n.id}: w must be a number ≥ 20`, n.id);
		if (n.h !== undefined && (!Number.isFinite(n.h) || n.h < 20))
			err("size", `node ${n.id}: h must be a number ≥ 20`, n.id);
		if (n.refs !== undefined) {
			if (!Array.isArray(n.refs) || n.refs.some((r) => typeof r !== "string")) {
				err("refs", `node ${n.id}: refs must be string[]`, n.id);
			}
		}
		if (n.table !== undefined) {
			const t = n.table as Record<string, unknown>;
			if (typeof t !== "object" || t === null || Array.isArray(t)) {
				err("table", `node ${n.id}: table must be an object`, n.id);
			} else {
				if (t.cols !== undefined) {
					if (!Array.isArray(t.cols) || t.cols.some((c) => typeof c !== "string"))
						err("table", `node ${n.id}: table.cols must be string[]`, n.id);
					else if (t.cols.length > MAX_TABLE_COLS)
						err(
							"table",
							`node ${n.id}: table.cols max ${MAX_TABLE_COLS}, got ${t.cols.length}`,
							n.id,
						);
				}
				if (t.rows !== undefined) {
					if (
						!Array.isArray(t.rows) ||
						t.rows.some((r) => !Array.isArray(r) || r.some((c) => typeof c !== "string"))
					)
						err("table", `node ${n.id}: table.rows must be string[][]`, n.id);
					else if (t.rows.length > MAX_TABLE_ROWS)
						err(
							"table",
							`node ${n.id}: table.rows max ${MAX_TABLE_ROWS}, got ${t.rows.length}`,
							n.id,
						);
				}
				if (n.shape !== "table")
					warn("table", `node ${n.id}: table data on a non-table node is ignored`, n.id);
			}
		}
	}

	// --- edges
	const edgeIds = new Set<string>();
	const linked = new Set<string>(); // node ids touched by a valid edge
	for (const e of edges) {
		if (!e || typeof e !== "object" || Array.isArray(e)) {
			err("edge", `edge must be an object, got ${JSON.stringify(e)}`);
			continue;
		}
		if (typeof e.id !== "string" || !e.id) {
			err("id", "edge without id");
			continue;
		}
		if (edgeIds.has(e.id)) err("dup-id", `duplicate id ${e.id}`, e.id);
		edgeIds.add(e.id);
		if (!seen.has(e.from)) err("from", `edge ${e.id}: unknown from "${e.from}"`, e.id);
		if (!seen.has(e.to)) err("to", `edge ${e.id}: unknown to "${e.to}"`, e.id);
		if (!EDGE_STYLES.includes(e.style))
			err("style", `edge ${e.id}: unknown style ${JSON.stringify(e.style)}`, e.id);
		if (e.label !== undefined && typeof e.label !== "string")
			err("label", `edge ${e.id}: label must be a string`, e.id);
		if (e.description !== undefined && typeof e.description !== "string")
			err("desc", `edge ${e.id}: description must be a string`, e.id);
		if (e.fromSide !== undefined && !SIDES.includes(e.fromSide))
			err("side", `edge ${e.id}: bad fromSide ${JSON.stringify(e.fromSide)}`, e.id);
		if (e.toSide !== undefined && !SIDES.includes(e.toSide))
			err("side", `edge ${e.id}: bad toSide ${JSON.stringify(e.toSide)}`, e.id);
		linked.add(e.from);
		linked.add(e.to);
	}

	// --- zones
	const zoneIds = new Set<string>();
	for (const z of s.zones ?? []) {
		if (!z || typeof z !== "object" || Array.isArray(z)) {
			err("zone", `zone must be an object, got ${JSON.stringify(z)}`);
			continue;
		}
		if (typeof z.id !== "string" || !z.id) {
			err("id", "zone without id");
			continue;
		}
		if (zoneIds.has(z.id)) err("dup-id", `duplicate zone id ${z.id}`, z.id);
		zoneIds.add(z.id);
		if (typeof z.label !== "string" || !z.label.trim())
			warn("label", `zone ${z.id}: empty label`, z.id);
		if (z.description !== undefined && typeof z.description !== "string")
			err("desc", `zone ${z.id}: description must be a string`, z.id);
		if (![z.x, z.y, z.w, z.h].every(Number.isFinite))
			err("coords", `zone ${z.id}: x/y/w/h must be numbers`, z.id);
		else if (z.w <= 0 || z.h <= 0) err("coords", `zone ${z.id}: w/h must be positive`, z.id);
		if (z.labelSide !== undefined && ![...SIDES, "center"].includes(z.labelSide))
			err("side", `zone ${z.id}: bad labelSide ${JSON.stringify(z.labelSide)}`, z.id);
	}

	// --- orphans (warning only: a lone box is legal, just suspicious)
	// iterates `seen`, not `nodes`: junk entries were already reported above and
	// have no id to read
	for (const [id, label] of seen)
		if (!linked.has(id)) warn("orphan", `node ${id} ("${label}") has no edges`, id);
	return { errors, warnings };
}

// refs freshness — needs a filesystem, injected as a checker so this stays pure.
export function checkRefs(s: Scheme, exists: (rel: string) => boolean): Issue[] {
	const out: Issue[] = [];
	for (const n of Array.isArray(s.nodes) ? s.nodes : []) {
		for (const ref of n.refs ?? []) {
			if (!exists(ref))
				out.push({
					level: "warn",
					code: "stale-ref",
					message: `node ${n.id}: ref "${ref}" does not exist`,
					id: n.id,
				});
		}
	}
	return out;
}
