// check — prove the artifact matches its sources, and nothing else.
//
// v1 had no such check, which is how the service ended up with a stale
// core.mjs that lacked w/h validation and happily accepted {"w":5,"h":-3}
// while the skill rejected it. Byte-for-byte comparison makes drift impossible
// to ship, and also catches a formatter touching a generated file (v1 bug B1:
// editor-template grew 111K -> 167K and broke the size budget).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = path.join(repo, "src");
// v2 layout: SKILL/llmscheme/, SERVICE-MCP/llmscheme/
const skill = path.join(repo, "SKILL", "llmscheme");
const mcp = path.join(repo, "SERVICE-MCP", "llmscheme");

// editor.html budgets (bytes). The editor is a single file a human opens from
// disk, so it stays small; the font subsets alone are ~26K.
const BUDGET_EDITOR = 200 * 1024;
const BUDGET_CONSOLE = 80 * 1024;

const sha256 = (file: string) =>
	crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const problems: string[] = [];
const note = (msg: string) => problems.push(msg);

// ---- 1. SKILL/llmscheme/{core,cli} are verbatim copies of src/ ----
// SKILL/llmscheme/cli/block.ts keeps importing ../core/index.ts, so the tree
// must mirror src/ exactly — a rename here would break the copied import.
const PAIRS = [
	["core", "core"],
	["cli/block.ts", "cli/block.ts"],
	["skill/SKILL.md", "SKILL.md"],
	["skill/references", "references"],
] as const;

function walkFiles(target: string): string[] {
	if (!fs.existsSync(target)) return [];
	// a PAIRS entry may be a single file (cli/block.ts), not only a directory
	if (!fs.statSync(target).isDirectory()) return [target];
	return fs
		.readdirSync(target, { withFileTypes: true })
		.flatMap((e) =>
			e.isDirectory() ? walkFiles(path.join(target, e.name)) : [path.join(target, e.name)],
		);
}

for (const [rel, dest] of PAIRS) {
	const srcRoot = path.join(src, rel);
	const skillRoot = path.join(skill, dest);
	const srcFiles = walkFiles(srcRoot).map((f) =>
		path.relative(srcRoot, f).split(path.sep).join("/"),
	);
	const skillFiles = walkFiles(skillRoot).map((f) =>
		path.relative(skillRoot, f).split(path.sep).join("/"),
	);

	for (const f of srcFiles)
		if (!skillFiles.includes(f)) note(`SKILL/llmscheme/${dest}/${f} is missing (run npm run sync-skill)`);
	for (const f of skillFiles)
		if (!srcFiles.includes(f)) note(`SKILL/llmscheme/${dest}/${f} is stale: no longer in src/${rel}/`);
	for (const f of srcFiles.filter((x) => skillFiles.includes(x))) {
		const a = path.join(srcRoot, f);
		const b = path.join(skillRoot, f);
		if (sha256(a) !== sha256(b)) note(`SKILL/llmscheme/${dest}/${f} differs from src/${rel}/${f}`);
	}
}

// ---- 2. the manifest matches reality (nobody hand-edited the artifact) ----
const manifestFile = path.join(skill, ".manifest.json");
let manifest: Record<string, string> | null = null;
if (!fs.existsSync(manifestFile)) {
	note("SKILL/llmscheme/.manifest.json missing (run npm run sync-skill)");
} else {
	// a corrupt manifest is itself a finding — report it like every other problem
	// instead of throwing a stacktrace out of a check script
	try {
		manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as Record<string, string>;
	} catch (e) {
		note(`SKILL/llmscheme/.manifest.json is not valid JSON: ${(e as Error).message}`);
	}
}
if (manifest) {
	for (const [rel, hash] of Object.entries(manifest)) {
		const p = path.join(skill, rel);
		if (!fs.existsSync(p)) note(`manifest lists ${rel} but the file is gone`);
		else if (sha256(p) !== hash)
			note(`${rel} was modified after sync — regenerate, do not hand-edit`);
	}
	for (const f of walkFiles(skill)) {
		const rel = path.relative(skill, f).split(path.sep).join("/");
		if (rel !== ".manifest.json" && !(rel in manifest)) note(`${rel} is not in the manifest`);
	}
}

