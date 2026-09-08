import fs from "node:fs";
import path from "node:path";
import type { Scheme, Generator, JournalEntry } from "./types.ts";
import { validate } from "./validate.ts";
import { exportMd } from "./exportMd.ts";
import { CasError, DataError, ValidationError } from "./errors.ts";

// v2 layout: a scheme is a flat directory (e.g. `.llmscheme/logic_scheme/`).
// scheme.json, SCHEME.md, scheme.html, VERSION and cache/ all live directly
// inside that directory — no nested `.block_llm/` anymore. DIR is empty so
// `path.join(root, DIR, x)` collapses to `path.join(root, x)`; it is kept as
// the one place callers and tests reach for "the scheme dir" without knowing
// the layout details.
export const DIR = "";
export const AUTOSAVE_KEEP = 50;
export const BACKUP_KEEP = 20;
export const JOURNAL_MAX = 5000;
export const AUTOSAVE_MIN_MS = 30_000;

export function readRaw(rootAbs: string): Scheme {
	const file = path.join(rootAbs, DIR, "scheme.json");
	let text: string;
	try {
		text = fs.readFileSync(file, "utf8");
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new DataError(`no scheme at ${file}`);
		throw new DataError(`cannot read ${file}: ${(e as Error).message}`);
	}
	try {
		return JSON.parse(text) as Scheme;
	} catch (e) {
		throw new DataError(`invalid JSON in ${file}: ${(e as Error).message}`);
	}
}

// rotate cache/<sub> keeping the newest `keep` entries
type Order = (a: fs.Dirent, b: fs.Dirent) => number;

// autosave names are `ts<fixed-width ISO>-revN.json`: plain name order == age order
const byNameDesc: Order = (a, b) => b.name.localeCompare(a.name);

// backup names are `rev<N>-<ISO>` and N is NOT zero-padded, so a plain name
// sort ranks rev9 above rev24 and rotation would keep the wrong 20 snapshots.
// Compare the numeric rev first, the stamp second.
const byRevDesc: Order = (a, b) => {
	const rev = (n: string) => Number(n.match(/^rev(\d+)-/)?.[1] ?? 0);
	return rev(b.name) - rev(a.name) || byNameDesc(a, b);
};

function rotate(dir: string, keep: number, order: Order) {
	let entries: fs.Dirent[] = [];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile());
	} catch {
		return;
	}
	entries.sort(order);
	for (const e of entries.slice(keep)) {
		try {
			fs.unlinkSync(path.join(dir, e.name));
		} catch {
			/* best effort */
		}
	}
}

function appendJournal(rootAbs: string, entry: JournalEntry) {
	const cache = path.join(rootAbs, DIR, "cache");
	fs.mkdirSync(cache, { recursive: true });
	const journal = path.join(cache, "journal.jsonl");
	fs.appendFileSync(journal, `${JSON.stringify(entry)}\n`);
	// cap the tape: read-back + rewrite only when actually over the limit
	try {
		const lines = fs.readFileSync(journal, "utf8").split("\n").filter(Boolean);
		if (lines.length > JOURNAL_MAX)
			fs.writeFileSync(journal, `${lines.slice(-JOURNAL_MAX).join("\n")}\n`);
	} catch {
		/* best effort */
	}
}

