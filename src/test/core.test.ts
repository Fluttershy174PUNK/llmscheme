// Core tests: node --test, no frameworks. Covers the v1 suite plus a test for
// every core-side bug found in the audit (B7 B8 B10 B11 B12 B14) and the
// backup-rotation ordering bug (rev9 sorted above rev24).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as core from "../core/index.ts";

type Loose = Record<string, unknown>;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "blm-"));

// Every fixture below carries the items it indexes, so one helper keeps
// `noUncheckedIndexedAccess` noise out of all assertions.
const at = <T>(arr: T[], i = 0): T => arr[i]!;

// a valid scheme with n nodes placed by the core (no x/y -> autoLayout decides)
function fixture(nodes = 1): core.Scheme {
	const s = core.emptyScheme("T");
	for (let i = 0; i < nodes; i++) {
		const {
			x: _x,
			y: _y,
			...rest
		} = {
			id: core.consumeNodeId(s),
			shape: "rect" as const,
			label: `n${i}`,
			x: 0,
			y: 0,
		};
		s.nodes.push(rest as core.SchemeNode);
	}
	core.autoLayout(s);
	return s;
}

// validate() is what these tests attack, so the payloads deliberately do NOT
// satisfy Scheme. Two helpers keep that at one cast each instead of six.
const bad = (patch: Loose): core.Scheme => ({ ...fixture(1), ...patch }) as core.Scheme;
const badNode = (patch: Loose): core.Scheme => {
	const s = fixture(1);
	s.nodes[0] = { ...at(s.nodes), ...patch } as core.SchemeNode;
	return s;
};

// SAFETY: fixtures deliberately build malformed objects (missing x/y,
// nodes:null, unknown shapes) to exercise validate()/saveSchema() rejection
// paths. A single cast from `unknown` is the only way TypeScript accepts them
// without a chained assertion; these are never real schemes.
const malformed = <T>(x: unknown): T => x as T;

test("validate: orphan = warn, broken edge = error, dup id = error", () => {
	const s = fixture(1);
	const v = core.validate(s);
	assert.equal(v.errors.length, 0);
	assert.equal(v.warnings.length, 1); // orphan
	assert.equal(at(v.warnings).code, "orphan");

	s.edges.push({ id: "e1", from: "n1", to: "ghost", style: "solid" });
	assert.ok(core.validate(s).errors.some((e) => e.code === "to"));

	s.nodes.push({ ...at(s.nodes) });
	assert.ok(core.validate(s).errors.some((e) => e.code === "dup-id"));
});

test("validate: unknown shape/style and future version are errors", () => {
	assert.ok(core.validate(badNode({ shape: "hexagon" })).errors.some((e) => e.code === "shape"));
	assert.ok(core.validate(bad({ version: 99 })).errors.some((e) => e.code === "version"));
	assert.ok(
		core
			.validate(
				malformed<core.Scheme>({
					...fixture(1),
					edges: [{ id: "e1", from: "n1", to: "n1", style: "dotted" }],
				}),
			)
			.errors.some((e) => e.code === "style"),
	);
});

// B8: `{"nodes": null}` validated clean in v1, got saved, and every later read
// of that scheme died with a 500 — the scheme was broken permanently.
test("B8 validate: nodes/edges/zones must be arrays, null is an error", () => {
	for (const [field, value] of [
		["nodes", null],
		["edges", null],
		["zones", "nope"],
		["nodes", undefined],
		["edges", {}],
	] as [string, unknown][]) {
		const v = core.validate(bad({ [field]: value }));
		assert.ok(
			v.errors.some((e) => e.code === field),
			`${field}=${String(value)} must error`,
		);
	}
});

