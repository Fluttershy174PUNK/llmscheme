// Demo entry point: TUI cat + GIF export. The scheme describes the data
// flow (cat.ts → render / gif), and this file is the actual program.
//
// Usage:
//   node src/run.ts                 # print one TUI cat to stdout
//   node src/run.ts --gif cat.gif   # write an animated GIF
//   node src/run.ts --gif -         # write GIF to stdout (binary)
import { renderCat } from "./cat.ts";
import { makeGif } from "./gif.ts";

const args = process.argv.slice(2);
const gifIdx = args.indexOf("--gif");
if (gifIdx >= 0) {
	const out = args[gifIdx + 1] ?? "cat.gif";
	makeGif(out);
	process.stdout.write(`wrote ${out}\n`);
} else {
	// pick a random name from cats.txt
	const fs = await import("node:fs");
	const path = await import("node:path");
	const { fileURLToPath } = await import("node:url");
	const HERE = path.dirname(fileURLToPath(import.meta.url));
	const words = fs
		.readFileSync(path.join(HERE, "..", "cats.txt"), "utf8")
		.split("\n")
		.map((w) => w.trim())
		.filter(Boolean);
	const name = `${words[Math.floor(Math.random() * words.length)] ?? "cat"} ${words[Math.floor(Math.random() * words.length)] ?? "void"}`;
	process.stdout.write(renderCat(name) + "\n");
}
