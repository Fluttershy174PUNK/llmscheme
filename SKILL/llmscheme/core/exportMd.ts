import type { Scheme, SchemeNode, SchemeZone, Issue } from "./types.ts";
import { nodeW, nodeH } from "./geometry.ts";

export { nodeW, nodeH };

// mermaid: label ALWAYS double-quoted, `"` -> #quot; (else `Auth [JWT]` breaks mermaid)
export function escMermaid(label: string): string {
	return (label ?? "").replace(/"/g, "#quot;");
}

function nodeDecl(n: SchemeNode): string {
	const l = escMermaid(n.label).replace(/\n/g, "<br/>");
	switch (n.shape) {
		case "circle":
			return `${n.id}(("${l}"))`;
		case "diamond":
			return `${n.id}{"${l}"}`;
		default:
			return `${n.id}["${l}"]`; // square | rect | table | ellipse (mermaid has no oval)
	}
}

// geometric membership: node center inside zone rect
function inZone(z: SchemeZone, x: number, y: number): boolean {
	return x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;
}

export function exportMermaid(s: Scheme): string {
	const lines = ["flowchart TD"];
	const zoneOf = new Map<string, string>();
	for (const z of s.zones ?? []) {
		const members = (s.nodes ?? [])
			.filter((n) => inZone(z, n.x + nodeW(n) / 2, n.y + nodeH(n) / 2))
			.map((n) => n.id);
		for (const id of members) zoneOf.set(id, z.id);
		lines.push(`  subgraph ${z.id}["${escMermaid(z.label)}"]`, "  direction TB");
		for (const id of members) lines.push(`  ${nodeDecl(s.nodes.find((x) => x.id === id)!)}`);
		lines.push("  end");
	}
	for (const n of s.nodes ?? []) if (!zoneOf.has(n.id)) lines.push(`  ${nodeDecl(n)}`);
	for (const e of s.edges ?? []) {
		const arrow = e.style === "dashed" ? "-.->" : "-->";
		const label = e.label ? `|"${escMermaid(e.label)}"|` : "";
		lines.push(`  ${e.from} ${arrow}${label} ${e.to}`);
	}
	return lines.join("\n");
}

function escTd(v: unknown): string {
	return String(v ?? "")
		.replace(/\|/g, "\\|")
		.replace(/\n/g, " ");
}

// Deterministic: every field comes from the scheme, none from the clock.
// v1 stamped `new Date()` here, so `render` twice produced two different files
// and SCHEME.md churned in git on every touch.
export function exportMd(s: Scheme, issues: { warnings: Issue[] }): string {
	const L: string[] = [];
	L.push(
		`# ${s.name}`,
		"",
		`rev: ${s.rev} · updated: ${s.meta?.updatedAt ?? "?"} · generator: ${s.meta?.generator ?? "?"}`,
		"",
		"## Diagram",
		"",
		"```mermaid",
		exportMermaid(s),
		"```",
		"",
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
			if (cols.length) L.push("", `**${n.id} columns:** ${escTd(cols.join(" · "))}`);
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
	for (const e of s.edges ?? [])
		L.push(
			`| ${e.id} | ${e.from} | ${e.to} | ${e.style} | ${escTd(e.label ?? "")} | ${escTd(e.description ?? "")} |`,
		);
	if (s.zones?.length) {
		L.push("", "## Zones", "", "| id | label | description | nodes |", "|---|---|---|---|");
		for (const z of s.zones) {
			const members = (s.nodes ?? [])
				.filter((n) => inZone(z, n.x + nodeW(n) / 2, n.y + nodeH(n) / 2))
				.map((n) => n.id)
				.join(", ");
			L.push(`| ${z.id} | ${escTd(z.label)} | ${escTd(z.description ?? "")} | ${members} |`);
		}
	}
	L.push("", "## Sync", "");
	if (issues.warnings.length) for (const w of issues.warnings) L.push(`- [${w.code}] ${w.message}`);
	else L.push("_No warnings._");
	L.push("");
	return L.join("\n");
}
