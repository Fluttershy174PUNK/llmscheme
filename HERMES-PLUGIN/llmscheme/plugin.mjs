#!/usr/bin/env node
// llmscheme hermes plugin (placeholder). v1 had only the manifest — the
// `.mjs` was missing, so the plugin never actually loaded. v2 ships a
// working entry that uses the same core as the CLI (read/update, CAS by
// rev, md/html exports). When the Hermes plugin spec is final we will
// implement the full surface; the operations below are the building blocks.
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	readRaw,
	validate,
	exportMd,
	saveSchema,
	addNode,
	addEdge,
	updateNode,
	removeNode,
	removeEdge,
	findProjectDir,
	DIR,
} from "../skill/core/index.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_CORE = path.join(HERE, "..", "skill", "core", "index.ts");

// The plugin runs in the host process; the imports above are the SAME
// functions the CLI uses, so a write through the plugin and a write
// through the CLI produce the same on-disk format (rev+1, atomic, CAS).
//
// v2 layout: the skill lives at SKILL/llmscheme/ (not skill/).
// The core files are a verbatim copy of src/core/ synced by
// `npm run sync-skill`, so the relative import path is unchanged.

function resolveProject() {
	const hits = findProjectDir(process.cwd());
	if (hits.length === 1) return hits[0];
	if (hits.length > 1) throw new Error(`multiple .block_llm/ found, pick one: ${hits.join(", ")}`);
	throw new Error("no .block_llm/ found");
}

export const plugin = {
	// Hermes plugin surface is not yet stable; these are the operations the
	// skill already supports, exported under the names any spec will likely
	// want.
	async get() {
		const root = resolveProject();
		const s = readRaw(root);
		const v = validate(s);
		return { ok: true, scheme: s, errors: v.errors, warnings: v.warnings };
	},
	async nodeAdd(input) {
		const root = resolveProject();
		const s = readRaw(root);
		const n = addNode(s, input);
		saveSchema(root, s, {
			journal: { actor: "agent", op: "node.add", summary: `node ${n.id} "${n.label}"` },
		});
		return { ok: true, id: n.id, rev: s.rev };
	},
	async nodeUpdate(id, patch) {
		const root = resolveProject();
		const s = readRaw(root);
		const n = updateNode(s, id, patch);
		saveSchema(root, s, {
			journal: { actor: "agent", op: "node.update", summary: `node ${n.id}` },
		});
		return { ok: true, id: n.id, rev: s.rev };
	},
	async nodeRemove(id) {
		const root = resolveProject();
		const s = readRaw(root);
		removeNode(s, id);
		saveSchema(root, s, {
			journal: { actor: "agent", op: "node.remove", summary: `node ${id}` },
		});
		return { ok: true, rev: s.rev };
	},
	async edgeAdd(input) {
		const root = resolveProject();
		const s = readRaw(root);
		const e = addEdge(s, input);
		saveSchema(root, s, {
			journal: { actor: "agent", op: "edge.add", summary: `edge ${e.id} ${e.from}->${e.to}` },
		});
		return { ok: true, id: e.id, rev: s.rev };
	},
	async edgeRemove(id) {
		const root = resolveProject();
		const s = readRaw(root);
		removeEdge(s, id);
		saveSchema(root, s, {
			journal: { actor: "agent", op: "edge.remove", summary: `edge ${id}` },
		});
		return { ok: true, rev: s.rev };
	},
	async md() {
		const root = resolveProject();
		const s = readRaw(root);
		return { ok: true, markdown: exportMd(s, validate(s)), rev: s.rev };
	},
};

export default plugin;
void SKILL_CORE;
void DIR;
