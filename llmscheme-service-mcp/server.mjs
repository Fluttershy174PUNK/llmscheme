// llmscheme-service — single-file, zero-dependency Node HTTP service.
// Users, api keys, tokens live in lightdb.json on the volume; schemes live in
// dataDir/schemes/<userId>/<name>/.block_llm (full cache/backup history).
// Scheme logic (validate/ids/layout/exportMd/CAS) is the SAME src/core the skill uses.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
	validate,
	consumeNodeId,
	consumeEdgeId,
	consumeZoneId,
	autoLayout,
	exportMd,
	renderHtml,
	readRaw,
	saveSchema,
	emptyScheme,
	CasError,
	ValidationError,
	DataError,
	diffSchemes,
} from "./core.mjs";

// ---------- env ----------
const ENV = {
	port: Number(process.env.PORT || 8080),
	adminPassword: process.env.ADMIN_PASSWORD || "admin",
	dataDir: process.env.DATA_DIR || "/data",
	tokenTtlDays: Number(process.env.TOKEN_TTL_DAYS || 30),
	dbQuota: Number(process.env.DB_QUOTA_MB || 64) * 1024 * 1024,
	maxBody: Number(process.env.MAX_BODY_MB || 8) * 1024 * 1024,
	mcpEnabled: (process.env.MCP_ENABLED || "true") === "true",
};

// ponytail: template lives once in the skill dir; Dockerfile copies it next to server.mjs
const TEMPLATE = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	fs.existsSync(
		path.join(
			path.dirname(fileURLToPath(import.meta.url)),
			"editor-template.gen.html",
		),
	)
		? "editor-template.gen.html"
		: path.join(
				"..",
				"llmscheme-skill",
				"block_llm_core",
				"editor-template.gen.html",
			),
);

// ---------- lightdb: one JSON file, atomic writes, quota guard ----------
class Db {
	constructor(dir) {
		this.file = path.join(dir, "lightdb.json");
		fs.mkdirSync(dir, { recursive: true });
		this.data = { users: [], seq: 1 };
		try {
			this.data = JSON.parse(fs.readFileSync(this.file, "utf8"));
		} catch (e) {
			if (e.code !== "ENOENT") throw new Error(`lightdb unreadable: ${e.message}`);
		}
	}
	save() {
		try {
			const used = fs.statSync(this.file).size;
			if (used > ENV.dbQuota)
				throw Object.assign(
					new Error(`lightdb quota exceeded (${used}B > ${ENV.dbQuota}B)`),
					{ status: 507 },
				);
		} catch (e) {
			if (e.code !== "ENOENT") throw e;
		}
		const tmp = `${this.file}.tmp-${process.pid}`;
		fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
		fs.renameSync(tmp, this.file);
	}
	nextId() {
		return this.data.seq++;
	}
}
const db = new Db(ENV.dataDir);

// ---------- passwords, tokens, api keys ----------
function hashPassword(pw, salt = crypto.randomBytes(16).toString("hex")) {
	return { salt, hash: crypto.scryptSync(pw, salt, 32).toString("hex") };
}
function verifyPassword(pw, u) {
	try {
		return crypto.timingSafeEqual(
			Buffer.from(u.hash, "hex"),
			crypto.scryptSync(pw, u.salt, 32),
		);
	} catch {
		return false;
	}
}
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const genApiKey = () => "llm_" + crypto.randomBytes(24).toString("hex");

const userBy = (pred) => db.data.users.find(pred);
const me = (u) => ({
	id: u.id,
	login: u.login,
	role: u.role,
	apiKeys: (u.apiKeys || []).filter((k) => !k.revoked).length,
});

// admin: login from env, created on first boot
if (!userBy((u) => u.role === "admin")) {
	const { salt, hash } = hashPassword(ENV.adminPassword);
	db.data.users.push({
		id: db.nextId(),
		login: "admin",
		role: "admin",
		salt,
		hash,
		createdAt: new Date().toISOString(),
	});
	db.save();
}

function issueToken(userId) {
	const t = {
		token: sha256(crypto.randomBytes(24).toString("hex")),
		expiresAt: Date.now() + ENV.tokenTtlDays * 864e5,
	};
	const u = userBy((u) => u.id === userId);
	u.tokens = [...(u.tokens || []), t];
	db.save();
	return t;
}
function revokeToken(tokenHash) {
	for (const u of db.data.users)
		u.tokens = (u.tokens || []).filter((t) => t.token !== tokenHash);
	db.save();
}

// ---------- schemes storage: per-user dirs, core owns every write ----------
const userRoot = (u) => path.join(ENV.dataDir, "schemes", String(u.id));
function schemeRoot(u, name) {
	// scheme name = "project/scheme" (one level) or bare "scheme"; both validated
	if (
		!name ||
		!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)?$/.test(name) ||
		name.includes("..")
	)
		throw new DataError(
			'bad scheme name (use "project/scheme" or "scheme", a-z 0-9 . _ -)',
		);
	const dir = path.resolve(path.join(userRoot(u), name));
	if (!dir.startsWith(path.resolve(userRoot(u)) + path.sep))
		throw new DataError("bad scheme name");
	return dir;
}
const hasScheme = (u, name) =>
	fs.existsSync(path.join(schemeRoot(u, name), ".block_llm", "scheme.json"));

function saveUserScheme(root, next, op) {
	return saveSchema(root, next, {
		extraFiles: (s) => ({
			".block_llm/scheme.html": renderHtml(fs.readFileSync(TEMPLATE, "utf8"), s),
		}),
		journal: { actor: "agent", op, summary: `${op} via service` },
	});
}

// ---------- HTTP helpers ----------
function send(res, status, body, headers = {}) {
	const h = { "content-type": "application/json; charset=utf-8", ...headers };
	res.writeHead(status, h);
	res.end(typeof body === "string" ? body : JSON.stringify(body));
}
const fail = (res, status, error) => send(res, status, { error });

function readBody(req) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (c) => {
			size += c.length;
			if (size > ENV.maxBody) {
				reject(Object.assign(new Error("body too large"), { status: 413 }));
				req.destroy();
				return;
			}
			chunks.push(c);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}
const lower = (req) =>
	Object.fromEntries(
		Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v]),
	);
