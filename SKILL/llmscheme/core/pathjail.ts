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

// Locate .block_llm/ upward from cwd, stop at the git repo root, never downward (§10).
// >1 candidate -> return all; the caller must ask instead of choosing silently.
export function findProjectDir(cwd: string): string[] {
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
		if (fs.existsSync(path.join(dir, ".block_llm", "scheme.json"))) hits.push(dir);
		if ((gitRoot && dir === gitRoot) || dir === path.dirname(dir)) break;
		dir = path.dirname(dir);
	}
	return [...new Set(hits)];
}
