// §12 test suite — node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
);
const CORE = new URL(
	"../../llmscheme-skill/block_llm_core/core.mjs",
	import.meta.url,
).href;
const BLOCK = path.join(repo, "llmscheme-skill/block_llm_tools/block.mjs");
const SKILL = path.join(repo, "llmscheme-skill/SKILL.md");
const core = await import(CORE);

function tmp() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "blm-test-"));
}

function run(args, cwd, opts = {}) {
	return spawnSync("node", [BLOCK, ...args], { cwd, encoding: "utf8", ...opts });
}

function freshProject(name = "T") {
	const dir = tmp();
	fs.mkdirSync(path.join(dir, "src"), { recursive: true });
	fs.writeFileSync(path.join(dir, "src/a.ts"), "export {};\n");
	run(["init", ".", `--name`, name], dir);
	return dir;
}

// ---------- validate: errors vs warnings ----------
test("validate: orphan = warn, broken edge = error, dup id = error", () => {
	const s = core.emptyScheme("V");
	s.nodes.push({ id: "n1", shape: "rect", label: "A", x: 0, y: 0 });
	s.nodes.push({ id: "n1", shape: "rect", label: "dup", x: 1, y: 1 });
	s.edges.push({ id: "e1", from: "nX", to: "n1", style: "solid" });
	const v = core.validate(s);
	assert.ok(v.errors.some((e) => e.code === "dup-id"));
	assert.ok(v.errors.some((e) => e.code === "from"));
	assert.ok(!v.errors.some((e) => e.code === "orphan"), "orphan is a warning");
	const s2 = core.emptyScheme("V2");
	s2.nodes.push({ id: "n1", shape: "rect", label: "alone", x: 0, y: 0 });
	const v2 = core.validate(s2);
	assert.ok(v2.warnings.some((w) => w.code === "orphan"));
	assert.equal(v2.errors.length, 0);
});

test("validate: unknown shape/style and future version are errors", () => {
	const s = core.emptyScheme("V3");
	s.nodes.push({ id: "n1", shape: "hexagon", label: "A", x: 0, y: 0 });
	s.edges.push({ id: "e1", from: "n1", to: "n1", style: "dotted" });
	s.version = 99;
	const v = core.validate(s);
	assert.ok(v.errors.some((e) => e.code === "shape"));
	assert.ok(v.errors.some((e) => e.code === "style"));
	assert.ok(v.errors.some((e) => e.code === "version"));
});

// ---------- ids: watermark + self-heal ----------
test("watermark: freed ids are never reused", () => {
	const s = core.emptyScheme("W");
	const a = core.consumeNodeId(s); // n1
	core.consumeNodeId(s); // n2
	assert.equal(a, "n1");
	assert.equal(core.nextNodeId(s), "n3"); // even if n2 gets removed later, counter only grows
});

test("watermark: self-heals when a hand-edited json has higher ids", () => {
	const s = core.emptyScheme("WH");
	s.nodes.push({ id: "n12", shape: "rect", label: "hand-added", x: 0, y: 0 });
	s.meta.nextId.n = 12; // counter points AT the taken id (restore of a foreign payload)
	assert.equal(core.consumeNodeId(s), "n13"); // skips taken n12
	assert.equal(s.meta.nextId.n, 14);
});

// ---------- layout: determinism, no overlaps ----------
test("layout: two runs -> identical output; no grid overlaps", () => {
	const build = () => {
		const s = core.emptyScheme("L");
		// no explicit coords -> layout places everything (explicit x/y are skipped by design)
		for (const [i, shape] of [
			"rect",
			"circle",
			"diamond",
			"square",
			"rect",
		].entries()) {
			s.nodes.push({ id: `n${i + 1}`, shape, label: `N${i}` });
		}
		s.edges.push({ id: "e1", from: "n1", to: "n2", style: "solid" });
		s.edges.push({ id: "e2", from: "n1", to: "n3", style: "solid" });
		s.edges.push({ id: "e3", from: "n3", to: "n4", style: "dashed" });
		s.edges.push({ id: "e4", from: "n2", to: "n5", style: "solid" });
		return s;
	};
	const a = build(),
		b = build();
	core.autoLayout(a);
	core.autoLayout(b);
	assert.deepEqual(a.nodes, b.nodes);
	const cells = new Set(a.nodes.map((n) => `${n.x}:${n.y}`));
	assert.equal(cells.size, a.nodes.length, "no overlaps");
	// fixed grid STEP: pairwise deltas are multiples of GRID_X/GRID_Y
	// (per-level centering may offset the origin by GRID_X/2 — that's by design)
	for (const n of a.nodes) {
		for (const m2 of a.nodes) {
			if (n === m2 || n.y !== m2.y) continue;
			assert.equal(
				Math.abs(n.x - m2.x) % core.GRID_X,
				0,
				"same-level x delta on grid",
			);
		}
	}
});