// route-body JSON: throws DataError (-> 400 at the dispatcher), never a raw SyntaxError
const parseJson = (text) => {
	try {
		return JSON.parse(text);
	} catch (e) {
		throw new DataError(`invalid JSON body: ${e.message}`);
	}
};
const originOf = (req) =>
	`http://${lower(req).host || `localhost:${ENV.port}`}`;

// token (browser session via ?t= for /editor) OR X-Api-Key (scripts/MCP)
function auth(req, urlQuery) {
	const h = lower(req);
	const apiKey = (h["x-api-key"] || "").trim();
	if (apiKey) {
		for (const u of db.data.users) {
			if ((u.apiKeys || []).some((k) => !k.revoked && k.key === sha256(apiKey)))
				return u;
		}
		return null;
	}
	const raw =
		(h["authorization"] || "").match(/^Bearer (.+)$/)?.[1] ||
		urlQuery?.get("t") ||
		// browser pages: token lives in a cookie (set by /api/login), not localStorage
		(h["cookie"] || "").match(/(?:^|;\s*)ls_token=([a-f0-9]{64})/)?.[1] ||
		"";
	if (!raw) return null;
	const tokenHash = raw.length === 64 ? raw : sha256(raw);
	for (const u of db.data.users) {
		if (
			(u.tokens || []).some(
				(t) => t.token === tokenHash && t.expiresAt > Date.now(),
			)
		)
			return u;
	}
	return null;
}

// ---------- log: stdout (docker logs) ----------
function log(level, msg) {
	process.stdout.write(`${new Date().toISOString()} ${level} ${msg}\n`);
}

// ---------- router ----------
const routes = [];
function route(method, pattern, handler) {
	const keys = [];
	// pattern is a compile-time literal (route registrations below), never user input;
	// the :param transform only ever produces "([^/]+)" (":name!" adds one optional
	// "/segment" — used by scheme routes so "project/scheme" names match) — no ReDoS surface.
	const re = new RegExp(
		"^" +
			pattern.replace(/:[a-zA-Z]+!?/g, (m) =>
				m.endsWith("!")
					? (keys.push(m.slice(1, -1)), "([^/]+(?:/[^/]+)?)")
					: (keys.push(m.slice(1)), "([^/]+)"),
			) +
			"$",
	);
	routes.push({ method, re, keys, handler });
}

// ---- auth & users ----
route("POST", "/api/login", async (ctx) => {
	const { login, password } = parseJson(ctx.body || "{}");
	const u = userBy((u) => u.login === login);
	if (!u || !verifyPassword(password || "", u))
		return fail(ctx.res, 401, "bad credentials");
	const t = issueToken(u.id);
	send(
		ctx.res,
		200,
		{
			token: t.token,
			expiresAt: new Date(t.expiresAt).toISOString(),
			role: u.role,
		},
		{
			// page navigation (console/editor) authenticates via cookie; XHR sends Bearer
			"set-cookie": `ls_token=${t.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ENV.tokenTtlDays * 86400}`,
		},
	);
});
route("POST", "/api/logout", async (ctx) => {
	const m = (lower(ctx.req)["authorization"] || "").match(/^Bearer (.+)$/);
	if (m) revokeToken(m[1].length === 64 ? m[1] : sha256(m[1]));
	send(
		ctx.res,
		200,
		{ ok: true },
		{
			"set-cookie": "ls_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
		},
	);
});
route("GET", "/api/me", async (ctx) => send(ctx.res, 200, me(ctx.auth)));
route("GET", "/api/users", async (ctx) => {
	if (ctx.auth.role !== "admin") return fail(ctx.res, 403, "admin only");
	send(ctx.res, 200, db.data.users.map(me));
});
route("POST", "/api/users", async (ctx) => {
	if (ctx.auth.role !== "admin") return fail(ctx.res, 403, "admin only");
	const { login, password, role } = parseJson(ctx.body || "{}");
	if (!login || !password)
		return fail(ctx.res, 400, "login and password required");
	if (role && !["admin", "user"].includes(role))
		return fail(ctx.res, 400, "role must be admin|user");
	if (userBy((u) => u.login === login)) return fail(ctx.res, 409, "login taken");
	const { salt, hash } = hashPassword(password);
	const u = {
		id: db.nextId(),
		login,
		role: role || "user",
		salt,
		hash,
		createdAt: new Date().toISOString(),
	};
	db.data.users.push(u);
	db.save();
	send(ctx.res, 201, me(u));
});
// delete a user and every scheme they own (admin only; cannot delete self)
route("DELETE", "/api/user/:id", async (ctx) => {
	if (ctx.auth.role !== "admin") return fail(ctx.res, 403, "admin only");
	const id = Number(ctx.params.id);
	const u = userBy((x) => x.id === id);
	if (!u) return fail(ctx.res, 404, "no such user");
	if (u.id === ctx.auth.id) return fail(ctx.res, 400, "cannot delete yourself");
	fs.rmSync(userRoot(u), { recursive: true, force: true });
	db.data.users = db.data.users.filter((x) => x.id !== id);
	db.save();
	send(ctx.res, 200, { ok: true });
});
// issue an api key (admin may target another user); key shown once
route("POST", "/api/apikey", async (ctx) => {
	const body = parseJson(ctx.body || "{}");
	const target =
		body.login && ctx.auth.role === "admin"
			? userBy((u) => u.login === body.login)
			: ctx.auth;
	if (!target) return fail(ctx.res, 404, "no such user");
	const key = genApiKey();
	target.apiKeys = [
		...(target.apiKeys || []),
		{ key: sha256(key), createdAt: new Date().toISOString() },
	];
	db.save();
	send(ctx.res, 201, { apiKey: key, note: "shown once; store it now" });
});
route("GET", "/api/keys", async (ctx) => {
	if (ctx.auth.role !== "admin") return fail(ctx.res, 403, "admin only");
	send(
		ctx.res,
		200,
		db.data.users.flatMap((u) =>
			(u.apiKeys || [])
				.filter((k) => !k.revoked)
				.map((k) => ({ user: u.login, hash: k.key, createdAt: k.createdAt })),
		),
	);
});
// ready-to-paste MCP connection config; creates the key if the user has none
route("GET", "/api/mcp-config", async (ctx) => {
	const target =
		ctx.query.login && ctx.auth.role === "admin"
			? userBy((u) => u.login === ctx.query.login)
			: ctx.auth;
	if (!target) return fail(ctx.res, 404, "no such user");
	let apiKey = (target.apiKeys || []).filter((k) => !k.revoked).at(-1);
	if (!apiKey) {
		const key = genApiKey();
		target.apiKeys = [
			...(target.apiKeys || []),
			{ key: sha256(key), createdAt: new Date().toISOString() },
		];
		db.save();
		apiKey = { key };
	}
	send(ctx.res, 200, {
		mcpServers: {
			llmscheme: {
				url: `${ctx.origin}/mcp`,
				headers: { "X-Api-Key": apiKey.key },
			},
		},
	});
});