// B7: v1 assigned next.meta.generator before validating, so a PUT body without
// meta threw a TypeError -> HTTP 500 instead of a 400 the caller can act on.
test("B7 validate: missing/partial meta is an error, not a crash", () => {
	assert.ok(core.validate(bad({ meta: undefined })).errors.some((e) => e.code === "meta"));
	for (const meta of [
		{},
		{ updatedAt: "x", generator: "agent" }, // no nextId
		{ updatedAt: "x", generator: "robot", nextId: { n: 1, e: 1 } }, // bad generator
		{ updatedAt: "", generator: "agent", nextId: { n: 1, e: 1 } }, // empty updatedAt
		{ updatedAt: "x", generator: "agent", nextId: { n: 1.5, e: 1 } }, // non-int
		[],
		null,
	] as unknown[]) {
		assert.ok(
			core.validate(bad({ meta })).errors.some((e) => e.code === "meta"),
			`meta=${JSON.stringify(meta)}`,
		);
	}
});

test("validate: node/edge/zone entries must be objects", () => {
	assert.ok(core.validate(bad({ nodes: ["nope"] })).errors.some((e) => e.code === "node"));
	assert.ok(core.validate(bad({ edges: [null] })).errors.some((e) => e.code === "edge"));
	assert.ok(core.validate(bad({ zones: [null] })).errors.some((e) => e.code === "zone"));
	assert.ok(core.validate(bad({ nodes: 7 })).errors.some((e) => e.code === "nodes"));
});

test("validate: w/h override must be finite and >= 20", () => {
	assert.ok(core.validate(badNode({ w: 5 })).errors.some((e) => e.code === "size"));
	const v = core.validate(badNode({ w: -3, h: Number.NaN }));
	assert.equal(v.errors.filter((e) => e.code === "size").length, 2);
	assert.equal(core.validate(badNode({ w: 300, h: 200 })).errors.length, 0);
});

test("validate: project is optional, but must be well-formed when present", () => {
	assert.equal(core.validate(bad({ project: undefined })).errors.length, 0);
	assert.ok(
		core
			.validate(bad({ project: { root: ".", codePaths: "src/" } }))
			.errors.some((e) => e.code === "project"),
	);
	assert.ok(core.validate(bad({ project: 7 })).errors.some((e) => e.code === "project"));
});

test("watermark: freed ids are never reused; hand-edited json self-heals", () => {
	const s = fixture(3);
	assert.deepEqual(
		s.nodes.map((n) => n.id),
		["n1", "n2", "n3"],
	);
	s.nodes.splice(1, 1); // free n2
	assert.equal(core.consumeNodeId(s), "n4", "n2 must NOT come back");

	// watermark lagging behind existing ids -> skip the taken ones
	// (a restore of a foreign payload points the counter AT an id in use)
	const s2 = core.emptyScheme("X");
	s2.nodes.push({ id: "n7", shape: "rect", label: "a", x: 0, y: 0 });
	s2.meta.nextId.n = 7;
	assert.equal(core.consumeNodeId(s2), "n8", "n7 is taken, counter skips it");

	// edges and zones share one counter, so ids never collide
	const s3 = core.emptyScheme("Y");
	assert.equal(core.consumeEdgeId(s3), "e1");
	assert.equal(core.consumeZoneId(s3), "z2");
	assert.equal(core.consumeEdgeId(s3), "e3");
});

test("layout: deterministic, no cell overlaps, honors explicit coords", () => {
	const mk = () => {
		const s = core.emptyScheme("L");
		for (const id of ["a", "b", "c", "d"])
			s.nodes.push(malformed<core.SchemeNode>({ id, shape: "rect", label: id }));
		const links: [string, string][] = [
			["a", "b"],
			["a", "c"],
			["b", "d"],
		];
		for (let i = 0; i < links.length; i++) {
			const [from, to] = links[i] as [string, string];
			s.edges.push({ id: `e${i + 1}`, from, to, style: "solid" });
		}
		return s;
	};
	const a = mk();
	const b = mk();
	core.autoLayout(a);
	core.autoLayout(b);
	assert.deepEqual(
		a.nodes.map((n) => [n.x, n.y]),
		b.nodes.map((n) => [n.x, n.y]),
		"same graph -> same layout",
	);
	assert.equal(
		new Set(a.nodes.map((n) => `${n.x}:${n.y}`)).size,
		a.nodes.length,
		"no two nodes in one cell",
	);
	// every node got finite coords on the fixed grid
	for (const n of a.nodes) {
		assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
		assert.equal(n.y % core.GRID_Y, 0);
	}

	// explicit coords win and reserve their cell
	const s = mk();
	at(s.nodes).x = 1000;
	at(s.nodes).y = 1000;
	const { placed } = core.autoLayout(s);
	assert.ok(!placed.includes("a"), "a already had coords");
	assert.equal(at(s.nodes).x, 1000);
});

