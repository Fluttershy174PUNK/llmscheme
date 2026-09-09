import type http from "node:http";
import {
	type Scheme,
	CasError,
	DataError,
	ValidationError,
} from "../../core/index.ts";
import { header, send } from "./http.ts";
import type { Schemes } from "./schemes.ts";
import type { Store, User } from "./store.ts";

// MCP over streamable HTTP (POST /mcp), dual-era:
//
//   legacy  (2025-06-18 / 2025-11-25) — initialize handshake. Still what Claude
//           Desktop, Cursor and most clients speak today.
//   modern  (2026-07-28)              — stateless: no session, server/discover
//           advertises versions, every request carries MCP-Protocol-Version.
//
// One endpoint serves both: `initialize` selects legacy, `server/discover` or a
// request carrying modern `_meta` selects modern. Tool handlers are shared, so
// the two eras cannot drift apart.
//
// Responses are plain application/json, which the transport allows instead of
// SSE. No session ids are minted and none are echoed back.

export const MODERN_VERSION = "2026-07-28";
export const LEGACY_VERSIONS = [
	"2025-11-25",
	"2025-06-18",
	"2025-03-26",
] as const;
export const SUPPORTED_VERSIONS = [MODERN_VERSION, ...LEGACY_VERSIONS];

const SERVER_INFO = { name: "llmscheme", version: "2.0.0" };

// JSON-RPC error codes
const PARSE_ERROR = -32700;
const INVALID_PARAMS = -32602;
const METHOD_NOT_FOUND = -32601;
// protocol-defined: header/body mismatch and unsupported version.
// There is no INTERNAL_ERROR constant: MCP reports tool failures inside a 200
// result with isError, and JSON-RPC -32000 would hide them from the model.
const HEADER_MISMATCH = -32020;
const UNSUPPORTED_VERSION = -32025;

interface RpcRequest {
	jsonrpc?: string;
	id?: string | number | null;
	method?: string;
	params?: Record<string, unknown>;
	_meta?: Record<string, unknown>;
}

export interface McpDeps {
	store: Store;
	schemes: Schemes;
	// empty = same-origin only; entries are exact origins (scheme://host[:port])
	allowedOrigins: string[];
}

const ok = (id: RpcRequest["id"], result: unknown) => ({
	jsonrpc: "2.0",
	id,
	result,
});
const rpcError = (
	id: RpcRequest["id"],
	code: number,
	message: string,
	data?: unknown,
) => ({
	jsonrpc: "2.0",
	id,
	error: { code, message, ...(data === undefined ? {} : { data }) },
});

// ---------- Origin validation (spec MUST; v1 had none) ----------
// Browsers send Origin, other MCP clients do not. An absent header therefore
// means "not a browser" and is allowed; a present one must match the request's
// own host or the allowlist, otherwise a malicious page could drive the server
// through a DNS-rebinding victim.
export function checkOrigin(
	req: http.IncomingMessage,
	allowed: string[],
): string | null {
	const origin = header(req, "origin");
	if (!origin) return null;
	if (allowed.includes(origin)) return null;
	const host = header(req, "host");
	if (host && origin === `http://${host}`) return null;
	if (host && origin === `https://${host}`) return null;
	return origin;
}

// ---------- tool table ----------
// annotations tell the client how careful to be: readOnly tools are safe to
// call speculatively, destructive ones should be confirmed with the user.
interface Tool {
	name: string;
	title: string;
	description: string;
	inputSchema: Record<string, unknown>;
	annotations: Record<string, unknown>;
}

const nameOnly = {
	type: "object",
	properties: {
		name: {
			type: "string",
			description: "Scheme name: `project/scheme` or `scheme`",
		},
	},
	required: ["name"],
	additionalProperties: false,
};
const idRef = {
	type: "object",
	properties: { name: { type: "string" }, id: { type: "string" } },
	required: ["name", "id"],
	additionalProperties: false,
};