// ---- schemes: CRUD + exports + history ----
route("GET", "/api/schemes", async (ctx) => {
	// admin may list everyone: ?user=all, or one user: ?user=<login>
	const users =
		ctx.query.user && ctx.auth.role === "admin"
			? ctx.query.user === "all"
				? db.data.users
				: [userBy((x) => x.login === ctx.query.user)].filter(Boolean)
			: [ctx.auth];
	if (!users.length) return fail(ctx.res, 404, "no such user");
	const list = [];
	for (const u of users)
		list.push(...listSchemes(u, ctx.query.user === "all" ? u.login : ""));
	send(ctx.res, 200, list);
});

function listSchemes(u, ownerTag) {
	const dir = userRoot(u);
	const list = [];
	if (!fs.existsSync(dir)) return list;
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (!e.isDirectory()) continue;
		const sub = path.join(dir, e.name);
		const push = (pdir, project, label) => {
			if (!fs.existsSync(path.join(pdir, ".block_llm", "scheme.json"))) return;
			const s = readRaw(pdir);
			list.push({
				owner: ownerTag || undefined,
				project,
				name: label,
				rev: s.rev,
				nodes: s.nodes.length,
				edges: s.edges.length,
				updatedAt: s.meta.updatedAt,
			});
		};
		push(sub, "", e.name);
		// one level of projects: <project>/<scheme>
		for (const p of fs.readdirSync(sub, { withFileTypes: true }))
			if (p.isDirectory()) push(path.join(sub, p.name), e.name, p.name);
	}
	return list;
}
route("POST", "/api/schemes", async (ctx) => {
	const { name, scheme } = parseJson(ctx.body || "{}");
	const root = schemeRoot(ctx.auth, name);
	if (hasScheme(ctx.auth, name)) return fail(ctx.res, 409, "scheme exists");
	if (scheme) {
		if (scheme.rev !== 0)
			return fail(ctx.res, 400, "imported scheme must have rev 0");
		const r = saveUserScheme(root, scheme, "put");
		send(ctx.res, 201, { name, rev: r.rev });
	} else {
		const r = saveUserScheme(root, emptyScheme(name), "init");
		send(ctx.res, 201, { name, rev: r.rev });
	}
});
route("GET", "/api/scheme/:name!", async (ctx) => {
	if (!hasScheme(ctx.auth, ctx.params.name))
		return fail(ctx.res, 404, "no such scheme");
	send(ctx.res, 200, readRaw(schemeRoot(ctx.auth, ctx.params.name)));
});
route("PUT", "/api/scheme/:name!", async (ctx) => {
	if (!hasScheme(ctx.auth, ctx.params.name))
		return fail(ctx.res, 404, "no such scheme");
	const root = schemeRoot(ctx.auth, ctx.params.name);
	const current = readRaw(root);
	const next = parseJson(ctx.body);
	// CAS: writer must send the rev it read; protects browser vs CLI vs MCP races
	if (next.rev !== current.rev) throw new CasError(next.rev, current.rev);
	next.meta.generator = "agent";
	const r = saveUserScheme(root, next, "put");
	send(ctx.res, 200, { ok: true, rev: r.rev });
});
route("DELETE", "/api/scheme/:name!", async (ctx) => {
	if (!hasScheme(ctx.auth, ctx.params.name))
		return fail(ctx.res, 404, "no such scheme");
	fs.rmSync(schemeRoot(ctx.auth, ctx.params.name), {
		recursive: true,
		force: true,
	});
	send(ctx.res, 200, { ok: true });
});
route("GET", "/api/scheme/:name!/md", async (ctx) => {
	if (!hasScheme(ctx.auth, ctx.params.name))
		return fail(ctx.res, 404, "no such scheme");
	const s = readRaw(schemeRoot(ctx.auth, ctx.params.name));
	send(ctx.res, 200, exportMd(s, validate(s)), {
		"content-type": "text/markdown; charset=utf-8",
	});
});
route("GET", "/api/scheme/:name!/diff", async (ctx) => {
	if (!hasScheme(ctx.auth, ctx.params.name))
		return fail(ctx.res, 404, "no such scheme");
	const root = schemeRoot(ctx.auth, ctx.params.name);
	const cur = readRaw(root);
	const base = Number(ctx.query.rev || cur.rev - 1);
	const dir = path.join(root, ".block_llm", "cache", "backup");
	const cand = fs.existsSync(dir)
		? fs
				.readdirSync(dir)
				.filter((f) => f.startsWith(`rev${base}-`))
				.sort()
		: [];
	if (!cand.length) return fail(ctx.res, 404, `no snapshot for rev ${base}`);
	let old;
	try {
		old = JSON.parse(fs.readFileSync(path.join(dir, cand.at(-1)), "utf8"));
	} catch {
		return fail(ctx.res, 500, `snapshot for rev ${base} is corrupt`);
	}
	send(ctx.res, 200, {
		from: base,
		to: cur.rev,
		changes: diffSchemes(old, cur),
	});
});