// ---------- saveSchema: rev+1, CAS, backup, md regeneration ----------
test("saveSchema: rev+1, CAS rejection on stale payload, backup written", () => {
	const dir = tmp();
	fs.mkdirSync(path.join(dir, core.DIR), { recursive: true });
	const s = core.emptyScheme("S");
	s.nodes.push({ id: "n1", shape: "rect", label: "A", x: 0, y: 0 });
	fs.writeFileSync(path.join(dir, core.DIR, "scheme.json"), JSON.stringify(s));
	const s2 = structuredClone(s);
	s2.nodes[0].label = "B";
	const r = core.saveSchema(dir, s2);
	assert.equal(r.rev, 1);
	assert.equal(core.readRaw(dir).nodes[0].label, "B");
	// stale payload (rev 0) must fail CAS
	assert.throws(() => core.saveSchema(dir, structuredClone(s)), core.CasError);
	// backup of pre-write state exists
	const backups = fs.readdirSync(path.join(dir, core.DIR, "cache", "backup"));
	assert.ok(backups.some((f) => f.startsWith("rev0-")));
	// SCHEME.md regenerated with the new rev
	assert.ok(
		fs.readFileSync(path.join(dir, "SCHEME.md"), "utf8").includes("rev: 1"),
	);
});

test("saveSchema: errors forbid the write (validation gate)", () => {
	const dir = tmp();
	fs.mkdirSync(path.join(dir, core.DIR), { recursive: true });
	const s = core.emptyScheme("G");
	fs.writeFileSync(path.join(dir, core.DIR, "scheme.json"), JSON.stringify(s));
	const bad = structuredClone(s);
	bad.edges.push({ id: "e1", from: "ghost", to: "also-ghost", style: "solid" });
	assert.throws(() => core.saveSchema(dir, bad), core.ValidationError);
	// disk untouched
	assert.equal(core.readRaw(dir).edges.length, 0);
});

// ---------- table shape + multiline labels (v0.3) ----------
test("table: 10x50 limits are errors, table on non-table node warns, md renders rows", () => {
	const s = core.emptyScheme("T");
	s.nodes.push({
		id: "n1",
		shape: "table",
		label: "Catalog",
		x: 0,
		y: 0,
		table: { cols: Array.from({ length: 11 }, (_, i) => `c${i}`), rows: [] },
	});
	let v = core.validate(s);
	assert.ok(
		v.errors.some((e) => e.code === "table" && e.message.includes("cols max 10")),
	);
	s.nodes[0].table = {
		cols: ["a"],
		rows: Array.from({ length: 51 }, () => ["x"]),
	};
	v = core.validate(s);
	assert.ok(
		v.errors.some((e) => e.code === "table" && e.message.includes("rows max 50")),
	);
	s.nodes[0].table = {
		cols: ["name", "mood"],
		rows: [["Barsik", "happy"], ["Murka"]],
	};
	v = core.validate(s);
	assert.equal(v.errors.length, 0);
	const md = core.exportMd(s, v);
	assert.ok(md.includes("**n1 columns:** name · mood"));
	assert.ok(md.includes("> n1 | Barsik | happy |"));
	assert.ok(md.includes("> n1 | Murka |"));
	// table data on a rect node is kept but warned
	s.nodes[0].shape = "rect";
	v = core.validate(s);
	assert.ok(v.warnings.some((w) => w.code === "table"));
});

