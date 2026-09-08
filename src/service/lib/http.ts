import type http from "node:http";

// HTTP plumbing: routing, body limits, responses and the access log.
// No framework — the service has zero runtime dependencies.

export class HttpError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = "HttpError";
		this.status = status;
	}
}

export interface RouteMatch {
	params: Record<string, string>;
	handler: (ctx: Context) => Promise<void> | void;
}

export interface Context {
	req: http.IncomingMessage;
	res: http.ServerResponse;
	body: string;
	params: Record<string, string>;
	query: Record<string, string>;
	origin: string;
	pathname: string;
	// filled by the auth gate before the handler runs
	auth: unknown;
}

// ---------- responses ----------
export function send(
	res: http.ServerResponse,
	status: number,
	body: unknown,
	headers: Record<string, string> = {},
): void {
	const isText = typeof body === "string";
	res.writeHead(status, {
		"content-type": isText
			? "text/plain; charset=utf-8"
			: "application/json; charset=utf-8",
		// the service runs behind a reverse proxy or on a LAN; same-origin by default
		"x-content-type-options": "nosniff",
		...headers,
	});
	res.end(isText ? body : JSON.stringify(body));
}

export const fail = (
	res: http.ServerResponse,
	status: number,
	error: string,
): void => send(res, status, { error });

export function readBody(
	req: http.IncomingMessage,
	maxBytes: number,
): Promise<string> {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => {
			size += c.length;
			if (size > maxBytes) {
				req.destroy();
				reject(new HttpError(413, "body too large"));
				return;
			}
			chunks.push(c);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", (e: Error) =>
			reject(new HttpError(400, `read error: ${e.message}`)),
		);
	});
}

// ---------- headers ----------
// Node lowercases incoming header names already, but a helper keeps callers honest.
export const header = (req: http.IncomingMessage, name: string): string =>
	String(req.headers[name.toLowerCase()] ?? "").trim();

export function cookieValue(req: http.IncomingMessage, name: string): string {
	const raw = header(req, "cookie");
	if (!raw) return "";
	const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
	return m?.[1] ?? "";
}

// ---------- path decoding ----------
// A scheme name may contain an encoded slash: /editor/web%2Fauth. Splitting on
// real slashes FIRST and decoding each segment keeps %2F inside a segment
// instead of turning it into a path separator (and blocks ../ traversal).
export function decodePathname(url: URL): string {
	const decoded = url.pathname
		.split("/")
		.map((seg) => {
			try {
				return decodeURIComponent(seg);
			} catch {
				return seg;
			}
		})
		.join("/");
	return decoded.replace(/\/+$/, "") || "/";
}

// ---------- router ----------
// `:name` matches one segment; `:name!` matches one OR two, so "project/scheme"
// names work without a second route. Patterns are compile-time literals written
// below — never user input — and the transform only emits ([^/]+) and
// ([^/]+(?:/[^/]+)?), so there is no ReDoS surface.
export class Router {
	private routes: {
		method: string;
		re: RegExp;
		keys: string[];
		handler: RouteMatch["handler"];
	}[] = [];

	add(method: string, pattern: string, handler: RouteMatch["handler"]): void {
		const keys: string[] = [];
		const re = new RegExp(
			`^${pattern.replace(/:[a-zA-Z]+!?/g, (m) => {
				const name = m.slice(1);
				const twoSegments = name.endsWith("!");
				keys.push(twoSegments ? name.slice(0, -1) : name);
				return twoSegments ? "([^/]+(?:/[^/]+)?)" : "([^/]+)";
			})}$`,
		);
		this.routes.push({ method, re, keys, handler });
	}

	get(pattern: string, handler: RouteMatch["handler"]): void {
		this.add("GET", pattern, handler);
	}
	post(pattern: string, handler: RouteMatch["handler"]): void {
		this.add("POST", pattern, handler);
	}
	put(pattern: string, handler: RouteMatch["handler"]): void {
		this.add("PUT", pattern, handler);
	}
	delete(pattern: string, handler: RouteMatch["handler"]): void {
		this.add("DELETE", pattern, handler);
	}
	patch(pattern: string, handler: RouteMatch["handler"]): void {
		this.add("PATCH", pattern, handler);
	}

	match(method: string, pathname: string): RouteMatch | null {
		for (const r of this.routes) {
			if (r.method !== method) continue;
			const m = pathname.match(r.re);
			if (!m) continue;
			const params: Record<string, string> = {};
			r.keys.forEach((k, i) => {
				// already decoded segment-wise by decodePathname; decoding again
				// would turn a literal %2F inside a name into a path separator
				params[k] = m[i + 1] ?? "";
			});
			return { params, handler: r.handler };
		}
		return null;
	}
}

// ---------- access log ----------
// B9: v1 logged req.url verbatim, so /editor/x?t=<session token> wrote a live
// credential into docker logs. The query string is never logged.
export function log(level: string, msg: string): void {
	process.stdout.write(`${new Date().toISOString()} ${level} ${msg}\n`);
}

export function logRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	pathname: string,
	started: number,
): void {
	log(
		"INFO",
		`${req.method ?? "?"} ${pathname} -> ${res.statusCode} ${Date.now() - started}ms`,
	);
}
