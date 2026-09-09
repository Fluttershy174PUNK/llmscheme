// CLI tests: the real binary against real temp projects (node --test).
// Exit codes matter — agents branch on them: 0 ok, 1 data/CAS, 2 usage.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as core from "../core/index.ts";

const repo = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
);
const BLOCK = path.join(repo, "src", "cli", "block.ts");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "blm-cli-"));

interface Run {
	status: number;
	stdout: string;
	stderr: string;
}

// run the CLI in `cwd`; never throws on non-zero exit (we assert on codes)
function run(args: string[], cwd: string, input?: string): Run {
	try {
		const stdout = execFileSync("node", [BLOCK, ...args], {
			cwd,
			encoding: "utf8",
			input,
			stdio: ["pipe", "pipe", "pipe"],
		});
		return { status: 0, stdout, stderr: "" };
	} catch (e) {
		const err = e as { status?: number; stdout?: string; stderr?: string };
		return {
			status: err.status ?? -1,
			stdout: err.stdout ?? "",
			stderr: err.stderr ?? "",
		};
	}
}

const fresh = () => {
	const dir = tmp();
	const r = run(["init", dir, "--name", "T"], dir);
	assert.equal(r.status, 0, `init failed: ${r.stderr}`);
	// the CLI operates on the scheme dir (.llmscheme/logic_scheme by default)
	return core.schemeDir(dir, "logic");
};

test("CLI runs straight from .ts: init -> node x3 -> edge x2 -> validate -> get", () => {
	const dir = fresh();
	assert.equal(
		run(["node", "add", "--label", "A", "--ref", "src/a.ts"], dir).status,
		0,
	);
	run(["node", "add", "--label", "B"], dir);
	run(["node", "add", "--label", "C", "--shape", "diamond"], dir);
	run(["edge", "add", "--from", "n1", "--to", "n2"], dir);
	assert.equal(
		run(["edge", "add", "--from", "n2", "--to", "n3", "--style", "dashed"], dir)
			.status,
		0,
	);

	const rev = JSON.parse(
		fs.readFileSync(path.join(dir, core.DIR, "scheme.json"), "utf8"),
	).rev;
	assert.equal(rev, 6, "init 1 + 3 nodes + 2 edges");
	assert.equal(run(["validate", "."], dir).status, 0);
	assert.equal(JSON.parse(run(["get", "--json"], dir).stdout).rev, 6);

	// exports follow every write
	assert.ok(
		fs.readFileSync(path.join(dir, "SCHEME.md"), "utf8").includes("rev: 6"),
	);
	const s = core.readRaw(dir);
	assert.equal(s.nodes.length, 3);
	assert.equal(s.edges.length, 2);
});

test("init is idempotent: no dup gitignore line, single AGENTS.md section", () => {
	const proj = tmp();
	run(["init", proj, "--name", "T"], proj);
	run(["init", proj, "--name", "T"], proj);
	// .gitignore and AGENTS.md live at the project root
	const gi = fs.readFileSync(path.join(proj, ".gitignore"), "utf8");
	assert.equal(
		gi.split(`${core.SCHEMES_DIR}/`).length - 1,
		1,
		"one gitignore line",
	);
	const ag = fs.readFileSync(path.join(proj, "AGENTS.md"), "utf8");
	assert.equal(ag.split(core.AGENTS_START).length - 1, 1, "one AGENTS section");
	// VERSION lands once, inside the scheme dir
	assert.match(
		fs.readFileSync(path.join(core.schemeDir(proj, "logic"), "VERSION"), "utf8"),
		/^skill: /,
	);
});