function backup(rootAbs: string, scheme: Scheme) {
	const dir = path.join(rootAbs, DIR, "cache", "backup");
	fs.mkdirSync(dir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	fs.writeFileSync(
		path.join(dir, `rev${scheme.rev}-${stamp}.json`),
		`${JSON.stringify(scheme, null, 2)}\n`,
	);
	rotate(dir, BACKUP_KEEP, byRevDesc);
}

// Rate-limited: at most one snapshot per AUTOSAVE_MIN_MS unless forced.
// v1 called this with `force ?? true`, so the limit never applied and every
// write left a full copy behind (the demo project accumulated 47 files / 360K).
function autosave(rootAbs: string, scheme: Scheme, force: boolean) {
	const dir = path.join(rootAbs, DIR, "cache", "autosave");
	fs.mkdirSync(dir, { recursive: true });
	if (!force) {
		try {
			const latest = fs.readdirSync(dir).sort().at(-1);
			const m = latest?.match(/^ts(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
			if (m) {
				const prev = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
				if (Date.now() - prev < AUTOSAVE_MIN_MS) return;
			}
		} catch {
			/* empty dir */
		}
	}
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	fs.writeFileSync(
		path.join(dir, `ts${stamp}-rev${scheme.rev}.json`),
		`${JSON.stringify(scheme, null, 2)}\n`,
	);
	rotate(dir, AUTOSAVE_KEEP, byNameDesc);
}

export interface SaveOptions {
	// computed AFTER the rev bump, so exports always match the written revision.
	// SCHEME.md is the core's own export; extraFiles carries scheme.html etc.
	extraFiles?: (s: Scheme) => Record<string, string>;
	journal?: { actor: Generator; op: string; summary: string };
	autosaveForce?: boolean;
}

function writeAtomic(target: string, content: string) {
	const tmp = `${target}.tmp-${process.pid}`;
	fs.writeFileSync(tmp, content);
	fs.renameSync(tmp, target);
}

// The single write path: CAS -> validate -> rev+1 -> backup -> atomic write ->
// regenerate exports -> journal. Errors forbid the write; nothing partial lands.
export function saveSchema(rootAbs: string, next: Scheme, opts: SaveOptions = {}): { rev: number } {
	const blockDir = path.join(rootAbs, DIR);
	const file = path.join(blockDir, "scheme.json");

	let current: Scheme | undefined;
	try {
		current = readRaw(rootAbs);
	} catch {
		/* init case: no file yet */
	}
	if (current && current.rev !== next.rev) throw new CasError(next.rev, current.rev);

	// validation gate BEFORE touching next.meta — v1 assigned
	// next.meta.generator first and 500'd on bodies without meta.
	const issues = validate(next);
	if (issues.errors.length) throw new ValidationError(issues);

	next.rev = (current?.rev ?? next.rev) + 1;
	next.meta.updatedAt = new Date().toISOString();
	fs.mkdirSync(path.join(blockDir, "cache"), { recursive: true });

	if (current) backup(rootAbs, current); // pre-write snapshot of the CURRENT state
	autosave(rootAbs, next, opts.autosaveForce ?? false);

	writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`);

	// exports follow the write and match the final rev
	writeAtomic(path.join(rootAbs, "SCHEME.md"), exportMd(next, issues));
	for (const [name, content] of Object.entries(opts.extraFiles?.(next) ?? {}))
		writeAtomic(path.join(rootAbs, name), content);

	if (opts.journal)
		appendJournal(rootAbs, {
			ts: next.meta.updatedAt,
			actor: opts.journal.actor,
			op: opts.journal.op,
			rev: next.rev,
			summary: opts.journal.summary,
		});

	return { rev: next.rev };
}

// latest snapshot of a revision, from cache/backup
export function readSnapshot(rootAbs: string, rev: number): Scheme {
	const dir = path.join(rootAbs, DIR, "cache", "backup");
	// only same-rev files remain after the filter and their stamps are
	// fixed-width ISO, so name order is chronological: last == newest
	const latest = fs.existsSync(dir)
		? fs
				.readdirSync(dir)
				.filter((f) => f.startsWith(`rev${rev}-`))
				.sort()
				.at(-1)
		: undefined;
	if (!latest) throw new DataError(`no snapshot for rev ${rev}`);
	try {
		return JSON.parse(fs.readFileSync(path.join(dir, latest), "utf8")) as Scheme;
	} catch {
		throw new DataError(`snapshot for rev ${rev} is corrupt`);
	}
}