const tableSchema = {
	type: "object",
	properties: {
		cols: { type: "array", items: { type: "string" }, maxItems: 10 },
		rows: {
			type: "array",
			maxItems: 50,
			items: { type: "array", items: { type: "string" } },
		},
	},
};
const SHAPES = {
	type: "string",
	enum: ["rect", "square", "circle", "ellipse", "diamond", "table"],
};
const SIDES = { type: "string", enum: ["top", "bottom", "left", "right"] };

const READ_ONLY = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
};
// repeating a write bumps rev, so it is NOT idempotent; destructive only where
// data disappears
const WRITE = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
};
const DESTROY = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: false,
};
// updating the same id with the same fields converges to one state
const CONVERGING = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
};

const TOOLS: Tool[] = [
	{
		name: "list_schemes",
		title: "List schemes",
		description: "List scheme names of the authenticated user",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		annotations: READ_ONLY,
	},
	{
		name: "get_scheme",
		title: "Get scheme",
		description: "Get full scheme JSON by name",
		inputSchema: nameOnly,
		annotations: READ_ONLY,
	},
	{
		name: "get_scheme_md",
		title: "Get scheme markdown",
		description:
			"Get the human-readable SCHEME.md export (mermaid + tables) of a scheme",
		inputSchema: nameOnly,
		annotations: READ_ONLY,
	},
	{
		name: "create_scheme",
		title: "Create scheme",
		description:
			"Create a new empty scheme, or import a full scheme object that has rev 0",
		inputSchema: {
			type: "object",
			properties: { name: { type: "string" }, scheme: { type: "object" } },
			required: ["name"],
			additionalProperties: false,
		},
		annotations: WRITE,
	},
	{
		name: "put_scheme",
		title: "Write scheme",
		description:
			"Write the whole scheme. CAS: payload rev must equal the current rev (read with get_scheme first). Not idempotent — a replayed call fails with a CAS conflict.",
		inputSchema: {
			type: "object",
			properties: { name: { type: "string" }, scheme: { type: "object" } },
			required: ["name", "scheme"],
			additionalProperties: false,
		},
		annotations: WRITE,
	},
	{
		name: "delete_scheme",
		title: "Delete scheme",
		description: "Delete a scheme with all its history",
		inputSchema: nameOnly,
		annotations: DESTROY,
	},
	{
		name: "node_add",
		title: "Add node",
		description:
			"Add a node (shape rect|square|circle|ellipse|diamond|table). Without x/y the deterministic layout places it. Returns the new node id.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string" },
				label: { type: "string" },
				shape: SHAPES,
				table: tableSchema,
				description: { type: "string" },
				refs: { type: "array", items: { type: "string" } },
				x: { type: "number" },
				y: { type: "number" },
				w: { type: "number", description: "explicit width override (>= 20)" },
				h: { type: "number", description: "explicit height override (>= 20)" },
			},
			required: ["name", "label"],
			additionalProperties: false,
		},
		annotations: WRITE,
	},
	{
		name: "node_update",
		title: "Update node",
		description:
			"Update node fields (label/shape/description/refs/x/y/w/h/table). Omitted fields are left alone.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string" },
				id: { type: "string" },
				label: { type: "string" },
				shape: SHAPES,
				table: tableSchema,
				description: { type: "string" },
				refs: { type: "array", items: { type: "string" } },
				x: { type: "number" },
				y: { type: "number" },
				w: { type: "number" },
				h: { type: "number" },
			},
			required: ["name", "id"],
			additionalProperties: false,
		},
		annotations: CONVERGING,
	},
	{
		name: "node_remove",
		title: "Remove node",
		description: "Remove a node and all edges that touch it",
		inputSchema: idRef,
		annotations: DESTROY,
	},
	{
		name: "edge_add",
		title: "Add edge",
		description:
			"Connect two nodes with an arrow (style solid|dashed). Returns the new edge id.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string" },
				from: { type: "string" },
				to: { type: "string" },
				style: { type: "string", enum: ["solid", "dashed"] },
				label: { type: "string" },
				fromSide: SIDES,
				toSide: SIDES,
			},
			required: ["name", "from", "to"],
			additionalProperties: false,
		},
		annotations: WRITE,
	},
	{
		name: "edge_remove",
		title: "Remove edge",
		description: "Remove an edge by id",
		inputSchema: idRef,
		annotations: DESTROY,
	},
	{
		name: "diff",
		title: "Diff revisions",
		description: "What changed since a revision (default: the previous rev)",
		inputSchema: {
			type: "object",
			properties: { name: { type: "string" }, rev: { type: "number" } },
			required: ["name"],
			additionalProperties: false,
		},
		annotations: READ_ONLY,
	},
];

