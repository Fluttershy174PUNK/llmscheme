export const FORMAT = "block-llm";
export const SUPPORTED_VERSION = 1;

export type Shape = "circle" | "ellipse" | "diamond" | "square" | "rect" | "table";
export type EdgeStyle = "solid" | "dashed";
export type Generator = "agent" | "human-editor" | "human-json";
export type Side = "top" | "bottom" | "left" | "right";

export const SHAPES: readonly Shape[] = ["circle", "ellipse", "diamond", "square", "rect", "table"];
export const EDGE_STYLES: readonly EdgeStyle[] = ["solid", "dashed"];
export const SIDES: readonly Side[] = ["top", "bottom", "left", "right"];

// table shape: header + up to 10 columns x 50 rows.
// rows[*] may be shorter than cols (missing cells render empty).
export interface TableSpec {
	cols?: string[];
	rows?: string[][];
}

export const MAX_TABLE_COLS = 10;
export const MAX_TABLE_ROWS = 50;

export interface SchemeNode {
	id: string;
	shape: Shape;
	label: string;
	description?: string;
	x: number;
	y: number;
	// explicit size override (editor resize handles); auto-sized from the label when absent
	w?: number;
	h?: number;
	refs?: string[];
	table?: TableSpec;
	[k: string]: unknown;
}

export interface SchemeEdge {
	id: string;
	from: string;
	to: string;
	style: EdgeStyle;
	label?: string;
	description?: string;
	fromSide?: Side;
	toSide?: Side;
	[k: string]: unknown;
}

// dashed container drawn behind nodes; membership = geometric containment
export interface SchemeZone {
	id: string;
	label: string;
	description?: string;
	x: number;
	y: number;
	w: number;
	h: number;
	labelSide?: Side | "center";
	[k: string]: unknown;
}

export interface SchemeMeta {
	updatedAt: string;
	generator: Generator;
	nextId: { n: number; e: number };
	editor?: { rev: number; savedAt: string };
	[k: string]: unknown;
}

export interface Scheme {
	format: string;
	version: number;
	rev: number;
	name: string;
	project: { root: string; codePaths: string[] };
	nodes: SchemeNode[];
	edges: SchemeEdge[];
	zones?: SchemeZone[];
	meta: SchemeMeta;
	[k: string]: unknown;
}

export type Level = "error" | "warn";
export interface Issue {
	level: Level;
	code: string;
	message: string;
	id?: string;
}
export interface Validation {
	errors: Issue[];
	warnings: Issue[];
}

export interface JournalEntry {
	ts: string;
	actor: Generator;
	op: string;
	rev: number;
	summary: string;
}
