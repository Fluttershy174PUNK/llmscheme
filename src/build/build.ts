// pi-lens-ignore-file: no-console-except-error — a build script's console output IS the product
// build — three single-file HTML artifacts from one set of sources.
//
//   editor-skill    skill/editor.html         font inlined (file:// has no network)
//   editor-service  mcp-service/editor.html   font as /assets/*.woff2 (http cache)
//   console         mcp-service/console.html  same, no scheme marker
//
// svelte/compiler turns .svelte into JS+CSS, esbuild bundles and minifies.
// No vite, no rolldown, no lightningcss: 2 dev dependencies instead of 8.
import { build } from "esbuild";
import { compile } from "svelte/compiler";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Entry {
	name: string;
	entry: string;
	out: string;
	title: string;
	// dataurl = base64 inline (required for file://), file = emit + reference
	font: "dataurl" | "file";
	// the editor boots from an embedded scheme; the console does not
	schemeMarker: boolean;
}

const ENTRIES: Entry[] = [
	{
		name: "editor-skill",
		entry: "src/editor/skill/main.ts",
		out: "dist/editor.html",
		title: "block-llm editor",
		font: "dataurl",
		schemeMarker: true,
	},
	{
		name: "editor-service",
		entry: "src/editor/service/main.ts",
		out: "mcp-service/editor.html",
		title: "llmscheme editor",
		font: "file",
		schemeMarker: true,
	},
	{
		name: "console",
		entry: "src/console/main.ts",
		out: "mcp-service/console.html",
		title: "llmscheme",
		font: "file",
		schemeMarker: false,
	},
];

// Svelte component CSS is emitted next to the component and imported back, so
// esbuild can order it after the global sheets.
function sveltePlugin(cssDir: string): {
	name: string;
	setup: (b: import("esbuild").PluginBuild) => void;
} {
	return {
		name: "svelte",
		setup(b) {
			b.onResolve({ filter: /\.svelte$/ }, (a) => ({
				path: path.resolve(a.resolveDir, a.path),
				namespace: "svelte",
			}));
			b.onLoad({ filter: /.*/, namespace: "svelte" }, (a) => {
				const src = fs.readFileSync(a.path, "utf8");
				const r = compile(src, {
					filename: path.basename(a.path),
					generate: "client",
					dev: false,
					css: "external",
				});
				for (const w of r.warnings)
					if (!w.code.startsWith("a11y"))
						console.warn(`  ${w.filename}:${w.start?.line} ${w.message}`);
				// emit component CSS to a scratch dir next to the bundle, not
				// next to the .svelte source (which would pollute src/)
				const name = path.basename(a.path, ".svelte") + ".css";
				const cssFile = path.join(cssDir, name);
				if (r.css?.code) fs.writeFileSync(cssFile, r.css.code);
				const js = r.css?.code ? `${r.js.code}\nimport ${JSON.stringify(cssFile)};\n` : r.js.code;
				return { contents: js, loader: "js", resolveDir: path.dirname(a.path) };
			});
		},
	};
}

async function buildEntry(e: Entry): Promise<{ js: number; css: number; total: number }> {
	const tmpDir = path.join(repo, "dist", ".tmp", e.name);
	fs.rmSync(tmpDir, { recursive: true, force: true });
	fs.mkdirSync(tmpDir, { recursive: true });
	// component CSS lives here, separate from the JS bundle output dir
	const cssDir = path.join(tmpDir, "css");
	fs.mkdirSync(cssDir, { recursive: true });

	const jsOut = path.join(tmpDir, "app.js");
	await build({
		entryPoints: [path.join(repo, e.entry)],
		bundle: true,
		format: "iife",
		target: "es2022",
		minify: true,
		// the editor is browser-only; node:* imports in the core (e.g. fs)
		// are reachable paths that should be tree-shaken away by Svelte
		platform: "browser",
		// Svelte's dev branches are gated on NODE_ENV; without this the bundle
		// carries ~24K of error-message code that can never run
		define: { "process.env.NODE_ENV": '"production"' },
		plugins: [sveltePlugin(cssDir)],
		outfile: jsOut,
		logLevel: "warning",
		loader: { ".woff2": "dataurl", ".woff": "dataurl", ".png": "dataurl", ".svg": "text" },
	});

	// CSS is bundled separately so the font loader can differ per artifact.
	// The input lives in tmpIn so it never collides with the outdir/outfile.
	const tmpIn = path.join(tmpDir, "in");
	fs.mkdirSync(tmpIn, { recursive: true });
	const cssEntry = path.join(tmpIn, "entry.css");
	fs.writeFileSync(
		cssEntry,
		[
			`@import "${path.join(repo, "src/ui/pixel.css")}";`,
			e.name === "console"
				? `@import "${path.join(repo, "src/console/console.css")}";`
				: `@import "${path.join(repo, "src/editor/core/editor.css")}";`,
		].join("\n"),
	);
	const cssOut = path.join(tmpDir, e.font === "file" ? "css" : "out.css");
	await build({
		entryPoints: [cssEntry],
		bundle: true,
		minify: true,
		logLevel: "warning",
		platform: "browser",
		loader: { ".woff2": e.font, ".woff": e.font },
		...(e.font === "file"
			? { outdir: cssOut, assetNames: "assets/[name][ext]", publicPath: "/" }
			: { outfile: cssOut }),
	});

	const js = fs.readFileSync(jsOut, "utf8");
	const cssFile = e.font === "file" ? path.join(cssOut, "entry.css") : cssOut;
	const css = fs.readFileSync(cssFile, "utf8");

	// component-scoped CSS from Svelte rides inside the JS bundle's imports, so
	// it lands in the JS output, not here — nothing extra to inline.
	const marker = e.schemeMarker
		? `\t\t<script type="application/json" id="scheme-data">\n\t\t\t{}\n\t\t</script>\n`
		: "";
	const html = `<!doctype html>
<html lang="en">
\t<head>
\t\t<meta charset="UTF-8" />
\t\t<meta name="viewport" content="width=device-width, initial-scale=1.0" />
\t\t<title>${e.title}</title>
${marker}\t\t<style>${css}</style>
\t</head>
\t<body>
\t\t<div id="app"></div>
\t\t<script>${js}</script>
\t</body>
</html>
`;
	const outFile = path.join(repo, e.out);
	fs.mkdirSync(path.dirname(outFile), { recursive: true });
	fs.writeFileSync(outFile, html);

	// emitted font files travel next to the HTML (served at /assets/*.woff2)
	if (e.font === "file") {
		const assets = path.join(cssOut, "assets");
		if (fs.existsSync(assets)) {
			const dest = path.join(path.dirname(outFile), "assets");
			fs.mkdirSync(dest, { recursive: true });
			for (const f of fs.readdirSync(assets))
				fs.copyFileSync(path.join(assets, f), path.join(dest, f));
		}
	}
	fs.rmSync(tmpDir, { recursive: true, force: true });
	return { js: js.length, css: css.length, total: Buffer.byteLength(html) };
}

for (const e of ENTRIES) {
	if (!fs.existsSync(path.join(repo, e.entry))) {
		console.log(`skip ${e.name}: ${e.entry} not written yet`);
		continue;
	}
	const r = await buildEntry(e);
	console.log(`${e.name}: ${e.out} ${r.total}B (js ${r.js}B + css ${r.css}B, font ${e.font})`);
}
