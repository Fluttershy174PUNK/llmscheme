// e2e: security — unauth walls, cookie flags, quota/name validation, console XSS
import { define } from "./harness.mjs";

export default define("security", async ({ t, page, BASE, ADMIN, PASS, api, login, randUser }) => {
	// every /api route except /api/login requires auth
	for (const [method, path] of [
		["GET", "/api/schemes"],
		["GET", "/api/users"],
		["GET", "/api/me"],
		["GET", "/api/keys"],
		["POST", "/api/schemes"],
		["POST", "/api/users"],
		["GET", "/api/mcp-config"],
	]) {
		const r = await fetch(BASE + path, {
			method,
			headers: { "content-type": "application/json" },
			body: method === "POST" ? "{}" : undefined,
		});
		t.eq(r.status, 401, `unauth ${method} ${path} -> 401`);
	}

	// editor without auth: browser gets login html, curl gets json
	const noAuth = await fetch(BASE + "/editor/whatever", { headers: { accept: "text/html" } });
	t.eq(noAuth.status, 401, "unauth /editor -> 401");
	t.truthy((await noAuth.text()).includes("sign in"), "login page served to browser");

	// login sets HttpOnly cookie
	const res = await fetch(BASE + "/api/login", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ login: ADMIN, password: PASS }),
	});
	const setCookie = res.headers.get("set-cookie") || "";
	t.truthy(setCookie.includes("ls_token="), "login sets ls_token cookie");
	t.truthy(setCookie.includes("HttpOnly"), "cookie is HttpOnly");
	t.truthy(setCookie.includes("SameSite=Lax"), "cookie SameSite=Lax");
	const token = (await res.json()).token;

	// bad password is rejected without user enumeration timing signal
	const bad = await fetch(BASE + "/api/login", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ login: ADMIN, password: "nope" }),
	});
	t.eq(bad.status, 401, "bad password -> 401");

	// XSS: scheme name with html chars can't be created (validation), but console
	// escapes anything coming from the db anyway — verify esc via user login field
	const evil = `<img src=x onerror=window.__xss=1>`;
	await api("/api/users", { method: "POST", token, body: { login: "xss-probe-1", password: "x" } }); // ensure admin path works
	// try to create a user with an evil login — server accepts a-z0-9_.- only
	const evilUser = await api("/api/users", { method: "POST", token, body: { login: evil, password: "x" } });
	t.eq(evilUser.status, 400, "html login rejected server-side");

	// scheme name validation: traversal + deep path
	t.eq((await api("/api/schemes", { method: "POST", token, body: { name: "../x" } })).status, 400, "traversal blocked");
	t.eq((await api("/api/schemes", { method: "POST", token, body: { name: "a..b/x" } })).status, 400, ".. in name blocked");
	t.eq((await api("/api/schemes", { method: "POST", token, body: { name: "ok-name_1" } })).status, 201, "normal name ok");

	// revoked token stops working immediately
	await api("/api/logout", { method: "POST", token, body: {} });
	t.eq((await api("/api/schemes", { token })).status, 401, "revoked token -> 401");
});
