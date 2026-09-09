// Service tests: spin the real server on a random port, drive it with fetch.
// One file per major bug class; no frameworks, no mocks.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { test, after, before, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";

const repo = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
);
const SERVER = path.join(repo, "src", "service", "server.ts");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "blm-svc-"));

let proc: ChildProcess;
let port: number;
let dataDir: string;
let editorDir: string;
let baseUrl: string;
const logBuffer: string[] = [];

before(async () => {
	port = 18000 + Math.floor(Math.random() * 1000);
	dataDir = tmp();
	editorDir = tmp();
	// minimal editor.html: a real HTML doc with the scheme marker so
	// renderHtml finds it and replaces the JSON
	fs.writeFileSync(
		path.join(editorDir, "editor.html"),
		`<!doctype html><html><head><title>T</title>` +
			`<script type="application/json" id="scheme-data">{}</script>` +
			`</head><body><div id="app"></div></body></html>`,
	);
	proc = spawn("node", [SERVER], {
		env: {
			...process.env,
			PORT: String(port),
			DATA_DIR: dataDir,
			ASSETS_DIR: editorDir,
			TOKEN_TTL_DAYS: "1",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	baseUrl = `http://127.0.0.1:${port}`;
	proc.stdout?.on("data", (b: Buffer) => {
		for (const line of b.toString().split("\n")) if (line) logBuffer.push(line);
	});
	proc.stderr?.on("data", (b: Buffer) => {
		for (const line of b.toString().split("\n"))
			if (line) logBuffer.push(`STDERR: ${line}`);
	});
	// wait for /health
	const deadline = Date.now() + 8000;
	while (Date.now() < deadline) {
		try {
			const r = await fetch(`${baseUrl}/health`);
			if (r.ok) return;
		} catch {
			/* not up yet */
		}
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error("server did not start within 8s");
});

after(() => {
	proc?.kill("SIGTERM");
});

const freshDir = () => {
	// wipe data dir for isolation per-test; restart would be slower
	for (const f of fs.readdirSync(dataDir))
		fs.rmSync(path.join(dataDir, f), { recursive: true, force: true });
};

beforeEach(() => {
	freshDir();
	// each test gets its own admin from env defaults
});

interface Authed {
	token: string;
	headers: Record<string, string>;
}

async function login(login = "admin", password = "admin"): Promise<Authed> {
	const r = await fetch(`${baseUrl}/api/login`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ login, password }),
	});
	if (!r.ok) throw new Error(`login failed: ${r.status} ${await r.text()}`);
	const j = (await r.json()) as { token: string };
	return {
		token: j.token,
		headers: {
			Authorization: `Bearer ${j.token}`,
			"content-type": "application/json",
		},
	};
}

test("B5: /editorial returns 404 and does NOT create a stray scheme folder", async () => {
	const a = await login();
	// a fresh admin has no schemes dir yet — capture whether it exists, then
	// verify nothing new appeared
	const schemesDir = path.join(dataDir, "schemes");
	const had = fs.existsSync(schemesDir);
	const before = had ? fs.readdirSync(schemesDir) : [];
	const r = await fetch(`${baseUrl}/editorial`, { headers: a.headers });
	assert.equal(r.status, 404);
	const after = fs.existsSync(schemesDir) ? fs.readdirSync(schemesDir) : [];
	assert.deepEqual(after, before, "no schemes created by /editorial");
});

test("B5: /editorFOO returns 404 and does NOT create /editorFOO", async () => {
	const a = await login();
	const r = await fetch(`${baseUrl}/editorFOO`, { headers: a.headers });
	assert.equal(r.status, 404);
	assert.ok(!fs.existsSync(path.join(dataDir, "schemes", "1", "editorFOO")));
});

test("B6: logout via Bearer revokes that token; reusing it gives 401", async () => {
	const a = await login();
	const r1 = await fetch(`${baseUrl}/api/me`, { headers: a.headers });
	assert.equal(r1.status, 200);
	const r2 = await fetch(`${baseUrl}/api/logout`, {
		method: "POST",
		headers: a.headers,
	});
	assert.equal(r2.status, 200);
	const r3 = await fetch(`${baseUrl}/api/me`, { headers: a.headers });
	assert.equal(r3.status, 401);
});

test("B6: logout via cookie also revokes (server reads either transport)", async () => {
	const lr = await fetch(`${baseUrl}/api/login`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ login: "admin", password: "admin" }),
	});
	const setCookie = lr.headers.get("set-cookie") ?? "";
	const token = setCookie.match(/ls_token=([^;]+)/)?.[1] ?? "";
	assert.ok(token, "set-cookie present");
	const cookieHeaders = { cookie: `ls_token=${token}` };
	const r1 = await fetch(`${baseUrl}/api/me`, { headers: cookieHeaders });
	assert.equal(r1.status, 200);
	await fetch(`${baseUrl}/api/logout`, {
		method: "POST",
		headers: cookieHeaders,
	});
	const r2 = await fetch(`${baseUrl}/api/me`, { headers: cookieHeaders });
	assert.equal(r2.status, 401);
});