test("multiline label: md uses <br/>, node sizes grow with lines", () => {
	const s = core.emptyScheme("M");
	s.nodes.push({
		id: "n1",
		shape: "rect",
		label: "line1\nline2\nline3",
		x: 0,
		y: 0,
	});
	assert.ok(core.exportMermaid(s).includes("line1<br/>line2<br/>line3"));
	assert.ok(
		core.nodeH(s.nodes[0]) > core.nodeH({ ...s.nodes[0], label: "one" }),
	);
	assert.ok(core.nodeW(s.nodes[0]) >= 120);
});

// ---------- exportMd: mermaid escaping ----------
test("exportMd: mermaid quotes/escapes and structure", () => {
	const s = core.emptyScheme("M");
	s.nodes.push({ id: "n1", shape: "rect", label: 'Auth [JWT] "x"', x: 0, y: 0 });
	const md = core.exportMd(s, core.validate(s));
	assert.ok(md.includes("```mermaid"));
	assert.ok(md.includes('n1["Auth [JWT] #quot;x#quot;"]'));
	assert.ok(md.includes("| n1 | rect |"));
	assert.ok(md.includes("## Sync"));
});

// ---------- renderHtml: roundtrip invariant ----------
test("renderHtml: embedded json == scheme.json (roundtrip)", () => {
	const dir = tmp();
	fs.mkdirSync(path.join(dir, core.DIR), { recursive: true });
	const s = core.emptyScheme("H");
	s.nodes.push({ id: "n1", shape: "circle", label: 'Круг "тест"', x: 0, y: 0 });
	fs.writeFileSync(path.join(dir, core.DIR, "scheme.json"), JSON.stringify(s));
	const tpl = fs.readFileSync(
		path.join(repo, "llmscheme-skill/block_llm_core/editor-template.gen.html"),
		"utf8",
	);
	const html = core.renderHtml(tpl, s);
	assert.equal(core.extractSchemeJson(html).rev, s.rev);
	assert.equal(core.extractSchemeJson(html).nodes[0].label, 'Круг "тест"');
});

