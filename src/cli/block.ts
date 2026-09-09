#!/usr/bin/env node
// block CLI — the single entry point.
//
// Runs straight from .ts: Node 22.18+ strips the types, no bundler involved.
// Exit codes: 0 ok / 1 data error or CAS conflict / 2 usage error.
//
// Every command except `pull` is offline and writes only inside the project
// (.llmscheme/<type>_scheme/, .gitignore, AGENTS.md). `pull` is the one networked
// command and needs --url and --key explicitly — nothing is hardcoded.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	DIR,
	checkRefs,
	diffSchemes,
	emptyScheme,
	ensureAgentsSection,
	ensureGitignoreLine,
	exportMd,
	findSchemeDirs,
	schemeDir,
	projectRootOf,
	SCHEMES_DIR,
	type SchemeType,
	readRaw,
	readSnapshot,
	renderHtml,
	saveSchema,
	validate,
	CasError,
	DataError,
	PathJailError,
	ValidationError,
	addNode,
	addEdge,
	addZone,
	updateNode,
	updateEdge,
	updateZone,
	removeNode,
	removeEdge,
	removeZone,
	type Generator,
	type JournalEntry,
	type Scheme,
	type TableSpec,
	type NodePatch,
	type EdgePatch,
	type ZonePatch,
} from "../core/index.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // …/cli
const SKILL_DIR = path.dirname(HERE); // …/skill or …/src

const USAGE = `usage: block <command> [project] [options]

commands:
  init [project] [--type NAME] [--name N]
                                   set up .llmscheme/<type>_scheme/ + SCHEME.md
  get [project] [--type T] [--json]   print scheme summary
  validate [project] [--type T] [--json]   errors / warnings / stale refs
  node add|update|remove [...]     --id --shape --label --desc --x --y --w --h --ref
                                   --table-cols "a,b,c" --table-rows "r1c1|r1c2;r2c1|r2c2"
  edge add|update|remove [...]     --id --from --to --style --label --desc --from-side --to-side
  zone add|update|remove [...]     --id --label --desc --x --y --w --h --label-side
  put <file|-> [project] [--type T]  write whole scheme (stdin ok)
  pull --url U --key K --name N [--type T]  download a scheme from a service
  sync [project] [--type T] [--from FILE]  re-read json -> rebuild exports
  render [project] [--type T] [--md|--html]  regenerate exports
  diff [project] [--type T] [--rev N]   what changed since revision N
  history [project] [--type T] [--limit N]  journal + autosave list
  restore [project] [--type T] --rev N  roll back to rev N (as a new write)
  doctor [project] [--type T]      self-check structure/consistency/budget
  upgrade [project] [--type T]     migrate scheme format (currently a check)
  version                          print skill + format version

global options:
  --type T     scheme type: any short name (logic|code|ui are common; default logic)
  --rev N      expected revision for CAS (write commands)
  --json       machine-readable output
  --actor NAME agent|human-json (default agent)
`;

function usage(code: number, msg = ""): never {
	const p = (s: string) => process.stderr.write(`${s}\n`);
	if (msg) p(`error: ${msg}`);
	p(USAGE);
	process.exit(code);
}

// ---------- arg parsing ----------
// One table instead of a 30-branch if/else chain: the kind decides how the value
// is stored, so a new flag is one line here and nothing anywhere else.
type Kind = "bool" | "str" | "num" | "list";
const FLAG_KINDS: Record<string, Kind> = {
	json: "bool",
	md: "bool",
	html: "bool",
	type: "str",
	name: "str",
	id: "str",
	shape: "str",
	label: "str",
	desc: "str",
	ref: "list",
	"table-cols": "str",
	"table-rows": "str",
	actor: "str",
	from: "str",
	to: "str",
	style: "str",
	"label-side": "str",
	"from-side": "str",
	"to-side": "str",
	url: "str",
	key: "str",
	x: "num",
	y: "num",
	w: "num",
	h: "num",
	rev: "num",
	limit: "num",
};