// ---- granular node/edge/zone ops ----
function mutate(ctx, fn) {
	if (!hasScheme(ctx.auth, ctx.params.name))
		return fail(ctx.res, 404, "no such scheme");
	const root = schemeRoot(ctx.auth, ctx.params.name);
	const s = readRaw(root);
	const out = fn(s, parseJson(ctx.body || "{}"));
	const r = saveUserScheme(root, s, out.op);
	send(ctx.res, 200, { ok: true, rev: r.rev, ...out.body });
}
route("POST", "/api/scheme/:name!/node", async (ctx) =>
	mutate(ctx, (s, b) => {
		if (!b.label) throw new DataError("label required");
		const n = {
			id: b.id || consumeNodeId(s),
			shape: b.shape || "rect",
			label: b.label,
		};
		if (b.description !== undefined) n.description = b.description;
		if (b.refs !== undefined) n.refs = b.refs;
		if (b.table !== undefined) n.table = b.table;
		if (Number.isFinite(b.x) && Number.isFinite(b.y)) {
			n.x = b.x;
			n.y = b.y;
			s.nodes.push(n);
		} else {
			s.nodes.push(n);
			autoLayout(s);
		}
		return { op: "node.add", body: { id: n.id } };
	}),
);
route("PUT", "/api/scheme/:name!/node/:id", async (ctx) =>
	mutate(ctx, (s, b) => {
		const n = s.nodes.find((n) => n.id === ctx.params.id);
		if (!n) throw new DataError(`node ${ctx.params.id} not found`);
		for (const k of ["label", "shape", "description", "refs", "x", "y", "table"])
			if (b[k] !== undefined) n[k] = b[k];
		return { op: "node.update", body: { id: n.id } };
	}),
);
route("DELETE", "/api/scheme/:name!/node/:id", async (ctx) =>
	mutate(ctx, (s) => {
		const i = s.nodes.findIndex((n) => n.id === ctx.params.id);
		if (i < 0) throw new DataError(`node ${ctx.params.id} not found`);
		s.nodes.splice(i, 1);
		s.edges = s.edges.filter(
			(e) => e.from !== ctx.params.id && e.to !== ctx.params.id,
		);
		return { op: "node.remove", body: {} };
	}),
);
route("POST", "/api/scheme/:name!/edge", async (ctx) =>
	mutate(ctx, (s, b) => {
		if (!b.from || !b.to) throw new DataError("from/to required");
		const e = {
			id: b.id || consumeEdgeId(s),
			from: b.from,
			to: b.to,
			style: b.style || "solid",
		};
		if (b.label !== undefined) e.label = b.label;
		if (b.fromSide !== undefined) e.fromSide = b.fromSide;
		if (b.toSide !== undefined) e.toSide = b.toSide;
		s.edges.push(e);
		return { op: "edge.add", body: { id: e.id } };
	}),
);
route("PUT", "/api/scheme/:name!/edge/:id", async (ctx) =>
	mutate(ctx, (s, b) => {
		const e = s.edges.find((e) => e.id === ctx.params.id);
		if (!e) throw new DataError(`edge ${ctx.params.id} not found`);
		for (const k of ["from", "to", "style", "label", "fromSide", "toSide"])
			if (b[k] !== undefined) e[k] = b[k];
		return { op: "edge.update", body: { id: e.id } };
	}),
);
route("DELETE", "/api/scheme/:name!/edge/:id", async (ctx) =>
	mutate(ctx, (s) => {
		const i = s.edges.findIndex((e) => e.id === ctx.params.id);
		if (i < 0) throw new DataError(`edge ${ctx.params.id} not found`);
		s.edges.splice(i, 1);
		return { op: "edge.remove", body: {} };
	}),
);
route("POST", "/api/scheme/:name!/zone", async (ctx) =>
	mutate(ctx, (s, b) => {
		const z = {
			id: b.id || consumeZoneId(s),
			label: b.label || "zone",
			x: b.x,
			y: b.y,
			w: b.w,
			h: b.h,
		};
		if (b.description !== undefined) z.description = b.description;
		if (b.labelSide !== undefined) z.labelSide = b.labelSide;
		s.zones = s.zones || [];
		s.zones.push(z);
		return { op: "zone.add", body: { id: z.id } };
	}),
);
route("DELETE", "/api/scheme/:name!/zone/:id", async (ctx) =>
	mutate(ctx, (s) => {
		const i = (s.zones || []).findIndex((z) => z.id === ctx.params.id);
		if (i < 0) throw new DataError(`zone ${ctx.params.id} not found`);
		s.zones.splice(i, 1);
		return { op: "zone.remove", body: {} };
	}),
);

// ---------- MCP (streamable HTTP JSON-RPC over POST /mcp, X-Api-Key auth) ----------
const mcpUser = (req) => {
	const u = auth(req);
	if (!u) throw Object.assign(new Error("X-Api-Key required"), { status: 401 });
	return u;
};

function mcpToolCall(u, name, a) {
	switch (name) {
		case "list_schemes":
			return listSchemes(u, "").map((s) =>
				s.project ? s.project + "/" + s.name : s.name,
			);
		case "get_scheme":
			return readRaw(schemeRoot(u, a.name));
		case "get_scheme_md": {
			const s = readRaw(schemeRoot(u, a.name));
			return exportMd(s, validate(s));
		}
		case "create_scheme": {
			const root = schemeRoot(u, a.name);
			if (hasScheme(u, a.name)) throw new DataError("scheme exists");
			const r = saveUserScheme(
				root,
				a.scheme && a.scheme.rev === 0 ? a.scheme : emptyScheme(a.name),
				"init",
			);
			return { ok: true, rev: r.rev };
		}
		case "put_scheme": {
			const root = schemeRoot(u, a.name);
			const current = readRaw(root);
			if (a.scheme.rev !== current.rev)
				throw new CasError(a.scheme.rev, current.rev);
			const r = saveUserScheme(root, a.scheme, "put");
			return { ok: true, rev: r.rev };
		}
		case "delete_scheme": {
			if (!hasScheme(u, a.name)) throw new DataError("no such scheme");
			fs.rmSync(schemeRoot(u, a.name), { recursive: true, force: true });
			return { ok: true };
		}
		case "node_add": {
			const root = schemeRoot(u, a.name);
			const s = readRaw(root);
			if (!a.label) throw new DataError("label required");
			const n = { id: consumeNodeId(s), shape: a.shape || "rect", label: a.label };
			if (a.description !== undefined) n.description = a.description;
			if (a.refs !== undefined) n.refs = a.refs;
			if (a.table !== undefined) n.table = a.table;
			if (Number.isFinite(a.x) && Number.isFinite(a.y)) {
				n.x = a.x;
				n.y = a.y;
				s.nodes.push(n);
			} else {
				s.nodes.push(n);
				autoLayout(s);
			}
			const r = saveUserScheme(root, s, "node.add");
			return { ok: true, rev: r.rev, id: n.id };
		}
		case "node_update": {
			const root = schemeRoot(u, a.name);
			const s = readRaw(root);
			const n = s.nodes.find((n) => n.id === a.id);
			if (!n) throw new DataError(`node ${a.id} not found`);
			for (const k of ["label", "shape", "description", "refs", "x", "y", "table"])
				if (a[k] !== undefined) n[k] = a[k];
			const r = saveUserScheme(root, s, "node.update");
			return { ok: true, rev: r.rev };
		}
		case "node_remove": {
			const root = schemeRoot(u, a.name);
			const s = readRaw(root);
			const i = s.nodes.findIndex((n) => n.id === a.id);
			if (i < 0) throw new DataError(`node ${a.id} not found`);
			s.nodes.splice(i, 1);
			s.edges = s.edges.filter((e) => e.from !== a.id && e.to !== a.id);
			const r = saveUserScheme(root, s, "node.remove");
			return { ok: true, rev: r.rev };
		}
		case "edge_add": {
			const root = schemeRoot(u, a.name);
			const s = readRaw(root);
			if (!a.from || !a.to) throw new DataError("from/to required");
			const e = {
				id: consumeEdgeId(s),
				from: a.from,
				to: a.to,
				style: a.style || "solid",
			};
			if (a.label !== undefined) e.label = a.label;
			s.edges.push(e);
			const r = saveUserScheme(root, s, "edge.add");
			return { ok: true, rev: r.rev, id: e.id };
		}
		case "edge_remove": {
			const root = schemeRoot(u, a.name);
			const s = readRaw(root);
			const i = s.edges.findIndex((e) => e.id === a.id);
			if (i < 0) throw new DataError(`edge ${a.id} not found`);
			s.edges.splice(i, 1);
			const r = saveUserScheme(root, s, "edge.remove");
			return { ok: true, rev: r.rev };
		}
		case "diff": {
			const root = schemeRoot(u, a.name);
			const cur = readRaw(root);
			const base = Number(a.rev ?? cur.rev - 1);
			const dir = path.join(root, ".block_llm", "cache", "backup");
			const cand = fs.existsSync(dir)
				? fs
						.readdirSync(dir)
						.filter((f) => f.startsWith(`rev${base}-`))
						.sort()
				: [];
			if (!cand.length) throw new DataError(`no snapshot for rev ${base}`);
			let old;
			try {
				old = JSON.parse(fs.readFileSync(path.join(dir, cand.at(-1)), "utf8"));
			} catch {
				throw new DataError(`snapshot for rev ${base} is corrupt`);
			}
			return { from: base, to: cur.rev, changes: diffSchemes(old, cur) };
		}
		default:
			throw new DataError(`unknown tool ${name}`);
	}
}

