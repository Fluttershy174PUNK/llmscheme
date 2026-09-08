import type {
	Scheme,
	SchemeEdge,
	SchemeNode,
	SchemeZone,
	EdgeStyle,
	Shape,
	Side,
	TableSpec,
} from "./types.ts";
import { consumeEdgeId, consumeNodeId, consumeZoneId } from "./ids.ts";
import { autoLayout } from "./layout.ts";
import { DataError } from "./errors.ts";

// The ONE implementation of scheme mutations.
//
// v1 spelled each of these out three times — once in the CLI, once in the REST
// routes, once in the MCP handler — and the copies drifted (the service core
// ended up without w/h validation, so it accepted {"w":5,"h":-3}). Pure
// functions over a Scheme, so CLI, REST, MCP and the editor all share them and
// validation stays the single gate.

export interface NodePatch {
	label?: string;
	shape?: Shape;
	description?: string;
	x?: number;
	y?: number;
	w?: number;
	h?: number;
	refs?: string[];
	table?: TableSpec;
}
export interface NodeInput extends NodePatch {
	label: string;
	id?: string;
}
export interface EdgePatch {
	from?: string;
	to?: string;
	style?: EdgeStyle;
	label?: string;
	description?: string;
	fromSide?: Side;
	toSide?: Side;
}
export interface EdgeInput extends EdgePatch {
	from: string;
	to: string;
	id?: string;
}
export interface ZonePatch {
	label?: string;
	description?: string;
	x?: number;
	y?: number;
	w?: number;
	h?: number;
	labelSide?: Side | "center";
}
export interface ZoneInput extends ZonePatch {
	x: number;
	y: number;
	w: number;
	h: number;
	id?: string;
	label?: string;
}

// `undefined` means "leave alone" everywhere below: JSON payloads cannot tell
// absent from undefined, and PATCH semantics are what all four callers want.
// AnyPatch (not Record<string, unknown>) because the inputs are declared
// interfaces without an index signature.
type AnyPatch = NodeInput | NodePatch | EdgeInput | EdgePatch | ZoneInput | ZonePatch;

function assign<T extends object>(target: T, patch: AnyPatch) {
	for (const [k, v] of Object.entries(patch))
		if (v !== undefined) (target as Record<string, unknown>)[k] = v;
}

function findNode(s: Scheme, id: string): SchemeNode {
	const n = s.nodes.find((x) => x.id === id);
	if (!n) throw new DataError(`node ${id} not found`);
	return n;
}
function findEdge(s: Scheme, id: string): SchemeEdge {
	const e = s.edges.find((x) => x.id === id);
	if (!e) throw new DataError(`edge ${id} not found`);
	return e;
}
function findZone(s: Scheme, id: string): SchemeZone {
	const z = (s.zones ?? []).find((x) => x.id === id);
	if (!z) throw new DataError(`zone ${id} not found`);
	return z;
}

export function addNode(s: Scheme, input: NodeInput): SchemeNode {
	if (!input.label) throw new DataError("label required");
	const placed = Number.isFinite(input.x) && Number.isFinite(input.y);
	const node = {
		id: input.id ?? consumeNodeId(s),
		shape: "rect",
	} as SchemeNode;
	assign(node, input);
	// assign() skipped the undefined id, so the consumed one survives
	s.nodes.push(node);
	// no coords -> the deterministic layout decides (same graph, same layout)
	if (!placed) autoLayout(s);
	return node;
}

export function updateNode(s: Scheme, id: string, patch: NodePatch): SchemeNode {
	const n = findNode(s, id);
	assign(n, patch);
	return n;
}

// removing a node also removes every edge that touched it
export function removeNode(s: Scheme, id: string): void {
	const i = s.nodes.findIndex((n) => n.id === id);
	if (i < 0) throw new DataError(`node ${id} not found`);
	s.nodes.splice(i, 1);
	s.edges = s.edges.filter((e) => e.from !== id && e.to !== id);
}

export function addEdge(s: Scheme, input: EdgeInput): SchemeEdge {
	if (!input.from || !input.to) throw new DataError("from/to required");
	const edge = {
		id: input.id ?? consumeEdgeId(s),
		from: input.from,
		to: input.to,
		style: input.style ?? "solid",
	} as SchemeEdge;
	assign(edge, input);
	s.edges.push(edge);
	return edge;
}

export function updateEdge(s: Scheme, id: string, patch: EdgePatch): SchemeEdge {
	const e = findEdge(s, id);
	assign(e, patch);
	return e;
}

export function removeEdge(s: Scheme, id: string): void {
	const i = s.edges.findIndex((e) => e.id === id);
	if (i < 0) throw new DataError(`edge ${id} not found`);
	s.edges.splice(i, 1);
}

export function addZone(s: Scheme, input: ZoneInput): SchemeZone {
	if (![input.x, input.y, input.w, input.h].every(Number.isFinite))
		throw new DataError("zone requires numeric x/y/w/h");
	const zone = {
		id: input.id ?? consumeZoneId(s),
		label: input.label ?? "zone",
		x: input.x,
		y: input.y,
		w: input.w,
		h: input.h,
	} as SchemeZone;
	assign(zone, input);
	s.zones ??= [];
	s.zones.push(zone);
	return zone;
}

export function updateZone(s: Scheme, id: string, patch: ZonePatch): SchemeZone {
	const z = findZone(s, id);
	assign(z, patch);
	return z;
}

export function removeZone(s: Scheme, id: string): void {
	const zones = s.zones ?? [];
	const i = zones.findIndex((z) => z.id === id);
	if (i < 0) throw new DataError(`zone ${id} not found`);
	zones.splice(i, 1);
}