interface Flags {
	json?: boolean;
	md?: boolean;
	html?: boolean;
	type?: SchemeType;
	name?: string;
	id?: string;
	shape?: string;
	label?: string;
	desc?: string;
	refs?: string[];
	tableCols?: string;
	tableRows?: string;
	actor?: Generator;
	from?: string;
	to?: string;
	style?: string;
	labelSide?: string;
	fromSide?: string;
	toSide?: string;
	url?: string;
	key?: string;
	x?: number;
	y?: number;
	w?: number;
	h?: number;
	rev?: number;
	limit?: number;
}

const CAMEL: Record<string, keyof Flags> = {
	// --ref accumulates into refs: the flag is singular, the field is an array.
	// v1 did this inline; without the mapping here --ref was parsed into
	// `flags.ref` and silently dropped by nodePatch().
	ref: "refs",
	"table-cols": "tableCols",
	"table-rows": "tableRows",
	"label-side": "labelSide",
	"from-side": "fromSide",
	"to-side": "toSide",
};

function parseArgs(argv: string[]): { flags: Flags; rest: string[] } {
	const flags: Flags = {};
	const rest: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i] as string;
		if (a === "--") {
			rest.push(...(argv.slice(i + 1) as string[]));
			break;
		}
		if (!a.startsWith("--")) {
			rest.push(a);
			continue;
		}
		const name = a.slice(2);
		const kind = FLAG_KINDS[name];
		if (!kind) usage(2, `unknown flag ${a}`);
		const key = CAMEL[name] ?? (name as keyof Flags);
		if (kind === "bool") {
			(flags as Record<string, unknown>)[key] = true;
			continue;
		}
		const value = argv[++i];
		if (value === undefined) usage(2, `flag ${a} needs a value`);
		if (kind === "num") {
			const n = Number(value);
			if (!Number.isFinite(n))
				usage(2, `flag ${a} needs a number, got "${value}"`);
			(flags as Record<string, unknown>)[key] = n;
		} else if (kind === "list") {
			const list =
				((flags as Record<string, unknown>)[key] as string[] | undefined) ?? [];
			list.push(value);
			(flags as Record<string, unknown>)[key] = list;
		} else {
			(flags as Record<string, unknown>)[key] = value;
		}
	}
	return { flags, rest };
}

const { flags, rest } = parseArgs(process.argv.slice(2));
const [cmd, ...positional] = rest;

// ---------- scheme resolution ----------
// The CLI may operate on one of several schemes per project (.llmscheme/
// logic_scheme|code_scheme|ui_scheme). Resolution order:
//   (a) explicit scheme dir / project path wins;
//   (b) --type picks the matching scheme dir;
//   (c) exactly one scheme dir found -> use it;
//   (d) multiple and no --type -> ask, never silently pick.
// scheme type: any safe single word (logic|code|ui are the common three, but
// a scheme can describe anything — db, api, auth, pipeline). The agent asks the
// user which scheme to build; it is not a fixed whitelist.
function schemeType(): SchemeType {
	if (flags.type === undefined) return "logic";
	if (/^[a-z0-9][a-z0-9_-]*$/.test(flags.type)) return flags.type;
	usage(2, `--type must be a safe name (a-z 0-9 _ -), got "${flags.type}"`);
}

// an explicit path may be a scheme dir itself or a project root; resolve to a
// scheme dir. For `init` the scheme does not exist yet, so this only applies to
// commands that read.
function resolveScheme(explicit?: string): string {
	if (explicit) {
		const p = path.resolve(explicit);
		// a scheme dir has scheme.json directly inside (DIR is "" in v2)
		if (fs.existsSync(path.join(p, DIR, "scheme.json"))) return p;
		// otherwise treat it as a project root and append the typed scheme dir
		const typed = schemeDir(p, schemeType());
		if (fs.existsSync(path.join(typed, DIR, "scheme.json"))) return typed;
		process.stderr.write(`no scheme at ${typed} (run init first)\n`);
		process.exit(2);
	}
	const hits = findSchemeDirs(process.cwd());
	if (hits.length === 1) return hits[0] as string;
	if (hits.length > 1) {
		const want = flags.type;
		if (want) {
			const typed = schemeDir(projectRootOf(hits[0] as string), schemeType());
			if (hits.includes(typed)) return typed;
		}
		process.stderr.write(
			`multiple schemes found, specify --type or a path:\n${hits.map((h) => `  ${h}`).join("\n")}\n`,
		);
		process.exit(2);
	}
	process.stderr.write(
		`no .llmscheme/<type>_scheme found from ${process.cwd()} upward (run init first)\n`,
	);
	process.exit(2);
}