const MCP_TOOLS = [
	[
		"list_schemes",
		"List scheme names of the authenticated user",
		{ type: "object", properties: {}, additionalProperties: false },
	],
	[
		"get_scheme",
		"Get full scheme JSON by name",
		{
			type: "object",
			properties: { name: { type: "string" } },
			required: ["name"],
			additionalProperties: false,
		},
	],
	[
		"get_scheme_md",
		"Get human-readable markdown export (SCHEME.md) of a scheme",
		{
			type: "object",
			properties: { name: { type: "string" } },
			required: ["name"],
			additionalProperties: false,
		},
	],
	[
		"create_scheme",
		"Create a new empty scheme (or import a full scheme object with rev 0)",
		{
			type: "object",
			properties: { name: { type: "string" }, scheme: { type: "object" } },
			required: ["name"],
			additionalProperties: false,
		},
	],
	[
		"put_scheme",
		"Write the whole scheme (CAS: payload rev must equal current rev; read with get_scheme first)",
		{
			type: "object",
			properties: { name: { type: "string" }, scheme: { type: "object" } },
			required: ["name", "scheme"],
			additionalProperties: false,
		},
	],
	[
		"delete_scheme",
		"Delete a scheme with all its history",
		{
			type: "object",
			properties: { name: { type: "string" } },
			required: ["name"],
			additionalProperties: false,
		},
	],
	[
		"node_add",
		"Add a node (shape rect|square|circle|diamond|table). Without x/y the deterministic layout places it. Returns the new node id.",
		{
			type: "object",
			properties: {
				name: { type: "string" },
				label: { type: "string" },
				shape: {
					type: "string",
					enum: ["rect", "square", "circle", "diamond", "table"],
				},
				table: {
					type: "object",
					properties: {
						cols: { type: "array", items: { type: "string" }, maxItems: 10 },
						rows: {
							type: "array",
							maxItems: 50,
							items: { type: "array", items: { type: "string" } },
						},
					},
				},
				description: { type: "string" },
				refs: { type: "array", items: { type: "string" } },
				x: { type: "number" },
				y: { type: "number" },
			},
			required: ["name", "label"],
			additionalProperties: false,
		},
	],
	[
		"node_update",
		"Update node fields (label/shape/description/refs/x/y)",
		{
			type: "object",
			properties: {
				name: { type: "string" },
				id: { type: "string" },
				label: { type: "string" },
				shape: {
					type: "string",
					enum: ["rect", "square", "circle", "diamond", "table"],
				},
				table: {
					type: "object",
					properties: {
						cols: { type: "array", items: { type: "string" }, maxItems: 10 },
						rows: {
							type: "array",
							maxItems: 50,
							items: { type: "array", items: { type: "string" } },
						},
					},
				},
				description: { type: "string" },
				refs: { type: "array", items: { type: "string" } },
				x: { type: "number" },
				y: { type: "number" },
			},
			required: ["name", "id"],
			additionalProperties: false,
		},
	],
	[
		"node_remove",
		"Remove a node and all its edges",
		{
			type: "object",
			properties: { name: { type: "string" }, id: { type: "string" } },
			required: ["name", "id"],
			additionalProperties: false,
		},
	],
	[
		"edge_add",
		"Connect two nodes with an arrow (style solid|dashed). Returns the new edge id.",
		{
			type: "object",
			properties: {
				name: { type: "string" },
				from: { type: "string" },
				to: { type: "string" },
				style: { type: "string", enum: ["solid", "dashed"] },
				label: { type: "string" },
			},
			required: ["name", "from", "to"],
			additionalProperties: false,
		},
	],
	[
		"edge_remove",
		"Remove an edge by id",
		{
			type: "object",
			properties: { name: { type: "string" }, id: { type: "string" } },
			required: ["name", "id"],
			additionalProperties: false,
		},
	],
	[
		"diff",
		"What changed since a revision (default: previous rev)",
		{
			type: "object",
			properties: { name: { type: "string" }, rev: { type: "number" } },
			required: ["name"],
			additionalProperties: false,
		},
	],
].map(([name, description, inputSchema]) => ({
	name,
	description,
	inputSchema,
}));

