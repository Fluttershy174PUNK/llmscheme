import fs from "node:fs";
import path from "node:path";

// §7: init adds an idempotent .gitignore line; AGENTS.md section between markers.
export function ensureGitignoreLine(rootAbs: string, line: string): boolean {
	const file = path.join(rootAbs, ".gitignore");
	let text = "";
	try {
		text = fs.readFileSync(file, "utf8");
	} catch {
		/* new file */
	}
	const lines = text.split("\n").map((l) => l.trimEnd());
	if (lines.some((l) => l === line || l === line + "/")) return false;
	fs.writeFileSync(
		file,
		(text && !text.endsWith("\n") ? text + "\n" : text) + line + "\n",
	);
	return true;
}

export const AGENTS_START = "<!-- block-llm:start -->";
export const AGENTS_END = "<!-- block-llm:end -->";

export function agentsSection(): string {
	return [
		AGENTS_START,
		"## Project scheme",
		"",
		"This project keeps a living logic scheme in `.block_llm/`.",
		"Before architectural changes read `SCHEME.md`.",
		"After them update the scheme with the block-llm skill.",
		AGENTS_END,
		"",
	].join("\n");
}

export function ensureAgentsSection(rootAbs: string): boolean {
	const file = path.join(rootAbs, "AGENTS.md");
	let text = "";
	try {
		text = fs.readFileSync(file, "utf8");
	} catch {
		/* new file */
	}
	if (text.includes(AGENTS_START)) {
		// refresh between markers (idempotent)
		const re = new RegExp(`${AGENTS_START}[\\s\\S]*?${AGENTS_END}`);
		const next = text.replace(re, agentsSection().trimEnd());
		if (next !== text) {
			fs.writeFileSync(file, next);
			return true;
		}
		return false;
	}
	fs.writeFileSync(
		file,
		(text ? text.trimEnd() + "\n\n" : "") + agentsSection(),
	);
	return true;
}