test("node update/remove: w/h override, table cols/rows, edges cleaned with the node", () => {
	const dir = fresh();
	run(["node", "add", "--label", "A"], dir);
	run(["node", "add", "--label", "B"], dir);
	run(["edge", "add", "--from", "n1", "--to", "n2"], dir);

	run(
		["node", "update", "--id", "n1", "--label", "A2", "--w", "300", "--h", "90"],
		dir,
	);
	let s = core.readRaw(dir);
	assert.equal(s.nodes[0]?.label, "A2");
	assert.equal(s.nodes[0]?.w, 300);
	assert.equal(s.nodes[0]?.h, 90);

	run(
		[
			"node",
			"add",
			"--shape",
			"table",
			"--label",
			"Spec",
			"--table-cols",
			"a,b",
			"--table-rows",
			"1|2;3|4",
		],
		dir,
	);
	s = core.readRaw(dir);
	const tbl = s.nodes.find((n) => n.shape === "table");
	assert.deepEqual(tbl?.table?.cols, ["a", "b"]);
	assert.deepEqual(tbl?.table?.rows, [
		["1", "2"],
		["3", "4"],
	]);

	// removing a node takes its edges with it
	assert.equal(run(["node", "remove", "--id", "n1"], dir).status, 0);
	s = core.readRaw(dir);
	assert.ok(!s.nodes.some((n) => n.id === "n1"));
	assert.equal(s.edges.length, 0, "orphaned edge removed");
});

test("w/h validation reaches the CLI path (v1 service accepted w:5,h:-3)", () => {
	const dir = fresh();
	run(["node", "add", "--label", "A"], dir);
	const r = run(["node", "update", "--id", "n1", "--w", "5", "--h", "-3"], dir);
	assert.equal(r.status, 1, "invalid size must fail");
	assert.match(r.stderr, /w must be a number/);
	// nothing landed
	assert.equal(core.readRaw(dir).nodes[0]?.w, undefined);
});

test("edge/zone add-update-remove", () => {
	const dir = fresh();
	run(["node", "add", "--label", "A"], dir);
	run(["node", "add", "--label", "B"], dir);

	const e = run(
		[
			"edge",
			"add",
			"--from",
			"n1",
			"--to",
			"n2",
			"--label",
			"ok",
			"--from-side",
			"right",
		],
		dir,
	);
	assert.equal(e.status, 0);
	assert.equal(
		run(["edge", "update", "--id", "e1", "--style", "dashed"], dir).status,
		0,
	);
	assert.equal(core.readRaw(dir).edges[0]?.style, "dashed");
	assert.equal(core.readRaw(dir).edges[0]?.fromSide, "right");
	assert.equal(run(["edge", "remove", "--id", "e1"], dir).status, 0);

	// zones share the edge watermark, so after e1 was consumed the first zone is
	// z2 — take the id from the command output instead of hardcoding it
	const z = run(
		[
			"zone",
			"add",
			"--json",
			"--label",
			"pipeline",
			"--x",
			"0",
			"--y",
			"0",
			"--w",
			"400",
			"--h",
			"300",
			"--label-side",
			"center",
		],
		dir,
	);
	assert.equal(z.status, 0, z.stderr);
	const zid = (JSON.parse(z.stdout) as { id: string }).id;
	assert.equal(core.readRaw(dir).zones?.[0]?.labelSide, "center");
	run(["zone", "update", "--id", zid, "--w", "500"], dir);
	assert.equal(core.readRaw(dir).zones?.[0]?.w, 500);
	assert.equal(run(["zone", "remove", "--id", zid], dir).status, 0);
	assert.equal(core.readRaw(dir).zones?.length, 0);
});

test("CAS: stale --rev exits 1 with friendly text and writes nothing", () => {
	const dir = fresh();
	run(["node", "add", "--label", "A"], dir);
	const rev = core.readRaw(dir).rev;
	const r = run(["node", "add", "--label", "B", "--rev", String(rev + 5)], dir);
	assert.equal(r.status, 1);
	assert.match(r.stderr, /^conflict: /);
	assert.equal(core.readRaw(dir).nodes.length, 1, "nothing written on conflict");
	// the correct rev is accepted
	assert.equal(
		run(["node", "add", "--label", "B", "--rev", String(rev)], dir).status,
		0,
	);
});

test("put from stdin: CAS against disk, payload rev ignored, exports rebuilt", () => {
	const dir = fresh();
	run(["node", "add", "--label", "A"], dir);
	const cur = core.readRaw(dir);
	const rev = cur.rev;

	cur.nodes.push({ id: "n9", shape: "rect", label: "from stdin", x: 40, y: 40 });
	cur.rev = 999; // payload rev is stale by definition; disk rev wins
	const r = run(["put", "-"], dir, JSON.stringify(cur));
	assert.equal(r.status, 0, r.stderr);
	const s = core.readRaw(dir);
	assert.equal(s.rev, rev + 1);
	assert.ok(s.nodes.some((n) => n.id === "n9"));

	// --rev must match disk
	const r2 = run(["put", "-", "--rev", "1"], dir, JSON.stringify(s));
	assert.equal(r2.status, 1);
	assert.match(r2.stderr, /^conflict: /);
});