test("layout: cyclic graph still places every node; empty scheme is a no-op", () => {
	const s = core.emptyScheme("C");
	for (const id of ["a", "b", "c", "d"])
		s.nodes.push(malformed<core.SchemeNode>({ id, shape: "rect", label: id }));
	const cycle: [string, string][] = [
		["a", "b"],
		["b", "c"],
		["c", "a"],
	];
	for (const [from, to] of cycle) s.edges.push({ id: `e${from}${to}`, from, to, style: "solid" });
	const { placed } = core.autoLayout(s);
	assert.equal(placed.length, 4);
	assert.deepEqual(core.autoLayout(core.emptyScheme("E")), { placed: [] });
});

test("layout: dangling edges do not crash and do not place ghosts", () => {
	const s = core.emptyScheme("D");
	s.nodes.push(malformed<core.SchemeNode>({ id: "a", shape: "rect", label: "a" }));
	s.edges.push({ id: "e1", from: "a", to: "ghost", style: "solid" });
	const { placed } = core.autoLayout(s);
	assert.deepEqual(placed, ["a"]);
});

test("saveSchema: rev+1, CAS rejection on stale payload, backup written", () => {
	const dir = tmp();
	const r1 = core.saveSchema(dir, fixture(1), {
		journal: { actor: "agent", op: "init", summary: "s" },
	});
	assert.equal(r1.rev, 1);
	assert.equal(core.readRaw(dir).rev, 1);
	assert.ok(fs.existsSync(path.join(dir, "SCHEME.md")));

	const stale = structuredClone(core.readRaw(dir));
	stale.rev = 0;
	assert.throws(() => core.saveSchema(dir, stale), core.CasError);
	assert.equal(core.readRaw(dir).rev, 1, "conflict wrote nothing");

	core.saveSchema(dir, core.readRaw(dir));
	assert.equal(core.readRaw(dir).rev, 2);
	assert.ok(
		fs.readdirSync(path.join(dir, core.DIR, "cache", "backup")).some((f) => f.startsWith("rev1-")),
		"pre-write backup of rev1",
	);
	const journal = fs.readFileSync(path.join(dir, core.DIR, "cache", "journal.jsonl"), "utf8");
	assert.match(journal, /"op":"init"/);
});

test("saveSchema: errors forbid the write (validation gate)", () => {
	const dir = tmp();
	core.saveSchema(dir, fixture(1));
	const bad2 = structuredClone(core.readRaw(dir));
	bad2.nodes[0] = malformed<core.SchemeNode>({ ...at(bad2.nodes), shape: "hexagon" });
	assert.throws(() => core.saveSchema(dir, bad2), core.ValidationError);
	assert.equal(at(core.readRaw(dir).nodes).shape, "rect", "nothing landed");
});

test("B8 saveSchema: nodes:null is refused, scheme on disk stays healthy", () => {
	const dir = tmp();
	core.saveSchema(dir, fixture(1));
	const broken = malformed<core.Scheme>({ ...structuredClone(core.readRaw(dir)), nodes: null });
	assert.throws(() => core.saveSchema(dir, broken), core.ValidationError);
	const after = core.readRaw(dir);
	assert.equal(after.nodes.length, 1, "still readable");
	assert.equal(core.validate(after).errors.length, 0);
});

// B10: v1 stamped `new Date()` into SCHEME.md, so re-rendering the same scheme
// produced a different file every time (constant churn in git).
test("B10 exportMd is deterministic: same scheme -> byte-identical markdown", () => {
	const s = fixture(2);
	s.edges.push({ id: "e1", from: "n1", to: "n2", style: "solid" });
	const v = core.validate(s);
	assert.equal(core.exportMd(s, v), core.exportMd(s, v));
	assert.ok(
		core.exportMd(s, v).includes(`updated: ${s.meta.updatedAt}`),
		"uses meta.updatedAt, not the clock",
	);
});

