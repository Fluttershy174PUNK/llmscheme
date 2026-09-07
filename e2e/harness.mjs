// pi-lens-ignore-file: no-console-except-error-js — this IS the test reporter
// e2e harness (test runner, console output is the product): puppeteer + tiny assertion kit + fresh user/scheme fixtures.
// Usage: BASE=http://host:8080 ADMIN_PASSWORD=... node e2e/run.mjs [suite ...]
// Suites: login console editor projects mcp security. No suite = all.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let puppeteer;
try {
	puppeteer = require("puppeteer");
} catch {
	console.error("e2e needs puppeteer: npm i -D puppeteer (in e2e/ or globally)");
	process.exit(2);
}

export const BASE = process.env.BASE || "http://127.0.0.1:8080";
export const ADMIN = process.env.E2E_ADMIN || "admin";
export const PASS = process.env.E2E_PASSWORD || "";

export function define(name, fn) {
	return { name, fn };
}

// ---- assertion kit ----
export function kit(t) {
	return {
		truthy(v, msg) {
			t.push({ ok: !!v, msg });
			return v;
		},
		eq(a, b, msg) {
			t.push({
				ok: a === b,
				msg: `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`,
			});
		},
		falsy(v, msg) {
			t.push({ ok: !v, msg });
			return v;
		},
		notEq(a, b, msg) {
			t.push({ ok: a !== b, msg: `${msg} (values must differ)` });
		},
		has(needle, hay, msg) {
			t.push({ ok: hay.includes(needle), msg: `${msg} (missing "${needle}")` });
		},
		urlIncludes(part, msg) {
			t.push({ ok: page_url.includes(part), msg: `${msg} (url=${page_url})` });
		},
	};
}
let page_url = "";

// ---- api client (for fixtures/cleanup, no browser) ----
export async function api(path, { method = "GET", token, key, body } = {}) {
	const headers = { "content-type": "application/json" };
	if (token) headers.authorization = `Bearer ${token}`;
	if (key) headers["x-api-key"] = key;
	const init = { method, headers };
	if (body !== undefined) init.body = JSON.stringify(body);
	const res = await fetch(BASE + path, init);
	return { status: res.status, json: await res.json().catch(() => ({})) };
}

export async function login(user, password) {
	const r = await api("/api/login", { method: "POST", body: { login: user, password } });
	if (r.status !== 200) throw new Error(`login failed: ${r.status} ${JSON.stringify(r.json)}`);
	return r.json.token;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// test reporter output (intentional console usage, suppressed per line below)
const out = (...a) => process.stdout.write(a.join(" ") + "\n");

export function randUser() {
	return "e2e_" + crypto.randomBytes(4).toString("hex");
}

export async function cleanupScheme(token, full) {
	await api("/api/scheme/" + full, { method: "DELETE", token });
}

// ---- suite runner ----
export async function run(suites) {
	if (!PASS) {
		console.error("set E2E_PASSWORD (admin password of the target service)");
		process.exit(2);
	}
	// idempotency: wipe leftovers from previous runs (e2e_* users, e2e-* schemes)
	try {
		const tok = await login(ADMIN, PASS);
		const schemes = await api("/api/schemes?user=all", { token: tok });
		for (const s of schemes.json) {
			const full = s.project ? `${s.project}/${s.name}` : s.name;
			if (full.startsWith("e2e") || full.startsWith("tmp/"))
				await api("/api/scheme/" + encodeURIComponent(full), { method: "DELETE", token: tok });
		}
		const users = await api("/api/users", { token: tok });
		for (const u of users.json) {
			if (u.login.startsWith("e2e_"))
				await api("/api/user/" + u.id, { method: "DELETE", token: tok });
		}
		out("cleanup: previous e2e data wiped");
	} catch (e) {
		console.error("cleanup skipped:", e.message);
	}
	const here = path.dirname(fileURLToPath(import.meta.url));
	const files = fs
		.readdirSync(here)
		.filter((f) => /^test-.*\.mjs$/.test(f))
		.filter((f) => !suites.length || suites.some((s) => f.includes(s)));
	let pass = 0;
	let fail = 0;
	const failures = [];
	const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
	for (const f of files) {
		const mod = await import(new URL(f, import.meta.url).href);
		const suite = mod.default;
		if (!suite) continue;
		const t = [];
		let page = null;
		// incognito context per suite: cookies (auth) never leak between suites
		const context = await browser.createBrowserContext();
		try {
			page = await context.newPage();
			page.on("pageerror", (e) =>
				t.push({ ok: false, msg: `PAGEERROR: ${e.message.slice(0, 140)}` }),
			);
			await page.setViewport({ width: 1440, height: 900 });
			page_url = "";
			await suite.fn({
				t: kit({
					push: (x) => {
						t.push(x);
					},
				}),
				page,
				browser,
				BASE,
				ADMIN,
				PASS,
				api,
				login,
				randUser,
				cleanupScheme,
				setPageUrl: (u) => (page_url = u),
			});
		} catch (e) {
			t.push({ ok: false, msg: `SUITE CRASHED: ${e.message}` });
		}
		try {
			await context.close();
		} catch {}
		out(`\n== ${suite.name} (${f})`);
		for (const r of t) {
			if (r.ok) pass++;
			else {
				fail++;
				failures.push(`${suite.name}: ${r.msg}`);
			}
			out(`${r.ok ? "PASS" : "FAIL"} | ${r.msg}`);
		}
	}
	await browser.close();
	out(`\n=== e2e: ${pass} pass, ${fail} fail ===`);
	if (failures.length) {
		out("failures:");
		for (const f of failures) out(" -", f);
		process.exit(1);
	}
}
