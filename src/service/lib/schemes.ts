import fs from "node:fs";
import path from "node:path";
import {
	type Scheme,
	type NodeInput,
	type EdgeInput,
	type ZoneInput,
	type NodePatch,
	type EdgePatch,
	DataError,
	CasError,
	ValidationError,
	diffSchemes,
	emptyScheme,
	exportMd,
	readRaw,
	readSnapshot,
	renderHtml,
	saveSchema,
	validate,
	addNode,
	addEdge,
	addZone,
	updateNode,
	updateEdge,
	removeNode,
	removeEdge,
	removeZone,
} from "../../core/index.ts";
import { HttpError } from "./http.ts";
import type { Store, User } from "./store.ts";

// The scheme layer both REST routes and MCP tools call. v1 spelled each
// operation out twice more (once per transport) and the copies drifted; here
// the transport only decodes arguments and the core's ops.ts does the mutation.

export interface SchemesOptions {
	store: Store;
	// editor.html for this deployment; read per save so a rebuild is picked up
	templatePath: string;
}

export class Schemes {
	private store: Store;
	private templatePath: string;
	// read once and cached: the template only changes across a redeploy
	private templateCache: string | null = null;

	constructor(opts: SchemesOptions) {
		this.store = opts.store;
		this.templatePath = opts.templatePath;
	}

	private template(): string | null {
		if (this.templateCache !== null) return this.templateCache || null;
		try {
			this.templateCache = fs.readFileSync(this.templatePath, "utf8");
		} catch {
			this.templateCache = ""; // missing -> exports skip scheme.html
		}
		return this.templateCache || null;
	}

	root(u: User, name: string): string {
		return this.store.schemeRoot(u, name);
	}

	private save(u: User, name: string, scheme: Scheme, op: string): { rev: number } {
		const root = this.root(u, name);
		const tpl = this.template();
		return saveSchema(root, scheme, {
			extraFiles: tpl ? (final) => ({ "scheme.html": renderHtml(tpl, final) }) : undefined,
			journal: { actor: scheme.meta.generator, op, summary: `${op} via service` },
		});
	}

	private mustRead(u: User, name: string): { root: string; scheme: Scheme } {
		const root = this.root(u, name);
		if (!fs.existsSync(path.join(root, "scheme.json"))) throw new HttpError(404, "no such scheme");
		return { root, scheme: readRaw(root) };
	}

