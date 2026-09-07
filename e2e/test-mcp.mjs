// e2e: mcp — initialize, tools/list, tools/call, auth, CAS conflict path
import { define } from "./harness.mjs";

export default define("mcp", async ({ t, BASE, ADMIN, PASS, api, login, cleanupScheme }) => {
	const adminTok = await login(ADMIN, PASS);
	const full = "e2e-mcp/s1";

	// get a key via mcp-config
	const cfg = await api("/api/mcp-config", { token: adminTok });
	const key = cfg.json.mcpServers?.llmscheme?.headers?.["X-Api-Key"];
	t.truthy(key?.startsWith("llm_"), "mcp-config issues a key");

	const rpc = async (body) => {
		const res = await fetch(BASE + "/mcp", {
			method: "POST",
			headers: { "content-type": "application/json", "x-api-key": key },
			body: JSON.stringify(body),
		});
		return { status: res.status, json: await res.json() };
	};

	// no key -> 401
	const noKey = await fetch(BASE + "/mcp", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
	});
	t.eq(noKey.status, 401, "mcp without key -> 401");

	// initialize + tools/list
	const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
	t.truthy(init.json.result?.serverInfo, "initialize ok");
	const tools = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
	t.eq(tools.json.result.tools.length, 12, "12 tools listed");

	// create_scheme + list_schemes + get_scheme
	const call = (name, args) => rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: args } });
	await call("create_scheme", { name: full });
	const listed = await call("list_schemes", {});
	t.truthy(JSON.stringify(listed.json).includes(full), "create+list roundtrip");
	const got = await call("get_scheme", { name: full });
	const schemeText = got.json.result?.content?.[0]?.text ?? "";
	let scheme;
	try {
		scheme = JSON.parse(schemeText);
	} catch {
		throw new Error(`get_scheme returned non-JSON: ${schemeText.slice(0, 80)}`);
	}
	t.eq(scheme.name, full, "get_scheme returns scheme");

	// put_scheme CAS: correct rev ok, stale rev -> error text
	scheme.nodes.push({ id: "n9", shape: "rect", label: "mcp node", x: 10, y: 10 });
	const put1 = await call("put_scheme", { name: full, scheme });
	t.truthy(JSON.stringify(put1.json).includes('"ok"'), "put with fresh rev ok");
	const put2 = await call("put_scheme", { name: full, scheme });
	t.truthy(JSON.stringify(put2.json).includes("changed on disk"), "stale rev CAS error");

	// get_scheme_md + diff
	const md = await call("get_scheme_md", { name: full });
	t.truthy(md.json.result, "md export");
	const diff = await call("diff", { name: full, rev: 1 });
	t.truthy(diff.json.result, "diff");

	// node_add tool
	const na = await call("node_add", { name: full, label: "via mcp" });
	t.truthy(JSON.stringify(na.json).includes('"ok"'), "node_add ok");

	// browser-side: editor SAVE from same user must not be clobbered (CAS holds)
	await cleanupScheme(adminTok, full);
});