test("put rejects a broken payload instead of corrupting the scheme (B8)", () => {
	const dir = fresh();
	const cur = core.readRaw(dir);
	const broken = { ...cur, nodes: null };
	const r = run(["put", "-"], dir, JSON.stringify(broken));
	assert.equal(r.status, 1);
	assert.match(r.stderr, /^invalid: /);
	assert.match(r.stderr, /nodes must be an array/);
	// the scheme on disk is still healthy and readable
	assert.equal(core.validate(core.readRaw(dir)).errors.length, 0);
	assert.equal(run(["get", "."], dir).status, 0);
});

test("validate exits 1 on errors and reports stale refs as warnings", () => {
	const dir = fresh();
	run(["node", "add", "--label", "A", "--ref", "src/missing.ts"], dir);
	const r = run(["validate", "."], dir);
	assert.equal(r.status, 0, "a stale ref is a warning, not an error");
	assert.match(r.stdout, /stale-ref|does not exist/);

	// break it on disk: an unknown shape. Raw JSON, not a SchemeNode — we are
	// corrupting a file deliberately, so no cast is needed to model it.
	const file = path.join(dir, core.DIR, "scheme.json");
	const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
		nodes: { shape: string }[];
	};
	if (raw.nodes[0]) raw.nodes[0].shape = "hexagon";
	fs.writeFileSync(file, JSON.stringify(raw));
	const bad = run(["validate", "."], dir);
	assert.equal(bad.status, 1);
	assert.match(bad.stdout, /FAIL/);
	assert.match(bad.stdout, /unknown shape/);
	// --json prints JSON only, no human prefix
	const j = run(["validate", "--json", "."], dir);
	assert.equal(j.status, 1);
	const parsed = JSON.parse(j.stdout) as { ok: boolean; errors: unknown[] };
	assert.equal(parsed.ok, false);
	assert.ok(parsed.errors.length > 0);
});

test("diff reports every changed field and handles a missing snapshot", () => {
	const dir = fresh();
	run(["node", "add", "--label", "A"], dir);
	const rev = core.readRaw(dir).rev;
	run(["node", "update", "--id", "n1", "--label", "B", "--w", "300"], dir);
	run(
		[
			"zone",
			"add",
			"--label",
			"z",
			"--x",
			"0",
			"--y",
			"0",
			"--w",
			"10",
			"--h",
			"10",
		],
		dir,
	);

	const d = run(["diff", "--rev", String(rev)], dir);
	assert.equal(d.status, 0);
	assert.match(d.stdout, /node n1\.label/);
	assert.match(d.stdout, /node n1\.w/); // v1's diff missed w/h entirely
	assert.match(d.stdout, /zone z1/); // …and missed zones too

	// a rev above current: nothing to compare
	assert.match(
		run(["diff", "--rev", String(rev + 50)], dir).stdout,
		/nothing changed/,
	);
	// a rev below current with its backup present: real diff
	assert.equal(run(["diff", "--rev", String(rev - 1)], dir).status, 0);
	// a rev below current whose backup was rotated away -> exit 1, no stacktrace
	fs.rmSync(path.join(dir, core.DIR, "cache", "backup"), {
		recursive: true,
		force: true,
	});
	const gone = run(["diff", "--rev", "1"], dir);
	assert.equal(gone.status, 1);
	assert.match(gone.stdout, /no snapshot for rev 1/);
	assert.ok(!gone.stderr.includes("at Module"), "no stacktrace");
});

test("restore rolls a rev back as a NEW write (history stays append-only)", () => {
	const dir = fresh();
	run(["node", "add", "--label", "A"], dir);
	const goodRev = core.readRaw(dir).rev;
	run(["node", "add", "--label", "B"], dir);
	run(["node", "add", "--label", "C"], dir);
	assert.equal(core.readRaw(dir).nodes.length, 3);

	const r = run(["restore", "--rev", String(goodRev)], dir);
	assert.equal(r.status, 0, r.stderr);
	const s = core.readRaw(dir);
	assert.equal(s.nodes.length, 1, "rolled back to rev 2 content");
	assert.ok(s.rev > goodRev, "as a new rev, not a rewind");
	assert.match(r.stdout, /restored rev 2 as new rev/);

	// no snapshot for a rev that never existed
	const bad = run(["restore", "--rev", "999"], dir);
	assert.equal(bad.status, 1);
	assert.match(bad.stderr, /no snapshot for rev 999/);
	assert.equal(
		run(["restore"], dir).status,
		2,
		"missing --rev is a usage error",
	);
});