async function handleMcp(req, res, body) {
	if (!ENV.mcpEnabled) return fail(res, 404, "mcp disabled");
	let msg;
	try {
		msg = JSON.parse(body || "{}");
	} catch {
		return fail(res, 400, "bad json");
	}
	const { id, method, params } = msg;
	// notifications (no id) get 202 and no body per JSON-RPC
	if (id === undefined || id === null) {
		res.writeHead(202).end();
		return;
	}
	if (method === "initialize") {
		return send(
			res,
			200,
			mcpOk(id, {
				protocolVersion: params?.protocolVersion || "2025-06-18",
				capabilities: { tools: {} },
				serverInfo: { name: "llmscheme-service", version: "1.0.0" },
			}),
		);
	}
	if (method === "tools/list") {
		mcpUser(req); // auth gate
		return send(res, 200, mcpOk(id, { tools: MCP_TOOLS }));
	}
	if (method === "tools/call") {
		let u;
		try {
			u = mcpUser(req);
		} catch (e) {
			return fail(res, e.status || 401, e.message);
		}
		try {
			const result = mcpToolCall(u, params?.name, params?.arguments || {});
			return send(
				res,
				200,
				mcpOk(id, {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				}),
			);
		} catch (e) {
			const msg2 =
				e instanceof CasError ||
				e instanceof ValidationError ||
				e instanceof DataError
					? e.message
					: "internal error";
			log("ERROR", `mcp tools/call ${params?.name}: ${e.message}`);
			return send(res, 200, mcpErr(id, e.status === 404 ? -32602 : -32000, msg2));
		}
	}
	if (method === "ping") return send(res, 200, mcpOk(id, {}));
	return send(res, 200, mcpErr(id, -32601, `method ${method} not found`));
}
const mcpOk = (id, result) => ({ jsonrpc: "2.0", id, result });
const mcpErr = (id, code, message) => ({
	jsonrpc: "2.0",
	id,
	error: { code, message },
});

// ---------- static editor (/editor and /editor/<name>) ----------
// minimal login page for browsers: / and /editor without a token land here
const LOGIN_HTML = `<!doctype html><meta charset=utf-8><title>llmscheme login</title>
<style>body{font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0}form{display:grid;gap:8px;width:16rem}input,button{padding:8px;font:inherit}</style>
<form onsubmit="event.preventDefault();fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login:this.l.value,password:this.p.value})}).then(r=>r.json()).then(j=>{if(j.token)location='/admin';else err.textContent=j.error||'login failed'}).catch(e=>err.textContent=e)">
<input name=l placeholder=login required><input name=p type=password placeholder=password required>
<button>sign in</button><div id=err style="color:#b00"></div></form>`;

// ---------- /admin console: tabs, projects->schemes, users, mcp ----------
// pixel style: same palette + Press Start 2P (base64, from the editor build) as the canvas
const esc = (s) =>
	String(s).replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
	);

// Press Start 2P (latin+cyrillic woff2), extracted once from the editor template
let FONT_CSS = "";
try {
	const faces = [
		...fs
			.readFileSync(TEMPLATE, "utf8")
			.matchAll(
				/@font-face\{[^}]*unicode-range:U\+0301[^}]*\}|@font-face\{[^}]*unicode-range:\s*U\+0000[^}]*\}/g,
			),
	];
	FONT_CSS = faces.map((m) => m[0]).join("");
} catch {}