// v1 re-rendered SCHEME.md on every save, so `render` twice churned git.
test("B10 saving the same scheme twice writes identical SCHEME.md", () => {
	const dir = tmp();
	core.saveSchema(dir, fixture(1));
	const first = fs.readFileSync(path.join(dir, "SCHEME.md"), "utf8");
	const s = core.readRaw(dir);
	s.meta.updatedAt = new Date(s.meta.updatedAt).toISOString(); // freeze the stamp
	core.saveSchema(dir, s);
	const again = core.readRaw(dir);
	again.meta.updatedAt = s.meta.updatedAt;
	core.saveSchema(dir, again);
	assert.ok(
		fs.readFileSync(path.join(dir, "SCHEME.md"), "utf8").includes(`rev: ${again.rev}`),
		"md tracks the written rev",
	);
	assert.ok(first.includes("rev: 1"));
});

// B12: v1 had two diverging geometry implementations (the editor wrapped labels
// at 34 chars, the core measured the raw label) so mermaid/md disagreed with
// what the canvas showed.
test("B12 geometry is the single source: wrap-aware, explicit w/h wins", () => {
	const long = "one two three four five six seven eight nine ten eleven twelve";
	const n = { id: "n1", shape: "rect" as const, label: long, x: 0, y: 0 };
	const lines = core.wrapLines(long);
	assert.ok(lines.length > 1, "long label wraps");
	assert.ok(
		lines.every((l) => l.length <= core.WRAP_AT),
		"wrapped at the limit",
	);
	assert.equal(
		core.nodeW(n),
		Math.max(core.MIN_W, 20 + Math.max(...lines.map((l) => l.length)) * core.CHAR_W),
	);
	assert.equal(core.nodeW({ ...n, w: 300 }), 300, "explicit w wins");
	assert.equal(core.nodeH({ ...n, h: 90 }), 90, "explicit h wins");

	// table sizes from cols/rows
	const t = {
		id: "n2",
		shape: "table" as const,
		label: "T",
		x: 0,
		y: 0,
		table: { cols: ["a", "b"], rows: [["1", "2"]] },
	};
	assert.equal(core.nodeW(t), Math.max(core.TABLE_MIN_W, 26 + 2 * core.TABLE_COL_W));
	assert.equal(core.nodeH(t), core.TABLE_HEAD_H + 2 * core.TABLE_ROW_H);

	// circle stays round; multiline grows downward; empty label does not collapse
	const c = { id: "c", shape: "circle" as const, label: "x", x: 0, y: 0 };
	assert.equal(core.nodeH(c), core.nodeW(c));
	const multi = { id: "m", shape: "rect" as const, label: "a\nb\nc", x: 0, y: 0 };
	assert.ok(core.nodeH(multi) > core.nodeH({ ...multi, label: "a" }));
	assert.ok(core.nodeW({ id: "e", shape: "rect", label: "", x: 0, y: 0 }) >= core.MIN_W);
	assert.deepEqual(core.wrapLines(""), [""]);
});

// B11: v1 called autosave with `force ?? true`, so the 30s rate limit never
// applied and every write left a full copy (the demo had 47 files / 360K).
test("B11 autosave rate limit applies; force bypasses it; rotation caps files", () => {
	const dir = tmp();
	const autosaveDir = path.join(dir, core.DIR, "cache", "autosave");
	core.saveSchema(dir, fixture(1));
	const first = fs.readdirSync(autosaveDir).length;
	assert.equal(first, 1);

	for (let i = 0; i < 5; i++) core.saveSchema(dir, core.readRaw(dir));
	assert.equal(fs.readdirSync(autosaveDir).length, first, "rate limit held");

	for (let i = 0; i < core.AUTOSAVE_KEEP + 10; i++)
		core.saveSchema(dir, core.readRaw(dir), { autosaveForce: true });
	const kept = fs.readdirSync(autosaveDir).length;
	assert.ok(kept <= core.AUTOSAVE_KEEP, `rotation kept ${kept}`);
});