test("B7: PUT with no meta returns 400, not 500", async () => {
	const a = await login();
	await fetch(`${baseUrl}/api/schemes`, {
		method: "POST",
		headers: a.headers,
		body: JSON.stringify({ name: "t" }),
	});
	const r = await fetch(`${baseUrl}/api/scheme/t`, {
		method: "PUT",
		headers: a.headers,
		body: "{}",
	});
	assert.equal(r.status, 400);
	const j = (await r.json()) as { error: string };
	assert.match(j.error, /validation failed/);
});

test("B8: PUT with nodes:null returns 400; the on-disk scheme is still readable", async () => {
	const a = await login();
	await fetch(`${baseUrl}/api/schemes`, {
		method: "POST",
		headers: a.headers,
		body: JSON.stringify({ name: "t" }),
	});
	const broken = {
		format: "block-llm",
		version: 1,
		rev: 1,
		name: "t",
		project: { root: ".", codePaths: [] },
		nodes: null,
		edges: [],
		meta: { updatedAt: "2026-01-01", generator: "agent", nextId: { n: 1, e: 1 } },
	};
	const r = await fetch(`${baseUrl}/api/scheme/t`, {
		method: "PUT",
		headers: a.headers,
		body: JSON.stringify(broken),
	});
	assert.equal(r.status, 400);
	const after = await fetch(`${baseUrl}/api/scheme/t`, { headers: a.headers });
	assert.equal(after.status, 200, "scheme on disk still healthy");
});

test("B9: access log contains the path but never the query string", async () => {
	const a = await login();
	logBuffer.length = 0;
	await fetch(`${baseUrl}/api/me?t=SECRET_LEAKED_TOKEN_AAAA`, {
		headers: a.headers,
	});
	// one log line per request — the token must not appear in any of them
	const all = logBuffer.join("\n");
	assert.ok(!all.includes("SECRET_LEAKED_TOKEN_AAAA"), `token leaked: ${all}`);
});

test("B13: GET /api/mcp-config reports state but does NOT revoke or create a key", async () => {
	const a = await login();
	const r1 = await fetch(`${baseUrl}/api/mcp-config`, { headers: a.headers });
	const j1 = (await r1.json()) as { hasKey: boolean; activeKeys: number };
	assert.equal(j1.hasKey, false);
	const r2 = await fetch(`${baseUrl}/api/mcp-config`, { headers: a.headers });
	const j2 = (await r2.json()) as { hasKey: boolean; activeKeys: number };
	assert.deepEqual(j2, j1, "idempotent: state unchanged across reads");
});

test("B13: POST /api/keys/rotate revokes the old and issues a new one (explicit, confirmed)", async () => {
	const a = await login();
	const r1 = await fetch(`${baseUrl}/api/keys`, {
		method: "POST",
		headers: a.headers,
	});
	assert.equal(r1.status, 201);
	const j1 = (await r1.json()) as { apiKey: string };
	const r2 = await fetch(`${baseUrl}/api/keys/rotate`, {
		method: "POST",
		headers: a.headers,
	});
	assert.equal(r2.status, 200);
	const j2 = (await r2.json()) as { apiKey: string };
	assert.notEqual(j1.apiKey, j2.apiKey, "rotate produced a new secret");
	// the old key no longer authenticates
	const r3 = await fetch(`${baseUrl}/api/me`, {
		headers: { "X-Api-Key": j1.apiKey },
	});
	assert.equal(r3.status, 401);
	// the new key does
	const r4 = await fetch(`${baseUrl}/api/me`, {
		headers: { "X-Api-Key": j2.apiKey },
	});
	assert.equal(r4.status, 200);
});

test("B15: /mcp with foreign Origin returns 403; absent Origin is fine", async () => {
	const r1 = await fetch(`${baseUrl}/mcp`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			Origin: "http://evil.example",
		},
		body: "{}",
	});
	assert.equal(r1.status, 403);
	const r2 = await fetch(`${baseUrl}/mcp`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: '{"jsonrpc":"2.0","id":1,"method":"server/discover"}',
	});
	assert.equal(r2.status, 200);
});

