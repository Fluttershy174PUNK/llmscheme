// cat generator — picks a random adjective and a random noun from
// cats.txt and prints them as a cat name. Stays tiny on purpose: this
// is a worked example for the block-llm skill, not a real project.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const words = fs
	.readFileSync(path.join(HERE, "..", "cats.txt"), "utf8")
	.split("\n")
	.map((w) => w.trim())
	.filter(Boolean);

const adj = words[Math.floor(Math.random() * words.length)] ?? "void";
const noun = words[Math.floor(Math.random() * words.length)] ?? "cat";
console.log(`${adj} ${noun}`);
