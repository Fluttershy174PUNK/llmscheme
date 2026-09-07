import type { Scheme } from "./types.ts";

export const DATA_MARKER = "scheme-data";

export class HtmlError extends Error {}

// §4.2: scheme.json embedded in a <script type="application/json" id="scheme-data">
// inside the single-file editor. `</script>` break-in prevented by escaping all `<`.
function embedJson(s: Scheme): string {
	return JSON.stringify(s, null, 2).replace(/</g, "\\u003c");
}

// replace (or create) the data script content in the editor template
export function renderHtml(template: string, scheme: Scheme): string {
	const script = `<script type="application/json" id="${DATA_MARKER}">${embedJson(scheme)}</script>`;
	const re = new RegExp(
		`<script type="application/json" id="${DATA_MARKER}">[\\s\\S]*?</script>`,
	);
	if (!re.test(template)) {
		throw new HtmlError(
			`editor template has no <script type="application/json" id="${DATA_MARKER}"> marker`,
		);
	}
	return template.replace(re, () => script);
}

// read the embedded scheme back (used by tests and by the editor bootstrap).
// Caller is expected to run validate() on the result.
export function extractSchemeJson(html: string): Scheme {
	const re = new RegExp(
		`<script type="application/json" id="${DATA_MARKER}">([\\s\\S]*?)</script>`,
	);
	const m = html.match(re);
	if (!m) throw new HtmlError(`no embedded scheme data (id="${DATA_MARKER}")`);
	let parsed: Scheme;
	try {
		parsed = JSON.parse(m[1]) as Scheme;
	} catch (e) {
		throw new HtmlError(
			`embedded scheme is not valid JSON: ${(e as Error).message}`,
		);
	}
	if (!parsed || typeof parsed !== "object" || parsed.format !== "block-llm") {
		throw new HtmlError("embedded data is not a block-llm scheme");
	}
	return parsed;
}