// VERSION sits next to the CLI in the shipped skill (skill/VERSION) and at the
// repo root while running from src/. Check both instead of guessing the layout.
function versionFile(): string | null {
	for (const dir of [SKILL_DIR, path.dirname(SKILL_DIR)]) {
		const p = path.join(dir, "VERSION");
		if (fs.existsSync(p)) return p;
	}
	return null;
}

function readVersion(): Record<string, string> {
	const file = versionFile();
	if (!file) return {};
	const v: Record<string, string> = {};
	for (const line of fs.readFileSync(file, "utf8").split("\n")) {
		const m = line.match(/^(\w+):\s*(.+)$/);
		if (m) v[m[1] as string] = (m[2] as string).trim();
	}
	return v;
}

// editor.html lives next to the CLI (the skill copies it at sync time).
// Missing template is not fatal: exports still get SCHEME.md.
function generateHtml(scheme: Scheme): string | null {
	const tpl = path.join(SKILL_DIR, "editor.html");
	if (!fs.existsSync(tpl)) return null;
	return renderHtml(fs.readFileSync(tpl, "utf8"), scheme);
}

function out(obj: unknown, human?: string) {
	if (flags.json) process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
	else if (human !== undefined) process.stdout.write(human);
}

// --rev N = the rev the caller read (CAS). saveSchema re-checks against disk,
// so a concurrent writer is caught even without --rev. Exports are computed
// from the FINAL scheme (rev already bumped) and always follow the write.
//
// `cas` is off for restore, where --rev names the revision to roll back TO and
// is therefore not a CAS expectation.
function writeScheme(
	root: string,
	scheme: Scheme,
	op: string,
	summary: string,
	cas = true,
) {
	if (cas && flags.rev !== undefined && flags.rev !== scheme.rev)
		throw new CasError(flags.rev, scheme.rev);
	return saveSchema(root, scheme, {
		extraFiles: (final) => {
			const html = generateHtml(final);
			return html === null ? {} : { [path.join(DIR, "scheme.html")]: html };
		},
		journal: { actor: flags.actor ?? "agent", op, summary },
	});
}

// refs are relative to the PROJECT root (jail: they never escape it). The
// CLI now operates on a scheme dir (.llmscheme/<type>_scheme/), so recover the
// project root before resolving a ref path.
function staleRefs(schemeDirAbs: string, scheme: Scheme) {
	const projectRoot = projectRootOf(schemeDirAbs);
	return checkRefs(scheme, (rel) => {
		try {
			fs.statSync(path.resolve(projectRoot, rel));
			return true;
		} catch {
			return false;
		}
	});
}

function readInputFile(p: string): string {
	// "-" is stdin; a path is an INPUT source — read only, never written
	return p === "-"
		? fs.readFileSync(0, "utf8")
		: fs.readFileSync(path.resolve(p), "utf8");
}

function parseJson(text: string, source: string): Scheme {
	try {
		return JSON.parse(text) as Scheme;
	} catch (e) {
		throw new DataError(`invalid JSON in ${source}: ${(e as Error).message}`);
	}
}

