// isolated repro: console createScheme flow
import puppeteer from "puppeteer";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ args: ["--no-sandbox"] });
const p = await b.newPage();
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 160)));
p.on("response", (r) => { if (r.status() >= 400) console.log("HTTP", r.status(), r.url().slice(0, 90)); });
await p.goto("http://127.0.0.1:8199/", { waitUntil: "networkidle0" });
await p.type("input[name=l]", "admin");
await p.type("input[name=p]", "secret");
await Promise.all([p.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}), p.click("form button")]);
await sleep(600);
await p.evaluate(() => document.querySelector("#tab-edit").click());
await sleep(300);
await p.type("form[onsubmit*='createScheme'] input[name=proj]", "e2e");
await p.type("form[onsubmit*='createScheme'] input[name=sname]", "s1");
await p.evaluate(() => document.querySelector("form[onsubmit*='createScheme'] button").click());
await sleep(900);
const st = await p.evaluate(() => ({
	err: document.getElementById("scherr")?.textContent,
	tbl: document.getElementById("schemes")?.textContent.slice(0, 140),
	forms: !!document.querySelector("form[onsubmit*='createScheme']"),
}));
console.log(JSON.stringify(st, null, 1));
await b.close();
