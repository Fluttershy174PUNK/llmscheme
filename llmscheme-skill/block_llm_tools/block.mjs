#!/usr/bin/env node
// block-llm CLI — the single entry point (§5).
// Self-locates core.mjs and editor-template.gen.html via import.meta.url (§2):
// works from any cwd, no npm install, no network.
// Exit codes: 0 ok / 1 data error or CAS conflict / 2 usage error.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	validate,
	checkRefs,
	emptyScheme,
	consumeNodeId,
	consumeEdgeId,
	consumeZoneId,
	autoLayout,
	exportMd,
	renderHtml,
	readRaw,
	saveSchema,
	CasError,
	ValidationError,
	DataError,
	PathJailError,
	findProjectDir,
	diffSchemes,
	DIR,
	ensureGitignoreLine,
	ensureAgentsSection,
} from "../block_llm_core/core.mjs";

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url)); // .../block_llm_tools
const CORE_DIR = path.join(path.dirname(TOOLS_DIR), "block_llm_core"); // .../block_llm_core

function usage(code = 2, msg = "") {
	const p = (s) => process.stderr.write(s + "\n");
	if (msg) p(`error: ${msg}`);
	p(`usage: block.mjs <command> [project] [options]

commands:
  init [project] [--name N]        set up .block_llm/ + SCHEME.md + .gitignore line
  get [project] [--json]           print scheme summary
  validate [project] [--json]      errors / warnings / stale refs
  node add|update|remove [...]     --id --shape --label --desc --x --y --ref
                                   --table-cols "a,b,c" --table-rows "r1c1|r1c2;r2c1|r2c2"
  edge add|update|remove [...]     --id --from --to --style --label --desc --from-side --to-side
  zone add|update|remove [...]     --id --label --desc --x --y --w --h --label-side
  put <file|->                     write whole scheme (stdin ok)
  sync [project] [--from FILE]     re-read json -> rebuild SCHEME.md + scheme.html
  render [project] [--md|--html]   regenerate exports without changing the scheme
  diff [project] [--rev N]         what changed since revision N
  history [project] [--limit N]    journal + autosave list
  restore [project] --rev N        roll back to rev N (as a new write)
  doctor [project]                 self-check structure/consistency/budget
  upgrade [project]                migrate scheme format (currently a check)
  version                          print skill + format version

global options:
  --rev N      expected revision for CAS (write commands)
  --json       machine-readable output
  --actor NAME agent|human-json (default agent)
`);
	process.exit(code);
}

// ---------- arg parsing ----------
function parseArgs(argv) {
	const flags = {};
	const rest = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--json") flags.json = true;
		else if (a === "--name") flags.name = argv[++i];
		else if (a === "--id") flags.id = argv[++i];
		else if (a === "--shape") flags.shape = argv[++i];
		else if (a === "--label") flags.label = argv[++i];
		else if (a === "--desc") flags.desc = argv[++i];
		else if (a === "--x") flags.x = Number(argv[++i]);
		else if (a === "--y") flags.y = Number(argv[++i]);
		else if (a === "--ref") (flags.refs ??= []).push(argv[++i]);
		else if (a === "--table-cols") flags.tableCols = argv[++i];
		else if (a === "--table-rows") flags.tableRows = argv[++i];
		else if (a === "--actor") flags.actor = argv[++i];
		else if (a === "--from") flags.from = argv[++i];
		else if (a === "--to") flags.to = argv[++i];
		else if (a === "--style") flags.style = argv[++i];
		else if (a === "--w") flags.w = Number(argv[++i]);
		else if (a === "--h") flags.h = Number(argv[++i]);
		else if (a === "--label-side") flags.labelSide = argv[++i];
		else if (a === "--from-side") flags.fromSide = argv[++i];
		else if (a === "--to-side") flags.toSide = argv[++i];
		else if (a === "--rev") flags.rev = Number(argv[++i]);
		else if (a === "--limit") flags.limit = Number(argv[++i]);
		else if (a === "--md") flags.md = true;
		else if (a === "--html") flags.html = true;
		else if (a === "--") {
			rest.push(...argv.slice(i + 1));
			break;
		} else if (a.startsWith("--")) usage(2, `unknown flag ${a}`);
		else rest.push(a);
	}
	return { flags, rest };
}

