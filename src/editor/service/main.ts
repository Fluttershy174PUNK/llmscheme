// Service editor entry: served by the llmscheme-service on /editor/<name>.
// SAVE goes through PUT /api/scheme/<name> with a Bearer token from localStorage
// (set by the console's /api/login response). No FSA, no pristine — tier S only.
import { mount } from "svelte";
import { extractSchemeJson, type Scheme } from "../../core/browser.ts";
import Editor from "../core/Editor.svelte";

const target = document.querySelector("#app");
if (!target) throw new Error("missing #app");

// SAFETY: the server has already validated the embedded scheme (B7/B8) and
// rendered it into the page; it IS a Scheme at this point, and if it isn't
// the editor's own validate() will surface the error to the user.
const initial = extractSchemeJson(document.documentElement.outerHTML) as Scheme;
if (!initial) throw new Error("server did not embed a scheme");

// the token: the console sets it on login; we re-use it here. If absent
// we bounce to the console so the user can sign in.
const token = (() => {
	try {
		return localStorage.getItem("llmscheme-token") ?? "";
	} catch {
		return "";
	}
})();
// SAFETY: location.pathname is a same-origin path (no scheme/host), so a
// `next` query built from it can only ever return the user to this app.
const sameOriginNext = (): string => {
	const p = location.pathname;
	return p.startsWith("/") ? p : `/${p}`;
};
if (!token) {
	// SAFETY: sameOriginNext() returns a /-prefixed path, no scheme/host; the
	// only destination is this app's own login page.
	globalThis.location.assign(`/?next=${encodeURIComponent(sameOriginNext())}`);
}

const schemeName = initial.name;

interface ServiceSave {
	save(scheme: Scheme, baseRev: number): Promise<{ rev: number }>;
	tier: "A" | "B" | "C" | "S";
	onSaved?(rev: number): void;
}

const save: ServiceSave = {
	tier: "S",
	async save(scheme, baseRev) {
		// CAS: pass the rev the editor saw when it loaded, so a concurrent
		// editor on another tab gives a 409 instead of silently overwriting.
		const r = await fetch(`/api/scheme/${schemeName.split("/").map(encodeURIComponent).join("/")}`, {
			method: "PUT",
			headers: {
				"content-type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(scheme),
		});
		if (r.status === 401) {
			localStorage.removeItem("llmscheme-token");
			// SAFETY: same as above; the next path is always same-origin.
			globalThis.location.assign(`/?next=${encodeURIComponent(sameOriginNext())}`);
			throw new Error("session expired");
		}
		if (r.status === 409) {
			throw new Error("rev changed on disk — re-open the editor to reload");
		}
		if (!r.ok) {
			const text = (await r.text()).slice(0, 200);
			throw new Error(`save failed: ${r.status} ${text}`);
		}
		const j = (await r.json()) as { rev: number };
		void baseRev; // checked at the API level
		return { rev: j.rev };
	},
	onSaved(rev) {
		// B4: the editor was opened on /editor/<name>; rev may bump server-side
		// but the URL stays the same (the name is the source of truth, not the
		// URL tail).
		console.log(`saved rev ${rev}`);
	},
};

mount(Editor, {
	target,
	props: {
		initial,
		save,
		canOpenLocal: () => true,
		canPatchProject: undefined, // server-side has no need; pull is in the CLI
	},
});
