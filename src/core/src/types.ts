export const FORMAT = "block-llm";
export const SUPPORTED_VERSION = 1;

export type Shape = "circle" | "diamond" | "square" | "rect" | "table";
export type EdgeStyle = "solid" | "dashed";
export type Generator = "agent" | "human-editor" | "human-json";

export const SHAPES: readonly Shape[] = [
	"circle",
	"diamond",
	"square",
	"rect",
	"table",
];
export const EDGE_STYLES: readonly EdgeStyle[] = ["solid", "dashed"];

// table shape: a box with a header + up to 10 columns x 50 rows.
// rows[*] length may be < cols (missing cells render empty).
export interface TableSpec {
	cols?: string[]; // column headers, max 10
	rows?: string[][]; // data rows, max 50
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
	// explicit size override (editor resize handles); core auto-sizes from
	// label when absent. undefined = auto.
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

export type Side = "top" | "bottom" | "left" | "right";
export const SIDES: readonly Side[] = ["top", "bottom", "left", "right"];

// dashed container drawn behind nodes; membership = geometric containment
export interface SchemeZone {
	id: string;
	label: string;
	description?: string;
	x: number;
	y: number;
	w: number;
	h: number;
	labelSide?: "top" | "bottom" | "left" | "right" | "center"; // editor label placement
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
	meta: {
		updatedAt: string;
		generator: Generator;
		nextId: { n: number; e: number };
		editor?: { rev: number; savedAt: string };
		[k: string]: unknown;
	};
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
