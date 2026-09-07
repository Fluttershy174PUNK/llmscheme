import path from "node:path";
import fs from "node:fs";

// §9 path-jail: resolve against project root, refuse escapes. Writing outside
// the project is NEVER allowed; error-source args are only read, never written.
export class PathJailError extends Error {}

export function jail(rootAbs: string, rel: string): string {
	if (typeof rel !== "string" || !rel) throw new PathJailError("empty path");
	if (path.isAbsolute(rel)) {
		// absolute paths are allowed only if they are already inside root
		const norm = path.normalize(rel);
		if (!norm.startsWith(rootAbs + path.sep) && norm !== rootAbs) {
			throw new PathJailError(`path escapes project root: ${rel}`);
		}
		return norm;
	}
	const resolved = path.resolve(rootAbs, rel);
	const rootWithSep = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
	if (resolved !== rootAbs && !resolved.startsWith(rootWithSep)) {
		throw new PathJailError(`path escapes project root: ${rel}`);
	}
	return resolved;
}

// realpath-based check for paths that may go through symlinks (§9)
export function jailReal(rootAbs: string, rel: string): string {
	const resolved = jail(rootAbs, rel);
	const rootReal = fs.realpathSync.native(rootAbs);
	try {
		const real = fs.realpathSync.native(resolved);
		if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
			throw new PathJailError(`symlink escapes project root: ${rel}`);
		}
		return real;
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return resolved; // not created yet
		if (e instanceof PathJailError) throw e;
		throw new PathJailError(`cannot resolve path: ${rel}`);
	}
}

// locate .block_llm/ upward from cwd, stop at git repo root, never downward (§10).
// >1 candidate -> return all, caller must ask (no silent choice).
export function findProjectDir(cwd: string): string[] {
	const hits: string[] = [];
	let dir = path.resolve(cwd);
	// git root boundary
	let gitRoot: string | null = null;
	let d = dir;
	while (true) {
		if (fs.existsSync(path.join(d, ".git"))) {
			gitRoot = d;
			break;
		}
		const parent = path.dirname(d);
		if (parent === d) break;
		d = parent;
	}
	while (true) {
		if (fs.existsSync(path.join(dir, ".block_llm", "scheme.json")))
			hits.push(dir);
		if (gitRoot && dir === gitRoot) break;
		const parent = path.dirname(dir);
		if (parent === dir) break; // fs root
		dir = parent;
	}
	return [...new Set(hits)];
}
