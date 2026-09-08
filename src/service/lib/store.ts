import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DataError } from "../../core/index.ts";
import { HttpError } from "./http.ts";

// Persistence: lightdb (users, tokens, api keys) + per-user scheme directories.
// The on-disk format is v1-compatible — a live service upgrades without migrating.

export interface Token {
	token: string; // sha256 of the issued secret
	expiresAt: number;
}
export interface ApiKey {
	key: string; // sha256 of the llm_… secret
	createdAt: string;
	revoked?: boolean;
}
export interface User {
	id: number;
	login: string;
	role: "admin" | "user";
	salt: string;
	hash: string;
	createdAt: string;
	tokens?: Token[];
	apiKeys?: ApiKey[];
}
interface DbShape {
	users: User[];
	seq: number;
}

export interface StoreOptions {
	dataDir: string;
	dbQuotaBytes: number;
}

const sha256 = (s: string): string =>
	crypto.createHash("sha256").update(s).digest("hex");
const genApiKey = (): string => `llm_${crypto.randomBytes(24).toString("hex")}`;

function hashPassword(
	pw: string,
	salt = crypto.randomBytes(16).toString("hex"),
) {
	return { salt, hash: crypto.scryptSync(pw, salt, 32).toString("hex") };
}

function verifyPassword(pw: string, u: User): boolean {
	try {
		return crypto.timingSafeEqual(
			Buffer.from(u.hash, "hex"),
			crypto.scryptSync(pw, u.salt, 32),
		);
	} catch {
		return false;
	}
}

export interface PublicUser {
	id: number;
	login: string;
	role: "admin" | "user";
	apiKeys: number;
	createdAt: string;
}

// public view of a user: never exposes salt/hash/tokens/keys
export function publicUser(u: User): PublicUser {
	return {
		id: u.id,
		login: u.login,
		role: u.role,
		apiKeys: (u.apiKeys ?? []).filter((k) => !k.revoked).length,
		createdAt: u.createdAt,
	};
}

export class Store {
	private file: string;
	private dataDir: string;
	private quota: number;
	data: DbShape = { users: [], seq: 1 };

	constructor(opts: StoreOptions) {
		this.dataDir = opts.dataDir;
		this.file = path.join(opts.dataDir, "lightdb.json");
		this.quota = opts.dbQuotaBytes;
		fs.mkdirSync(opts.dataDir, { recursive: true });
		try {
			this.data = JSON.parse(fs.readFileSync(this.file, "utf8")) as DbShape;
		} catch (e) {
			// a missing db is the first-boot case; anything else is fatal
			if ((e as NodeJS.ErrnoException).code !== "ENOENT")
				throw new Error(`lightdb unreadable: ${(e as Error).message}`);
		}
	}

	save(): void {
		// quota is checked BEFORE growing the file, so a runaway db stops early
		if (fs.existsSync(this.file) && fs.statSync(this.file).size > this.quota)
			throw new HttpError(507, `lightdb quota exceeded (${this.quota}B)`);
		const tmp = `${this.file}.tmp-${process.pid}`;
		fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
		fs.renameSync(tmp, this.file);
	}

	// ---------- users ----------
	private nextId(): number {
		return this.data.seq++;
	}
	users(): User[] {
		return this.data.users;
	}
	userById(id: number): User | undefined {
		return this.data.users.find((u) => u.id === id);
	}
	userByLogin(login: string): User | undefined {
		return this.data.users.find((u) => u.login === login);
	}
	hasAdmin(): boolean {
		return this.data.users.some((u) => u.role === "admin");
	}

	createUser(
		login: string,
		password: string,
		role: "admin" | "user" = "user",
	): User {
		if (!/^[a-z0-9_.-]{1,32}$/.test(login))
			throw new DataError("login must match [a-z0-9_.-]{1,32}");
		if (!password || password.length < 4)
			throw new DataError("password must be ≥ 4 chars");
		if (this.userByLogin(login)) throw new HttpError(409, "login taken");
		const { salt, hash } = hashPassword(password);
		const u: User = {
			id: this.nextId(),
			login,
			role,
			salt,
			hash,
			createdAt: new Date().toISOString(),
		};
		this.data.users.push(u);
		this.save();
		return u;
	}

	// B: admin bootstrapped from env on first start with an empty db
	ensureAdmin(login: string, password: string): void {
		if (this.hasAdmin()) return;
		const { salt, hash } = hashPassword(password);
		this.data.users.push({
			id: this.nextId(),
			login,
			role: "admin",
			salt,
			hash,
			createdAt: new Date().toISOString(),
		});
		this.save();
	}

