// build a one-page HTML gallery from scored cats; stamps mood captions, limit enforced
import type { ScoredCat } from "./score.ts";
import { caption } from "./caption.ts";
export interface Gallery {
	title: string;
	count: number;
	html: string;
}
// pixel-styled standalone page: inline CSS, mood stamp + score under every cat
export function buildGallery(scored: ScoredCat[], title = "Cats", limit = 100): Gallery {
	const shown = scored.slice(0, limit);
	const cards = shown
		.map(
			(s) => `<figure>
<img src="${s.cat.src}" alt="${s.cat.name}" width="220">
<figcaption>${caption(s.mood)} ${s.cat.name} · ${s.score}/100</figcaption>
</figure>`,
		)
		.join("\n");
	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
	body { background:#1a1c2c; color:#f4f4f4; font-family:"Press Start 2P",monospace; text-align:center; padding:24px; }
	h1 { color:#ffcd75; font-size:18px; }
	main { display:flex; flex-wrap:wrap; gap:18px; justify-content:center; }
	figure { margin:0; background:#29366f; padding:10px; box-shadow: 4px 4px 0 #091428; }
	img { image-rendering: pixelated; border: 3px solid #41a6f6; }
	figcaption { font-size:9px; margin-top:8px; color:#94b0c2; }
</style>
</head>
<body>
<h1>${title}</h1>
<main>
${cards}
</main>
</body>
</html>
`;
	return { title, count: shown.length, html };
}