	// ---------- listing ----------
	list(u: User, ownerTag = ""): SchemeSummary[] {
		const dir = this.store.userRoot(u.id);
		const out: SchemeSummary[] = [];
		if (!fs.existsSync(dir)) return out;
		const push = (pdir: string, project: string, name: string) => {
			if (!fs.existsSync(path.join(pdir, "scheme.json"))) return;
			let s: Scheme;
			try {
				s = readRaw(pdir);
			} catch {
				return; // a half-written scheme must not break the whole listing
			}
			out.push({
				owner: ownerTag || undefined,
				project,
				name,
				rev: s.rev,
				nodes: s.nodes.length,
				edges: s.edges.length,
				updatedAt: s.meta.updatedAt,
			});
		};
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			if (!e.isDirectory()) continue;
			const sub = path.join(dir, e.name);
			push(sub, "", e.name);
			// one level of projects: <project>/<scheme>
			for (const p of fs.readdirSync(sub, { withFileTypes: true }))
				if (p.isDirectory()) push(path.join(sub, p.name), e.name, p.name);
		}
		return out;
	}

	// ---------- whole-scheme ops ----------
	get(u: User, name: string): Scheme {
		return this.mustRead(u, name).scheme;
	}

	md(u: User, name: string): string {
		const s = this.mustRead(u, name).scheme;
		return exportMd(s, validate(s));
	}

	create(u: User, name: string, scheme?: Scheme): { rev: number } {
		const root = this.root(u, name);
		if (fs.existsSync(path.join(root, "scheme.json"))) throw new HttpError(409, "scheme exists");
		if (scheme) {
			if (scheme.rev !== 0) throw new DataError("imported scheme must have rev 0");
			return this.save(u, name, scheme, "put");
		}
		return this.save(u, name, emptyScheme(name), "init");
	}

	// CAS: the payload must carry the rev the caller read. Validation runs
	// FIRST so a malformed body (no meta, nodes:null) is a 400, not a 409
	// against a stale CAS — a 409 tells the caller "retry", which is wrong
	// when the body itself is broken.
	put(u: User, name: string, next: Scheme): { rev: number } {
		if (!next || typeof next !== "object" || Array.isArray(next))
			throw new DataError("scheme must be an object");
		const v = validate(next);
		if (v.errors.length) throw new ValidationError(v);
		const { scheme: current } = this.mustRead(u, name);
		if (next.rev !== current.rev) throw new CasError(next.rev, current.rev);
		next.meta = { ...(next.meta ?? current.meta), generator: "human-editor" };
		return this.save(u, name, next, "put");
	}

	remove(u: User, name: string): void {
		const { root } = this.mustRead(u, name);
		fs.rmSync(root, { recursive: true, force: true });
	}

	diff(u: User, name: string, rev?: number): { from: number; to: number; changes: string[] } {
		const { root, scheme: cur } = this.mustRead(u, name);
		const base = rev ?? cur.rev - 1;
		if (base >= cur.rev) return { from: base, to: cur.rev, changes: [] };
		const old = readSnapshot(root, base); // throws DataError if rotated out
		return { from: base, to: cur.rev, changes: diffSchemes(old, cur) };
	}

	log(u: User, name: string, limit = 50): JournalLine[] {
		const { root } = this.mustRead(u, name);
		const file = path.join(root, "cache", "journal.jsonl");
		if (!fs.existsSync(file)) return [];
		const n = Math.min(200, Math.max(1, limit));
		return (
			fs
				.readFileSync(file, "utf8")
				.split("\n")
				.filter(Boolean)
				// a truncated tail line must not kill the whole journal
				.flatMap((line) => {
					try {
						return [JSON.parse(line) as JournalLine];
					} catch {
						return [];
					}
				})
				.slice(-n)
		);
	}

	// ---------- granular ops (REST + MCP share these) ----------
	private mutate<T>(
		u: User,
		name: string,
		op: string,
		fn: (s: Scheme) => T,
	): { rev: number; result: T } {
		const { scheme } = this.mustRead(u, name);
		const result = fn(scheme);
		const r = this.save(u, name, scheme, op);
		return { rev: r.rev, result };
	}

	nodeAdd(u: User, name: string, input: NodeInput) {
		return this.mutate(u, name, "node.add", (s) => addNode(s, input).id);
	}
	nodeUpdate(u: User, name: string, id: string, patch: NodePatch) {
		return this.mutate(u, name, "node.update", (s) => updateNode(s, id, patch).id);
	}
	nodeRemove(u: User, name: string, id: string) {
		return this.mutate(u, name, "node.remove", (s) => removeNode(s, id));
	}
	edgeAdd(u: User, name: string, input: EdgeInput) {
		return this.mutate(u, name, "edge.add", (s) => addEdge(s, input).id);
	}
	edgeUpdate(u: User, name: string, id: string, patch: EdgePatch) {
		return this.mutate(u, name, "edge.update", (s) => updateEdge(s, id, patch).id);
	}
	edgeRemove(u: User, name: string, id: string) {
		return this.mutate(u, name, "edge.remove", (s) => removeEdge(s, id));
	}
	zoneAdd(u: User, name: string, input: ZoneInput) {
		return this.mutate(u, name, "zone.add", (s) => addZone(s, input).id);
	}
	zoneRemove(u: User, name: string, id: string) {
		return this.mutate(u, name, "zone.remove", (s) => removeZone(s, id));
	}

	// ensure a scheme exists (the editor auto-creates on first open)
	ensure(u: User, name: string): Scheme {
		try {
			return this.get(u, name);
		} catch (e) {
			if (e instanceof HttpError && e.status === 404) {
				this.create(u, name);
				return this.get(u, name);
			}
			throw e;
		}
	}
}

export interface SchemeSummary {
	owner?: string;
	project: string;
	name: string;
	rev: number;
	nodes: number;
	edges: number;
	updatedAt: string;
}
export interface JournalLine {
	ts: string;
	actor: string;
	op: string;
	rev: number;
	summary: string;
}