test("history shows the journal tape and survives a corrupt line", () => {
	const dir = fresh();
	run(["node", "add", "--label", "A"], dir);
	run(["node", "add", "--label", "B"], dir);
	const h = run(["history", "--json"], dir);
	assert.equal(h.status, 0);
	const j = JSON.parse(h.stdout);
	assert.ok(j.entries.length >= 3, "init + 2 node adds");
	assert.ok(j.entries.every((e: { actor: string }) => e.actor === "agent"));

	// a truncated tail line must not kill the whole history
	const journal = path.join(dir, core.DIR, "cache", "journal.jsonl");
	fs.appendFileSync(journal, '{"ts":"broken\n');
	assert.equal(run(["history", "."], dir).status, 0);
});

test("sync rebuilds exports around hand-edited json; render does not bump rev", () => {
	const dir = fresh();
	run(["node", "add", "--label", "A"], dir);
	const file = path.join(dir, core.DIR, "scheme.json");
	const s = JSON.parse(fs.readFileSync(file, "utf8"));
	s.nodes[0].label = "hand edited";
	fs.writeFileSync(file, JSON.stringify(s));

	assert.equal(run(["render", "."], dir).status, 0);
	assert.equal(core.readRaw(dir).rev, s.rev, "render does not bump rev");
	assert.ok(
		fs.readFileSync(path.join(dir, "SCHEME.md"), "utf8").includes("hand edited"),
	);

	assert.equal(run(["sync", "."], dir).status, 0);
	assert.equal(core.readRaw(dir).rev, s.rev + 1, "sync is a write");

	// tier C: hand the agent a file, rebuild from it
	const payload = path.join(dir, "incoming.json");
	const cur = core.readRaw(dir);
	cur.nodes.push({ id: "n7", shape: "rect", label: "from file", x: 0, y: 0 });
	fs.writeFileSync(payload, JSON.stringify(cur));
	assert.equal(run(["sync", "--from", payload], dir).status, 0);
	assert.ok(core.readRaw(dir).nodes.some((n) => n.id === "n7"));
});

test("doctor: clean project passes, stale export and missing files are reported", () => {
	const dir = fresh();
	run(["node", "add", "--label", "A"], dir);
	assert.equal(
		run(["doctor", "."], dir).status,
		0,
		run(["doctor", "."], dir).stdout,
	);

	// stale SCHEME.md
	fs.writeFileSync(path.join(dir, "SCHEME.md"), "# T\n\nrev: 1\n");
	const stale = run(["doctor", "."], dir);
	assert.equal(stale.status, 1);
	assert.match(stale.stdout, /SCHEME\.md rev mismatch/);
	run(["render", "."], dir);
	assert.equal(run(["doctor", "."], dir).status, 0);

	// missing scheme in an empty dir: no scheme found -> usage error (2)
	assert.equal(run(["doctor", tmp()], tmp()).status, 2);
});

test("usage errors exit 2 with the usage text, never a stacktrace", () => {
	const dir = fresh();
	for (const args of [
		["nosuchcommand"],
		["node"],
		["node", "nosuch"],
		["node", "add"],
		["edge", "add", "--from", "n1"],
		["zone", "add", "--label", "z"],
		["node", "update"],
		["put"],
		["--bogus-flag"],
		["node", "add", "--label", "x", "--x", "notanumber"],
	] as string[][]) {
		const r = run(args, dir);
		assert.equal(
			r.status,
			2,
			`${args.join(" ")} -> ${r.status} (${r.stderr.slice(0, 80)})`,
		);
		assert.match(r.stderr, /usage: block/);
		assert.ok(
			!r.stderr.includes("at Module"),
			`${args.join(" ")} leaked a stacktrace`,
		);
	}
});