// ---------- single-file invariants (CI guard, §12) ----------
test("single-file invariants: no external refs, inline scripts, woff2 data fonts, budget", () => {
	const html = fs.readFileSync(
		path.join(repo, "llmscheme-skill/block_llm_core/editor-template.gen.html"),
		"utf8",
	);
	assert.ok(
		html.length <= 150 * 1024,
		`editor-template.gen.html ${html.length}B > 150KB budget`,
	);
	const externals = [];
	for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
		const u = match[1];
		if (u.startsWith("data:") || u.startsWith("#")) continue;
		externals.push(u);
	}
	assert.deepEqual(externals, [], "no external src/href");
	assert.match(html, /<script type="module"[^>]*>/, "module script is inline");
	assert.equal(
		(html.match(/data:font\/woff2;base64/g) ?? []).length,
		2,
		"both woff2 subsets inlined",
	);
	assert.ok(!/fetch\(["']https?:/.test(html), "no http fetch");
	assert.ok(/url\(["']?https?:/.test(html) === false, "no external css url()");
	assert.ok(html.includes('id="scheme-data"'), "embed marker present");
});

// ---------- path-jail ----------
test("path-jail: ../ escape refused; input files only read", () => {
	const dir = tmp();
	assert.throws(() => core.jail(dir, "../outside"), core.PathJailError);
	assert.throws(() => core.jail(dir, "/etc/passwd"), core.PathJailError);
	assert.throws(() => core.jail(dir, ""), core.PathJailError);
	// allowed
	assert.equal(core.jail(dir, "src/a.ts"), path.join(dir, "src/a.ts"));
});

// ---------- rotation ----------
test("rotation: 60 autosaves -> 50 kept via saveSchema autosave path", () => {
	const dir2 = tmp();
	fs.mkdirSync(path.join(dir2, core.DIR, "cache", "autosave"), {
		recursive: true,
	});
	for (let i = 0; i < 60; i++) {
		fs.writeFileSync(
			path.join(
				dir2,
				core.DIR,
				"cache",
				"autosave",
				`ts2026-01-01T00-00-${String(i).padStart(2, "0")}-000Z-rev${i}.json`,
			),
			"{}",
		);
	}
	const s = core.emptyScheme("R");
	fs.writeFileSync(path.join(dir2, core.DIR, "scheme.json"), JSON.stringify(s));
	core.saveSchema(dir2, structuredClone(s));
	const kept = fs.readdirSync(
		path.join(dir2, core.DIR, "cache", "autosave"),
	).length;
	assert.ok(kept <= 50, `autosave rotation kept ${kept}`);
});

// ---------- doctor via CLI ----------
test("CLI doctor: concrete problems on broken structure, no stacktrace", () => {
	const dir = freshProject("D");
	// make exports stale
	const jsonPath = path.join(dir, core.DIR, "scheme.json");
	const s = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
	s.rev = 42;
	fs.writeFileSync(jsonPath, JSON.stringify(s));
	const r = run(["doctor", "."], dir);
	assert.equal(r.status, 1);
	assert.ok(r.stdout.includes("PROBLEMS"));
	assert.ok(r.stdout.includes("stale export"));
	assert.ok(!r.stderr.includes("at "), "no stacktrace");
});

// ---------- CLI e2e on a copy of the flow (§12) ----------
test("CLI e2e: init -> node add x3 -> edge add x2 -> validate -> get -> diff -> render -> doctor", () => {
	const dir = freshProject("E2E");
	const r1 = run(["node", "add", "--label", "A", "--ref", "src/a.ts"], dir);
	assert.equal(r1.status, 0);
	run(["node", "add", "--label", "B"], dir);
	run(["node", "add", "--label", "C", "--shape", "diamond"], dir);
	run(["edge", "add", "--from", "n1", "--to", "n2"], dir);
	const rEdge = run(
		["edge", "add", "--from", "n2", "--to", "n3", "--style", "dashed"],
		dir,
	);
	assert.equal(rEdge.status, 0);
	const rev = JSON.parse(
		fs.readFileSync(path.join(dir, core.DIR, "scheme.json")),
	).rev;
	assert.equal(rev, 6); // init 1 + 3 nodes + 2 edges
	assert.equal(run(["validate", "."], dir).status, 0);
	const g = run(["get", "--json"], dir);
	assert.equal(JSON.parse(g.stdout).rev, 6);
	run(["node", "update", "--id", "n2", "--label", "B2"], dir);
	const d = run(["diff", "--rev", String(rev)], dir);
	assert.ok(d.stdout.includes("n2.label"));
	assert.equal(run(["render", "."], dir).status, 0);
	assert.equal(run(["doctor", "."], dir).status, 0);
	// history: single tape
	const h = run(["history", "--json"], dir);
	const entries = JSON.parse(h.stdout).entries;
	assert.ok(entries.length >= 7);
	assert.ok(entries.every((e) => e.actor === "agent"));
});

// ---------- project search rules (§10 / §12) ----------
test("search: finds demo upward inside its tree; sibling tree does NOT see it; explicit path wins", () => {
	const root = tmp();
	const demo = path.join(root, "demo");
	const demoSrc = path.join(demo, "src");
	fs.mkdirSync(demoSrc, { recursive: true });
	run(["init", demo, "--name", "Demo"], root);
	// from inside demo subtree -> found
	const inside = run(["get"], demoSrc);
	assert.equal(inside.status, 0, inside.stderr);
	assert.ok(inside.stdout.includes("Demo"));
	// from sibling of demo (no .block_llm upward) -> exit 2
	const sibling = path.join(root, "other");
	fs.mkdirSync(sibling, { recursive: true });
	const outside = run(["get"], sibling);
	assert.equal(outside.status, 2);
	// two candidates -> ask, exit 2
	const two = path.join(root, "two");
	fs.mkdirSync(two, { recursive: true });
	run(["init", two, "--name", "Two"], root);
	// both are under root; from root itself upward search sees nothing (root has no .block_llm)
	// but explicit ancestor chain: run from root -> 0 candidates; simulate ambiguity by running from a dir whose
	// upward chain contains both: put a marker dir between them is not possible; so test explicit-path priority instead:
	const explicit = run(["get", demo], root);
	assert.equal(explicit.status, 0);
	assert.ok(explicit.stdout.includes("Demo"));
});

test("explicit path wins over cwd search", () => {
	const a = freshProject("A"),
		b = freshProject("B");
	const r = run(["get", b], a);
	assert.ok(r.stdout.includes("B"));
});

// ---------- SKILL.md validation (§12) ----------
test("SKILL.md: standard-only frontmatter, limits, references exist", () => {
	const text = fs.readFileSync(SKILL, "utf8");
	const m = text.match(/^---\n([\s\S]*?)\n---\n/);
	assert.ok(m, "frontmatter present");
	const fm = m[1];
	const name = fm.match(/^name:\s*(.+)$/m)?.[1].trim();
	assert.equal(name, "block-llm");
	assert.match(name, /^[a-z0-9-]+$/);
	assert.ok(
		!name.includes("--") && !name.startsWith("-") && !name.endsWith("-"),
	);
	// description may wrap; count chars between 'description:' and next known key
	const startDesc = fm.indexOf("description:");
	const endDesc = fm.indexOf("\nlicense:");
	const fullDesc = fm
		.slice(startDesc + "description:".length, endDesc)
		.replace(/\n\s+/g, " ")
		.trim();
	assert.ok(fullDesc.length <= 1024, `description ${fullDesc.length} > 1024`);
	const compatMatch = fm.match(
		/compatibility:\s*\n?\s*([\s\S]*?)(?=\n\w|\n---)/,
	);
	if (compatMatch)
		assert.ok(compatMatch[1].trim().length <= 500, "compatibility <= 500");
	// standard-only fields
	const allowed = new Set([
		"name",
		"description",
		"license",
		"compatibility",
		"metadata",
		"allowed-tools",
	]);
	for (const line of fm.split("\n")) {
		const key = line.match(/^([a-z-]+):/)?.[1];
		if (key) assert.ok(allowed.has(key), `non-standard field: ${key}`);
	}
	// body < 500 lines
	const body = text.slice(m[0].length);
	assert.ok(body.split("\n").length < 500, "body < 500 lines");
	// references exist (one level)
	for (const ref of body.matchAll(
		/\bblock_llm_core\/references\/([A-Z_]+\.md)/g,
	)) {
		const p = path.join(
			repo,
			"llmscheme-skill/block_llm_core/references",
			ref[1],
		);
		assert.ok(fs.existsSync(p), `reference exists: ${ref[1]}`);
	}
});

// ---------- init idempotency ----------
test("init is idempotent: no dup gitignore lines, AGENTS.md section single", () => {
	const dir = freshProject("I");
	run(["init", "."], dir);
	run(["init", "."], dir);
	const gi = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
	assert.equal(
		gi.split("\n").filter((l) => l === `${core.DIR}/cache/`).length,
		1,
	);
	const ag = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
	assert.equal(ag.split(core.AGENTS_START).length - 1, 1);
	const s = JSON.parse(
		fs.readFileSync(path.join(dir, core.DIR, "scheme.json"), "utf8"),
	);
	assert.equal(s.rev, 1, "scheme not re-created on re-init");
});

// ---------- restore / conflict text ----------
test("CLI: CAS conflict exits 1 with friendly text; restore rolls back as new rev", () => {
	const dir = freshProject("C");
	run(["node", "add", "--label", "A"], dir);
	run(["node", "add", "--label", "B"], dir); // rev 3
	const bad = run(["node", "add", "--label", "X", "--rev", "1"], dir);
	assert.equal(bad.status, 1);
	assert.ok(bad.stderr.includes("scheme changed on disk"));
	assert.ok(bad.stderr.includes("re-read"));
	const res = run(["restore", ".", "--rev", "2"], dir);
	assert.equal(res.status, 0);
	const s = JSON.parse(
		fs.readFileSync(path.join(dir, core.DIR, "scheme.json"), "utf8"),
	);
	assert.equal(s.rev, 4);
	assert.equal(s.nodes.length, 1); // state of rev2 restored
});

// ---------- upgrade ----------
test("upgrade: current format -> ok; future format -> exit 1", () => {
	const dir = freshProject("U");
	assert.equal(run(["upgrade", "."], dir).status, 0);
	const jsonPath = path.join(dir, core.DIR, "scheme.json");
	const s = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
	s.version = 99;
	fs.writeFileSync(jsonPath, JSON.stringify(s));
	const r = run(["upgrade", "."], dir);
	assert.equal(r.status, 1);
	assert.ok(r.stdout.includes("update the skill"));
});
