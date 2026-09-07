// e2e: projects — per-user isolation, project/scheme naming, all-users slider
import { define, sleep } from "./harness.mjs";

export default define("projects & isolation", async ({ t, page, browser, BASE, ADMIN, PASS, api, login, randUser }) => {
	const adminTok = await login(ADMIN, PASS);
	const user = randUser();
	await api("/api/users", { method: "POST", token: adminTok, body: { login: user, password: user + "-pw" } });
	const userTok = await login(user, user + "-pw");

	// user creates project/scheme via API
	const full = "e2e-proj/alpha";
	const r = await api("/api/schemes", { method: "POST", token: userTok, body: { name: full } });
	t.eq(r.status, 201, "project/scheme created (201)");

	// bad names rejected
	t.eq(
		(await api("/api/schemes", { method: "POST", token: userTok, body: { name: "../etc" } })).status,
		400,
		"traversal rejected",
	);
	t.eq(
		(await api("/api/schemes", { method: "POST", token: userTok, body: { name: "a/b/c" } })).status,
		400,
		"3-level name rejected",
	);

	// isolation: admin's list does not include user's scheme; ?user=all does
	const own = await api("/api/schemes", { token: adminTok });
	t.falsy(
		JSON.stringify(own.json).includes("alpha"),
		"admin list hides other user's scheme",
	);
	const all = await api("/api/schemes?user=all", { token: adminTok });
	t.truthy(
		JSON.stringify(all.json).includes("alpha") && JSON.stringify(all.json).includes(user),
		"?user=all shows other user's scheme with owner",
	);
	// non-admin ?user=all is accepted but scoped to their own schemes (param ignored)
	const nonAdminAll = await api("/api/schemes?user=all", { token: userTok });
	t.eq(nonAdminAll.status, 200, "non-admin all-listing responds");
	t.falsy(
		JSON.stringify(nonAdminAll.json).includes("admin"),
		"non-admin all-listing contains no foreign schemes",
	);

	// editor for user's scheme: user ok, admin 404
	const edUser = await fetch(`${BASE}/editor/${encodeURIComponent(full)}`, { headers: { accept: "text/html", authorization: `Bearer ${userTok}` } });
	t.eq(edUser.status, 200, "owner opens /editor/project/scheme");
	const adminOwn = "e2e-proj/alpha"; // same name, DIFFERENT owner -> admin gets his own copy
	const edAdmin = await fetch(`${BASE}/editor/${encodeURIComponent(adminOwn)}`, { headers: { accept: "text/html", authorization: `Bearer ${adminTok}` } });
	t.eq(edAdmin.status, 200, "admin /editor auto-creates own copy (no leak)");
	const adminEd = await edAdmin.text();
	// admin's copy must contain HIS scheme-data marker (fresh empty scheme rev 1),
	// not the user's scheme — /editor always resolves inside the caller's dir
	t.falsy(/"rev":\s*[2-9]/.test(adminEd), "admin /editor does not serve user scheme data");

	// UI: user has no all-users slider; admin has
	const pageA = await page;
	await pageA.goto(BASE + "/", { waitUntil: "networkidle0" });
	await pageA.type("input[name=l]", ADMIN);
	await pageA.type("input[name=p]", PASS);
	await Promise.all([pageA.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}), pageA.click("form button")]);
	await sleep(600);
	t.truthy(await pageA.$("#allusers"), "admin sees show-all slider");
	await pageA.evaluate(() => document.getElementById("allusers")?.click());
	await sleep(700);
	const tbl = await pageA.$eval("#schemes", (el) => el.textContent);
	t.truthy(tbl.includes("alpha"), "slider on: user scheme visible in admin table");

	// non-admin page: no slider, no tabs
	const ctx = await browser.createBrowserContext();
	const p2 = await ctx.newPage();
	await p2.goto(BASE + "/", { waitUntil: "networkidle0" });
	await p2.type("input[name=l]", user);
	await p2.type("input[name=p]", user + "-pw");
	await Promise.all([p2.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}), p2.click("form button")]);
	await sleep(600);
	t.eq(await p2.evaluate(() => !!document.getElementById("allusers")), false, "no slider for plain user");
	t.eq(await p2.evaluate(() => document.querySelectorAll("nav button").length), 0, "no admin tabs for plain user");
	await ctx.close();

	// cleanup
	await api("/api/scheme/e2e-proj%2Falpha", { method: "DELETE", token: userTok });
	await api("/api/scheme/e2e-proj%2Falpha", { method: "DELETE", token: adminTok });
	const usersRes = await api("/api/users", { token: adminTok });
	const uid = usersRes.json.find((u) => u.login === user).id;
	await api("/api/user/" + uid, { method: "DELETE", token: adminTok });
});