// ---------- tool execution ----------
const argStr = (a: Record<string, unknown>, key: string): string => {
	const v = a[key];
	if (typeof v !== "string" || !v)
		throw new DataError(`${key} must be a non-empty string`);
	return v;
};
const argNum = (
	a: Record<string, unknown>,
	key: string,
): number | undefined => {
	const v = a[key];
	if (v === undefined || v === null) return undefined;
	const n = Number(v);
	if (!Number.isFinite(n)) throw new DataError(`${key} must be a number`);
	return n;
};
const argId = (a: Record<string, unknown>): string => argStr(a, "id");

// what a tool returns: a scheme or markdown text for reads, a receipt for writes
export type ToolResult =
	| Scheme
	| string
	| { schemes: string[] }
	| { ok: true }
	| WriteReceipt
	| DiffResult;
interface WriteReceipt {
	ok?: true;
	rev: number;
	id?: string;
}
interface DiffResult {
	from: number;
	to: number;
	changes: string[];
}

// Spec MUST (server validation): Mcp-Method and Mcp-Name mirror body fields so
// proxies can route without parsing JSON. When both are present they have to
// agree with the body, or a load balancer and this server would act on
// different requests. A missing header is not an error: clients on older
// revisions do not send them.
function headerMismatch(
	req: http.IncomingMessage,
	msg: RpcRequest,
): string | null {
	const hdrMethod = header(req, "mcp-method");
	if (hdrMethod && msg.method && hdrMethod !== msg.method)
		return `Mcp-Method "${hdrMethod}" does not match body method "${msg.method}"`;
	const hdrName = header(req, "mcp-name");
	if (!hdrName) return null;
	const toolName = typeof msg.params?.name === "string" ? msg.params.name : "";
	// the spec allows a base64 sentinel for values that are not header-safe
	const decoded = decodeHeaderValue(hdrName);
	if (toolName && decoded !== toolName)
		return `Mcp-Name "${hdrName}" does not match body tool name "${toolName}"`;
	return null;
}

function decodeHeaderValue(v: string): string {
	if (!v.startsWith("=?base64?") || !v.endsWith("?=")) return v;
	try {
		return Buffer.from(v.slice(9, -2), "base64").toString("utf8");
	} catch {
		return v;
	}
}

