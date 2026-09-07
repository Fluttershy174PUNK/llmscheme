// e2e: editor — canvas render, resize, copy/paste, undo, multi-drag, log, save (CAS)
import { define, sleep } from "./harness.mjs";

export default define("editor", async ({ t, page, BASE, ADMIN, PASS, randUser, api, login, cleanupScheme }) => {
	const proj = "e2e-ed";
	const full = `${proj}/s1`;
	const user = randUser();
	await api("/api/users", { method: "POST", token: await login(ADMIN, PASS), body: { login: user, password: user + "-pw" } });
	const token = await login(user, user + "-pw");
	await cleanupScheme(token, full).catch(() => {});
	await api("/api/schemes", { method: "POST", token, body: { name: full } });

	// login via UI first (sets cookie)
	await page.goto(BASE + "/", { waitUntil: "networkidle0" });
	await page.type("input[name=l]", user);
	await page.type("input[name=p]", user + "-pw");
	await Promise.all([
		page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
		page.click("form button"),
	]);
	await page.goto(`${BASE}/editor/${encodeURIComponent(full)}`, { waitUntil: "networkidle0" });
	await sleep(1800);
	t.truthy(await page.$("svg"), "svg canvas rendered");
	t.truthy(await page.$(".topbar"), "topbar rendered");
	t.has("e2e-ed/s1", await page.$eval(".title", (el) => el.textContent), "scheme name shown");

	// add 2 nodes
	for (let i = 0; i < 2; i++) {
		await page.evaluate(() => {
			[...document.querySelectorAll(".topbar button")]
				.find((b) => /node|нода/.test(b.textContent))
				?.click();
		});
		await sleep(250);
	}
	t.eq(await countNodes(page), 2, "2 nodes added");

	// separate them so clicks are unambiguous
	await dragEl(page, ".node path", 1, 130, 90);
	await sleep(200);

	// RESIZE node1 via BR handle
	await clickEl(page, ".node path", 0);
	await sleep(300);
	const handle = await brHandle(page);
	const before = await inspector(page);
	await page.mouse.move(handle.x, handle.y);
	await page.mouse.down();
	await page.mouse.move(handle.x + 60, handle.y + 40, { steps: 8 });
	await page.mouse.up();
	await sleep(300);
	const after = await inspector(page);
	t.truthy(after.w > before.w + 30 && after.h > before.h + 20, `resize grows node (${before.w}×${before.h} → ${after.w}×${after.h})`);

	// UNDO restores auto size (w/h fields cleared)
	await page.keyboard.down("Control");
	await page.keyboard.press("KeyZ");
	await page.keyboard.up("Control");
	await sleep(300);
	await clickEl(page, ".node path", 0); // undo deselects — re-select to read inspector
	await sleep(200);
	const undone = await inspector(page);
	t.truthy(
		undone === null || undone.w < after.w,
		`undo reverts size (${after.w} → ${undone ? undone.w : "deselected"})`,
	);

	// COPY/PASTE
	const n0 = await countNodes(page);
	await clickEl(page, ".node path", 0);
	await sleep(200);
	await page.keyboard.down("Control");
	await page.keyboard.press("KeyC");
	await page.keyboard.up("Control");
	await page.keyboard.down("Control");
	await page.keyboard.press("KeyV");
	await page.keyboard.up("Control");
	await sleep(400);
	const saveBoxTxt = await page.evaluate(
		() => document.querySelector(".savebox")?.textContent || "(no savebox)",
	);
	t.eq(await countNodes(page), n0 + 1, `paste adds a node (savebox: ${saveBoxTxt.slice(0, 60)})`);

	// move the pasted copy away (it spawns +40,+40 from its source)
	await dragEl(page, ".node path", 2, 220, 160);
	await sleep(200);

	// MULTI-SELECT + GROUP DRAG
	const paths = await page.$$(".node path");
	const b1 = await paths[0].boundingBox();
	const b2 = await paths[1].boundingBox();
	await page.keyboard.down("Control");
	await page.mouse.click(b1.x + 10, b1.y + 10);
	await sleep(150);
	await page.mouse.click(b2.x + b2.width - 10, b2.y + 10);
	await page.keyboard.up("Control");
	await sleep(250);
	const selCount = await page.evaluate(
		() => document.querySelectorAll(".node.selected").length,
	);
	t.truthy(selCount >= 2, `ctrl+click multi-select (${selCount})`);
	const pos0 = await positions(page);
	await dragEl(page, ".node path", 1, 60, 40, { center: true });
	await sleep(250);
	const pos1 = await positions(page);
	const moved = pos0.filter((p, i) => p[0] !== pos1[i][0] || p[1] !== pos1[i][1]).length;
	t.eq(moved, selCount, `group drag moves all selected (${moved}/${selCount})`);

	// LOG shows journal
	await page.evaluate(() => {
		[...document.querySelectorAll(".topbar button")]
			.find((b) => b.textContent === "log")
			?.click();
	});
	await page.waitForFunction(
		() => /rev=/.test(document.querySelector(".savebox")?.textContent || ""),
		{ timeout: 5000 },
	);
	t.truthy(
		/rev=/.test(await page.$eval(".savebox", (el) => el.textContent)),
		"journal (log) rendered",
	);

	// SAVE roundtrip -> rev bump
	const rev0 = await page.$eval(".rev", (el) => el.textContent);
	await page.evaluate(() => {
		[...document.querySelectorAll(".topbar button")]
			.find((b) => /SAVE|ЗАПИСАТЬ/.test(b.textContent))
			?.click();
	});
	await page.waitForFunction(
		() => /written|записано/.test(document.querySelector(".savebox")?.textContent || ""),
		{ timeout: 5000 },
	);
	const rev1 = await page.$eval(".rev", (el) => el.textContent);
	t.truthy(rev1 !== rev0, `save bumps rev (${rev0} → ${rev1})`);

	// cookie session works without ?t= (fresh page in the same incognito context)
	const page2 = await page.browserContext().newPage();
	await page2.goto(`${BASE}/editor/${encodeURIComponent(full)}`, { waitUntil: "networkidle0" });
	await sleep(1500);
	t.truthy(await page2.$("svg"), "cookie session opens editor without ?t=");
	await page2.close();

	await cleanupScheme(token, full);
	await api(`/api/user/${await userId(user)}`, { method: "DELETE", token: await login(ADMIN, PASS) });

	// ---- helpers ----
	async function countNodes(p) {
		return p.evaluate(() => document.querySelectorAll(".node").length);
	}
	async function clickEl(p, sel, i) {
		const el = (await p.$$(sel))[i];
		const b = await el.boundingBox();
		await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
	}
	async function dragEl(p, sel, i, dx, dy, opts = {}) {
		const el = (await p.$$(sel))[i];
		const b = await el.boundingBox();
		const x = opts.center === false ? b.x + 12 : b.x + b.width / 2;
		const y = opts.center === false ? b.y + 10 : b.y + b.height / 2;
		await p.mouse.move(x, y);
		await p.mouse.down();
		await p.mouse.move(x + dx, y + dy, { steps: 8 });
		await p.mouse.up();
	}
	async function brHandle(p) {
		return p.evaluate(() => {
			const hs = [...document.querySelectorAll("circle.resize-handle")];
			const el = hs.sort((a, b) => b.cx.baseVal.value - a.cx.baseVal.value)[0];
			const r = el.getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
		});
	}
	async function inspector(p) {
		return p.evaluate(() => {
			if (!document.querySelector(".node.selected")) return null;
			const nums = [...document.querySelectorAll(".inspector input[type=number]")].map(
				(i) => (i.value === "" ? 0 : Number(i.value)),
			);
			return { x: nums[0], y: nums[1], w: nums[2], h: nums[3] };
		});
	}
	async function positions(p) {
		return p.evaluate(() =>
			[...document.querySelectorAll(".node")].map((g) => {
				const b = g.querySelector("path").getBoundingClientRect();
				return [Math.round(b.x), Math.round(b.y)];
			}),
		);
	}
	async function userId(loginName) {
		const { json } = await api("/api/users", { token: await login(ADMIN, PASS) });
		return json.find((u) => u.login === loginName).id;
	}
});