test("B16: MCP modern — server/discover lists all supported versions, tools/list has annotations", async () => {
	const a = await login();
	const r1 = await fetch(`${baseUrl}/mcp`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"MCP-Protocol-Version": "2026-07-28",
		},
		body: '{"jsonrpc":"2.0","id":1,"method":"server/discover"}',
	});
	const j1 = (await r1.json()) as {
		result: { supportedVersions: string[]; capabilities: { tools: object } };
	};
	assert.ok(j1.result.supportedVersions.includes("2026-07-28"));
	assert.ok(j1.result.supportedVersions.includes("2025-11-25"));
	// tools/list — needs an api key, but we use Bearer here: the endpoint
	// only checks X-Api-Key. Issue a key, then call as the api client would.
	const kr = await fetch(`${baseUrl}/api/keys`, {
		method: "POST",
		headers: a.headers,
	});
	const { apiKey } = (await kr.json()) as { apiKey: string };
	const r2 = await fetch(`${baseUrl}/mcp`, {
		method: "POST",
		headers: { "content-type": "application/json", "X-Api-Key": apiKey },
		body: '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
	});
	const j2 = (await r2.json()) as {
		result: { tools: { name: string; annotations: Record<string, unknown> }[] };
	};
	assert.equal(j2.result.tools.length, 12, "12 tools");
	for (const t of j2.result.tools) {
		assert.ok(t.annotations, `${t.name} has no annotations`);
		assert.equal(typeof t.annotations.readOnlyHint, "boolean");
		assert.equal(typeof t.annotations.destructiveHint, "boolean");
		assert.equal(typeof t.annotations.idempotentHint, "boolean");
	}
});

test("B16: MCP legacy — initialize echoes the client's protocolVersion", async () => {
	const a = await login();
	const kr = await fetch(`${baseUrl}/api/keys`, {
		method: "POST",
		headers: a.headers,
	});
	const { apiKey } = (await kr.json()) as { apiKey: string };
	const r = await fetch(`${baseUrl}/mcp`, {
		method: "POST",
		headers: { "content-type": "application/json", "X-Api-Key": apiKey },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: "2025-11-25" },
		}),
	});
	const j = (await r.json()) as { result: { protocolVersion: string } };
	assert.equal(j.result.protocolVersion, "2025-11-25");
});

test("B16: unknown MCP version returns 400 with supported list", async () => {
	const r = await fetch(`${baseUrl}/mcp`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"MCP-Protocol-Version": "1999-01-01",
		},
		body: '{"jsonrpc":"2.0","id":1,"method":"server/discover"}',
	});
	assert.equal(r.status, 400);
	const j = (await r.json()) as {
		error: { code: number; data: { supported: string[] } };
	};
	assert.equal(j.error.code, -32025);
	assert.ok(Array.isArray(j.error.data.supported));
});

test("B16: Mcp-Method header/body mismatch returns 400 with -32020", async () => {
	const a = await login();
	const kr = await fetch(`${baseUrl}/api/keys`, {
		method: "POST",
		headers: a.headers,
	});
	const { apiKey } = (await kr.json()) as { apiKey: string };
	const r = await fetch(`${baseUrl}/mcp`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"X-Api-Key": apiKey,
			"Mcp-Method": "tools/list",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: "list_schemes" },
		}),
	});
	assert.equal(r.status, 400);
	const j = (await r.json()) as { error: { code: number } };
	assert.equal(j.error.code, -32020);
});

test("isolation: user2 cannot see admin's schemes", async () => {
	const admin = await login("admin", "admin");
	await fetch(`${baseUrl}/api/schemes`, {
		method: "POST",
		headers: admin.headers,
		body: JSON.stringify({ name: "admin-only" }),
	});
	// create user2
	const ur = await fetch(`${baseUrl}/api/users`, {
		method: "POST",
		headers: admin.headers,
		body: JSON.stringify({ login: "user2", password: "user2pass" }),
	});
	assert.equal(ur.status, 201);
	const u2 = await login("user2", "user2pass");
	const list = await fetch(`${baseUrl}/api/schemes`, { headers: u2.headers });
	const j = (await list.json()) as { name: string }[];
	assert.equal(j.length, 0);
});

