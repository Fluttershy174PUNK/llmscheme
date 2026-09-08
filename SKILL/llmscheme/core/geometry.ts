import type { SchemeNode } from "./types.ts";

// Single source of truth for box geometry.
//
// v1 kept two copies: the editor wrapped labels at 34 chars to fit the box,
// the core measured the raw label — so mermaid/SCHEME.md disagreed with what
// the canvas showed. Both the editor and exportMd import from here.

export const WRAP_AT = 34;
export const MIN_W = 120;
export const MIN_H = 40;
export const CHAR_W = 7;
export const LINE_H = 14;
// table: fixed column width + header row height
export const TABLE_COL_W = 64;
export const TABLE_MIN_W = 160;
export const TABLE_ROW_H = 18;
export const TABLE_HEAD_H = 28;

// wrap each explicit newline to ~WRAP_AT chars so long labels fit the box
export function wrapLines(label: string): string[] {
	const out: string[] = [];
	for (const raw of (label ?? "").split("\n")) {
		if (raw.length <= WRAP_AT) {
			out.push(raw);
			continue;
		}
		let cur = "";
		for (const word of raw.split(" ")) {
			if (cur && (cur + " " + word).length > WRAP_AT) {
				out.push(cur);
				cur = word;
			} else cur = cur ? `${cur} ${word}` : word;
		}
		if (cur) out.push(cur);
	}
	return out.length ? out : [""];
}

// an explicit n.w/n.h (editor resize handles) always wins over the label estimate
export function nodeW(n: SchemeNode): number {
	if (typeof n.w === "number" && Number.isFinite(n.w)) return n.w;
	if (n.shape === "table") {
		const cols = Math.max(1, n.table?.cols?.length ?? 1);
		return Math.max(TABLE_MIN_W, 26 + cols * TABLE_COL_W);
	}
	if (n.shape === "circle") {
		const [first = ""] = wrapLines(n.label);
		return Math.max(80, 24 + first.length * CHAR_W);
	}
	const widest = Math.max(...wrapLines(n.label).map((l) => l.length));
	return Math.max(MIN_W, 20 + widest * CHAR_W);
}

export function nodeH(n: SchemeNode): number {
	if (typeof n.h === "number" && Number.isFinite(n.h)) return n.h;
	if (n.shape === "table") {
		const rows = Math.min(n.table?.rows?.length ?? 0, 50) + 1;
		return TABLE_HEAD_H + rows * TABLE_ROW_H;
	}
	if (n.shape === "circle") return nodeW(n);
	return Math.max(MIN_H, wrapLines(n.label).length * LINE_H + 12);
}
