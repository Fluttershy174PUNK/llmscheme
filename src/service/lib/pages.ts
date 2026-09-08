// Page routes — the single-file artifacts the browser loads.
//
// The editor needs the scheme embedded (B4 fix: name comes from the data, not
// the URL tail), the console is a single HTML behind an auth wall that
// gracefully degrades to a 401 for XHR (so the same page is the login form
// AND the signed-in shell).
import fs from "node:fs";
import path from "node:path";
import { DataError } from "../../core/index.ts";
import { fail, send, type Context } from "./http.ts";
import { assertSchemeName } from "./routes.ts";
import { renderHtml } from "../../core/index.ts";
import type { Schemes } from "./schemes.ts";

export interface PagesDeps {
	schemes: Schemes;
	consolePath: string;
	editorTemplatePath: string;
}

const sendHtml = (res: import("node:http").ServerResponse, body: string, status = 200): void => {
	res.writeHead(status, {
		"content-type": "text/html; charset=utf-8",
		"x-content-type-options": "nosniff",
	});
	res.end(body);
};

const readIfExists = (p: string): string | null => {
	try {
		return fs.readFileSync(p, "utf8");
	} catch {
		return null;
	}
};

// GET / and GET /admin both serve the console. The console itself does the
// login screen vs. app swap in JS, so the server only decides "is this signed
// in" — the 401 vs. HTML dance below lets the same file play both roles.
export function serveConsole(deps: PagesDeps, ctx: Context): void {
	const tpl = readIfExists(deps.consolePath);
	if (!tpl) {
		fail(ctx.res, 500, "console.html missing — run npm run build");
		return;
	}
	if (!ctx.auth) {
		// a signed-out browser GET still gets the login page (so the form
		// renders); an XHR call from a stale session gets a clean 401.
		const accept = String(ctx.req.headers.accept ?? "");
		if (accept.includes("text/html")) {
			sendHtml(ctx.res, tpl);
		} else {
			send(ctx.res, 401, { error: "auth required" });
		}
		return;
	}
	sendHtml(ctx.res, tpl);
}

// GET /editor/<name>  — editor with the scheme embedded. The skill path
// (/editor/foo.html) does NOT hit this route; that file is opened from disk
// and carries its own scheme in <script id="scheme-data">.
export function serveEditor(deps: PagesDeps, ctx: Context, name: string): void {
	if (!ctx.auth) {
		send(ctx.res, 401, { error: "auth required" });
		return;
	}
	assertSchemeName(name);
	const tpl = readIfExists(deps.editorTemplatePath);
	if (!tpl) {
		fail(ctx.res, 500, "editor.html missing — run npm run build");
		return;
	}
	// ensure() auto-creates on first open so the editor has something to load
	// without a separate POST round-trip. The page is the editor, not a 201.
	const u = ctx.auth as { id: number };
	const scheme = deps.schemes.ensure(u as never, name);
	// embed the scheme: renderHtml handles the marker replacement and any
	// malformed html throws (caught upstream) instead of corrupting the page
	sendHtml(ctx.res, renderHtml(tpl, scheme));
}

// 404 page that still pretends to be HTML for browser navigations.
export function serveNotFound(ctx: Context): void {
	const accept = String(ctx.req.headers.accept ?? "");
	if (accept.includes("text/html")) {
		sendHtml(
			ctx.res,
			`<!doctype html><meta charset="utf-8"><title>404</title><pre>404 not found</pre>`,
			404,
		);
	} else {
		send(ctx.res, 404, { error: "not found" });
	}
}

// typed path resolver: every artifact path is resolved at startup so a bad
// env var crashes once and loud, not per request
export function resolveArtifactPaths(env = process.env): {
	consolePath: string;
	editorTemplatePath: string;
} {
	// v2 layout: the built artifacts live at SERVICE-MCP/llmscheme/{console,editor}.html
	const root = path.resolve(env.ASSETS_DIR ?? "SERVICE-MCP/llmscheme");
	return {
		consolePath: path.join(root, "console.html"),
		editorTemplatePath: path.join(root, "editor.html"),
	};
}

// unused but exported so the editor view can also be reached by name when a
// caller asks for a specific scheme (the URL is the only signal we keep)
export { assertSchemeName };
// re-export so the server file can build deps without importing routes twice
export { DataError };
