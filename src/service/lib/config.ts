// Environment configuration. Every value has a working default except
// ADMIN_PASSWORD, which compose refuses to start without.
export interface Config {
	port: number;
	adminLogin: string;
	adminPassword: string;
	dataDir: string;
	tokenTtlMs: number;
	dbQuotaBytes: number;
	maxBodyBytes: number;
	mcpEnabled: boolean;
	// origins allowed to call /mcp from a browser; the service itself has no TLS
	// and is meant to sit behind a reverse proxy
	allowedOrigins: string[];
}

const num = (name: string, fallback: number): number => {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	const n = Number(raw);
	return Number.isFinite(n) ? n : fallback;
};

const bool = (name: string, fallback: boolean): boolean => {
	const raw = process.env[name];
	return raw === undefined ? fallback : raw === "true";
};

export function loadConfig(): Config {
	return {
		port: num("PORT", 8080),
		adminLogin: process.env.ADMIN_LOGIN || "admin",
		adminPassword: process.env.ADMIN_PASSWORD || "admin",
		dataDir: process.env.DATA_DIR || "/data",
		tokenTtlMs: num("TOKEN_TTL_DAYS", 30) * 86_400_000,
		dbQuotaBytes: num("DB_QUOTA_MB", 64) * 1024 * 1024,
		maxBodyBytes: num("MAX_BODY_MB", 8) * 1024 * 1024,
		mcpEnabled: bool("MCP_ENABLED", true),
		// empty = same-origin only (the safe default); set ORIGIN_ALLOWLIST to
		// comma-separated origins when an MCP client runs on another host
		allowedOrigins: (process.env.ORIGIN_ALLOWLIST || "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	};
}