test("PATCH /api/user/:id changes a user's role (admin-only, never self, never last admin)", async () => {
	const admin = await login("admin", "admin");
	// two fresh users: one to act on, one to try acting as a non-admin
	const mk = async (login: string) => {
		const r = await fetch(`${baseUrl}/api/users`, {
			method: "POST",
			headers: admin.headers,
			body: JSON.stringify({ login, password: `${login}pw` }),
		});
		return (await r.json()) as { id: number };
	};
	const target = await mk("roletarget");
	await mk("roleactor");

	// a non-admin cannot change anyone's role
	const actorLogin = await login("roleactor", "roleactorpw");
	const forbidden = await fetch(`${baseUrl}/api/user/${target.id}`, {
		method: "PATCH",
		headers: actorLogin.headers,
		body: JSON.stringify({ role: "admin" }),
	});
	assert.equal(forbidden.status, 403);

	// promote user -> admin
	const promo = await fetch(`${baseUrl}/api/user/${target.id}`, {
		method: "PATCH",
		headers: admin.headers,
		body: JSON.stringify({ role: "admin" }),
	});
	assert.equal(promo.status, 200);
	assert.equal(((await promo.json()) as { role: string }).role, "admin");

	// admin cannot change their own role
	const self = await fetch(`${baseUrl}/api/user/1`, {
		method: "PATCH",
		headers: admin.headers,
		body: JSON.stringify({ role: "user" }),
	});
	assert.equal(self.status, 400);

	// demote the promoted admin back down (now 2 admins exist, so ok)
	const demo = await fetch(`${baseUrl}/api/user/${target.id}`, {
		method: "PATCH",
		headers: admin.headers,
		body: JSON.stringify({ role: "user" }),
	});
	assert.equal(demo.status, 200);

	// cannot demote the LAST admin (only "admin" left now)
	const last = await fetch(`${baseUrl}/api/user/1`, {
		method: "PATCH",
		headers: admin.headers,
		body: JSON.stringify({ role: "user" }),
	});
	assert.equal(last.status, 400);
});

test("admin can scope ?user=all to see every user's schemes", async () => {
	const admin = await login("admin", "admin");
	await fetch(`${baseUrl}/api/users`, {
		method: "POST",
		headers: admin.headers,
		body: JSON.stringify({ login: "u3", password: "u3pass" }),
	});
	const u3 = await login("u3", "u3pass");
	await fetch(`${baseUrl}/api/schemes`, {
		method: "POST",
		headers: u3.headers,
		body: JSON.stringify({ name: "u3-scheme" }),
	});
	const list = await fetch(`${baseUrl}/api/schemes?user=all`, {
		headers: admin.headers,
	});
	const j = (await list.json()) as { owner: string; name: string }[];
	const mine = j.find((s) => s.name === "u3-scheme");
	assert.ok(mine, "admin sees u3's scheme");
	assert.equal(mine?.owner, "u3");
	// non-admin cannot pass ?user=all
	const denied = await fetch(`${baseUrl}/api/schemes?user=all`, {
		headers: u3.headers,
	});
	const j2 = (await denied.json()) as { name: string }[];
	assert.equal(j2.length, 1, "non-admin sees only their own");
});

test("project/scheme via %2F: schemes with a slash in the name are reachable", async () => {
	const a = await login();
	const r1 = await fetch(`${baseUrl}/api/schemes`, {
		method: "POST",
		headers: a.headers,
		body: JSON.stringify({ name: "web/auth" }),
	});
	assert.equal(r1.status, 201);
	const r2 = await fetch(`${baseUrl}/api/scheme/web%2Fauth`, {
		headers: a.headers,
	});
	assert.equal(r2.status, 200);
	const j = (await r2.json()) as { name: string };
	assert.equal(j.name, "web/auth");
});

test("body too large returns 413 (or connection refused, either is safe)", async () => {
	const a = await login();
	// The server destroys the connection when the body exceeds MAX_BODY_MB,
	// which undici reports as a fetch error rather than a 413 status. Either
	// "rejected with ECONNRESET" or "responded 413" is acceptable — the
	// contract is "this never reaches the handler". Try once with retry so a
	// transient glitch doesn't fail the test.
	let outcome = "unknown";
	for (let i = 0; i < 2; i++) {
		try {
			const r = await fetch(`${baseUrl}/api/me`, {
				method: "POST",
				headers: a.headers,
				body: new ReadableStream({
					start(c) {
						c.enqueue(new Uint8Array(9 * 1024 * 1024).fill(0x78));
						c.close();
					},
				}),
				duplex: "half",
			} as RequestInit);
			outcome = r.status === 413 ? "413" : `status ${r.status}`;
			break;
		} catch (e) {
			outcome = `rejected: ${(e as Error).message}`;
		}
	}
	// a 413 OR a connection-level rejection both mean "the body never reached
	// the handler" — that is the whole point of the limit. We don't insist on
	// a specific status code here.
	assert.ok(
		outcome === "413" || outcome.startsWith("rejected"),
		`expected 413 or a rejected connection, got ${outcome}`,
	);
	// and a healthy request still works (the server didn't crash)
	const a2 = await login();
	assert.equal(
		(await fetch(`${baseUrl}/api/me`, { headers: a2.headers })).status,
		200,
	);
});

