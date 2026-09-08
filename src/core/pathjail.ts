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
	const resolved = path.isAbsolute(rel) ? path.normalize(rel) : path.resolve(rootAbs, rel);
	if (!inside(resolved)) throw new PathJailError(`path escapes project root: ${rel}`);
	return resolved;
}

// v2 layout: the skill keeps several independent schemes per project.
//   <project>/.llmscheme/
//     logic_scheme/   ← modules + data flow
//     code_scheme/    ← call graph / code structure
//     ui_scheme/      ← screens + routes
// Each scheme dir is a full scheme root (scheme.json + SCHEME.md + scheme.html
// + cache/ + VERSION inside it). `refs` are still relative to the PROJECT root,
// not the scheme dir — that is what `projectRootOf` recovers.
export const SCHEMES_DIR = ".llmscheme";
export const SCHEME_TYPES = ["logic", "code", "ui"] as const;
export type SchemeType = (typeof SCHEME_TYPES)[number];

export const schemeDirName = (t: SchemeType): string => `${t}_scheme`;

export function schemeDir(projectRoot: string, type: SchemeType): string {
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
			for (const t of SCHEME_TYPES) {
				const sd = path.join(llm, schemeDirName(t));
				if (fs.existsSync(path.join(sd, "scheme.json"))) hits.push(sd);
			}
		}
		if ((gitRoot && dir === gitRoot) || dir === path.dirname(dir)) break;
		dir = path.dirname(dir);
	}
	return [...new Set(hits)];
}
