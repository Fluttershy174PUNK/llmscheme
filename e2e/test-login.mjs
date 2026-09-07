// e2e: login page — pixel style, cat, readme, reset hint, lang, wrong/right creds
// run: node e2e/run.mjs login  (needs a deployed llmscheme-service + puppeteer)
import { define } from "./harness.mjs";

export default define("login page", async ({ t, page, BASE, ADMIN, PASS }) => {
	await page.goto(BASE + "/", { waitUntil: "networkidle0" });

	// pixel style + cat + readme are rendered
	await t.has("Press Start 2P", await page.content(), "pixel font loaded");
	await t.truthy(await page.$("svg"), "pixel cat svg present");
	const readme = await page.$eval("#readme", (el) => el.textContent);
	t.truthy(/llmscheme/i.test(readme), "readme block rendered");
	t.truthy(await page.$("#readme a"), "readme has link");

	// lang switch flips sign-in label
	const btnText = () => page.$eval("form button", (b) => b.textContent);
	const before = await btnText();
	await page.evaluate(() => document.querySelector(".lang button")?.click());
	await t.notEq(before, await btnText(), "lang toggles button label");

	// reset hint toggles
	const hintHidden0 = await page.$eval("#reset-hint", (el) => el.hidden);
	await page.click(".reset");
	const hintHidden1 = await page.$eval("#reset-hint", (el) => el.hidden);
	t.notEq(hintHidden0, hintHidden1, "reset hint toggles");

	// wrong credentials -> error, stays on login
	await page.type("input[name=l]", ADMIN);
	await page.type("input[name=p]", "definitely-wrong-password");
	await page.click("form button");
	await page.waitForFunction(() => document.getElementById("err")?.textContent.length > 0, { timeout: 5000 });
	const errText = await page.$eval("#err", (el) => el.textContent);
	t.truthy(/credentials|failed/i.test(errText), `wrong password rejected (${errText})`);
	t.eq(await page.evaluate(() => location.pathname), "/", "still on login page (no redirect)");

	// right credentials -> console
	await page.$eval("input[name=p]", (el) => (el.value = ""));
	await page.type("input[name=p]", PASS);
	await Promise.all([
		page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
		page.click("form button"),
	]);
	t.truthy(page.url().includes("/admin"), `login redirects to console (${page.url()})`);
});