	deleteUser(id: number): void {
		const before = this.data.users.length;
		this.data.users = this.data.users.filter((u) => u.id !== id);
		if (this.data.users.length === before)
			throw new HttpError(404, "no such user");
		// their schemes go too (data/schemes/<id>)
		fs.rmSync(this.userRoot(id), { recursive: true, force: true });
		this.save();
	}

	setPassword(u: User, newPassword: string): void {
		if (!newPassword || newPassword.length < 4)
			throw new DataError("password must be ≥ 4 chars");
		const { salt, hash } = hashPassword(newPassword);
		u.salt = salt;
		u.hash = hash;
		// a password change invalidates every existing session
		u.tokens = [];
		this.save();
	}

	// change a user's role. Never demote the last remaining admin (that would
	// lock every admin out of the console).
	setRole(u: User, role: "admin" | "user"): void {
		if (u.role === role) return;
		if (role === "user" && u.role === "admin") {
			const admins = this.data.users.filter((x) => x.role === "admin").length;
			if (admins === 1) throw new HttpError(400, "cannot demote the last admin");
		}
		u.role = role;
		this.save();
	}

	checkPassword(u: User, password: string): boolean {
		return verifyPassword(password, u);
	}

	// ---------- sessions ----------
	issueToken(u: User, ttlMs: number): Token {
		const t: Token = {
			token: sha256(crypto.randomBytes(24).toString("hex")),
			expiresAt: Date.now() + ttlMs,
		};
		u.tokens = [...(u.tokens ?? []), t];
		this.save();
		return t;
	}

	// B6: v1 only revoked when the caller sent Authorization: Bearer, so the
	// console's cookie-based logout left the session token alive. Revoking by
	// hash (from whichever transport carried it) fixes that.
	revokeToken(tokenHash: string): void {
		let changed = false;
		for (const u of this.data.users) {
			const before = u.tokens?.length ?? 0;
			u.tokens = (u.tokens ?? []).filter((t) => t.token !== tokenHash);
			if ((u.tokens?.length ?? 0) !== before) changed = true;
		}
		if (changed) this.save();
	}

	revokeAllSessions(u: User): void {
		u.tokens = [];
		this.save();
	}

	// resolve a raw token (64-hex is already a hash; anything else is hashed)
	userByToken(raw: string): User | undefined {
		if (!raw) return undefined;
		const tokenHash = raw.length === 64 ? raw : sha256(raw);
		const now = Date.now();
		return this.data.users.find((u) =>
			(u.tokens ?? []).some((t) => t.token === tokenHash && t.expiresAt > now),
		);
	}

	// ---------- api keys ----------
	issueApiKey(u: User): string {
		const key = genApiKey();
		u.apiKeys = [
			...(u.apiKeys ?? []),
			{ key: sha256(key), createdAt: new Date().toISOString() },
		];
		this.save();
		return key; // shown once
	}

	revokeApiKey(u: User, keyHash: string): void {
		const k = (u.apiKeys ?? []).find((x) => x.key === keyHash && !x.revoked);
		if (!k) throw new HttpError(404, "no such active key");
		k.revoked = true;
		this.save();
	}

	// B13: rotating is an explicit, confirmed action (POST), not a side effect of
	// GET /api/mcp-config as in v1 — a read must never break live clients.
	rotateApiKeys(u: User): string {
		for (const k of u.apiKeys ?? []) k.revoked = true;
		const key = genApiKey();
		u.apiKeys = [
			...(u.apiKeys ?? []),
			{ key: sha256(key), createdAt: new Date().toISOString() },
		];
		this.save();
		return key;
	}

	userByApiKey(raw: string): User | undefined {
		if (!raw) return undefined;
		const hash = sha256(raw);
		return this.data.users.find((u) =>
			(u.apiKeys ?? []).some((k) => !k.revoked && k.key === hash),
		);
	}

	activeKeys(): { user: string; hash: string; createdAt: string }[] {
		return this.data.users.flatMap((u) =>
			(u.apiKeys ?? [])
				.filter((k) => !k.revoked)
				.map((k) => ({ user: u.login, hash: k.key, createdAt: k.createdAt })),
		);
	}

	// ---------- schemes ----------
	userRoot(id: number): string {
		return path.join(this.dataDir, "schemes", String(id));
	}

	// scheme name = "project/scheme" (one level) or bare "scheme"
	schemeRoot(u: User, name: string): string {
		if (
			!name ||
			!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)?$/.test(name) ||
			name.includes("..")
		)
			throw new DataError(
				'bad scheme name (use "project/scheme" or "scheme", a-z 0-9 . _ -)',
			);
		const root = path.resolve(this.userRoot(u.id));
		const dir = path.resolve(path.join(root, name));
		// belt and braces: the regex already blocks traversal, this proves it
		if (!dir.startsWith(root + path.sep)) throw new DataError("bad scheme name");
		return dir;
	}
}
