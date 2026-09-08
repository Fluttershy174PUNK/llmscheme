// pi-lens-ignore-file: no-console-except-error — a build script's console output IS the product
// sync-skill — make skill/ a self-contained copy of src/.
//
// skill/ mirrors src/ exactly (skill/core/*.ts, skill/cli/block.ts) so the
// relative imports inside the copied files keep resolving without a rewrite:
// skill/cli/block.ts imports ../core/index.ts just like src/cli/block.ts does.
// Nothing is bundled and nothing is transformed — Node 22.18+ strips the types.
//
// A .manifest.json records sha256 of every copied file plus the built
// editor.html, so check.ts can prove the artifact still matches its sources.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = path.join(repo, "src");
const skill = path.join(repo, "skill");

// source -> destination, copied verbatim
const COPIES = [
	["core", "core"],
	["cli/block.ts", "cli/block.ts"],
	["skill/SKILL.md", "SKILL.md"],
	["skill/references", "references"],
] as const;

// written fresh each sync (not copied): the skill's own identity
const VERSION = "skill: 2.0.0\nformat: 1\n";

const sha256 = (file: string) =>
	crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function copyTree(from: string, to: string) {
	const stat = fs.statSync(from);
	if (stat.isDirectory()) {
		fs.mkdirSync(to, { recursive: true });
		for (const e of fs.readdirSync(from, { withFileTypes: true }))
			copyTree(path.join(from, e.name), path.join(to, e.name));
		return;
	}
	fs.mkdirSync(path.dirname(to), { recursive: true });
	fs.copyFileSync(from, to);
}

export function syncSkill(): { files: number; manifest: Record<string, string> } {
	// start from a clean slate so deleted sources cannot linger in the artifact
	fs.rmSync(skill, { recursive: true, force: true });
	fs.mkdirSync(skill, { recursive: true });

	for (const [rel, dest] of COPIES) copyTree(path.join(src, rel), path.join(skill, dest));
	fs.writeFileSync(path.join(skill, "VERSION"), VERSION);

	// editor.html is built by build.ts; sync must not delete it, so rebuild order
	// is: build first, then sync (npm run build does both). If it is missing we
	// still sync the code and let check.ts report the gap.
	const built = path.join(repo, "dist", "editor.html");
	if (fs.existsSync(built)) fs.copyFileSync(built, path.join(skill, "editor.html"));

	const manifest: Record<string, string> = {};
	const walk = (dir: string) => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) walk(p);
			else manifest[path.relative(skill, p).split(path.sep).join("/")] = sha256(p);
		}
	};
	walk(skill);
	fs.writeFileSync(path.join(skill, ".manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	return { files: Object.keys(manifest).length, manifest };
}

const { files, manifest } = syncSkill();
console.log(`skill/ synced: ${files} files`);
console.log(
	`  editor.html: ${manifest["editor.html"] ? "present" : "MISSING (run npm run build first)"}`,
);