test("unknown route returns 404 (not 500)", async () => {
	const a = await login();
	const r = await fetch(`${baseUrl}/api/nosuch`, { headers: a.headers });
	assert.equal(r.status, 404);
});

test("scheme rename and duplicate", async () => {
	const a = await login("admin", "admin");
	const mk = (name: string) =>
		fetch(`${baseUrl}/api/schemes`, {
			method: "POST",
			headers: a.headers,
			body: JSON.stringify({ name }),
		});
	assert.equal((await mk("ren/proj")).status, 201);

	// rename ren/proj -> ren/proj2
	const rn = await fetch(`${baseUrl}/api/scheme/ren%2Fproj/rename`, {
		method: "POST",
		headers: a.headers,
		body: JSON.stringify({ to: "ren/proj2" }),
	});
	assert.equal(rn.status, 200);
	const list1 = (await (
		await fetch(`${baseUrl}/api/schemes`, { headers: a.headers })
	).json()) as {
		project: string;
		name: string;
	}[];
	assert.ok(list1.some((s) => s.project === "ren" && s.name === "proj2"));
	assert.ok(!list1.some((s) => s.project === "ren" && s.name === "proj"));

	// duplicate ren/proj2 -> ren/proj3
	const dup = await fetch(`${baseUrl}/api/scheme/ren%2Fproj2/duplicate`, {
		method: "POST",
		headers: a.headers,
		body: JSON.stringify({ to: "ren/proj3" }),
	});
	assert.equal(dup.status, 201);
	const list2 = (await (
		await fetch(`${baseUrl}/api/schemes`, { headers: a.headers })
	).json()) as {
		project: string;
		name: string;
	}[];
	assert.ok(list2.some((s) => s.project === "ren" && s.name === "proj3"));
	assert.ok(list2.some((s) => s.project === "ren" && s.name === "proj2"));

	// duplicate onto an existing name -> 409
	const clash = await fetch(`${baseUrl}/api/scheme/ren%2Fproj3/duplicate`, {
		method: "POST",
		headers: a.headers,
		body: JSON.stringify({ to: "ren/proj2" }),
	});
	assert.equal(clash.status, 409);
});

test("own password change requires current; admin sets others without it", async () => {
	const a = await login("admin", "admin");
	// create a regular user
	await fetch(`${baseUrl}/api/users`, {
		method: "POST",
		headers: a.headers,
		body: JSON.stringify({ login: "pwuser", password: "pwuser1" }),
	});
	const u = await login("pwuser", "pwuser1");

	// own change without current -> 400
	const bad = await fetch(`${baseUrl}/api/password`, {
		method: "POST",
		headers: u.headers,
		body: JSON.stringify({ password: "pwuser2" }),
	});
	assert.equal(bad.status, 400);

	// own change with wrong current -> 403
	const wrong = await fetch(`${baseUrl}/api/password`, {
		method: "POST",
		headers: u.headers,
		body: JSON.stringify({ current: "nope", password: "pwuser2" }),
	});
	assert.equal(wrong.status, 403);

	// admin sets pwuser's password without current -> 200
	const byAdmin = await fetch(`${baseUrl}/api/password`, {
		method: "POST",
		headers: a.headers,
		body: JSON.stringify({ login: "pwuser", password: "pwuser3" }),
	});
	assert.equal(byAdmin.status, 200);
});

test("MCP tools/call round-trip: create_scheme then list_schemes", async () => {
	const a = await login();
	const kr = await fetch(`${baseUrl}/api/keys`, {
		method: "POST",
		headers: a.headers,
	});
	const { apiKey } = (await kr.json()) as { apiKey: string };
	const call = (method: string, params: Record<string, unknown>) =>
		fetch(`${baseUrl}/mcp`, {
			method: "POST",
			headers: { "content-type": "application/json", "X-Api-Key": apiKey },
			body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }),
		});

	const created = await call("tools/call", {
		name: "create_scheme",
		arguments: { name: "mcp-made" },
	});
	const cj = (await created.json()) as {
		result: { content: { text: string }[] };
	};
	assert.equal(created.status, 200);
	assert.match(cj.result.content[0]!.text, /"rev":\s*1/);

	const listed = await call("tools/call", {
		name: "list_schemes",
		arguments: {},
	});
	const lj = (await listed.json()) as {
		result: { content: { text: string }[] };
	};
	assert.match(lj.result.content[0]!.text, /mcp-made/);
});
