import type { Scheme, SchemeNode, SchemeZone } from "./types.ts";
import type { Issue } from "./types.ts";

// §4.1 mermaid: label ALWAYS double-quoted, `"` -> #quot; (else `Auth [JWT]` breaks mermaid)
export function escMermaid(label: string): string {
	return label.replace(/"/g, "#quot;");
}

// node size from label: the editor grows the box on newlines — md mirrors that
// (one mermaid line per \\n via <br/>) so exports match what you see.
export function nodeW(n: SchemeNode): number {
	if (n.w !== undefined) return n.w;
	if (n.shape === "circle") return Math.max(80, 24 + n.label.length * 7);
	const lines = n.label.split("\n");
	if (n.shape === "table") return 260; // fixed by cols; header may wrap, box does not
	return Math.max(120, 20 + Math.max(...lines.map((l) => l.length)) * 7);
}
export function nodeH(n: SchemeNode): number {
	if (n.h !== undefined) return n.h;
	if (n.shape === "circle") return nodeW(n);
	if (n.shape === "table") {
		const rows = (n.table?.rows?.length ?? 0) + 1;
		return 28 + Math.min(rows, 51) * 18;
	}
	const lines = n.label.split("\n");
	return Math.max(40, lines.length * 14 + 12);
}

function nodeDecl(n: Scheme["nodes"][number]): string {
	const l = escMermaid(n.label).replace(/\n/g, "<br/>");
	switch (n.shape) {
		case "circle":
			return `  ${n.id}(("${l}"))`;
		case "diamond":
			return `  ${n.id}{"${l}"}`;
		default:
			return `  ${n.id}["${l}"]`; // square | rect | table
	}
}

export function exportMermaid(s: Scheme): string {
	const lines = ["flowchart TD"];
	// zones -> mermaid subgraphs (dashed if the zone border is dashed in the editor)
	const zoneOf = new Map<string, string>();
	for (const z of s.zones ?? []) {
		const members = (s.nodes ?? [])
			.filter((n) => inZone(z, n.x, n.y))
			.map((n) => n.id);
		for (const id of members) zoneOf.set(id, z.id);
		lines.push(`  subgraph ${z.id}["${escMermaid(z.label)}"]`);
		lines.push("  direction TB");
		for (const id of members) {
			const n = (s.nodes ?? []).find((x) => x.id === id)!;
			lines.push("  " + nodeDecl(n).trimStart());
		}
		lines.push("  end");
	}
	for (const n of s.nodes ?? []) {
		if (!zoneOf.has(n.id)) lines.push(nodeDecl(n));
	}
	for (const e of s.edges ?? []) {
		const arrow = e.style === "dashed" ? "-.->" : "-->";
		const label = e.label ? `|"${escMermaid(e.label)}"|` : "";
		lines.push(`  ${e.from} ${arrow}${label} ${e.to}`);
	}
	return lines.join("\n");
}

// geometric membership: node center inside zone rect
function inZone(z: SchemeZone, x: number, y: number): boolean {
	return x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;
}

function escTd(v: unknown): string {
	return String(v ?? "")
		.replace(/\|/g, "\\|")
		.replace(/\n/g, " ");
}

export function exportMd(s: Scheme, issues: { warnings: Issue[] }): string {
	const d = new Date().toISOString();
	const L: string[] = [];
	L.push(`# ${s.name}`, "");
	L.push(`rev: ${s.rev} · updated: ${d} · generator: ${s.meta.generator}`, "");
	L.push("## Diagram", "", "```mermaid", exportMermaid(s), "```", "");
	L.push(
		"## Nodes",
		"",
		"| id | shape | label | refs | description |",
		"|---|---|---|---|---|",
	);
	for (const n of s.nodes ?? []) {
		L.push(
			`| ${n.id} | ${n.shape} | ${escTd(n.label)} | ${escTd((n.refs ?? []).join(", "))} | ${escTd(n.description ?? "")} |`,
		);
		if (n.shape === "table" && n.table) {
			const cols = n.table.cols ?? [];
			if (cols.length)
				L.push(``, `**${n.id} columns:** ${escTd(cols.join(" · "))}`);
			for (const row of n.table.rows ?? [])
				L.push(`> ${n.id} | ${row.map((c) => escTd(c)).join(" | ")} |`);
		}
	}
	L.push(
		"",
		"## Edges",
		"",
		"| id | from | to | style | label | description |",
		"|---|---|---|---|---|---|",
	);
	for (const e of s.edges ?? []) {
		L.push(
			`| ${e.id} | ${e.from} | ${e.to} | ${e.style} | ${escTd(e.label ?? "")} | ${escTd(e.description ?? "")} |`,
		);
	}
	if (s.zones?.length) {
		L.push(
			"",
			"## Zones",
			"",
			"| id | label | description | nodes |",
			"|---|---|---|---|",
		);
		for (const z of s.zones) {
			const members = (s.nodes ?? [])
				.filter((n) => inZone(z, n.x, n.y))
				.map((n) => n.id)
				.join(", ");
			L.push(
				`| ${z.id} | ${escTd(z.label)} | ${escTd(z.description ?? "")} | ${members} |`,
			);
		}
	}
	// §4.1 Sync block — generated "what to check"
	L.push("", "## Sync", "");
	if (issues.warnings.length) {
		for (const w of issues.warnings) L.push(`- [${w.code}] ${w.message}`);
	} else {
		L.push("_No warnings._");
	}
	L.push("");
	return L.join("\n");
}