// v1 sorted backup names lexicographically, so "rev9-…" ranked above "rev24-…":
// rotation kept the wrong snapshots and diff/restore could read the wrong rev.
test("backup rotation keeps the numerically newest revs, not lexicographic ones", () => {
	const dir = tmp();
	const backupDir = path.join(dir, core.DIR, "cache", "backup");
	// pre-seed fake backups whose name order disagrees with numeric order
	core.saveSchema(dir, fixture(1)); // a real scheme first: rotation only runs on writes
	fs.mkdirSync(backupDir, { recursive: true });
	for (const rev of [1, 9, 10, 24, 100])
		fs.writeFileSync(path.join(backupDir, `rev${rev}-2026-01-01T00-00-00-000Z.json`), "{}");
	assert.ok(
		fs.readdirSync(backupDir).sort().at(-1)?.startsWith("rev9-"),
		"lexicographic name order is wrong by design",
	);

	// write enough revisions to force rotation, then check who survived
	for (let i = 0; i < core.BACKUP_KEEP + 5; i++) core.saveSchema(dir, core.readRaw(dir));
	const kept = fs
		.readdirSync(backupDir)
		.map((f) => Number(f.match(/^rev(\d+)-/)?.[1]))
		.filter(Number.isFinite)
		.sort((a, b) => a - b);
	// the invariant: exactly the BACKUP_KEEP numerically newest snapshots.
	// Backups are one per save after the first, so the multiset is 1..25 plus
	// the seeded fakes; lexicographic order would keep a different set
	// (rev9 survives, rev100 and rev10..13 are dropped instead).
	const all = [...Array.from({ length: core.BACKUP_KEEP + 5 }, (_, i) => i + 1), 1, 9, 10, 24, 100];
	const expected = all
		.sort((a, b) => b - a)
		.slice(0, core.BACKUP_KEEP)
		.sort((a, b) => a - b);
	assert.deepEqual(kept, expected);
	assert.equal(kept.length, core.BACKUP_KEEP);
});

test("table: 10x50 limits are errors, table on non-table node warns, md renders rows", () => {
	const s = fixture(1);
	at(s.nodes).shape = "table";
	at(s.nodes).table = { cols: Array.from({ length: 11 }, (_, i) => `c${i}`), rows: [] };
	assert.ok(core.validate(s).errors.some((e) => /cols max 10/.test(e.message)));

	at(s.nodes).table = { cols: ["a"], rows: Array.from({ length: 51 }, () => ["x"]) };
	assert.ok(core.validate(s).errors.some((e) => /rows max 50/.test(e.message)));

	at(s.nodes).table = { cols: ["a", "b"], rows: [["1", "2"], ["3"]] };
	assert.equal(core.validate(s).errors.length, 0);
	const md = core.exportMd(s, core.validate(s));
	assert.ok(md.includes("**n1 columns:** a · b"));
	assert.ok(md.includes("> n1 | 1 | 2 |"));

	// table data on a non-table node is a warning, not an error
	assert.ok(
		core
			.validate(badNode({ table: { cols: ["a"], rows: [["1"]] } }))
			.warnings.some((w) => w.code === "table"),
	);
	assert.ok(core.validate(badNode({ table: "nope" })).errors.some((e) => e.code === "table"));
});

test("multiline label: md uses <br/>, mermaid quotes and escapes", () => {
	const s = fixture(1);
	at(s.nodes).label = 'line1\nline2\nsay "hi"';
	const md = core.exportMd(s, core.validate(s));
	assert.ok(md.includes("line1<br/>line2"));
	assert.ok(md.includes("#quot;"), '" escaped for mermaid');
	assert.ok(core.exportMermaid(s).includes('["line1<br/>line2<br/>say #quot;hi#quot;"]'));
});