// "a,b" -> ["a","b"] / "r1c1|r1c2;r2c1" -> [["r1c1","r1c2"],["r2c1"]]
function parseTable(): TableSpec | undefined {
	const t: TableSpec = {};
	if (flags.tableCols !== undefined)
		t.cols = flags.tableCols
			.split(",")
			.map((c) => c.trim())
			.filter(Boolean)
			.slice(0, 10);
	if (flags.tableRows !== undefined)
		t.rows = flags.tableRows
			.split(";")
			.map((line) => line.split("|").map((c) => c.trim()))
			.slice(0, 50);
	return flags.tableCols === undefined && flags.tableRows === undefined
		? undefined
		: t;
}

function nodePatch(): NodePatch {
	const p: NodePatch = {};
	if (flags.label !== undefined) p.label = flags.label;
	if (flags.shape !== undefined) p.shape = flags.shape as NodePatch["shape"];
	if (flags.desc !== undefined) p.description = flags.desc;
	if (flags.x !== undefined) p.x = flags.x;
	if (flags.y !== undefined) p.y = flags.y;
	if (flags.w !== undefined) p.w = flags.w;
	if (flags.h !== undefined) p.h = flags.h;
	if (flags.refs !== undefined) p.refs = flags.refs;
	const t = parseTable();
	if (t !== undefined) p.table = t;
	return p;
}

function edgePatch(): EdgePatch {
	const p: EdgePatch = {};
	if (flags.from !== undefined) p.from = flags.from;
	if (flags.to !== undefined) p.to = flags.to;
	if (flags.style !== undefined) p.style = flags.style as EdgePatch["style"];
	if (flags.label !== undefined) p.label = flags.label;
	if (flags.desc !== undefined) p.description = flags.desc;
	if (flags.fromSide !== undefined)
		p.fromSide = flags.fromSide as EdgePatch["fromSide"];
	if (flags.toSide !== undefined) p.toSide = flags.toSide as EdgePatch["toSide"];
	return p;
}

function zonePatch(): ZonePatch {
	const p: ZonePatch = {};
	if (flags.label !== undefined) p.label = flags.label;
	if (flags.desc !== undefined) p.description = flags.desc;
	if (flags.x !== undefined) p.x = flags.x;
	if (flags.y !== undefined) p.y = flags.y;
	if (flags.w !== undefined) p.w = flags.w;
	if (flags.h !== undefined) p.h = flags.h;
	if (flags.labelSide !== undefined)
		p.labelSide = flags.labelSide as ZonePatch["labelSide"];
	return p;
}

