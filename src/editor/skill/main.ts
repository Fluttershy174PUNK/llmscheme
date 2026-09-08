// Skill editor entry: runs from file://, no server, three save tiers
// (A=clipboard, B=FSA, C=download). The script grabs the embedded scheme
// from <script id="scheme-data"> and mounts the shared Editor.svelte.
import { mount } from "svelte";
import { extractSchemeJson, type Scheme } from "../../core/browser.ts";
import Editor from "../core/Editor.svelte";

const target = document.querySelector("#app");
if (!target) throw new Error("missing #app");

const raw = extractSchemeJson(document.documentElement.outerHTML);
if (!raw) throw new Error("missing scheme-data marker");

// The current build path. Build order (build.ts): the editor template lives
// at skill/editor.html with an empty {} marker, and every save in the CLI
// writes a fresh copy with the actual JSON. The browser reads it from there.
// SAFETY: extractSchemeJson returns unknown; the embedded JSON IS a Scheme
// because the CLI writes the same type and no other path produces the marker.
const initial = raw as Scheme;

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
				createWritable: () => Promise<{ write: (s: string) => Promise<void>; close: () => Promise<void> }>;
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
		canPatchProject: () => {
			const name = initial.name;
			if (!name) return null;
			const url = window.prompt(
				"Service URL?",
				location.origin === "null" || location.protocol === "file:" ? "http://localhost:8080" : location.origin,
			);
			if (!url) return null;
			const key = window.prompt("API key (llm_…)?");
			if (!key) return null;
			const cmd = `node <skill-dir>/cli/block.ts pull --url ${url} --key ${key} --name ${name}`;
			navigator.clipboard?.writeText(cmd);
			return { cmd };
		},
		canOpenLocal: () => true,
	},
});