// ---- 3. VERSION and SKILL.md exist; editor.html is present and within budget ----
for (const f of ["VERSION", "SKILL.md"])
	if (!fs.existsSync(path.join(skill, f))) note(`SKILL/llmscheme/${f} missing`);

// The editor is built from src/editor/skill/main.ts. Until that entry exists
// there is nothing to build, so a missing editor.html is not a finding yet —
// but once it does, the artifact must be present and up to date.
const editorSourcesExist = fs.existsSync(path.join(repo, "src", "editor", "skill", "main.ts"));
const editor = path.join(skill, "editor.html");
if (!fs.existsSync(editor)) {
	if (editorSourcesExist) note("SKILL/llmscheme/editor.html missing (run npm run build)");
} else {
	const size = fs.statSync(editor).size;
	if (size > BUDGET_EDITOR) note(`SKILL/llmscheme/editor.html ${size}B > budget ${BUDGET_EDITOR}B`);

	// single-file invariants: it is opened from file:// with no network
	const html = fs.readFileSync(editor, "utf8");
	const external = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
		.map((m) => m[1] as string)
		.filter((u) => !u.startsWith("data:") && !u.startsWith("#"));
	if (external.length) note(`editor.html references external files: ${external.join(", ")}`);
	if (!/<script type="application\/json" id="scheme-data">/.test(html))
		note("editor.html has no scheme-data marker (cannot embed a scheme)");
	if (!/<script(?:\s[^>]*)?>/.test(html)) note("editor.html has no inline script");
	// fonts must be inline for file:// (a relative fetch there is a NetworkError)
	const fonts = (html.match(/data:font\/woff2;base64/g) ?? []).length;
	if (fonts !== 2)
		note(`editor.html inlines ${fonts} woff2 subsets, expected 2 (latin + cyrillic)`);
	if (/fetch\(["']https?:/.test(html)) note("editor.html fetches an absolute http(s) URL");
}

// ---- 4. the service artifact: thin HTML, font served separately ----
const serviceEditor = path.join(mcp, "editor.html");
if (fs.existsSync(serviceEditor)) {
	const size = fs.statSync(serviceEditor).size;
	if (size > BUDGET_EDITOR) note(`SERVICE-MCP/llmscheme/editor.html ${size}B > budget ${BUDGET_EDITOR}B`);
}
const serviceConsole = path.join(mcp, "console.html");
if (fs.existsSync(serviceConsole)) {
	const size = fs.statSync(serviceConsole).size;
	if (size > BUDGET_CONSOLE) note(`SERVICE-MCP/llmscheme/console.html ${size}B > budget ${BUDGET_CONSOLE}B`);
	const html = fs.readFileSync(serviceConsole, "utf8");
	// served over http: the font is a cacheable file, not 26K of base64 per page
	if (/data:font\/woff2;base64/.test(html))
		note("console.html inlines the font — serve /assets/*.woff2 instead");
}

// ---- 5. generated files must never carry a formatter's hand ----
// v1 bug B1: a formatter rewrote editor-template.gen.html, the minified module
// script went 80K -> 133K, the file blew the budget and two tests failed.
for (const f of [editor, serviceEditor, serviceConsole]) {
	if (!fs.existsSync(f)) continue;
	const html = fs.readFileSync(f, "utf8");
	// a formatted bundle has readable newlines between statements; a real build
	// does not. Cheap heuristic, and it catches the exact v1 failure mode.
	const script = html.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/)?.[1] ?? "";
	if (script.length > 20_000 && (script.match(/\n/g) ?? []).length > 500)
		note(`${path.relative(repo, f)} looks hand-formatted — rebuild it`);
}

if (problems.length) {
	process.stderr.write(`check: FAILED (${problems.length})\n`);
	for (const p of problems) process.stderr.write(`  - ${p}\n`);
	process.exit(1);
}
process.stdout.write("check: OK\n");
