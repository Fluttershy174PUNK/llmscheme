// e2e: console (/admin) — tabs, schemes table, users, mcp-config, logout
import { define } from "./harness.mjs";

export default define("console /admin", async ({ t, page, BASE, ADMIN, PASS, randUser }) => {
	const user = randUser(); // fresh admin-scoped data each run
	// login via UI
	await page.goto(BASE + "/", { waitUntil: "networkidle0" });
	await page.type("input[name=l]", ADMIN);
	await page.type("input[name=p]", PASS);
	await Promise.all([
		page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
		page.click("form button"),
	]);
	t.truthy(page.url().includes("/admin"), `login lands on console (${page.url()})`);

	// tabs: admin sees both, edit active by default
	const tabs = await page.$$eval("nav button", (bs) => bs.map((b) => b.textContent));
	t.eq(tabs.join(","), "редактирование,администрирование", "admin has both tabs");
	t.truthy(
		await page.$eval("#sec-edit", (el) => !el.hidden),
		"edit tab open by default",
	);
	await page.evaluate(() => document.querySelector("#tab-admin").click());
	await t.truthy(
		await page.$eval("#sec-admin", (el) => !el.hidden),
		"admin tab opens",
	);

	// create user via form -> appears in table
	await page.type("#fusers input[name=login]", user);
	await page.type("#fusers input[name=password]", user + "-pw");
	await page.evaluate(() => document.querySelector("#fusers button").click());
	await page.waitForFunction(
		(u) => document.getElementById("users")?.textContent.includes(u),
		{},
		user,
	);
	t.truthy(
		(await page.$eval("#users", (el) => el.textContent)).includes(user),
		"created user appears in table",
	);

	// mcp-config for that user -> JSON with key
	await page.select("#msel", user);
	await page.evaluate(() => document.querySelector("form[onsubmit*='mcpUser'] button").click());
	await page.waitForFunction(() => {
		const p = document.getElementById("mcp");
		return !p.hidden && p.textContent.includes("mcpServers");
	}, { timeout: 5000 });
	const mcpText = await page.$eval("#mcp", (el) => el.textContent);
	t.truthy(mcpText.includes("X-Api-Key"), "mcp config contains api key");

	// api-key generation shows once in dialog
	await page.evaluate((u) => {
		const rows = [...document.querySelectorAll("#users tr")];
		const row = rows.find((r) => r.textContent.includes(u));
		row.querySelector("button").click();
	}, user);
	await page.waitForFunction(() => document.getElementById("dkey").open, { timeout: 5000 });
	const key = await page.$eval("#dbody", (el) => el.textContent);
	t.truthy(key.startsWith("llm_"), `api key shown once (${key.slice(0, 12)}…)`);

	// delete the user (confirm) -> gone
	page.on("dialog", (d) => d.accept());
	await page.evaluate((u) => {
		const rows = [...document.querySelectorAll("#users tr")];
		const row = rows.find((r) => r.textContent.includes(u));
		row.querySelector("button.warn").click();
	}, user);
	await page.waitForFunction(
		(u) => !document.getElementById("users")?.textContent.includes(u),
		{ timeout: 5000 },
		user,
	);
	t.truthy(
		!(await page.$eval("#users", (el) => el.textContent)).includes(user),
		"deleted user disappears",
	);

	// schemes tab: create project/scheme via form -> grouped row
	await page.evaluate(() => document.querySelector("#tab-edit").click());
	await page.type("form[onsubmit*='createScheme'] input[name=proj]", "e2e");
	await page.type("form[onsubmit*='createScheme'] input[name=sname]", "s1");
	await page.evaluate(() => document.querySelector("form[onsubmit*='createScheme'] button").click());
	await page.waitForFunction(() =>
		document.getElementById("schemes")?.textContent.includes("📁"),
	);
	const tbl = await page.$eval("#schemes", (el) => el.textContent);
	t.truthy(tbl.includes("e2e") && tbl.includes("s1"), "project/scheme row grouped");
	t.truthy(tbl.includes("[редактор]"), "editor link present");

	// delete scheme
	await page.evaluate(() => {
		const row = [...document.querySelectorAll("#schemes tr")].find((r) =>
			r.textContent.includes("s1"),
		);
		row.querySelector("button.warn").click();
	});
	await page.waitForFunction(() =>
		!document.getElementById("schemes")?.textContent.includes("s1"),
	);
	t.truthy(
		!(await page.$eval("#schemes", (el) => el.textContent)).includes("s1"),
		"scheme deleted",
	);

	// logout returns to login page
	await page.evaluate(() => {
		[...document.querySelectorAll("header button")].find((b) => b.textContent === "выйти")?.click();
	});
	await page.waitForFunction(() => location.pathname === "/", { timeout: 5000 });
	t.eq(await page.evaluate(() => location.pathname), "/", "logout lands on login");
});