const { flags, rest } = parseArgs(process.argv.slice(2));
const [cmd, ...positional] = rest;

// ---------- project resolution ----------
// (a) explicit path wins; (b) search only UPWARD from cwd; (c) stop at git root;
// (d) multiple candidates -> ask, never silently pick (§10).
function resolveProject(explicit) {
	if (explicit) {
		const abs = path.resolve(explicit);
		if (!fs.existsSync(path.join(abs, DIR, "scheme.json"))) {
			// init creates it; other commands need it
			return abs;
		}
		return abs;
	}
	const hits = findProjectDir(process.cwd());
	if (hits.length === 1) return hits[0];
	if (hits.length > 1) {
		process.stderr.write(
			`multiple .block_llm/ projects found, specify one:\n` +
				hits.map((h) => `  ${h}`).join("\n") +
				"\n",
		);
		process.exit(2);
	}
	process.stderr.write(`no .block_llm/ found from ${process.cwd()} upward\n`);
	process.exit(2);
}

function readVersion() {
	try {
		const text = fs.readFileSync(path.join(CORE_DIR, "VERSION"), "utf8");
		const v = {};
		for (const line of text.split("\n")) {
			const m = line.match(/^(\w+):\s*(.+)$/);
			if (m) v[m[1]] = m[2].trim();
		}
		return v;
	} catch {
		return {};
	}
}

// editor-template.gen.html next to core.mjs; if the caller passed the html content
// (browser build), it goes through opts.html.
function templatePath() {
	const p = path.join(CORE_DIR, "editor-template.gen.html");
	if (!fs.existsSync(p)) return null;
	return p;
}

function generateHtml(scheme) {
	const tp = templatePath();
	if (!tp) return null;
	return renderHtml(fs.readFileSync(tp, "utf8"), scheme);
}

function out(obj, human) {
	if (flags.json) process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
	else if (human !== undefined) process.stdout.write(human);
}

// ---------- shared: write with exports regeneration (§4.3) ----------
// --rev N = expected on-disk rev (CAS, §5): checked here against the freshly
// read scheme; saveSchema enforces payload-vs-disk equality for put/restore.
// SCHEME.md is regenerated by the core; html via callback so it embeds the
// FINAL rev (scheme object is bumped by saveSchema before the callback runs).
function writeScheme(root, scheme, actor, op, summary, casCheck = true) {
	if (casCheck && flags.rev !== undefined && flags.rev !== scheme.rev) {
		throw new CasError(flags.rev, scheme.rev);
	}
	return saveSchema(root, scheme, {
		extraFiles: (final) => {
			const html = generateHtml(final);
			return html === null ? {} : { [path.join(DIR, "scheme.html")]: html };
		},
		journal: { actor, op, summary },
	});
}

function staleRefs(root, scheme) {
	return checkRefs(scheme, (rel) => {
		try {
			fs.statSync(path.resolve(root, rel));
			return true;
		} catch {
			return false;
		}
	});
}

// fs.statSync on a path user gave as an INPUT source (read-only, never written) — §9
function readInputFile(p) {
	const abs = p === "-" ? null : path.resolve(p);
	const text = abs ? fs.readFileSync(abs, "utf8") : fs.readFileSync(0, "utf8");
	return text;
}

function parseJson(text, source) {
	try {
		return JSON.parse(text);
	} catch (e) {
		throw new DataError(`invalid JSON in ${source}: ${e.message}`);
	}
}

