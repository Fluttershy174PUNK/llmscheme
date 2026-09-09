import path from "node:path";
import fs from "node:fs";

// §9 path-jail: resolve against the project root, refuse escapes. Writing
// outside the project is NEVER allowed; error-source args are only read.
export class PathJailError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PathJailError";
	}
}

export function jail(rootAbs: string, rel: string): string {
	if (typeof rel !== "string" || !rel) throw new PathJailError("empty path");
	const rootWithSep = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
	const inside = (p: string) => p === rootAbs || p.startsWith(rootWithSep);
	// absolute paths are allowed only if they are already inside root
	const resolved = path.isAbsolute(rel)
		? path.normalize(rel)
		: path.resolve(rootAbs, rel);
	if (!inside(resolved))
		throw new PathJailError(`path escapes project root: ${rel}`);
	return resolved;
}

// v2 layout: the skill keeps several independent schemes per project.
//   <project>/.llmscheme/
//     logic_scheme/   ← modules + data flow (common default)
//     code_scheme/    ← call graph / code structure
//     ui_scheme/      ← screens + routes
//     …_scheme/       ← any meaning: db, api, auth, pipeline — the agent asks
//                       the user what to build, it is NOT a fixed set
// Each scheme dir is a full scheme root (scheme.json + SCHEME.md + scheme.html
// + cache/ + VERSION inside it). `refs` are still relative to the PROJECT root,
// not the scheme dir — that is what `projectRootOf` recovers.
export const SCHEMES_DIR = ".llmscheme";
// the common three, kept as the documented examples — NOT a hard whitelist
export const SCHEME_TYPES = ["logic", "code", "ui"] as const;
// a scheme type is any safe single word; the dir name is `<type>_scheme`
export type SchemeType = string;

const TYPE_RE = /^[a-z0-9][a-z0-9_-]*$/;

export const schemeDirName = (t: string): string => {
	if (!TYPE_RE.test(t))
		throw new PathJailError(`bad scheme type "${t}" (use a-z 0-9 _ -)`);
	return `${t}_scheme`;
};

export function schemeDir(projectRoot: string, type: string): string {
	return path.join(projectRoot, SCHEMES_DIR, schemeDirName(type));
}

// recover the project root from a scheme dir (<proj>/.llmscheme/<type>_scheme)
export function projectRootOf(schemeDirAbs: string): string {
	let d = path.resolve(schemeDirAbs);
	for (;;) {
		if (path.basename(d) === SCHEMES_DIR) return path.dirname(d);
		const parent = path.dirname(d);
		if (parent === d) return d;
		d = parent;
	}
}

// Locate scheme dirs upward from cwd, stop at the git repo root, never downward.
// >1 candidate -> return all; the caller must ask instead of choosing silently.
export function findSchemeDirs(cwd: string): string[] {
	const hits: string[] = [];
	// git root boundary
	let gitRoot: string | null = null;
	for (let d = path.resolve(cwd); ; ) {
		if (fs.existsSync(path.join(d, ".git"))) {
			gitRoot = d;
			break;
		}
		const parent = path.dirname(d);
		if (parent === d) break;
		d = parent;
	}
	for (let dir = path.resolve(cwd); ; ) {
		const llm = path.join(dir, SCHEMES_DIR);
		if (fs.existsSync(llm)) {
			// any <type>_scheme with a scheme.json is a candidate — the set is
			// open (logic/code/ui/…), not hardcoded
			for (const e of fs.readdirSync(llm, { withFileTypes: true })) {
				if (!e.isDirectory() || !e.name.endsWith("_scheme")) continue;
				const sd = path.join(llm, e.name);
				if (fs.existsSync(path.join(sd, "scheme.json"))) hits.push(sd);
			}
		}
		if ((gitRoot && dir === gitRoot) || dir === path.dirname(dir)) break;
		dir = path.dirname(dir);
	}
	return [...new Set(hits)].sort();
}