// ---------- commands ----------
async function main(): Promise<number> {
	switch (cmd) {
		case "version": {
			const v = readVersion();
			out(
				{ ok: true, skill: v.skill ?? "?", format: v.format ?? "?" },
				`block-llm skill ${v.skill ?? "?"} (format ${v.format ?? "?"})\n`,
			);
			return 0;
		}

		case "init": {
			const projectRoot = path.resolve(positional[0] ?? process.cwd());
			const root = schemeDir(projectRoot, schemeType());
			fs.mkdirSync(path.join(root, DIR, "cache"), { recursive: true });
			if (!fs.existsSync(path.join(root, DIR, "scheme.json")))
				writeScheme(
					root,
					emptyScheme(flags.name ?? path.basename(root)),
					"init",
					"init",
				);
			// .gitignore and AGENTS.md live at the PROJECT root, not the scheme dir.
			// Only the per-scheme cache/ is ignored; scheme.json, SCHEME.md and
			// scheme.html are committed.
			ensureGitignoreLine(projectRoot, `${SCHEMES_DIR}/*/cache/`);
			const verFile = path.join(root, DIR, "VERSION");
			if (!fs.existsSync(verFile)) {
				const src = versionFile();
				if (src) fs.copyFileSync(src, verFile);
			}
			ensureAgentsSection(projectRoot);
			const rev = readRaw(root).rev;
			out(
				{ ok: true, root, rev },
				`initialized ${path.join(root, DIR)} (rev ${rev})\n`,
			);
			return 0;
		}

		case "get": {
			const root = resolveScheme(positional[0]);
			const s = readRaw(root);
			const v = validate(s);
			const warnings = [...v.warnings, ...staleRefs(root, s)];
			out(
				{
					ok: true,
					rev: s.rev,
					name: s.name,
					nodes: s.nodes.length,
					edges: s.edges.length,
					warnings: warnings.map((w) => w.message),
				},
				`${s.name} rev=${s.rev} nodes=${s.nodes.length} edges=${s.edges.length}\n${warnings
					.map((w) => `  warn: ${w.message}`)
					.join("\n")}`,
			);
			return 0;
		}

		case "validate": {
			const root = resolveScheme(positional[0]);
			const s = readRaw(root);
			const v = validate(s);
			const warnings = [...v.warnings, ...staleRefs(root, s)];
			const ok = v.errors.length === 0;
			out(
				{ ok, rev: s.rev, errors: v.errors, warnings },
				`${ok ? "OK" : "FAIL"} (rev ${s.rev})\n${[...v.errors, ...warnings]
					.map((i) => `  ${i.level}: ${i.message}`)
					.join("\n")}\n`,
			);
			// the returned code sets process.exitCode at the bottom, so stdout is
			// fully flushed (process.exit() here could truncate a piped write)
			return ok ? 0 : 1;
		}

		case "node": {
			const [action] = positional;
			const root = resolveScheme(positional[1]);
			const s = readRaw(root);
			if (action === "add") {
				if (!flags.label) usage(2, "node add requires --label");
				const n = addNode(s, { ...nodePatch(), label: flags.label, id: flags.id });
				const r = writeScheme(root, s, "node.add", `node ${n.id} "${n.label}"`);
				out(
					{ ok: true, rev: r.rev, id: n.id },
					`added node ${n.id} (rev ${r.rev})\n`,
				);
			} else if (action === "update") {
				if (!flags.id) usage(2, "node update requires --id");
				const n = updateNode(s, flags.id, nodePatch());
				const r = writeScheme(root, s, "node.update", `node ${n.id}`);
				out(
					{ ok: true, rev: r.rev, id: n.id },
					`updated node ${n.id} (rev ${r.rev})\n`,
				);
			} else if (action === "remove") {
				if (!flags.id) usage(2, "node remove requires --id");
				removeNode(s, flags.id);
				const r = writeScheme(root, s, "node.remove", `node ${flags.id}`);
				out({ ok: true, rev: r.rev }, `removed node ${flags.id} (rev ${r.rev})\n`);
			} else usage(2, "node: add | update | remove");
			return 0;
		}

		case "edge": {
			const [action] = positional;
			const root = resolveScheme(positional[1]);
			const s = readRaw(root);
			if (action === "add") {
				if (!flags.from || !flags.to) usage(2, "edge add requires --from and --to");
				const e = addEdge(s, {
					...edgePatch(),
					from: flags.from,
					to: flags.to,
					id: flags.id,
				});
				const r = writeScheme(
					root,
					s,
					"edge.add",
					`edge ${e.id} ${e.from}->${e.to}`,
				);
				out(
					{ ok: true, rev: r.rev, id: e.id },
					`added edge ${e.id} (rev ${r.rev})\n`,
				);
			} else if (action === "update") {
				if (!flags.id) usage(2, "edge update requires --id");
				const e = updateEdge(s, flags.id, edgePatch());
				const r = writeScheme(root, s, "edge.update", `edge ${e.id}`);
				out(
					{ ok: true, rev: r.rev, id: e.id },
					`updated edge ${e.id} (rev ${r.rev})\n`,
				);
			} else if (action === "remove") {
				if (!flags.id) usage(2, "edge remove requires --id");
				removeEdge(s, flags.id);
				const r = writeScheme(root, s, "edge.remove", `edge ${flags.id}`);
				out({ ok: true, rev: r.rev }, `removed edge ${flags.id} (rev ${r.rev})\n`);
			} else usage(2, "edge: add | update | remove");
			return 0;
		}

		case "zone": {
			const [action] = positional;
			const root = resolveScheme(positional[1]);
			const s = readRaw(root);
			s.zones ??= [];
			if (action === "add") {
				if (![flags.x, flags.y, flags.w, flags.h].every(Number.isFinite))
					usage(2, "zone add requires --x --y --w --h");
				const z = addZone(s, {
					...zonePatch(),
					x: flags.x as number,
					y: flags.y as number,
					w: flags.w as number,
					h: flags.h as number,
					id: flags.id,
				});
				const r = writeScheme(root, s, "zone.add", `zone ${z.id} "${z.label}"`);
				out(
					{ ok: true, rev: r.rev, id: z.id },
					`added zone ${z.id} (rev ${r.rev})\n`,
				);
			} else if (action === "update") {
				if (!flags.id) usage(2, "zone update requires --id");
				const z = updateZone(s, flags.id, zonePatch());
				const r = writeScheme(root, s, "zone.update", `zone ${z.id}`);
				out(
					{ ok: true, rev: r.rev, id: z.id },
					`updated zone ${z.id} (rev ${r.rev})\n`,
				);
			} else if (action === "remove") {
				if (!flags.id) usage(2, "zone remove requires --id");
				removeZone(s, flags.id);
				const r = writeScheme(root, s, "zone.remove", `zone ${flags.id}`);
				out({ ok: true, rev: r.rev }, `removed zone ${flags.id} (rev ${r.rev})\n`);
			} else usage(2, "zone: add | update | remove");
			return 0;
		}

		case "put": {
			const fileArg = positional[0];
			if (!fileArg) usage(2, "put requires <file|->");
			const root = resolveScheme(positional[1]);
			const s = parseJson(readInputFile(fileArg), fileArg);
			// CAS: with --rev it must match disk; without, the disk rev wins
			// (the payload's own rev is stale by definition).
			const current = readRaw(root);
			if (flags.rev !== undefined && flags.rev !== current.rev)
				throw new CasError(flags.rev, current.rev);
			s.rev = current.rev;
			const r = writeScheme(root, s, "put", `put (${s.nodes?.length ?? 0} nodes)`);
			out({ ok: true, rev: r.rev }, `written (rev ${r.rev})\n`);
			return 0;
		}

		// The one networked command: bring a service scheme into this project so
		// an agent can keep working offline. Url/key are always explicit.
		case "pull": {
			if (!flags.url || !flags.key || !flags.name)
				usage(2, "pull requires --url, --key and --name");
			const projectRoot = path.resolve(positional[0] ?? process.cwd());
			const root = schemeDir(projectRoot, schemeType());
			const url = new URL(
				`/api/scheme/${flags.name.split("/").map(encodeURIComponent).join("/")}`,
				flags.url,
			);
			const res = await fetch(url, { headers: { "x-api-key": flags.key } });
			if (!res.ok) {
				const body = (await res.text()).slice(0, 300);
				throw new DataError(`pull failed: ${res.status} ${body}`);
			}
			const remote = (await res.json()) as Scheme;
			if (remote.format !== "block-llm")
				throw new DataError(`pull got a non-block-llm payload from ${url.href}`);

			fs.mkdirSync(path.join(root, DIR, "cache"), { recursive: true });
			ensureGitignoreLine(projectRoot, `${SCHEMES_DIR}/*/cache/`);
			ensureAgentsSection(projectRoot);
			let localRev = 0;
			try {
				localRev = readRaw(root).rev;
			} catch {
				/* first pull into an empty project */
			}
			if (flags.rev !== undefined && flags.rev !== localRev)
				throw new CasError(flags.rev, localRev);
			// write under the LOCAL rev: the service history stays on the service,
			// and local CAS keeps working for later writes
			const remoteRev = remote.rev;
			remote.rev = localRev;
			const r = writeScheme(
				root,
				remote,
				"pull",
				`pull ${flags.name} (service rev ${remoteRev})`,
			);
			out(
				{
					ok: true,
					rev: r.rev,
					name: flags.name,
					nodes: remote.nodes?.length ?? 0,
				},
				`pulled ${flags.name} into ${root} (rev ${r.rev})\n`,
			);
			return 0;
		}

		case "sync": {
			const root = resolveScheme(positional[0]);
			// --from FILE rebuilds exports around a hand-edited/agent payload;
			// without it, the on-disk scheme is re-exported as is
			const s = flags.from
				? parseJson(readInputFile(flags.from), flags.from)
				: readRaw(root);
			const r = writeScheme(root, s, "sync", "sync exports");
			out({ ok: true, rev: r.rev }, `synced (rev ${r.rev})\n`);
			return 0;
		}

		case "render": {
			const root = resolveScheme(positional[0]);
			const s = readRaw(root);
			const wantMd = flags.md || !flags.html;
			const wantHtml = flags.html || !flags.md;
			if (wantMd)
				fs.writeFileSync(path.join(root, "SCHEME.md"), exportMd(s, validate(s)));
			if (wantHtml) {
				const html = generateHtml(s);
				// Missing editor.html only defeats an EXPLICIT --html request; the
				// default "render everything" still writes SCHEME.md and reports the gap.
				if (html !== null)
					fs.writeFileSync(path.join(root, DIR, "scheme.html"), html);
				else if (flags.html) usage(2, "editor.html missing next to the CLI");
			}
			out({ ok: true, rev: s.rev }, `rendered exports (rev ${s.rev})\n`);
			return 0;
		}

		case "diff": {
			const root = resolveScheme(positional[0]);
			const cur = readRaw(root);
			const base = flags.rev ?? cur.rev - 1;
			if (base >= cur.rev) {
				out({ ok: true, changes: [] }, `nothing changed since rev ${base}\n`);
				return 0;
			}
			let old: Scheme;
			try {
				old = readSnapshot(root, base);
			} catch {
				out(
					{
						ok: false,
						error: `no snapshot for rev ${base} (cache/backup rotated out?)`,
					},
					`no snapshot for rev ${base} in cache/backup\n`,
				);
				return 1;
			}
			const changes = diffSchemes(old, cur);
			out(
				{ ok: true, from: base, to: cur.rev, changes },
				`rev ${base} -> ${cur.rev}\n${
					changes.length
						? `${changes.map((c) => `  ${c}`).join("\n")}\n`
						: "  (no changes)\n"
				}`,
			);
			return 0;
		}

		case "history": {
			const root = resolveScheme(positional[0]);
			const limit = flags.limit ?? 20;
			const journalFile = path.join(root, DIR, "cache", "journal.jsonl");
			// flatMap drops the bad lines: a truncated tail must not kill the tape
			const entries: JournalEntry[] = fs.existsSync(journalFile)
				? fs
						.readFileSync(journalFile, "utf8")
						.split("\n")
						.flatMap((line) => {
							if (!line) return [];
							try {
								return [JSON.parse(line) as JournalEntry];
							} catch {
								return [];
							}
						})
						.slice(-limit)
				: [];
			const autosaveDir = path.join(root, DIR, "cache", "autosave");
			// names are ts-prefixed with a fixed width, so code-unit order is age order
			const autosaves = fs.existsSync(autosaveDir)
				? fs
						.readdirSync(autosaveDir)
						.sort((a, b) => a.localeCompare(b))
						.slice(-limit)
				: [];
			out(
				{ ok: true, entries, autosaves },
				`${entries
					.map(
						(e) =>
							`${e.ts} ${e.actor.padEnd(13)} rev=${String(e.rev).padEnd(4)} ${e.op}: ${e.summary}`,
					)
					.join("\n")}${
					autosaves.length
						? `\nautosave:\n${autosaves.map((a) => `  ${a}`).join("\n")}`
						: ""
				}\n`,
			);
			return 0;
		}

		case "restore": {
			const root = resolveScheme(positional[0]);
			if (flags.rev === undefined) usage(2, "restore requires --rev N");
			const cur = readRaw(root);
			const snapshot = readSnapshot(root, flags.rev);
			// CAS: the snapshot lands as a NEW write on top of the current rev,
			// and --rev here names the revision to roll back TO, not a CAS expectation.
			snapshot.rev = cur.rev;
			const r = writeScheme(
				root,
				snapshot,
				"restore",
				`restore to rev ${flags.rev}`,
				false,
			);
			out(
				{ ok: true, rev: r.rev },
				`restored rev ${flags.rev} as new rev ${r.rev}\n`,
			);
			return 0;
		}

		case "doctor": {
			const root = resolveScheme(positional[0]);
			const problems: string[] = [];
			const blockDir = path.join(root, DIR);
			for (const f of ["scheme.json", "VERSION"])
				if (!fs.existsSync(path.join(blockDir, f)))
					problems.push(`missing ${DIR}/${f}`);
			if (!fs.existsSync(path.join(root, "SCHEME.md")))
				problems.push("missing SCHEME.md");

			const s = readRaw(root);
			problems.push(...validate(s).errors.map((e) => `json: ${e.message}`));

			// exports must agree with scheme.json, otherwise the human is looking
			// at a different revision than the agent
			const md = path.join(root, "SCHEME.md");
			if (fs.existsSync(md)) {
				const text = fs.readFileSync(md, "utf8");
				if (!text.includes(`# ${s.name}`)) problems.push("SCHEME.md name mismatch");
				if (!text.includes(`rev: ${s.rev}`))
					problems.push("SCHEME.md rev mismatch (stale export)");
			}
			const htmlFile = path.join(blockDir, "scheme.html");
			if (fs.existsSync(htmlFile)) {
				const html = fs.readFileSync(htmlFile, "utf8");
				const m = html.match(/"rev":\s*(\d+)/);
				if (!m) problems.push("scheme.html has no embedded scheme");
				else if (Number(m[1]) !== s.rev)
					problems.push(`scheme.html embedded rev ${m[1]} != ${s.rev} (stale)`);
				// the editor is opened from disk by a human: keep it single-file small
				if (html.length > 200 * 1024)
					problems.push(`scheme.html ${html.length}B > 200KB budget`);
			}
			problems.push(...staleRefs(root, s).map((i) => i.message));

			const verFile = path.join(blockDir, "VERSION");
			const ver = fs.existsSync(verFile) ? fs.readFileSync(verFile, "utf8") : "";
			const skillV = readVersion();
			if (skillV.format && !ver.includes(`format: ${skillV.format}`))
				problems.push(`VERSION format mismatch: skill ${skillV.format}`);

			const ok = problems.length === 0;
			out(
				{ ok, problems },
				`${ok ? "doctor: OK" : "doctor: PROBLEMS"}\n${problems.map((p) => `  - ${p}`).join("\n")}`,
			);
			return ok ? 0 : 1;
		}

		case "upgrade": {
			const root = resolveScheme(positional[0]);
			const s = readRaw(root);
			const supported = Number(readVersion().format ?? 1);
			if (s.version > supported) {
				out(
					{
						ok: false,
						error: `scheme version ${s.version} > supported ${supported}; update the skill`,
					},
					`scheme version ${s.version} > supported ${supported}; update the skill\n`,
				);
				return 1;
			}
			out(
				{ ok: true, version: s.version },
				`format ${s.version} is current; nothing to migrate\n`,
			);
			return 0;
		}

		default:
			usage(2, `unknown command "${cmd ?? ""}"`);
	}
	// no trailing return: usage() is typed `never`, so every path above returns
}

try {
	process.exitCode = await main();
} catch (e) {
	// friendly text + a meaningful exit code; never a stacktrace at the user
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
	if ((e as NodeJS.ErrnoException)?.code === "ENOENT") {
		process.stderr.write(`error: ${(e as Error).message}\n`);
		process.exit(2);
	}
	if (e instanceof SyntaxError) {
		process.stderr.write(`error: invalid JSON input: ${e.message}\n`);
		process.exit(1);
	}
	process.stderr.write(`error: ${(e as Error)?.stack ?? e}\n`);
	process.exit(1);
}
