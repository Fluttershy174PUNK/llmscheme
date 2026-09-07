// CLI entry: wires all stages of the cat generator together
import { readFileSync, existsSync } from "node:fs";
import { parseArgs } from "./args.ts";
import { makeCat, readCats } from "./cat.ts";
import { scoreCats } from "./score.ts";
import { topCat } from "./top.ts";
import { caption } from "./caption.ts";
import { buildGallery } from "./gallery.ts";
import { writeGallery } from "./write.ts";
import { report } from "./report.ts";
import { stats } from "./stats.ts";

const args = parseArgs(process.argv.slice(2));
// sources: cats.txt (one "url|name" per line); local files must exist
const raw = readFileSync(args.input, "utf8");
const missing = readCats(raw, makeCat)
	.filter((c) => c.kind === "file" && !existsSync(c.src))
	.map((c) => c.src);
if (missing.length) {
	console.error(`error: local cat file(s) not found: ${missing.join(", ")}`);
	process.exit(1);
}
const cats = readCats(raw, makeCat);
const scored = scoreCats(cats);
const best = topCat(scored);
const gallery = buildGallery(
	scored,
	`Cats (best: ${best ? best.cat.name + " " + caption(best.mood) : "none"})`,
);
const out = writeGallery(gallery, args.output);
if (args.verbose) console.log(report(gallery, out), stats(scored.map((s) => s.mood)));