export function callTool(
	deps: McpDeps,
	u: User,
	name: string,
	a: Record<string, unknown>,
): ToolResult {
	const s = deps.schemes;
	switch (name) {
		case "list_schemes":
			// structuredContent must be an OBJECT (MCP spec); a bare array breaks
			// strict clients (Hermes/pydantic expects a dict). Wrap the list.
			return {
				schemes: s
					.list(u)
					.map((x) => (x.project ? `${x.project}/${x.name}` : x.name)),
			};
		case "get_scheme":
			return s.get(u, argStr(a, "name"));
		case "get_scheme_md":
			return s.md(u, argStr(a, "name"));
		case "create_scheme": {
			const schemeName = argStr(a, "name");
			const payload = a.scheme as Scheme | undefined;
			return s.create(u, schemeName, payload);
		}
		case "put_scheme": {
			const schemeName = argStr(a, "name");
			const payload = a.scheme;
			if (!payload || typeof payload !== "object" || Array.isArray(payload))
				throw new DataError("scheme must be an object");
			// SAFETY: an untrusted argument reaches core validation inside put(),
			// which rejects malformed schemes with a 400-level error.
			return s.put(u, schemeName, payload as unknown as Scheme);
		}
		case "delete_scheme":
			s.remove(u, argStr(a, "name"));
			return { ok: true };
		case "node_add": {
			const schemeName = argStr(a, "name");
			const out = s.nodeAdd(u, schemeName, {
				label: argStr(a, "label"),
				shape: a.shape as never,
				description: a.description as string | undefined,
				refs: a.refs as string[] | undefined,
				table: a.table as never,
				x: argNum(a, "x"),
				y: argNum(a, "y"),
				w: argNum(a, "w"),
				h: argNum(a, "h"),
			});
			return { ok: true, rev: out.rev, id: out.result };
		}
		case "node_update": {
			const schemeName = argStr(a, "name");
			const out = s.nodeUpdate(u, schemeName, argId(a), {
				label: a.label as string | undefined,
				shape: a.shape as never,
				description: a.description as string | undefined,
				refs: a.refs as string[] | undefined,
				table: a.table as never,
				x: argNum(a, "x"),
				y: argNum(a, "y"),
				w: argNum(a, "w"),
				h: argNum(a, "h"),
			});
			return { ok: true, rev: out.rev, id: out.result };
		}
		case "node_remove": {
			const schemeName = argStr(a, "name");
			const out = s.nodeRemove(u, schemeName, argId(a));
			return { ok: true, rev: out.rev };
		}
		case "edge_add": {
			const schemeName = argStr(a, "name");
			const out = s.edgeAdd(u, schemeName, {
				from: argStr(a, "from"),
				to: argStr(a, "to"),
				style: a.style as never,
				label: a.label as string | undefined,
				fromSide: a.fromSide as never,
				toSide: a.toSide as never,
			});
			return { ok: true, rev: out.rev, id: out.result };
		}
		case "edge_remove": {
			const schemeName = argStr(a, "name");
			const out = s.edgeRemove(u, schemeName, argId(a));
			return { ok: true, rev: out.rev };
		}
		case "diff": {
			const schemeName = argStr(a, "name");
			return s.diff(u, schemeName, argNum(a, "rev"));
		}
		default:
			throw new DataError(`unknown tool ${name}`);
	}
}

// ---------- request handling ----------
export interface McpResponse {
	status: number;
	body: unknown;
}

function isModern(msg: RpcRequest, headerVersion: string): boolean {
	return (
		headerVersion === MODERN_VERSION ||
		msg._meta?.["io.modelcontextprotocol/protocolVersion"] === MODERN_VERSION
	);
}

