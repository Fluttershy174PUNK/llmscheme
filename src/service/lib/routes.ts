import fs from "node:fs";
import path from "node:path";
import { DataError, type Scheme } from "../../core/index.ts";
import { COOKIE, clearCookieHeader, cookieHeader, currentTokenHash, isAdmin } from "./auth.ts";
import type { Config } from "./config.ts";
import { HttpError, Router, send, type Context } from "./http.ts";
import type { Schemes } from "./schemes.ts";
import { publicUser, type Store, type User } from "./store.ts";

// REST routes.
//
// R9: no GET ever mutates state. v1's GET /api/mcp-config revoked every api
// key and issued a new one, so merely opening the console page broke live MCP
// clients. Creating, rotating and revoking are explicit POSTs the UI gates
// behind a confirmation dialog.

export interface RoutesDeps {
	store: Store;
	schemes: Schemes;
	config: Config;
	// README.md rendered on the login page (scheme node n1)
	readmePath: string;
	repoUrl: string;
	// built font/css files served at /assets/<name>
	assetsDir: string;
}

const parseJson = (text: string): Record<string, unknown> => {
	if (!text.trim()) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (e) {
		throw new DataError(`invalid JSON body: ${(e as Error).message}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		throw new DataError("body must be a JSON object");
	return parsed as Record<string, unknown>;
};

// Body/query field readers. Both throw DataError (-> 400) instead of letting a
// bad value reach the core, which would surface as a confusing validation error.
const str = (v: unknown, field: string): string => {
	if (typeof v === "string" && v.trim()) return v;
	throw new DataError(`${field} must be a non-empty string`);
};

const num = (v: unknown, field: string): number | undefined => {
	if (v === undefined || v === null || v === "") return undefined;
	const n = Number(v);
	if (!Number.isFinite(n)) throw new DataError(`${field} must be a number`);
	return n;
};

// admin-targeting: ?login=x / {"login":x} lets an admin act for another user
function targetUser(deps: RoutesDeps, ctx: Context, fromBody?: unknown): User {
	const me = ctx.auth as User;
	const login = typeof fromBody === "string" && fromBody ? fromBody : ctx.query.login;
	if (!login || login === me.login) return me;
	if (!isAdmin(me)) throw new HttpError(403, "admin only");
	const u = deps.store.userByLogin(login);
	if (!u) throw new HttpError(404, "no such user");
	return u;
}

const requireAdmin = (ctx: Context): User => {
	const u = ctx.auth as User;
	if (!isAdmin(u)) throw new HttpError(403, "admin only");
	return u;
};

// the editor auto-creates the scheme on first open, so /editor/<name> must
// reject names the store would refuse — before creating any directory
function assertSchemeName(name: string): void {
	if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)?$/.test(name) || name.includes(".."))
		throw new DataError('bad scheme name (use "project/scheme" or "scheme")');
}

export function buildRoutes(deps: RoutesDeps): Router {
	const r = new Router();
	const { store, schemes, config } = deps;

	// ---------- auth ----------
	r.post("/api/login", (ctx) => {
		const b = parseJson(ctx.body);
		const login = str(b.login, "login");
		const password = str(b.password, "password");
		const u = store.userByLogin(login);
		if (!u || !store.checkPassword(u, password))
			// same message and the same work for "no such user" and "wrong password"
			throw new HttpError(401, "bad credentials");
		const t = store.issueToken(u, config.tokenTtlMs);
		send(
			ctx.res,
			200,
			{
				token: t.token,
				expiresAt: new Date(t.expiresAt).toISOString(),
				role: u.role,
				login: u.login,
			},
			{ "set-cookie": cookieHeader(t.token, Math.floor(config.tokenTtlMs / 1000)) },
		);
	});

	// B6: v1 revoked only when the caller sent Authorization: Bearer, so the
	// console's cookie-based logout left the session token alive.
	r.post("/api/logout", (ctx) => {
		const hash = currentTokenHash(ctx.req);
		if (hash) store.revokeToken(hash);
		send(ctx.res, 200, { ok: true }, { "set-cookie": clearCookieHeader() });
	});

	r.get("/api/me", (ctx) => send(ctx.res, 200, publicUser(ctx.auth as User)));

	// the login page renders the real README (scheme node n1), not a hardcoded blurb
	r.get("/api/readme", (ctx) => {
		let markdown = "";
		try {
			markdown = fs.readFileSync(deps.readmePath, "utf8");
		} catch {
			markdown = ""; // absent -> the console falls back to its own text
		}
		send(ctx.res, 200, { markdown, url: deps.repoUrl });
	});

	// ---------- users ----------
	r.get("/api/users", (ctx) => {
		requireAdmin(ctx);
		send(ctx.res, 200, store.users().map(publicUser));
	});

	r.post("/api/users", (ctx) => {
		requireAdmin(ctx);
		const b = parseJson(ctx.body);
		const role = b.role === "admin" ? "admin" : "user";
		const u = store.createUser(str(b.login, "login"), str(b.password, "password"), role);
		send(ctx.res, 201, publicUser(u));
	});

	r.delete("/api/user/:id", (ctx) => {
		const me = requireAdmin(ctx);
		const id = Number(ctx.params.id);
		if (!Number.isInteger(id)) throw new DataError("id must be an integer");
		const u = store.userById(id);
		if (!u) throw new HttpError(404, "no such user");
		if (u.id === me.id) throw new HttpError(400, "cannot delete yourself");
		if (u.role === "admin" && store.users().filter((x) => x.role === "admin").length === 1)
			throw new HttpError(400, "cannot delete the last admin");
		store.deleteUser(id);
		send(ctx.res, 200, { ok: true });
	});

	// own password; an admin may set someone else's via ?login=
	r.post("/api/password", (ctx) => {
		const b = parseJson(ctx.body);
		const target = targetUser(deps, ctx, b.login);
		const next = str(b.password, "password");
		// changing your OWN password requires proving the current one;
		// an admin acting for someone else does not (that is the point of admin)
		if (target.id === (ctx.auth as User).id) {
			const current = str(b.current, "current");
			if (!store.checkPassword(target, current))
				throw new HttpError(403, "current password is wrong");
		}
		store.setPassword(target, next);
		// sessions were dropped, so the caller must sign in again
		send(ctx.res, 200, { ok: true, sessionsRevoked: true }, { "set-cookie": clearCookieHeader() });
	});

	// ---------- sessions ----------
	// explicit revocation endpoints (the UI confirms before calling them)
	r.post("/api/session/revoke-all", (ctx) => {
		const target = targetUser(deps, ctx);
		store.revokeAllSessions(target);
		send(ctx.res, 200, { ok: true }, { "set-cookie": clearCookieHeader() });
	});

	// ---------- api keys ----------
	r.get("/api/keys", (ctx) => {
		const u = ctx.auth as User;
		send(
			ctx.res,
			200,
			(u.apiKeys ?? [])
				.filter((k) => !k.revoked)
				.map((k) => ({ hash: k.key, createdAt: k.createdAt })),
		);
	});

	r.get("/api/admin/keys", (ctx) => {
		requireAdmin(ctx);
		send(ctx.res, 200, store.activeKeys());
	});

	// R9: issuing a key is a POST (confirm-gated) and shows the secret once
	r.post("/api/keys", (ctx) => {
		const b = parseJson(ctx.body);
		const target = targetUser(deps, ctx, b.login);
		const apiKey = store.issueApiKey(target);
		send(ctx.res, 201, {
			apiKey,
			note: "shown once; store it now",
			mcpConfig: mcpConfig(ctx.origin, apiKey),
		});
	});

	// R9/B13: rotating revokes every active key — destructive, so POST + confirm
	r.post("/api/keys/rotate", (ctx) => {
		const b = parseJson(ctx.body);
		const target = targetUser(deps, ctx, b.login);
		const apiKey = store.rotateApiKeys(target);
		send(ctx.res, 200, {
			apiKey,
			revokedAll: true,
			mcpConfig: mcpConfig(ctx.origin, apiKey),
		});
	});

	r.post("/api/keys/:hash/revoke", (ctx) => {
		const b = parseJson(ctx.body);
		const target = targetUser(deps, ctx, b.login);
		store.revokeApiKey(target, str(ctx.params.hash, "hash"));
		send(ctx.res, 200, { ok: true });
	});

	// read-only: reports whether a key exists, never creates or revokes one
	r.get("/api/mcp-config", (ctx) => {
		const target = targetUser(deps, ctx);
		const active = (target.apiKeys ?? []).filter((k) => !k.revoked).length;
		send(ctx.res, 200, {
			url: `${ctx.origin}/mcp`,
			hasKey: active > 0,
			activeKeys: active,
			// the secret is hashed at rest, so it can never be re-shown here
			hint: active ? "POST /api/keys/rotate to issue a new secret" : "POST /api/keys to create one",
		});
	});

	// ---------- schemes ----------
	r.get("/api/schemes", (ctx) => {
		const me = ctx.auth as User;
		// ?user=all | ?user=<login> are admin-only views
		const wantAll = ctx.query.user === "all";
		const oneLogin = ctx.query.user && !wantAll ? ctx.query.user : "";
		let users: User[];
		if (!ctx.query.user || !isAdmin(me)) users = [me];
		else if (wantAll) users = store.users();
		else {
			const u = store.userByLogin(oneLogin);
			users = u ? [u] : [];
			if (!users.length) throw new HttpError(404, "no such user");
		}
		const list = users.flatMap((u) => schemes.list(u, wantAll ? u.login : ""));
		send(ctx.res, 200, list);
	});

	r.post("/api/schemes", (ctx) => {
		const me = ctx.auth as User;
		const b = parseJson(ctx.body);
		const name = str(b.name, "name");
		assertSchemeName(name);
		const out = schemes.create(me, name, b.scheme as Scheme | undefined);
		send(ctx.res, 201, { name, rev: out.rev });
	});

	// specific routes first: the greedy :name! would otherwise swallow them
	r.get("/api/scheme/:name!/md", (ctx) => {
		const me = ctx.auth as User;
		send(ctx.res, 200, schemes.md(me, ctx.params.name as string), {
			"content-type": "text/markdown; charset=utf-8",
		});
	});

	r.get("/api/scheme/:name!/diff", (ctx) => {
		const me = ctx.auth as User;
		send(ctx.res, 200, schemes.diff(me, ctx.params.name as string, num(ctx.query.rev, "rev")));
	});

	r.get("/api/scheme/:name!/log", (ctx) => {
		const me = ctx.auth as User;
		const limit = num(ctx.query.limit, "limit") ?? 50;
		send(ctx.res, 200, { entries: schemes.log(me, ctx.params.name as string, limit) });
	});

	r.get("/api/scheme/:name!", (ctx) => {
		const me = ctx.auth as User;
		send(ctx.res, 200, schemes.get(me, ctx.params.name as string));
	});

	// B7/B8: core validation runs before anything touches the payload, so a body
	// without meta or with nodes:null is a 400 — never a 500 and never a
	// permanently broken scheme on disk.
	r.put("/api/scheme/:name!", (ctx) => {
		const me = ctx.auth as User;
		// SAFETY: an untrusted JSON body is cast to Scheme so it reaches the core's
		// validate(), which is what rejects a malformed payload (missing meta,
		// nodes:null, bad types) with a 400 — the cast must not be trusted itself.
		const next = parseJson(ctx.body) as unknown as Scheme;
		const out = schemes.put(me, ctx.params.name as string, next);
		send(ctx.res, 200, { ok: true, rev: out.rev });
	});

	r.delete("/api/scheme/:name!", (ctx) => {
		const me = ctx.auth as User;
		schemes.remove(me, ctx.params.name as string);
		send(ctx.res, 200, { ok: true });
	});

	// ---------- granular ops (shared with MCP through schemes.ts) ----------
	r.post("/api/scheme/:name!/node", (ctx) => {
		const me = ctx.auth as User;
		const b = parseJson(ctx.body);
		const out = schemes.nodeAdd(me, ctx.params.name as string, {
			label: str(b.label, "label"),
			id: typeof b.id === "string" ? b.id : undefined,
			shape: b.shape as never,
			description: b.description as string | undefined,
			refs: b.refs as string[] | undefined,
			table: b.table as never,
			x: num(b.x, "x"),
			y: num(b.y, "y"),
			w: num(b.w, "w"),
			h: num(b.h, "h"),
		});
		send(ctx.res, 200, { ok: true, rev: out.rev, id: out.result });
	});

	r.put("/api/scheme/:name!/node/:id", (ctx) => {
		const me = ctx.auth as User;
		const b = parseJson(ctx.body);
		const out = schemes.nodeUpdate(me, ctx.params.name as string, ctx.params.id as string, {
			label: b.label as string | undefined,
			shape: b.shape as never,
			description: b.description as string | undefined,
			refs: b.refs as string[] | undefined,
			table: b.table as never,
			x: num(b.x, "x"),
			y: num(b.y, "y"),
			w: num(b.w, "w"),
			h: num(b.h, "h"),
		});
		send(ctx.res, 200, { ok: true, rev: out.rev, id: out.result });
	});

	r.delete("/api/scheme/:name!/node/:id", (ctx) => {
		const me = ctx.auth as User;
		const out = schemes.nodeRemove(me, ctx.params.name as string, ctx.params.id as string);
		send(ctx.res, 200, { ok: true, rev: out.rev });
	});

	r.post("/api/scheme/:name!/edge", (ctx) => {
		const me = ctx.auth as User;
		const b = parseJson(ctx.body);
		const out = schemes.edgeAdd(me, ctx.params.name as string, {
			from: str(b.from, "from"),
			to: str(b.to, "to"),
			id: typeof b.id === "string" ? b.id : undefined,
			style: b.style as never,
			label: b.label as string | undefined,
			description: b.description as string | undefined,
			fromSide: b.fromSide as never,
			toSide: b.toSide as never,
		});
		send(ctx.res, 200, { ok: true, rev: out.rev, id: out.result });
	});

	r.put("/api/scheme/:name!/edge/:id", (ctx) => {
		const me = ctx.auth as User;
		const b = parseJson(ctx.body);
		const out = schemes.edgeUpdate(me, ctx.params.name as string, ctx.params.id as string, {
			from: b.from as string | undefined,
			to: b.to as string | undefined,
			style: b.style as never,
			label: b.label as string | undefined,
			description: b.description as string | undefined,
			fromSide: b.fromSide as never,
			toSide: b.toSide as never,
		});
		send(ctx.res, 200, { ok: true, rev: out.rev, id: out.result });
	});

	r.delete("/api/scheme/:name!/edge/:id", (ctx) => {
		const me = ctx.auth as User;
		const out = schemes.edgeRemove(me, ctx.params.name as string, ctx.params.id as string);
		send(ctx.res, 200, { ok: true, rev: out.rev });
	});

	r.post("/api/scheme/:name!/zone", (ctx) => {
		const me = ctx.auth as User;
		const b = parseJson(ctx.body);
		const out = schemes.zoneAdd(me, ctx.params.name as string, {
			x: num(b.x, "x") as number,
			y: num(b.y, "y") as number,
			w: num(b.w, "w") as number,
			h: num(b.h, "h") as number,
			id: typeof b.id === "string" ? b.id : undefined,
			label: b.label as string | undefined,
			description: b.description as string | undefined,
			labelSide: b.labelSide as never,
		});
		send(ctx.res, 200, { ok: true, rev: out.rev, id: out.result });
	});

	r.delete("/api/scheme/:name!/zone/:id", (ctx) => {
		const me = ctx.auth as User;
		const out = schemes.zoneRemove(me, ctx.params.name as string, ctx.params.id as string);
		send(ctx.res, 200, { ok: true, rev: out.rev });
	});

	// health for the container HEALTHCHECK; no auth, no data
	r.get("/health", (ctx) => send(ctx.res, 200, { ok: true }));

	// the editor and console artifacts plus their font files
	r.get("/assets/:file", (ctx) => serveAsset(deps, ctx));

	return r;
}

const mcpConfig = (origin: string, apiKey: string) => ({
	mcpServers: {
		llmscheme: { url: `${origin}/mcp`, headers: { "X-Api-Key": apiKey } },
	},
});

const ASSET_EXT: Record<string, string> = {
	woff2: "font/woff2",
	woff: "font/woff",
	css: "text/css; charset=utf-8",
};

function serveAsset(deps: RoutesDeps, ctx: Context): void {
	const name = path.basename(ctx.params.file as string); // no traversal
	const file = path.join(deps.assetsDir, name);
	if (!fs.existsSync(file)) throw new HttpError(404, "no such asset");
	const ext = name.split(".").pop() ?? "";
	send(ctx.res, 200, fs.readFileSync(file), {
		"content-type": ASSET_EXT[ext] ?? "application/octet-stream",
		// the font never changes between deploys under the same hashed name
		"cache-control": "public, max-age=31536000, immutable",
	});
}

export { COOKIE, assertSchemeName };