test("no scheme found upward exits 2; multiple types asks instead of guessing", () => {
	const dir = tmp();
	// no path argument -> searches upward from cwd and finds nothing (2).
	// An explicit path is a data error instead (readRaw: "no scheme at ...").
	const r = run(["get"], dir);
	assert.equal(r.status, 2);
	assert.match(r.stderr, /no \.llmscheme\//);
	assert.equal(run(["get", "."], dir).status, 2);

	// two scheme types in one project: cwd nested under both
	const proj = tmp();
	fs.mkdirSync(path.join(proj, ".git"));
	run(["init", proj, "--name", "L", "--type", "logic"], proj);
	run(["init", proj, "--name", "C", "--type", "code"], proj);
	const multi = run(["get"], proj);
	assert.equal(multi.status, 2);
	assert.match(multi.stderr, /multiple schemes found/);
	// --type disambiguates
	assert.equal(run(["get", "--type", "logic"], proj).status, 0);
	// an explicit scheme dir always wins
	assert.equal(run(["get", core.schemeDir(proj, "logic")], proj).status, 0);
});

test("arbitrary scheme types: --type accepts any safe word, rejects bad ones", () => {
	const proj = tmp();
	fs.mkdirSync(path.join(proj, ".git"));
	// a non-standard type (e.g. "db") works and lands in <type>_scheme
	assert.equal(
		run(["init", proj, "--name", "DB", "--type", "db"], proj).status,
		0,
	);
	assert.ok(fs.existsSync(path.join(core.schemeDir(proj, "db"), "scheme.json")));
	assert.equal(run(["get", "--type", "db"], proj).status, 0);
	// unsafe names are rejected with a usage error (2), not a path escape
	for (const bad of ["../x", "a/b", "", "Has Space", "Àb"]) {
		const r = run(["init", proj, "--name", "B", "--type", bad], proj);
		assert.equal(r.status, 2, `--type "${bad}" must be rejected`);
	}
});

test("pull requires --url, --key and --name (never a hardcoded endpoint)", () => {
	const dir = tmp();
	for (const args of [
		["pull"],
		["pull", "--url", "http://x"],
		["pull", "--url", "http://x", "--key", "llm_x"],
	] as string[][]) {
		const r = run(args, dir);
		assert.equal(r.status, 2);
		assert.match(r.stderr, /pull requires --url, --key and --name/);
	}
	// unreachable service: a data error (1), not a stacktrace
	const bad = run(
		[
			"pull",
			"--url",
			"http://127.0.0.1:1",
			"--key",
			"llm_x",
			"--name",
			"web/auth",
			dir,
		],
		dir,
	);
	assert.equal(bad.status, 1);
	assert.match(bad.stderr, /^error: /);
	assert.ok(!bad.stderr.includes("at Module"), "no stacktrace");
});

test("version prints skill and format version", () => {
	const r = run(["version"], tmp());
	assert.equal(r.status, 0);
	assert.match(r.stdout, /block-llm skill 2\.0\.0 \(format 1\)/);
	const j = run(["version", "--json"], tmp());
	assert.equal(JSON.parse(j.stdout).format, "1");
});

test("upgrade: current format ok, future format exits 1", () => {
	const dir = fresh();
	assert.equal(run(["upgrade", "."], dir).status, 0);
	const file = path.join(dir, core.DIR, "scheme.json");
	const s = JSON.parse(fs.readFileSync(file, "utf8"));
	s.version = 99;
	fs.writeFileSync(file, JSON.stringify(s));
	const r = run(["upgrade", "."], dir);
	assert.equal(r.status, 1);
	assert.match(r.stdout, /update the skill/);
});

test("--json output is machine-readable for every read command", () => {
	const dir = fresh();
	run(["node", "add", "--label", "A"], dir);
	run(["edge", "add", "--from", "n1", "--to", "n1"], dir);
	for (const cmd of [["get"], ["validate"], ["history"], ["diff"]]) {
		const r = run([...cmd, "--json", "."], dir);
		assert.doesNotThrow(
			() => JSON.parse(r.stdout),
			`${cmd[0]} --json must parse`,
		);
	}
});

test("actor flag records who wrote in the journal", () => {
	const dir = fresh();
	run(["node", "add", "--label", "A", "--actor", "human-json"], dir);
	const h = JSON.parse(run(["history", "--json"], dir).stdout);
	assert.ok(h.entries.some((e: { actor: string }) => e.actor === "human-json"));
});
