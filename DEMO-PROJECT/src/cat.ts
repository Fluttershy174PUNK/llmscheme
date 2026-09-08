// TUI cat: composes a random cat from cats.txt and prints it to the
// terminal as a coloured block. Designed for TUI rendering (terminal
// escape codes) — no external dependencies, runs on Node 22.18+.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORDS = fs
	.readFileSync(path.join(HERE, "..", "cats.txt"), "utf8")
	.split("\n")
	.map((w) => w.trim())
	.filter(Boolean);

// ANSI colours — truecolor when supported, fallback 256-colour
const C = {
	reset: "\x1b[0m",
	orange: "\x1b[38;5;214m",
	gray: "\x1b[38;5;244m",
	white: "\x1b[38;5;255m",
	yellow: "\x1b[38;5;220m",
	dim: "\x1b[38;5;240m",
	bg: "\x1b[48;5;235m",
};

const pick = (): string => WORDS[Math.floor(Math.random() * WORDS.length)] ?? "cat";

// 6-row ASCII cat, ~28 chars wide. Coloured top to bottom: ears orange,
// face gray, body orange, paws white, tail yellow. The background dim
// gives a "card" look in the terminal.
const FRAME = [
	`${C.bg}    /\\_____/${C.reset}     ${C.orange}/*\\_____/*\\${C.reset}  `,
	`${C.bg}   /  o   o  \\${C.reset}    ${C.orange}/  o   o  \\${C.reset}  `,
	`${C.bg}  ( =  ^  = )${C.reset}   ${C.gray}( =  ^  = )${C.reset} `,
	`${C.bg}   \\__^__//${C.reset}       ${C.gray}\\__^__//${C.reset}    `,
	`${C.bg}    /   \\${C.reset}        ${C.orange}/   \\${C.reset}       `,
	`${C.bg}   /     \\___${C.reset}    ${C.yellow}/     \\___${C.reset} `,
];

// Render the full TUI card
export function renderCat(name: string): string {
	const lines: string[] = [];
	lines.push(`${C.dim}╭${"─".repeat(40)}╮${C.reset}`);
	lines.push(
		`${C.dim}│${C.reset} ${C.yellow}♥${C.reset}  ${C.orange}cat-generator${C.reset} ${C.dim}(TUI v1.0)${C.reset}`,
	);
	lines.push(`${C.dim}│${C.reset}`);
	for (const row of FRAME) {
		lines.push(`${C.dim}│${C.reset}  ${row}`);
	}
	lines.push(`${C.dim}│${C.reset}`);
	lines.push(`${C.dim}│${C.reset}  ${C.white}name:${C.reset} ${C.yellow}${name}${C.reset}`);
	lines.push(`${C.dim}│${C.reset}  ${C.dim}(press Ctrl+C to quit)${C.reset}`);
	lines.push(`${C.dim}╰${"─".repeat(40)}╯${C.reset}`);
	return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
	// CLI mode: print one cat and exit
	const name = `${pick()} ${pick()}`;
	process.stdout.write(renderCat(name) + "\n");
}