function adminHtml(u) {
	const admin = u.role === "admin";
	return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>llmscheme</title>
<style>
${FONT_CSS}
:root{--bg:#1a1c2c;--panel:#29366f;--panel2:#3b5dc9;--ink:#f4f4f4;--accent:#ffcd75;--err:#ff004d;--dim:#94b0c2;--edge:#41a6f6;--dark:#091428;--ok:#38b764}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);font-family:"Press Start 2P",monospace;font-size:10px;line-height:1.7}
header{display:flex;gap:10px;align-items:center;padding:10px;background:var(--panel);box-shadow:inset 0 -2px 0 var(--dark);flex-wrap:wrap}
header .title{color:var(--accent);font-size:12px}
header .who{color:var(--dim)}
header .spacer{flex:1}
nav{display:flex;gap:8px;padding:10px;background:var(--panel);box-shadow:inset 0 -2px 0 var(--dark)}
nav button{flex:1;max-width:16rem}
main{max-width:60rem;margin:0 auto;padding:14px}
h2{font-size:10px;color:var(--accent);margin:20px 0 10px;text-transform:uppercase}
table{border-collapse:collapse;width:100%;background:var(--dark);box-shadow:inset -2px -2px 0 var(--panel2)}
th{color:var(--dim);font-weight:400;text-align:left}
td,th{padding:7px 8px;border-bottom:1px solid var(--panel)}
tr:last-child td{border-bottom:0}
tr.proj td{color:var(--accent);background:var(--panel)}
tr.proj td .muted{color:var(--dim)}
button{font:inherit;font-size:9px;background:var(--panel2);color:var(--ink);border:0;box-shadow:inset -2px -2px 0 var(--dark),inset 2px 2px 0 var(--accent);padding:6px 9px;cursor:pointer}
button:hover{filter:brightness(1.15)}
button:active{transform:translateY(1px)}
button.warn{background:#ab5236}
button.tab{background:var(--panel)}
button.tab.on{background:var(--accent);color:var(--dark)}
button:disabled{opacity:.4;cursor:default}
input,select{font:inherit;font-size:9px;background:var(--dark);color:var(--ink);border:0;box-shadow:inset 2px 2px 0 var(--dark),inset -2px -2px 0 var(--panel2);padding:7px}
input:focus,select:focus{outline:2px solid var(--accent)}
form{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0;align-items:center}
form input{width:13rem}
label.chk{display:flex;gap:6px;align-items:center;color:var(--dim);cursor:pointer}
label.chk input{width:auto}
a{color:var(--edge);text-decoration:none}
a:hover{color:var(--accent)}
.muted{color:var(--dim)}
.err{color:var(--err)}
pre{background:var(--dark);box-shadow:inset -2px -2px 0 var(--panel2);padding:10px;overflow:auto;white-space:pre-wrap;word-break:break-word;color:var(--accent);font-family:inherit;font-size:9px}
.flash{position:fixed;top:10px;right:10px;background:var(--panel);box-shadow:inset -2px -2px 0 var(--dark),inset 2px 2px 0 var(--accent);padding:9px 12px;color:var(--accent);z-index:9}
dialog{background:var(--panel);color:var(--ink);border:0;box-shadow:inset -2px -2px 0 var(--dark),inset 2px 2px 0 var(--accent);padding:14px;max-width:44rem;width:92vw}
dialog::backdrop{background:rgba(9,20,40,.8)}
dialog h3{margin:0 0 12px;font-size:11px;color:var(--accent)}
@media (max-width:640px){body{font-size:9px}form input{width:100%}}
</style>
<header>
<span class=title>llmscheme</span><span class=who>· ${esc(u.login)} [${esc(u.role)}]</span><span class=spacer></span>
<button onclick="logout()">выйти</button>
</header>
${
	admin
		? `<nav><button class="tab on" id=tab-edit onclick="tab('edit')">редактирование</button><button class="tab" id=tab-admin onclick="tab('admin')">администрирование</button></nav>
<section id=sec-edit>`
		: `<main>`
}
<div id=editbox>
<h2># мои проекты и схемы</h2>
${admin ? `<label class=chk><input type=checkbox id=allusers onchange="loadSchemes()"> показать схемы всех юзеров</label>` : ""}
<table id=schemes></table>
<h2>+ новая схема</h2>
<form onsubmit="return createScheme(this)"><input name=proj placeholder="проект" pattern="[A-Za-z0-9._-]{1,32}"><input name=sname required placeholder="имя схемы" pattern="[A-Za-z0-9._-]{1,64}"><button>+ создать</button><span class=muted>проект можно оставить пустым</span><span class=err id=scherr></span></form>
</div>
${
	admin
		? `</section>
<section id=sec-admin hidden>
<div id=adminbox>
<h2># пользователи</h2>
<table id=users></table>
<form id=fusers onsubmit="return createUser(this)"><input name=login required pattern="[a-z0-9_.-]{1,32}" placeholder=login><input name=password required minlength=4 placeholder=password><select name=role><option value=user>user</option><option value=admin>admin</option></select><button>+ создать</button><span class=err id=usrerr></span></form>
<h2># mcp-конфиги</h2>
<form onsubmit="return mcpUser(this)"><select name=login id=msel></select><button>показать конфиг</button><span class=muted>готовый JSON для mcp-клиента (ключ создаётся при необходимости)</span></form>
<pre id=mcp hidden></pre>
</div>
</section>`
		: ""
}
</${admin ? "div" : "main"}>
<div id=flashbox></div>
<dialog id=dkey><h3 id=dtitle></h3><pre id=dbody></pre><form method=dialog><button>закрыть</button></form></dialog>
<script>
const ADMIN=${admin ? "true" : "false"};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const flash=(m,err)=>{const d=document.createElement('div');d.className='flash'+(err?' err':'');d.textContent=m;document.getElementById('flashbox').append(d);setTimeout(()=>d.remove(),4000)};
async function api(path,opt={}){const r=await fetch(path,{...opt,headers:{'content-type':'application/json'}});if(r.status===401)location='/';const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||r.status);return j}
function show(id,html){const el=document.getElementById(id);el.hidden=html==null;if(html!=null)el.innerHTML=html}
function tab(name){
document.getElementById('tab-edit').classList.toggle('on',name==='edit');
document.getElementById('tab-admin').classList.toggle('on',name==='admin');
document.getElementById('sec-edit').hidden=name!=='edit';
document.getElementById('sec-admin').hidden=name!=='admin';
if(name==='admin')loadUsers();
}
async function loadSchemes(){try{
const all=document.getElementById('allusers')?.checked;
const l=await api('/api/schemes'+(all?'?user=all':''));
const rows=[];let proj=null;
for(const s of l){
if(s.project!==proj){proj=s.project;rows.push('<tr class=proj><td colspan=5>'+(proj?'📁 '+esc(proj):'📁 (без проекта)')+'</td></tr>')}
const full=(s.project?s.project+'/'+s.name:s.name);
rows.push('<tr><td>'+esc(s.name)+'</td><td>'+s.rev+'</td><td>'+s.nodes+' / '+s.edges+'</td><td class=muted>'+esc((s.updatedAt||'').slice(0,16).replace('T',' '))+'</td><td><a href="/editor/'+encodeURIComponent(full)+'">[редактор]</a> <button class=warn onclick="delScheme(\\''+encodeURIComponent(full)+'\\')">x</button></td></tr>');
}
show('schemes',rows.length?rows.join(''):'<tr><td class=muted>нет схем — создай первую</td></tr>')}catch(e){flash(e.message,1)}}
async function createScheme(f){event.preventDefault();try{
const name=(f.proj.value?f.proj.value+'/'+f.sname.value:f.sname.value);
await api('/api/schemes',{method:'POST',body:JSON.stringify({name})});
flash('схема создана: '+name);f.sname.value='';show('scherr','');loadSchemes()}catch(e){show('scherr',esc(e.message))}return false}
async function delScheme(n){const d=decodeURIComponent(n);if(!confirm('удалить схему "'+d+'" со всей историей?'))return;try{await api('/api/scheme/'+n,{method:'DELETE'});flash('удалена: '+d);loadSchemes()}catch(e){flash(e.message,1)}}
${
	admin
		? `
async function loadUsers(){try{const l=await api('/api/users');
show('users','<tr><th>login</th><th>роль</th><th>ключи</th><th></th></tr>'+l.map(x=>'<tr><td>'+esc(x.login)+'</td><td>'+esc(x.role)+'</td><td>'+x.apiKeys+'</td><td><button onclick="genKey(\\''+encodeURIComponent(x.login)+'\\')">ключ</button> <button class=warn onclick="delUser(\\''+encodeURIComponent(x.login)+'\\','+x.id+')">x</button></td></tr>').join(''));
const sel=document.getElementById('msel');sel.innerHTML='<option value="">— я —</option>'+l.map(x=>'<option value="'+encodeURIComponent(x.login)+'">'+esc(x.login)+'</option>').join('');
}catch(e){flash(e.message,1)}}
async function createUser(f){event.preventDefault();try{await api('/api/users',{method:'POST',body:JSON.stringify({login:f.login.value,password:f.password.value,role:f.role.value})});flash('пользователь создан: '+f.login.value);f.password.value='';show('usrerr','');loadUsers()}catch(e){show('usrerr',esc(e.message))}return false}
async function delUser(n,id){const d=decodeURIComponent(n);if(!confirm('удалить пользователя "'+d+'" и ВСЕ его схемы?'))return;try{await api('/api/user/'+id,{method:'DELETE'});flash('удалён: '+d);loadUsers()}catch(e){flash(e.message,1)}}
async function genKey(n){try{const j=await api('/api/apikey',{method:'POST',body:JSON.stringify({login:decodeURIComponent(n)})});dlg('api-ключ: '+decodeURIComponent(n)+' — показывается ОДИН раз, сохрани сейчас',j.apiKey)}catch(e){flash(e.message,1)}}
async function mcpUser(f){event.preventDefault();try{const q=f.login.value?'?login='+f.login.value:'';const j=await api('/api/mcp-config'+q);const p=document.getElementById('mcp');p.hidden=false;p.textContent=JSON.stringify(j,null,2)}catch(e){flash(e.message,1)}return false}
`
		: ""
}
function dlg(title,body){document.getElementById('dtitle').textContent=title;document.getElementById('dbody').textContent=body;document.getElementById('dkey').showModal()}
async function logout(){try{await api('/api/logout',{method:'POST',body:'{}'})}catch(e){}location='/'}
loadSchemes();
</script>`;
}

function serveEditor(res, name, auth0) {
	// template embeds scheme-data and refuses to boot without format:"block-llm",
	// so /editor/<name> always opens a concrete scheme, creating it if missing
	if (!hasScheme(auth0, name)) {
		saveUserScheme(schemeRoot(auth0, name), emptyScheme(name), "init");
		log("INFO", `created scheme ${name} for ${auth0.login} (via /editor)`);
	}
	const s = readRaw(schemeRoot(auth0, name));
	let html = fs.readFileSync(TEMPLATE, "utf8");
	const script = `<script type="application/json" id="scheme-data">${JSON.stringify(s, null, 2).replace(/</g, "\\u003c")}</script>`;
	html = html.replace(
		/<script type="application\/json" id="scheme-data">[\s\S]*?<\/script>/,
		() => script,
	);
	send(res, 200, html, { "content-type": "text/html; charset=utf-8" });
}

// ---------- request dispatch ----------
// JSON.parse errors and DataError from route bodies are handled HERE, once, at
// the single choke point (no per-route try/catch; a route needing a custom
// status throws {status}).
import http from "node:http";
const server = http.createServer(async (req, res) => {
	const started = Date.now();
	res.on("finish", () =>
		log(
			"INFO",
			`${req.method} ${req.url} -> ${res.statusCode} ${Date.now() - started}ms`,
		),
	);
	const u = new URL(req.url, originOf(req));
	// decode AFTER splitting on real slashes: %2F inside a segment is a scheme-name
	// separator (/editor/web%2Fauth), not a path separator
	const pathname =
		u.pathname
			.split("/")
			.map((seg) => {
				try {
					return decodeURIComponent(seg);
				} catch {
					return seg;
				}
			})
			.join("/")
			.replace(/\/+$/, "") || "/";
	try {
		const body = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)
			? await readBody(req)
			: "";

		// editor: /editor (needs auth), /editor/<name> opens the scheme; token via ?t= or header
		if (req.method === "GET" && pathname.startsWith("/editor")) {
			const a = auth(req, u.searchParams);
			if (!a) {
				// browser gets a login page, scripts keep the JSON error
				if ((req.headers.accept || "").includes("text/html"))
					return send(res, 401, LOGIN_HTML, {
						"content-type": "text/html; charset=utf-8",
					});
				return fail(
					res,
					401,
					"login required: POST /api/login, then open /editor with ?t=<token> or X-Api-Key/Bearer header",
				);
			}
			const name =
				pathname === "/editor"
					? "default" // template dies without a valid scheme — open/create "default"
					: pathname.slice("/editor/".length);
			return serveEditor(res, name, a);
		}

		// console: / and /admin — schemes + users + mcp-config, browser UI over the REST api
		if (req.method === "GET" && (pathname === "/" || pathname === "/admin")) {
			const a = auth(req, u.searchParams);
			if (!a)
				return (req.headers.accept || "").includes("text/html")
					? send(res, 401, LOGIN_HTML, {
							"content-type": "text/html; charset=utf-8",
						})
					: fail(res, 401, "unauthorized (Bearer token or X-Api-Key)");
			return send(res, 200, adminHtml(a, u.origin), {
				"content-type": "text/html; charset=utf-8",
			});
		}
		if (pathname === "/mcp" && req.method === "POST")
			return handleMcp(req, res, body);
		if (pathname === "/health" && req.method === "GET")
			return send(res, 200, { ok: true });

		const ctx = {
			req,
			res,
			body,
			params: {},
			query: Object.fromEntries(u.searchParams),
			auth: null,
			origin: originOf(req),
		};
		for (const r of routes) {
			if (r.method !== req.method) continue;
			const m = pathname.match(r.re);
			if (!m) continue;
			// /api/login is the only unauthenticated route
			if (pathname !== "/api/login") {
				const a = auth(req);
				if (!a) return fail(res, 401, "unauthorized (Bearer token or X-Api-Key)");
				ctx.auth = a;
			}
			r.keys.forEach((k, i) => (ctx.params[k] = decodeURIComponent(m[i + 1])));
			return await r.handler(ctx);
		}
		return fail(res, 404, `no route: ${req.method} ${pathname}`);
	} catch (e) {
		if (e instanceof SyntaxError)
			return fail(res, 400, `invalid JSON: ${e.message}`);
		if (
			e instanceof CasError ||
			e instanceof ValidationError ||
			e instanceof DataError
		)
			return fail(res, e instanceof CasError ? 409 : 400, e.message);
		if (e.status) return fail(res, e.status, e.message);
		log("ERROR", `${req.method} ${pathname}: ${e.stack || e}`);
		return fail(res, 500, "internal error");
	}
});

server.listen(ENV.port, () =>
	log(
		"INFO",
		`llmscheme-service on :${ENV.port} data=${ENV.dataDir} mcp=${ENV.mcpEnabled} editor=/editor`,
	),
);

// graceful shutdown
for (const sig of ["SIGTERM", "SIGINT"])
	process.on(sig, () => {
		log("INFO", `${sig} received, closing`);
		server.close(() => process.exit(0));
		setTimeout(() => process.exit(0), 2000).unref();
	});
