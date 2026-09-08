import type { Scheme } from "./types.ts";

export const DATA_MARKER = "scheme-data";

export class HtmlError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "HtmlError";
	}
}

// §4.2: the scheme travels inside <script type="application/json" id="scheme-data">
// of the single-file editor. Escaping every `<` keeps a label containing
// `</script>` from terminating the tag early.
function embedJson(s: Scheme): string {
	return JSON.stringify(s, null, 2).replace(/</g, "\\u003c");
}

const markerRe = () =>
	new RegExp(`<script type="application/json" id="${DATA_MARKER}">([\\s\\S]*?)</script>`);

// replace the data script content in the editor template
export function renderHtml(template: string, scheme: Scheme): string {
	const re = markerRe();
	if (!re.test(template))
		throw new HtmlError(`editor template has no <script … id="${DATA_MARKER}"> marker`);
	const script = `<script type="application/json" id="${DATA_MARKER}">${embedJson(scheme)}</script>`;
	return template.replace(re, () => script);
}

// read the embedded scheme back (tests + the editor bootstrap).
// Callers are expected to run validate() on the result.
export function extractSchemeJson(html: string): Scheme {
	const m = html.match(markerRe());
	const embedded = m?.[1];
	if (embedded === undefined) throw new HtmlError(`no embedded scheme data (id="${DATA_MARKER}")`);
	let parsed: Scheme;
	try {
		parsed = JSON.parse(embedded) as Scheme;
	} catch (e) {
		throw new HtmlError(`embedded scheme is not valid JSON: ${(e as Error).message}`);
	}
	if (!parsed || typeof parsed !== "object" || parsed.format !== "block-llm")
		throw new HtmlError("embedded data is not a block-llm scheme");
	return parsed;
}
