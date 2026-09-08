#!/usr/bin/env node
// llmscheme service: HTTP entry point, MCP, REST, and the two single-file
// pages (console, editor). Runs straight from .ts (Node 22.18+).
//
// Order per request:
//   1. /mcp                              → MCP handler (X-Api-Key only)
//   2. /health                           → 200 OK, no auth
//   3. pages                             → /, /admin (console), /editor/<name>
//   4. /assets/<file>                    → static font/css (in routes.ts)
//   5. router.match() with auth gate     → REST API
//   6. otherwise                         → 404
//
// One try/catch around the whole pipeline converts every error into a 4xx/5xx
// response: the process never dies on a bad request. CasError/ValidationError/
// DataError/HttpError carry their own status; the rest is a logged 500.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { authenticate } from "./lib/auth.ts";
import { loadConfig } from "./lib/config.ts";
import { CasError, DataError, ValidationError, renderHtml } from "../core/index.ts";
import { decodePathname, fail, HttpError, log, logRequest, readBody, type Context } from "./lib/http.ts";
import { resolveArtifactPaths, serveConsole, serveEditor, serveNotFound } from "./lib/pages.ts";
import { buildRoutes } from "./lib/routes.ts";
import { Schemes } from "./lib/schemes.ts";
import { Store, type User } from "./lib/store.ts";
import { handleMcpHttp } from "./lib/mcp.ts";

const config = loadConfig();
const store = new Store({ dataDir: config.dataDir, dbQuotaBytes: config.dbQuotaBytes });
store.ensureAdmin(config.adminLogin, config.adminPassword);

const artifacts = resolveArtifactPaths();
// editor template lives next to the data dir (deployed as a single file in
// the artifact image) or falls back to the asset dir
const editorTpl = fs.existsSync(path.join(config.dataDir, "..", "editor.html"))
	? path.join(config.dataDir, "..", "editor.html")
	: artifacts.editorTemplatePath;
const readmePath = path.resolve("README.md");

const schemes = new Schemes({ store, templatePath: editorTpl });
const routes = buildRoutes({
	store,
	schemes,
	config,
	readmePath,
	repoUrl: "https://example.invalid/llmscheme",
	assetsDir: path.dirname(artifacts.consolePath),
});

interface AuthScope {
	auth: User | null;
}

const makeCtx = (req: http.IncomingMessage, res: http.ServerResponse, body: string, scope: AuthScope, url: URL): Context => ({
	req,
	res,
	body,
	params: {},
	query: Object.fromEntries(url.searchParams),
	origin: `${url.protocol}//${url.host}`,
	pathname: decodePathname(url),
	auth: scope.auth,
});

const server = http.createServer(async (req, res) => {
	const started = Date.now();
	const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
	const pathname = decodePathname(url);
	const scope: AuthScope = { auth: null };

	try {
		scope.auth = authenticate(store, req);

		const body = needsBody(req.method, pathname) ? await readBody(req, config.maxBodyBytes) : "";
		const ctx = makeCtx(req, res, body, scope, url);

		// 1. /mcp — own auth (X-Api-Key only) and origin check
		if (pathname === "/mcp") {
			handleMcpHttp({ store, schemes, allowedOrigins: config.allowedOrigins }, req, res, body);
			logRequest(req, res, pathname, started);
			return;
		}

		// 2. /health
		if (pathname === "/health" && req.method === "GET") {
			res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
			logRequest(req, res, pathname, started);
			return;
		}

		// 3. pages — own auth gate (login form vs. app)
		if (pathname === "/" || pathname === "/admin") {
			serveConsole({ schemes, consolePath: artifacts.consolePath, editorTemplatePath: editorTpl }, ctx);
			logRequest(req, res, pathname, started);
			return;
		}
		if (pathname === "/editor" || pathname.startsWith("/editor/")) {
			const name = pathname === "/editor" ? "" : pathname.slice("/editor/".length);
			serveEditor({ schemes, consolePath: artifacts.consolePath, editorTemplatePath: editorTpl }, ctx, name);
			logRequest(req, res, pathname, started);
			return;
		}

		// 5. REST — auth gate then router. Login and the readme are the only
		// public endpoints; everything else (including /api/mcp-config) needs
		// a session. The MCP endpoint already authenticates by X-Api-Key.
		const isPublic = pathname === "/api/login" || pathname === "/api/readme";
		if (!isPublic && !scope.auth) {
			fail(res, 401, "auth required");
			logRequest(req, res, pathname, started);
			return;
		}
		const m = routes.match(req.method ?? "GET", pathname);
		if (!m) {
			serveNotFound(ctx);
			logRequest(req, res, pathname, started);
			return;
		}
		ctx.params = m.params;
		await m.handler(ctx);
		logRequest(req, res, pathname, started);
	} catch (e) {
		handleError(res, e, pathname);
		logRequest(req, res, pathname, started);
	}
});

// Body is only useful for write-methods on REST + /mcp; everything else gets
// an empty body and avoids an unnecessary stream.
function needsBody(method: string | undefined, pathname: string): boolean {
	if (pathname === "/mcp") return true;
	return method === "POST" || method === "PUT" || method === "DELETE";
}

function handleError(res: http.ServerResponse, e: unknown, pathname: string): void {
	if (e instanceof HttpError) {
		fail(res, e.status, e.message);
		return;
	}
	if (e instanceof CasError) {
		fail(res, 409, e.message);
		return;
	}
	if (e instanceof ValidationError) {
		fail(res, 400, e.message);
		return;
	}
	if (e instanceof DataError) {
		fail(res, 400, e.message);
		return;
	}
	log("ERROR", `${pathname}: ${(e as Error)?.stack ?? e}`);
	fail(res, 500, "internal error");
}

// silences the unused import warning when renderHtml is only re-exported via pages
void renderHtml;

server.listen(config.port, () => {
	log("INFO", `llmscheme-service on :${config.port} (data=${config.dataDir})`);
});

// graceful shutdown: a long container stop would otherwise truncate a write
function shutdown(sig: string): void {
	log("INFO", `received ${sig}, closing`);
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// safety net: v1 crashed the process when an MCP auth 401 escaped
process.on("unhandledRejection", (r) => log("ERROR", `unhandledRejection: ${r}`));
process.on("uncaughtException", (e) => log("ERROR", `uncaughtException: ${e?.stack ?? e}`));
