// Skill editor entry: runs from file://, no server, three save tiers
// (A=clipboard, B=FSA, C=download). The script grabs the embedded scheme
// from <script id="scheme-data"> and mounts the shared Editor.svelte.
import { mount } from "svelte";
import {
	extractSchemeJson,
	emptyScheme,
	consumeNodeId,
	consumeEdgeId,
	autoLayout,
	type Scheme,
} from "../../core/browser.ts";
import Editor from "../core/Editor.svelte";

const target = document.querySelector("#app");
if (!target) throw new Error("missing #app");

const raw = extractSchemeJson(document.documentElement.outerHTML);
if (!raw) throw new Error("missing scheme-data marker");

// The build writes a default welcome scheme into the marker, and the CLI's
// `init` overwrites it with the project's real scheme on first run. When
// the editor is opened from file:// with the default (or an empty scheme),
// we replace it with a "getting started" demo so the canvas isn't blank.
// The user can hit SAVE to commit, or DELETE all nodes to start clean.
// SAFETY: extractSchemeJson returns unknown; the embedded JSON IS a Scheme
// because the build and CLI both write that exact type.
let initial = raw as Scheme;

// detect "empty" (no nodes AND no edges AND no zones) and seed a welcome
const isEmpty =
	(!initial.nodes || initial.nodes.length === 0) &&
	(!initial.edges || initial.edges.length === 0) &&
	(!initial.zones || initial.zones.length === 0);
if (isEmpty) {
	const seed = emptyScheme(initial.name || "my-scheme");
	// three labelled nodes so the editor isn't a void
	const a = { id: consumeNodeId(seed), shape: "rect" as const, label: "start here", x: 80, y: 100 };
	const b = { id: consumeNodeId(seed), shape: "rect" as const, label: "middle", x: 300, y: 100 };
	const c = { id: consumeNodeId(seed), shape: "rect" as const, label: "end", x: 520, y: 100 };
	seed.nodes.push(a, b, c);
	// edge ids are minted via consumeEdgeId, but to keep the type narrow we
	// splice them in after the fact
	seed.edges.push(
		{ id: consumeEdgeId(seed), from: a.id, to: b.id, style: "solid" as const },
		{ id: consumeEdgeId(seed), from: b.id, to: c.id, style: "solid" as const },
	);
	autoLayout(seed);
	initial = seed;
}

interface SkillSave {
	save(scheme: Scheme, baseRev: number): Promise<{ rev: number }>;
	tier: "A" | "B" | "C" | "S";
	onSaved?(rev: number): void;
}

// SAFETY: showSaveFilePicker exists in Chromium; we sniff it instead of
// trusting a type that would not exist at compile time otherwise.
const hasFsa = (): boolean =>
	typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === "function";

const tierB: SkillSave = {
	tier: "B",
	async save(scheme) {
		// SAFETY: the File System Access API is feature-detected via hasFsa();
		// a TS assertion at runtime cannot be more precise than unknown.
		const picker = window as unknown as {
			showSaveFilePicker: (o?: { suggestedName?: string }) => Promise<{
				createWritable: () => Promise<{
					write: (s: string) => Promise<void>;
					close: () => Promise<void>;
				}>;
			}>;
		};
		const handle = await picker.showSaveFilePicker({ suggestedName: `${scheme.name}.json` });
		const w = await handle.createWritable();
		await w.write(JSON.stringify(scheme, null, 2));
		await w.close();
		return { rev: scheme.rev + 1 };
	},
};

const tierC: SkillSave = {
	tier: "C",
	async save(scheme) {
		const blob = new Blob([JSON.stringify(scheme, null, 2)], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `${scheme.name.replace(/[/]/g, "_")}.json`;
		a.click();
		URL.revokeObjectURL(url);
		return { rev: scheme.rev + 1 };
	},
};

const save: SkillSave = hasFsa() ? tierB : tierC;

mount(Editor, {
	target,
	props: {
		initial,
		save,
		// The skill is a LOCAL tool — no service URL, no API key. "patch to
		// project" is the same as tier A save: it puts the `put` command on the
		// clipboard so the user can hand it to their agent. Nothing here ever
		// asks for a URL or an llm_ key.
		canPatchProject: () => null,
		canOpenLocal: () => true,
	},
});
