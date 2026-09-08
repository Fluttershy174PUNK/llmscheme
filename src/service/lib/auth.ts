import type http from "node:http";
import crypto from "node:crypto";
import { cookieValue, header } from "./http.ts";
import type { Store, User } from "./store.ts";

// Request authentication. Three transports, one resolution order:
//   X-Api-Key  — scripts and MCP (stateless, sha256-looked-up)
//   Bearer     — XHR from the console/editor
//   ls_token   — cookie set by /api/login, used by plain page navigation
//
// v1 also accepted ?t=<token> in the URL, which put a live session credential
// into browser history, the Referer header and the access log (bug B9).
// Cookies cover pages and Bearer covers XHR, so that transport is gone.

export const COOKIE = "ls_token";

const sha256 = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");

export function authenticate(store: Store, req: http.IncomingMessage): User | null {
	const apiKey = header(req, "x-api-key");
	if (apiKey) return store.userByApiKey(apiKey) ?? null;

	const auth = header(req, "authorization");
	const bearer = auth.match(/^Bearer (.+)$/)?.[1];
	if (bearer) return store.userByToken(bearer) ?? null;

	const cookie = cookieValue(req, COOKIE);
	if (cookie) return store.userByToken(cookie) ?? null;

	return null;
}

// The token hash of the CURRENT request, for logout: whatever transport carried
// the credential (Bearer or cookie), normalized exactly like Store.userByToken
// so revokeToken() compares hash to hash. v1 only handled the Bearer header,
// which is why the console's cookie logout left the session alive (bug B6).
export function currentTokenHash(req: http.IncomingMessage): string {
	const raw = header(req, "authorization").match(/^Bearer (.+)$/)?.[1] || cookieValue(req, COOKIE);
	if (!raw) return "";
	return raw.length === 64 ? raw : sha256(raw);
}

export function cookieHeader(token: string, maxAgeSeconds: number): string {
	return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export const clearCookieHeader = (): string =>
	`${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export function isAdmin(u: User | null | undefined): boolean {
	return u?.role === "admin";
}