// ---------- commands ----------
async function main() {
	switch (cmd) {
		case "version": {
			const v = readVersion();
			out(
				{ ok: true, skill: v.skill ?? "?", format: v.format ?? "?" },
				`block-llm skill ${v.skill ?? "?"} (format ${v.format ?? "?"})\n`,
			);
			return;
		}

		case "init": {
			const root = path.resolve(positional[0] ?? process.cwd());
			fs.mkdirSync(path.join(root, DIR, "cache"), { recursive: true });
			const file = path.join(root, DIR, "scheme.json");
			if (!fs.existsSync(file)) {
				const s = emptyScheme(flags.name ?? path.basename(root));
				writeScheme(root, s, flags.actor ?? "agent", "init", "init");
			}
			ensureGitignoreLine(root, `${DIR}/cache/`);
			const verFile = path.join(root, DIR, "VERSION");
			if (!fs.existsSync(verFile)) {
				fs.copyFileSync(path.join(CORE_DIR, "VERSION"), verFile);
			}
			ensureAgentsSection(root);
			out(
				{ ok: true, root, rev: readRaw(root).rev },
				`initialized ${path.join(root, DIR)} (rev ${readRaw(root).rev})\n`,
			);
			return;
		}

		case "get": {
			const root = resolveProject(positional[0]);
			const s = readRaw(root);
			const v = validate(s);
			const stale = staleRefs(root, s);
			out(
				{
					ok: true,
					rev: s.rev,
					name: s.name,
					nodes: s.nodes.length,
					edges: s.edges.length,
					warnings: [...v.warnings, ...stale].map((w) => w.message),
				},
				`${s.name} rev=${s.rev} nodes=${s.nodes.length} edges=${s.edges.length}\n` +
					[...v.warnings, ...stale].map((w) => `  warn: ${w.message}`).join("\n"),
			);
			return;
		}

		case "validate": {
			const root = resolveProject(positional[0]);
			const s = readRaw(root);
			const v = validate(s);
			const stale = staleRefs(root, s);
			const all = [...v.errors, ...v.warnings, ...stale];
			const ok = v.errors.length === 0;
			out(
				{ ok, rev: s.rev, errors: v.errors, warnings: [...v.warnings, ...stale] },
				(ok ? "OK" : "FAIL") +
					` (rev ${s.rev})\n` +
					all.map((i) => `  ${i.level}: ${i.message}`).join("\n") +
					"\n",
			);
			process.exit(ok ? 0 : 1);
			return; // explicit terminal statement (biome switch_case)
		}

		case "node": {
			const [action] = positional;
			const root = resolveProject(positional[1]);
			const s = readRaw(root);
			if (action === "add") {
				if (!flags.label) usage(2, "node add requires --label");
				const n = {
					id: flags.id ?? consumeNodeId(s),
					shape: flags.shape ?? "rect",
					label: flags.label,
					x: flags.x,
					y: flags.y,
				};
				if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) {
					// no coords -> let the deterministic layout place it
					delete n.x;
					delete n.y;
					s.nodes.push(n);
					autoLayout(s);
				} else {
					s.nodes.push(n);
				}
				if (flags.desc) n.description = flags.desc;
				if (flags.refs?.length) n.refs = flags.refs;
				if (flags.tableCols || flags.tableRows) {
					n.table = {};
					if (flags.tableCols)
						n.table.cols = flags.tableCols
							.split(",")
							.map((c) => c.trim())
							.filter(Boolean)
							.slice(0, 10);
					if (flags.tableRows)
						n.table.rows = flags.tableRows
							.split(";")
							.map((line) => line.split("|").map((c) => c.trim()))
							.slice(0, 50);
				}
				const r = writeScheme(
					root,
					s,
					flags.actor ?? "agent",
					"node.add",
					`node ${n.id} "${flags.label}"`,
				);
				out(
					{ ok: true, rev: r.rev, id: n.id },
					`added node ${n.id} (rev ${r.rev})\n`,
				);
			} else if (action === "update") {
				const n = s.nodes.find((n) => n.id === flags.id);
				if (!n) usage(2, `node ${flags.id} not found`);
				if (flags.label !== undefined) n.label = flags.label;
				if (flags.shape !== undefined) n.shape = flags.shape;
				if (flags.desc !== undefined) n.description = flags.desc;
				if (flags.x !== undefined) n.x = flags.x;
				if (flags.y !== undefined) n.y = flags.y;
				if (flags.refs !== undefined) n.refs = flags.refs;
				if (flags.tableCols !== undefined || flags.tableRows !== undefined) {
					n.table = n.table ?? {};
					if (flags.tableCols !== undefined)
						n.table.cols = flags.tableCols
							.split(",")
							.map((c) => c.trim())
							.filter(Boolean)
							.slice(0, 10);
					if (flags.tableRows !== undefined)
						n.table.rows = flags.tableRows
							.split(";")
							.map((line) => line.split("|").map((c) => c.trim()))
							.slice(0, 50);
				}
				const r = writeScheme(
					root,
					s,
					flags.actor ?? "agent",
					"node.update",
					`node ${flags.id}`,
				);
				out(
					{ ok: true, rev: r.rev, id: n.id },
					`updated node ${n.id} (rev ${r.rev})\n`,
				);
			} else if (action === "remove") {
				const i = s.nodes.findIndex((n) => n.id === flags.id);
				if (i < 0) usage(2, `node ${flags.id} not found`);
				s.nodes.splice(i, 1);
				s.edges = s.edges.filter((e) => e.from !== flags.id && e.to !== flags.id);
				const r = writeScheme(
					root,
					s,
					flags.actor ?? "agent",
					"node.remove",
					`node ${flags.id}`,
				);
				out({ ok: true, rev: r.rev }, `removed node ${flags.id} (rev ${r.rev})\n`);
			} else usage(2, "node: add | update | remove");
			return;
		}

		case "edge": {
			const [action] = positional;
			const root = resolveProject(positional[1]);
			const s = readRaw(root);
			if (action === "add") {
				if (!flags.from || !flags.to) usage(2, "edge add requires --from and --to");
				const e = {
					id: flags.id ?? consumeEdgeId(s),
					from: flags.from,
					to: flags.to,
					style: flags.style ?? "solid",
					label: flags.label,
					description: flags.desc,
					fromSide: flags.fromSide,
					toSide: flags.toSide,
				};
				if (e.label === undefined) delete e.label;
				if (e.description === undefined) delete e.description;
				if (e.fromSide === undefined) delete e.fromSide;
				if (e.toSide === undefined) delete e.toSide;
				s.edges.push(e);
				const r = writeScheme(
					root,
					s,
					flags.actor ?? "agent",
					"edge.add",
					`edge ${e.id} ${e.from}->${e.to}`,
				);
				out(
					{ ok: true, rev: r.rev, id: e.id },
					`added edge ${e.id} (rev ${r.rev})\n`,
				);
			} else if (action === "update") {
				const e = s.edges.find((e) => e.id === flags.id);
				if (!e) usage(2, `edge ${flags.id} not found`);
				if (flags.from !== undefined) e.from = flags.from;
				if (flags.to !== undefined) e.to = flags.to;
				if (flags.style !== undefined) e.style = flags.style;
				if (flags.label !== undefined) e.label = flags.label;
				if (flags.desc !== undefined) e.description = flags.desc;
				if (flags.fromSide !== undefined) e.fromSide = flags.fromSide;
				if (flags.toSide !== undefined) e.toSide = flags.toSide;
				const r = writeScheme(
					root,
					s,
					flags.actor ?? "agent",
					"edge.update",
					`edge ${flags.id}`,
				);
				out({ ok: true, rev: r.rev }, `updated edge ${flags.id} (rev ${r.rev})\n`);
			} else if (action === "remove") {
				const i = s.edges.findIndex((e) => e.id === flags.id);
				if (i < 0) usage(2, `edge ${flags.id} not found`);
				s.edges.splice(i, 1);
				const r = writeScheme(
					root,
					s,
					flags.actor ?? "agent",
					"edge.remove",
					`edge ${flags.id}`,
				);
				out({ ok: true, rev: r.rev }, `removed edge ${flags.id} (rev ${r.rev})\n`);
			} else usage(2, "edge: add | update | remove");
			return;
		}

		case "put": {
			const fileArg = positional[0];
			if (!fileArg) usage(2, "put requires <file|->");
			// file arg is an INPUT source (§9), never a project path
			const root = positional[1]
				? path.resolve(positional[1])
				: resolveProject(undefined);
			const s = parseJson(readInputFile(fileArg), fileArg);
			// §5 CAS: without --rev the disk rev wins (payload.rev is stale by definition);
			// with --rev it must match disk, else conflict.
			const current = readRaw(root);
			if (flags.rev !== undefined && flags.rev !== current.rev)
				throw new CasError(flags.rev, current.rev);
			s.rev = current.rev;
			const r = writeScheme(
				root,
				s,
				flags.actor ?? "agent",
				"put",
				`put (${s.nodes?.length ?? 0} nodes)`,
			);
			out({ ok: true, rev: r.rev }, `written (rev ${r.rev})\n`);
			return;
		}

		case "sync": {
			const root = resolveProject(positional[0]);
			let s;
			if (flags.from) {
				s = parseJson(readInputFile(flags.from), flags.from);
			} else {
				s = readRaw(root); // hand-edited json -> rebuild exports
			}
			const r = writeScheme(
				root,
				s,
				flags.actor ?? "agent",
				"sync",
				"sync exports",
			);
			out({ ok: true, rev: r.rev }, `synced (rev ${r.rev})\n`);
			return;
		}

		case "zone": {
			const [action] = positional;
			const root = resolveProject(positional[1]);
			const s = readRaw(root);
			s.zones ??= [];
			if (action === "add") {
				if (![flags.x, flags.y, flags.w, flags.h].every(Number.isFinite))
					usage(2, "zone add requires --x --y --w --h");
				const z = {
					id: flags.id ?? consumeZoneId(s),
					label: flags.label ?? "zone",
					x: flags.x,
					y: flags.y,
					w: flags.w,
					h: flags.h,
					labelSide: flags.labelSide,
				};
				if (flags.desc) z.description = flags.desc;
				if (z.labelSide === undefined) delete z.labelSide;
				s.zones.push(z);
				const r = writeScheme(
					root,
					s,
					flags.actor ?? "agent",
					"zone.add",
					`zone ${z.id} "${flags.label}"`,
				);
				out(
					{ ok: true, rev: r.rev, id: z.id },
					`added zone ${z.id} (rev ${r.rev})\n`,
				);
			} else if (action === "update") {
				const z = s.zones.find((z) => z.id === flags.id);
				if (!z) usage(2, `zone ${flags.id} not found`);
				if (flags.label !== undefined) z.label = flags.label;
				if (flags.desc !== undefined) z.description = flags.desc;
				if (flags.x !== undefined) z.x = flags.x;
				if (flags.y !== undefined) z.y = flags.y;
				if (flags.w !== undefined) z.w = flags.w;
				if (flags.h !== undefined) z.h = flags.h;
				if (flags.labelSide !== undefined) z.labelSide = flags.labelSide;
				const r = writeScheme(
					root,
					s,
					flags.actor ?? "agent",
					"zone.update",
					`zone ${flags.id}`,
				);
				out({ ok: true, rev: r.rev }, `updated zone ${flags.id} (rev ${r.rev})\n`);
			} else if (action === "remove") {
				const i = s.zones.findIndex((z) => z.id === flags.id);
				if (i < 0) usage(2, `zone ${flags.id} not found`);
				s.zones.splice(i, 1);
				const r = writeScheme(
					root,
					s,
					flags.actor ?? "agent",
					"zone.remove",
					`zone ${flags.id}`,
				);
				out({ ok: true, rev: r.rev }, `removed zone ${flags.id} (rev ${r.rev})\n`);
			} else usage(2, "zone: add | update | remove");
			return;
		}

		case "render": {
			const root = resolveProject(positional[0]);
			const s = readRaw(root);
			if (flags.md || !flags.html) {
				fs.writeFileSync(path.join(root, "SCHEME.md"), exportMd(s, validate(s)));
			}
			if (flags.html || !flags.md) {
				const html = generateHtml(s);
				if (html === null)
					usage(2, "editor-template.gen.html missing in the skill");
				fs.writeFileSync(path.join(root, DIR, "scheme.html"), html);
			}
			out({ ok: true, rev: s.rev }, `rendered exports (rev ${s.rev})\n`);
			return;
		}

		case "diff": {
			const root = resolveProject(positional[0]);
			const cur = readRaw(root);
			const base = flags.rev ?? cur.rev - 1;
			if (base >= cur.rev) {
				out({ ok: true, changes: [] }, `nothing changed since rev ${base}\n`);
				return;
			}
			// backups are named rev{base}-{ts}.json (pre-write state); latest wins
			const dir = path.join(root, DIR, "cache", "backup");
			const candidates = fs.existsSync(dir)
				? fs
						.readdirSync(dir)
						.filter((f) => f.startsWith(`rev${base}-`))
						.sort()
				: [];
			if (!candidates.length) {
				out(
					{
						ok: false,
						error: `no snapshot for rev ${base} (cache/backup rotated out?)`,
					},
					`no snapshot for rev ${base} in cache/backup\n`,
				);
				process.exit(1);
				return;
			}
			const old = parseJson(
				fs.readFileSync(path.join(dir, candidates.at(-1)), "utf8"),
				`backup rev${base}`,
			);
			const changes = diffSchemes(old, cur);
			out(
				{ ok: true, from: base, to: cur.rev, changes },
				`rev ${base} -> ${cur.rev}\n` +
					(changes.length
						? changes.map((c) => `  ${c}`).join("\n") + "\n"
						: "  (no changes)\n"),
			);
			return;
		}

		case "history": {
			const root = resolveProject(positional[0]);
			const limit = flags.limit ?? 20;
			const journalFile = path.join(root, DIR, "cache", "journal.jsonl");
			const entries = fs.existsSync(journalFile)
				? fs
						.readFileSync(journalFile, "utf8")
						.split("\n")
						.filter(Boolean)
						.map(JSON.parse)
						.slice(-limit)
				: [];
			const autosaveDir = path.join(root, DIR, "cache", "autosave");
			const autosaves = fs.existsSync(autosaveDir)
				? fs.readdirSync(autosaveDir).sort().slice(-limit)
				: [];
			out(
				{ ok: true, entries, autosaves },
				entries
					.map(
						(e) =>
							`${e.ts} ${e.actor.padEnd(13)} rev=${String(e.rev).padEnd(4)} ${e.op}: ${e.summary}`,
					)
					.join("\n") +
					(autosaves.length
						? "\nautosave:\n" + autosaves.map((a) => `  ${a}`).join("\n")
						: ""),
			);
			return;
		}

		case "restore": {
			const root = resolveProject(positional[0]);
			if (flags.rev === undefined) usage(2, "restore requires --rev N");
			const cur = readRaw(root);
			const dir = path.join(root, DIR, "cache", "backup");
			const candidates = fs.existsSync(dir)
				? fs
						.readdirSync(dir)
						.filter((f) => f.startsWith(`rev${flags.rev}-`))
						.sort()
				: [];
			if (!candidates.length) {
				out(
					{ ok: false, error: `no backup for rev ${flags.rev}` },
					`no backup for rev ${flags.rev}\n`,
				);
				process.exit(1);
				return;
			}
			const snapshot = parseJson(
				fs.readFileSync(path.join(dir, candidates.at(-1)), "utf8"),
				`backup rev${flags.rev}`,
			);
			snapshot.rev = cur.rev; // CAS: write as new revision on top of current
			const r = writeScheme(
				root,
				snapshot,
				flags.actor ?? "agent",
				"restore",
				`restore to rev ${flags.rev}`,
				false,
			);
			out(
				{ ok: true, rev: r.rev },
				`restored rev ${flags.rev} as new rev ${r.rev}\n`,
			);
			return;
		}

		case "doctor": {
			const root = resolveProject(positional[0]);
			const problems = [];
			const blockDir = path.join(root, DIR);
			for (const f of ["scheme.json", "VERSION"]) {
				if (!fs.existsSync(path.join(blockDir, f)))
					problems.push(`missing ${DIR}/${f}`);
			}
			if (!fs.existsSync(path.join(root, "SCHEME.md")))
				problems.push("missing SCHEME.md");
			const s = readRaw(root);
			const v = validate(s);
			problems.push(...v.errors.map((e) => `json: ${e.message}`));
			// md consistency: name + rev must match
			if (fs.existsSync(path.join(root, "SCHEME.md"))) {
				const md = fs.readFileSync(path.join(root, "SCHEME.md"), "utf8");
				if (!md.includes(`# ${s.name}`)) problems.push("SCHEME.md name mismatch");
				if (!md.includes(`rev: ${s.rev}`))
					problems.push(`SCHEME.md rev mismatch (stale export)`);
			}
			// html consistency: embedded rev must match
			const htmlFile = path.join(blockDir, "scheme.html");
			if (fs.existsSync(htmlFile)) {
				const html = fs.readFileSync(htmlFile, "utf8");
				const m = html.match(/"rev":\s*(\d+)/);
				if (!m) problems.push("scheme.html has no embedded scheme");
				else if (Number(m[1]) !== s.rev)
					problems.push(`scheme.html embedded rev ${m[1]} != ${s.rev} (stale)`);
				if (html.length > 150 * 1024)
					problems.push(`scheme.html ${html.length}B > 150KB budget`);
			}
			// version file
			const ver = fs.existsSync(path.join(blockDir, "VERSION"))
				? fs.readFileSync(path.join(blockDir, "VERSION"), "utf8")
				: "";
			const skillV = readVersion();
			if (skillV.format && !ver.includes(`format: ${skillV.format}`)) {
				problems.push(`VERSION format mismatch: skill ${skillV.format}`);
			}
			const ok = problems.length === 0;
			out(
				{ ok, problems },
				(ok ? "doctor: OK" : "doctor: PROBLEMS") +
					"\n" +
					problems.map((p) => `  - ${p}`).join("\n"),
			);
			process.exit(ok ? 0 : 1);
			return; // explicit terminal statement (biome switch_case)
		}

		case "upgrade": {
			const root = resolveProject(positional[0]);
			const s = readRaw(root);
			const v = readVersion();
			if (s.version > Number(v.format ?? 1)) {
				out(
					{
						ok: false,
						error: `scheme version ${s.version} > supported ${v.format}; update the skill`,
					},
					`scheme version ${s.version} > supported ${v.format}; update the skill\n`,
				);
				process.exit(1);
				return;
			}
			out(
				{ ok: true, version: s.version },
				`format ${s.version} is current; nothing to migrate\n`,
			);
			return;
		}

		default:
			usage(2, `unknown command "${cmd}"`);
	}
}

try {
	await main();
} catch (e) {
	if (e instanceof CasError) {
		process.stderr.write(`conflict: ${e.message}\n`);
		process.exit(1);
	}
	if (e instanceof ValidationError) {
		process.stderr.write(`invalid: ${e.message}\n`);
		process.exit(1);
	}
	if (e instanceof DataError) {
		process.stderr.write(`error: ${e.message}\n`);
		process.exit(1);
	}
	if (e instanceof PathJailError) {
		process.stderr.write(`error: ${e.message}\n`);
		process.exit(2);
	}
	if (e && e.code === "ENOENT") {
		process.stderr.write(`error: ${e.message}\n`);
		process.exit(2);
	}
	if (e instanceof SyntaxError) {
		process.stderr.write(`error: invalid JSON input: ${e.message}\n`);
		process.exit(1);
	}
	process.stderr.write(`error: ${e?.stack ?? e}\n`);
	process.exit(1);
}