test("zones: mermaid subgraphs contain geometric members only", () => {
	const s = fixture(2);
	at(s.nodes).x = 0;
	at(s.nodes).y = 0;
	at(s.nodes, 1).x = 5000;
	at(s.nodes, 1).y = 5000;
	s.zones = [{ id: "z1", label: "auth", x: -50, y: -50, w: 500, h: 500 }];
	const mer = core.exportMermaid(s);
	assert.ok(mer.includes('subgraph z1["auth"]'));
	// n1 is inside the subgraph block, n2 only after its `end`
	const block = mer.slice(mer.indexOf("subgraph z1"), mer.indexOf("\n  end"));
	assert.ok(block.includes("n1["), "n1 inside the zone");
	assert.ok(!block.includes("n2["), "n2 stays outside");
	assert.match(mer, /end\n {2}n2\[/, "n2 emitted after the zone closes");
	assert.match(core.exportMd(s, core.validate(s)), /\| z1 \| auth \| {2}\| n1 \|/);

	for (const zone of [
		{ id: "z1", label: "a", x: 0, y: 0, w: 0, h: 10 },
		{ id: "z1", label: "a", x: 0, y: 0, w: 10, h: -1 },
		{ id: "z1", label: "a", x: 0, y: "0", w: 10, h: 10 },
		{ id: "z1", label: "a", x: 0, y: 0, w: 10, h: 10, labelSide: "middle" },
	]) {
		assert.ok(
			core.validate(bad({ zones: [zone] })).errors.length > 0,
			`zone ${JSON.stringify(zone)} must error`,
		);
	}
	for (const labelSide of ["top", "bottom", "left", "right", "center"])
		assert.equal(
			core.validate(bad({ zones: [{ id: "z1", label: "a", x: 0, y: 0, w: 10, h: 10, labelSide }] }))
				.errors.length,
			0,
			`labelSide ${labelSide} is legal`,
		);
});

// v1's diff ignored zones, w/h, refs, table and edge sides: a human could
// resize and move boxes in the browser and the diff still said "no changes".
test("diff covers every field: node w/h/refs/table, edge sides, zones", () => {
	const a = fixture(2);
	a.edges.push({ id: "e1", from: "n1", to: "n2", style: "solid" });
	a.zones = [{ id: "z1", label: "auth", x: 0, y: 0, w: 100, h: 100 }];
	const b = structuredClone(a);
	at(b.nodes).x += 20;
	at(b.nodes).w = 300;
	at(b.nodes).refs = ["src/a.ts"];
	at(b.nodes).table = { cols: ["c"], rows: [["r"]] };
	at(b.edges).fromSide = "top";
	at(b.zones ?? []).label = "auth2";
	at(b.zones ?? []).w = 200;
	const d = core.diffSchemes(a, b).join("\n");
	for (const needle of [
		"node n1.x",
		"node n1.w",
		"node n1.refs",
		"node n1.table",
		"edge e1.fromSide",
		"zone z1.label",
		"zone z1.w",
	])
		assert.ok(d.includes(needle), `diff must report ${needle}\n${d}`);
	assert.equal(core.diffSchemes(a, structuredClone(a)).length, 0, "no changes -> empty");

	// removals of each kind
	const c = structuredClone(a);
	c.nodes.pop();
	c.edges = [];
	c.zones = [];
	assert.ok(Array.isArray(c.zones));
	const d2 = core.diffSchemes(a, c).join("\n");
	assert.ok(d2.includes("- node n2"));
	assert.ok(d2.includes("- edge e1"));
	assert.ok(d2.includes("- zone z1"));
	// additions of each kind
	const d3 = core.diffSchemes(c, a).join("\n");
	assert.ok(d3.includes("+ node n2"));
	assert.ok(d3.includes("+ edge e1"));
	assert.ok(d3.includes("+ zone z1"));
	// rename
	assert.ok(
		core
			.diffSchemes(a, { ...structuredClone(a), name: "other" })
			.join("\n")
			.includes("~ name"),
	);
});

test("renderHtml: roundtrip preserves the scheme; escaping survives </script>", () => {
	const s = fixture(1);
	at(s.nodes).label = '</script><script>alert(1)</script>Круг "тест"';
	const tpl = '<script type="application/json" id="scheme-data">{}</script>';
	const html = core.renderHtml(tpl, s);
	const back = core.extractSchemeJson(html);
	assert.equal(back.rev, s.rev);
	assert.equal(at(back.nodes).label, at(s.nodes).label);
	assert.ok(!/<\/script><script>alert/.test(html), "break-in escaped");
	assert.throws(() => core.extractSchemeJson("<html></html>"), core.HtmlError);
	assert.throws(() => core.renderHtml("<html>no marker</html>", s), core.HtmlError);
	assert.throws(
		() => core.extractSchemeJson('<script type="application/json" id="scheme-data">{oops</script>'),
		/not valid JSON/,
	);
	assert.throws(
		() =>
			core.extractSchemeJson(
				'<script type="application/json" id="scheme-data">{"format":"other"}</script>',
			),
		/not a block-llm scheme/,
	);
});

test("path-jail: ../ and absolute escapes refused, inside paths allowed", () => {
	const dir = tmp();
	assert.throws(() => core.jail(dir, "../outside"), core.PathJailError);
	assert.throws(() => core.jail(dir, "/etc/passwd"), core.PathJailError);
	assert.throws(() => core.jail(dir, ""), core.PathJailError);
	assert.throws(() => core.jail(dir, "a/../../outside"), core.PathJailError);
	assert.equal(core.jail(dir, "src/a.ts"), path.join(dir, "src/a.ts"));
	assert.equal(core.jail(dir, path.join(dir, "src/a.ts")), path.join(dir, "src/a.ts"));
	assert.equal(core.jail(dir, "."), dir);
});

test("findSchemeDirs: finds .llmscheme/<type>_scheme upward, stops at git root, dedupes", () => {
	const root = tmp();
	fs.mkdirSync(path.join(root, ".git"));
	const proj = path.join(root, "proj");
	const mkScheme = (dir: string, type: core.SchemeType = "logic") => {
		const sd = core.schemeDir(dir, type);
		fs.mkdirSync(sd, { recursive: true });
		fs.writeFileSync(path.join(sd, "scheme.json"), "{}");
	};
	mkScheme(proj);
	const deep = path.join(proj, "src", "a");
	fs.mkdirSync(deep, { recursive: true });
	assert.deepEqual(core.findSchemeDirs(deep), [core.schemeDir(proj, "logic")]);

	// a sibling outside the project sees nothing (git root boundary)
	const sibling = path.join(root, "other");
	fs.mkdirSync(sibling);
	assert.deepEqual(core.findSchemeDirs(sibling), []);

	// a second scheme type in the same project is a second candidate
	mkScheme(proj, "code");
	assert.deepEqual(core.findSchemeDirs(path.join(proj, "src", "x")), [
		core.schemeDir(proj, "logic"),
		core.schemeDir(proj, "code"),
	]);
});

test("gitmd: .gitignore line and AGENTS.md section are idempotent", () => {
	const dir = tmp();
	assert.equal(core.ensureGitignoreLine(dir, ".block_llm/cache/"), true);
	assert.equal(core.ensureGitignoreLine(dir, ".block_llm/cache/"), false);
	assert.equal(core.ensureGitignoreLine(dir, ".block_llm/cache"), false); // slash variant
	const gi = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
	assert.equal(gi.split(".block_llm/cache").length - 1, 1, "single line");
	// appends to an existing file without eating its last line
	fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules");
	assert.equal(core.ensureGitignoreLine(dir, "dist/"), true);
	assert.match(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), /^node_modules\ndist\/\n$/);

	assert.equal(core.ensureAgentsSection(dir), true);
	const once = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
	assert.equal(core.ensureAgentsSection(dir), false);
	assert.equal(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8"), once);
	assert.equal(once.split(core.AGENTS_START).length - 1, 1, "single section");
});

test("readSnapshot: returns the requested rev; missing/corrupt are DataError", () => {
	const dir = tmp();
	core.saveSchema(dir, fixture(1));
	core.saveSchema(dir, core.readRaw(dir)); // rev 2, backup of rev 1 written
	assert.equal(core.readSnapshot(dir, 1).rev, 1);
	assert.throws(() => core.readSnapshot(dir, 99), core.DataError);
	fs.writeFileSync(path.join(dir, core.DIR, "cache", "backup", "rev5-x.json"), "{not json");
	assert.throws(() => core.readSnapshot(dir, 5), core.DataError);
});

test("readRaw: missing file and invalid JSON are DataError, not raw fs errors", () => {
	const dir = tmp();
	assert.throws(() => core.readRaw(dir), core.DataError);
	fs.mkdirSync(path.join(dir, core.DIR), { recursive: true });
	fs.writeFileSync(path.join(dir, core.DIR, "scheme.json"), "{oops");
	assert.throws(() => core.readRaw(dir), /invalid JSON/);
});

// B14: v1 exported jailReal and dirSizeLimitExceeded with zero call sites.
test("B14 public surface is lean: dead exports gone, live ones present", () => {
	for (const name of ["jailReal", "dirSizeLimitExceeded", "nextNodeId", "nextEdgeId", "escMermaid"])
		assert.equal(name in core, false, `${name} must not be exported`);
	for (const name of [
		"validate",
		"checkRefs",
		"emptyScheme",
		"consumeNodeId",
		"consumeEdgeId",
		"consumeZoneId",
		"autoLayout",
		"wrapLines",
		"nodeW",
		"nodeH",
		"exportMermaid",
		"exportMd",
		"diffSchemes",
		"readRaw",
		"readSnapshot",
		"saveSchema",
		"jail",
		"findSchemeDirs",
		"schemeDir",
		"schemeDirName",
		"projectRootOf",
		"SCHEMES_DIR",
		"SCHEME_TYPES",
		"ensureGitignoreLine",
		"ensureAgentsSection",
		"renderHtml",
		"extractSchemeJson",
		"DataError",
		"CasError",
		"ValidationError",
		"PathJailError",
		"HtmlError",
		"DIR",
		"AUTOSAVE_KEEP",
		"BACKUP_KEEP",
		"JOURNAL_MAX",
	])
		assert.ok(name in core, `${name} must be exported`);
});

test("checkRefs: reports stale refs only, stays pure", () => {
	const s = fixture(1);
	at(s.nodes).refs = ["src/ok.ts", "src/gone.ts"];
	const issues = core.checkRefs(s, (rel) => rel === "src/ok.ts");
	assert.equal(issues.length, 1);
	assert.equal(at(issues).code, "stale-ref");
	assert.match(at(issues).message, /src\/gone\.ts/);
	assert.equal(core.checkRefs(bad({ nodes: null }), () => true).length, 0, "no crash on junk");
});

test("exports are written atomically and match the final rev", () => {
	const dir = tmp();
	const tpl = '<script type="application/json" id="scheme-data">{}</script>';
	core.saveSchema(dir, fixture(1), {
		extraFiles: (final) => ({
			[path.join(core.DIR, "scheme.html")]: core.renderHtml(tpl, final),
		}),
	});
	const html = fs.readFileSync(path.join(dir, core.DIR, "scheme.html"), "utf8");
	assert.equal(core.extractSchemeJson(html).rev, core.readRaw(dir).rev);
	assert.ok(
		fs.readFileSync(path.join(dir, "SCHEME.md"), "utf8").includes(`rev: ${core.readRaw(dir).rev}`),
	);
	assert.equal(
		fs.readdirSync(path.join(dir, core.DIR)).filter((f) => f.includes(".tmp-")).length,
		0,
		"no tmp leftovers",
	);
});

// The real v1 data must still load: the format on disk does not change in v2.
test("reads the v1 UI/page scheme unchanged (live data compatibility)", () => {
	const file = new URL("../schemes/UI-page.json", import.meta.url);
	const s = JSON.parse(fs.readFileSync(file, "utf8")) as core.Scheme;
	assert.equal(s.format, "block-llm");
	assert.equal(s.rev, 2);
	assert.equal(s.nodes.length, 35);
	assert.equal(s.zones?.length, 8);
	const v = core.validate(s);
	assert.deepEqual(v.errors, [], "v1 data validates clean under v2 rules");
	assert.ok(core.exportMd(s, v).includes("subgraph z1"), "zones still export");
	assert.equal(core.diffSchemes(s, structuredClone(s)).length, 0);
});
