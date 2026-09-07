// one cat picture, from a URL or a local file
export interface Cat {
	src: string; // where the picture came from
	name: string; // pet name
	kind: "url" | "file";
}
export function makeCat(src: string, name = "Barsik"): Cat {
	const kind = /^https?:\/\//.test(src) ? "url" : "file";
	return { src, name, kind };
}

// parse the cat-list file text (one "url|name" per line); makeCat is injected
// to keep this module import-free
export function readCats(
	text: string,
	make: (src: string, name?: string) => Cat,
): Cat[] {
	return text
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [src, name] = line.split("|");
			return make(src.trim(), (name ?? "").trim() || undefined);
		});
}