export function handleMcpMessage(
	deps: McpDeps,
	req: http.IncomingMessage,
	bodyText: string,
): McpResponse {
	const headerVersion = header(req, "mcp-protocol-version");

	let msg: RpcRequest;
	try {
		msg = JSON.parse(bodyText || "{}") as RpcRequest;
	} catch {
		return {
			status: 400,
			body: rpcError(null, PARSE_ERROR, "parse error: body is not valid JSON"),
		};
	}

	const { id, method, params } = msg;
	const modern = isModern(msg, headerVersion);

	// Spec MUST: the mirrored headers have to agree with the body, otherwise a
	// proxy routing on headers and this server executing the body would disagree.
	const mismatch = headerMismatch(req, msg);
	if (mismatch)
		return { status: 400, body: rpcError(id ?? null, HEADER_MISMATCH, mismatch) };

	// a declared version we do not speak must be refused with the list we do
	const declared =
		headerVersion ||
		(msg._meta?.["io.modelcontextprotocol/protocolVersion"] as
			| string
			| undefined);
	if (declared && !SUPPORTED_VERSIONS.includes(declared))
		return {
			status: 400,
			body: rpcError(
				id ?? null,
				UNSUPPORTED_VERSION,
				`unsupported protocol version ${declared}`,
				{
					supported: SUPPORTED_VERSIONS,
				},
			),
		};

	// notifications (no id) get 202 and no body, per JSON-RPC over HTTP
	if (id === undefined || id === null) {
		// an invalid notification is still a bad request
		if (!method)
			return {
				status: 400,
				body: rpcError(null, INVALID_PARAMS, "notification without method"),
			};
		return { status: 202, body: null };
	}
	if (!method)
		return {
			status: 400,
			body: rpcError(id, INVALID_PARAMS, "method is required"),
		};

	switch (method) {
		// ---- modern era ----
		case "server/discover":
			return {
				status: 200,
				body: ok(id, {
					supportedVersions: SUPPORTED_VERSIONS,
					capabilities: { tools: { listChanged: false } },
					instructions:
						"Living logic schemes. Read with get_scheme before changing code, write with put_scheme using the rev you read (CAS). list_schemes shows your schemes.",
					_meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO },
				}),
			};

		// ---- legacy era handshake, still answered for today's clients ----
		case "initialize": {
			const requested = (params?.protocolVersion as string) || LEGACY_VERSIONS[1];
			const agreed = SUPPORTED_VERSIONS.includes(requested)
				? requested
				: MODERN_VERSION;
			return {
				status: 200,
				body: ok(id, {
					protocolVersion: agreed,
					capabilities: { tools: { listChanged: false } },
					serverInfo: SERVER_INFO,
					instructions:
						"Living logic schemes. Read with get_scheme before changing code, write with put_scheme using the rev you read (CAS).",
				}),
			};
		}

		case "ping":
			return { status: 200, body: ok(id, {}) };

		case "tools/list":
		case "tools/call": {
			const u = deps.store.userByApiKey(header(req, "x-api-key"));
			// the auth gate must not throw out of the handler (v1 crashed the
			// process when a 401 escaped here)
			if (!u) return { status: 401, body: { error: "X-Api-Key required" } };

			if (method === "tools/list")
				return {
					status: 200,
					body: ok(id, {
						tools: TOOLS.map(
							({ name, title, description, inputSchema, annotations }) => ({
								name,
								title,
								description,
								inputSchema,
								annotations,
							}),
						),
					}),
				};

			const toolName = params?.name;
			const args = (params?.arguments ?? {}) as Record<string, unknown>;
			if (typeof toolName !== "string" || !toolName)
				return {
					status: 400,
					body: rpcError(id, INVALID_PARAMS, "params.name is required"),
				};
			if (!TOOLS.some((t) => t.name === toolName))
				return {
					status: 404,
					body: rpcError(id, INVALID_PARAMS, `unknown tool ${toolName}`),
				};

			try {
				const result = callTool(deps, u, toolName, args);
				const text =
					typeof result === "string" ? result : JSON.stringify(result, null, 2);
				return {
					status: 200,
					body: ok(id, {
						content: [{ type: "text", text }],
						// structuredContent mirrors the JSON for clients that want it
						...(typeof result === "string" ? {} : { structuredContent: result }),
					}),
				};
			} catch (e) {
				// tool failures are reported INSIDE a 200 result per MCP, except for
				// a bad scheme name, which is an invalid-params protocol error
				const known =
					e instanceof CasError ||
					e instanceof ValidationError ||
					e instanceof DataError;
				const message = known ? (e as Error).message : "internal error";
				return {
					status: 200,
					body: ok(id, {
						content: [{ type: "text", text: message }],
						isError: true,
					}),
				};
			}
		}

		default:
			// modern spec: an unknown method is a 404 carrying -32601
			return {
				status: modern ? 404 : 200,
				body: rpcError(id, METHOD_NOT_FOUND, `method ${method} not found`),
			};
	}
}

// HTTP wrapper: auth for the endpoint as a whole, Origin check, GET/DELETE 405.
export function handleMcpHttp(
	deps: McpDeps,
	req: http.IncomingMessage,
	res: http.ServerResponse,
	bodyText: string,
): void {
	// the modern transport defines POST only; GET/DELETE belong to older
	// revisions that used a standalone SSE stream and a session delete
	if (req.method !== "POST") {
		send(
			res,
			405,
			{ error: "method not allowed: /mcp accepts POST only" },
			{ allow: "POST" },
		);
		return;
	}
	const badOrigin = checkOrigin(req, deps.allowedOrigins);
	if (badOrigin) {
		send(res, 403, { error: `origin ${badOrigin} not allowed` });
		return;
	}
	const { status, body } = handleMcpMessage(deps, req, bodyText);
	if (status === 202) {
		res.writeHead(202).end();
		return;
	}
	send(res, status, body, { "content-type": "application/json" });
}

export { HEADER_MISMATCH, TOOLS };
