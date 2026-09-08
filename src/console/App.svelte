<script lang="ts">
	// console — single Svelte 5 runes component, hash-routed.
	// four screens: #/login, #/projects, #/users, #/settings
	// the URL fragment survives reloads and deep-links.
	import { onMount } from "svelte";
	import { api, getToken, setToken, confirmDialog, promptDialog } from "./api.ts";
	import { DICT, loadLang, saveLang, type Lang } from "../editor/core/i18n.ts";

	type Screen = "login" | "projects" | "users" | "settings";
	let route: Screen = $state(parseHash());
	let lang: Lang = $state(loadLang());

	let me: { id: number; login: string; role: "admin" | "user" } | null = $state(null);
	let meErr: string = $state("");

	let readmeMd: string = $state("");
	let readmeUrl: string = $state("");

	// --- login form state ---
	let loginName = $state("");
	let loginPass = $state("");
	let loginErr = $state("");
	let loginBusy = $state(false);

	// --- projects state ---
	let schemes: { project: string; name: string; owner?: string; rev: number; updatedAt: string }[] =
		$state([]);
	let allUsers = $state(false); // admin toggle
	let projectsErr = $state("");

	// --- users state (admin) ---
	let users: { id: number; login: string; role: "admin" | "user"; apiKeys: number; createdAt: string }[] =
		$state([]);
	let usersErr = $state("");

	// --- settings (own password + own keys) ---
	let newPass = $state("");
	let keys: { hash: string; createdAt: string }[] = $state([]);
	let mcpConfig: unknown = $state(null);

	function parseHash(): Screen {
		const h = location.hash.replace(/^#\/?/, "");
		if (h === "projects" || h === "users" || h === "settings" || h === "login") return h;
		return "login";
	}

	function go(s: Screen) {
		location.hash = `#/${s}`;
	}

	$effect(() => saveLang(lang));
	$effect(() => {
		route = parseHash();
	});
	window.addEventListener("hashchange", () => (route = parseHash()));

	onMount(async () => {
		// login: try /api/me with whatever token is in storage
		if (getToken()) {
			try {
				me = await api("/api/me");
			} catch {
				me = null;
			}
		}
		// readme is public, always fetched
		try {
			const r = (await api("/api/readme")) as { markdown: string; url: string };
			readmeMd = r.markdown;
			readmeUrl = r.url;
		} catch {
			/* no readme */
		}
		// redirect to the saved next if we landed here unauthenticated
		const u = new URL(location.href);
		const next = u.searchParams.get("next");
		if (!me && next && next.startsWith("/")) {
			// we are not logged in, and the editor sent us here — just sit
			// on the login screen; the editor will bounce back on success.
		}
		if (me && route === "login") go("projects");
	});

	async function doLogin() {
		loginBusy = true;
		loginErr = "";
		try {
			const r = (await api("/api/login", {
				method: "POST",
				body: JSON.stringify({ login: loginName, password: loginPass }),
			})) as { token: string };
			setToken(r.token);
			me = await api("/api/me");
			// honour ?next from the editor
			const u = new URL(location.href);
			const next = u.searchParams.get("next");
			if (next && next.startsWith("/")) {
				location.href = next;
				return;
			}
			go("projects");
		} catch (e) {
			loginErr = (e as Error).message;
		} finally {
			loginBusy = false;
		}
	}

	async function doLogout() {
		try {
			await api("/api/logout", { method: "POST" });
		} catch {
			/* even if it fails server-side, the local token is gone */
		}
		setToken("");
		me = null;
		go("login");
	}

	async function revokeAllSessions() {
		if (!(await confirmDialog("Revoke all sessions? You will be signed out."))) return;
		try {
			await api("/api/session/revoke-all", { method: "POST" });
		} catch (e) {
			meErr = (e as Error).message;
		}
		setToken("");
		me = null;
		go("login");
	}

	async function loadProjects() {
		if (!me) return;
		try {
			const url = me.role === "admin" && allUsers ? "/api/schemes?user=all" : "/api/schemes";
			schemes = (await api(url)) as typeof schemes;
			projectsErr = "";
		} catch (e) {
			projectsErr = (e as Error).message;
		}
	}

	async function loadUsers() {
		if (!me || me.role !== "admin") return;
		try {
			users = (await api("/api/users")) as typeof users;
			usersErr = "";
		} catch (e) {
			usersErr = (e as Error).message;
		}
	}

	async function loadSettings() {
		if (!me) return;
		try {
			keys = (await api("/api/keys")) as typeof keys;
			mcpConfig = await api("/api/mcp-config");
		} catch (e) {
			meErr = (e as Error).message;
		}
	}

	$effect(() => {
		if (route === "projects" && me) loadProjects();
		if (route === "users" && me) loadUsers();
		if (route === "settings" && me) loadSettings();
	});

	async function createProject() {
		const name = await promptDialog("Project name:");
		if (!name) return;
		const desc = await promptDialog("Description (optional):");
		try {
			await api("/api/schemes", {
				method: "POST",
				body: JSON.stringify({ name }),
			});
			await loadProjects();
		} catch (e) {
			projectsErr = (e as Error).message;
		}
		void desc;
	}

	async function deleteProject(name: string) {
		const confirm = await promptDialog(`Type project name to confirm: ${name}`, "");
		if (confirm !== name) return;
		try {
			await api(`/api/scheme/${encodeURIComponent(name)}`, { method: "DELETE" });
			await loadProjects();
		} catch (e) {
			projectsErr = (e as Error).message;
		}
	}

	async function createUser() {
		const login = await promptDialog("Login:");
		if (!login) return;
		const password = await promptDialog("Password:");
		if (!password) return;
		try {
			await api("/api/users", {
				method: "POST",
				body: JSON.stringify({ login, password, role: "user" }),
			});
			await loadUsers();
		} catch (e) {
			usersErr = (e as Error).message;
		}
	}

	async function deleteUser(id: number, login: string) {
		if (!(await confirmDialog(`Delete user ${login}?`))) return;
		try {
			await api(`/api/user/${id}`, { method: "DELETE" });
			await loadUsers();
		} catch (e) {
			usersErr = (e as Error).message;
		}
	}

	async function changePassForUser(login: string) {
		const pw = await promptDialog(`New password for ${login}:`);
		if (!pw) return;
		try {
			await api("/api/password", {
				method: "POST",
				body: JSON.stringify({ login, password: pw }),
			});
		} catch (e) {
			usersErr = (e as Error).message;
		}
	}

	async function showMcpConfig(login: string) {
		try {
			const c = await api(`/api/mcp-config?login=${encodeURIComponent(login)}`);
			alert(JSON.stringify(c, null, 2));
		} catch (e) {
			usersErr = (e as Error).message;
		}
	}

	async function rotateKey(login: string) {
		if (!(await confirmDialog(`Rotate API key for ${login}? The old key stops working.`))) return;
		try {
			const r = (await api("/api/keys/rotate", {
				method: "POST",
				body: JSON.stringify({ login }),
			})) as { apiKey: string; mcpConfig: unknown };
			alert(`New key (save it now):\n\n${r.apiKey}\n\n${JSON.stringify(r.mcpConfig, null, 2)}`);
			await loadUsers();
		} catch (e) {
			usersErr = (e as Error).message;
		}
	}

	async function changeOwnPassword() {
		if (newPass.length < 4) {
			meErr = "min 4 chars";
			return;
		}
		try {
			await api("/api/password", {
				method: "POST",
				body: JSON.stringify({ password: newPass }),
			});
			// password change drops our session
			setToken("");
			me = null;
			go("login");
		} catch (e) {
			meErr = (e as Error).message;
		}
	}

	async function createOwnKey() {
		try {
			const r = (await api("/api/keys", { method: "POST" })) as { apiKey: string; mcpConfig: unknown };
			alert(`New key (save it now):\n\n${r.apiKey}\n\n${JSON.stringify(r.mcpConfig, null, 2)}`);
			await loadSettings();
		} catch (e) {
			meErr = (e as Error).message;
		}
	}

	async function revokeOwnKey(hash: string) {
		if (!(await confirmDialog("Revoke this key?"))) return;
		try {
			await api(`/api/keys/${hash}/revoke`, { method: "POST" });
			await loadSettings();
		} catch (e) {
			meErr = (e as Error).message;
		}
	}

	function renderReadme(md: string): string {
		// minimal renderer: paragraphs + fenced code + headings. enough for the
		// "live README on the login page" UI requirement (n1 in the spec).
		return md
			.split(/\n{2,}/)
			.map((p) => {
				if (p.startsWith("```")) {
					const m = p.match(/^```\w*\n([\s\S]*?)\n```$/);
					return m ? `<pre>${m[1]!.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!)}</pre>` : "";
				}
				if (p.startsWith("# ")) return `<h1>${p.slice(2)}</h1>`;
				if (p.startsWith("## ")) return `<h2>${p.slice(3)}</h2>`;
				if (p.startsWith("### ")) return `<h3>${p.slice(4)}</h3>`;
				return `<p>${p.replace(/\n/g, "<br>")}</p>`;
			})
			.join("\n");
	}
</script>

<header class="topbar">
	<span class="title">llmscheme</span>
	{#if me}
		<nav>
			<button class:on={route === "projects"} onclick={() => go("projects")}>projects</button>
			{#if me.role === "admin"}<button class:on={route === "users"} onclick={() => go("users")}>users</button>{/if}
			<button class:on={route === "settings"} onclick={() => go("settings")}>settings</button>
		</nav>
		<span class="spacer"></span>
		<span class="muted">{me.login} ({me.role})</span>
		<button onclick={revokeAllSessions}>logout all</button>
		<button onclick={doLogout}>logout</button>
		<button onclick={() => (lang = lang === "en" ? "ru" : "en")}>{lang.toUpperCase()}</button>
	{:else}
		<span class="spacer"></span>
		<button onclick={() => (lang = lang === "en" ? "ru" : "en")}>{lang.toUpperCase()}</button>
	{/if}
</header>

<main>
	{#if route === "login"}
		<section class="login">
			<div class="card">
				<h2>login</h2>
				<form
					onsubmit={(e) => {
						e.preventDefault();
						doLogin();
					}}
				>
					<label>login <input bind:value={loginName} autocomplete="username" required /></label>
					<label>password <input type="password" bind:value={loginPass} autocomplete="current-password" required /></label>
					{#if loginErr}<p class="err">{loginErr}</p>{/if}
					<button type="submit" disabled={loginBusy}>{loginBusy ? "..." : "login"}</button>
				</form>
				<details>
					<summary>reset admin password</summary>
					<p class="hint">if you are locked out: stop the container, delete <code>DATA_DIR/lightdb.json</code>, and restart with <code>ADMIN_PASSWORD=...</code> in the env.</p>
				</details>
			</div>
			<aside class="readme">
				<h3>readme</h3>
				{#if readmeMd}
					{@html renderReadme(readmeMd)}
					{#if readmeUrl}<p><a href={readmeUrl} target="_blank" rel="noopener">repo →</a></p>{/if}
				{:else}
					<p class="hint">no README.md next to the server.</p>
				{/if}
			</aside>
		</section>
	{:else if route === "projects"}
		<section>
			<h2>projects</h2>
			{#if me?.role === "admin"}
				<label><input type="checkbox" bind:checked={allUsers} onchange={loadProjects} /> show all users' projects</label>
			{/if}
			<button onclick={createProject}>new project</button>
			{#if projectsErr}<p class="err">{projectsErr}</p>{/if}
			{#if schemes.length === 0}
				<p class="hint">no schemes yet — create a project to begin.</p>
			{:else}
				<table>
					<thead>
						<tr>
							<th>project</th>
							<th>scheme</th>
							<th>edit</th>
							{#if me?.role === "admin" && allUsers}<th>user</th>{/if}
							<th>last edit</th>
							<th>del</th>
						</tr>
					</thead>
					<tbody>
						{#each schemes as s}
							<tr>
								<td>{s.project || "—"}</td>
								<td>{s.name}</td>
								<td>
									<a href={`#/editor/${encodeURIComponent((s.project ? `${s.project}/${s.name}` : s.name))}`}>edit</a>
								</td>
								{#if me?.role === "admin" && allUsers}<td>{s.owner}</td>{/if}
								<td>{new Date(s.updatedAt).toLocaleString()}</td>
								<td><button class="warn mini" onclick={() => deleteProject(s.project ? `${s.project}/${s.name}` : s.name)}>×</button></td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
			<!-- the "edit" links target the server editor route; we use plain anchors so it survives a no-JS browser -->
		</section>
	{:else if route === "users" && me?.role === "admin"}
		<section>
			<h2>users</h2>
			<button onclick={createUser}>new user</button>
			{#if usersErr}<p class="err">{usersErr}</p>{/if}
			<table>
				<thead>
					<tr><th>login</th><th>role</th><th>api keys</th><th>created</th><th>actions</th></tr>
				</thead>
				<tbody>
					{#each users as u}
						<tr>
							<td>{u.login}</td>
							<td>{u.role}</td>
							<td>{u.apiKeys}</td>
							<td>{new Date(u.createdAt).toLocaleDateString()}</td>
							<td>
								<button class="mini" onclick={() => changePassForUser(u.login)}>pass</button>
								<button class="mini" onclick={() => showMcpConfig(u.login)}>mcp</button>
								<button class="mini warn" onclick={() => rotateKey(u.login)}>rotate</button>
								<button class="mini warn" onclick={() => deleteUser(u.id, u.login)}>×</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{:else if route === "settings" && me}
		<section>
			<h2>settings</h2>
			<h3>change password</h3>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					changeOwnPassword();
				}}
			>
				<label>new password <input type="password" bind:value={newPass} /></label>
				<button type="submit">change</button>
			</form>
			{#if meErr}<p class="err">{meErr}</p>{/if}

			<h3>api keys</h3>
			<button onclick={createOwnKey}>new key</button>
			<table>
				<thead><tr><th>hash</th><th>created</th><th></th></tr></thead>
				<tbody>
					{#each keys as k}
						<tr>
							<td><code>{k.hash.slice(0, 12)}…</code></td>
							<td>{new Date(k.createdAt).toLocaleString()}</td>
							<td><button class="warn mini" onclick={() => revokeOwnKey(k.hash)}>revoke</button></td>
						</tr>
					{/each}
				</tbody>
			</table>

			<h3>mcp</h3>
			{#if mcpConfig}
				<pre>{JSON.stringify(mcpConfig, null, 2)}</pre>
			{/if}
		</section>
	{/if}
</main>

<style>
	header {
		display: flex;
		gap: 8px;
		align-items: center;
		padding: 8px 12px;
		background: var(--panel);
		box-shadow: inset 0 -2px 0 var(--dark);
	}
	header .title {
		color: var(--accent);
		font-size: 12px;
	}
	header nav {
		display: flex;
		gap: 6px;
	}
	header .spacer {
		flex: 1;
	}
	main {
		padding: 16px;
	}
	.login {
		display: flex;
		gap: 16px;
		flex-wrap: wrap;
	}
	.login .card,
	.login .readme {
		background: var(--panel);
		box-shadow: inset -2px -2px 0 var(--dark), inset 2px 2px 0 var(--accent);
		padding: 14px;
		flex: 1 1 320px;
	}
	.login form label {
		display: block;
		margin: 8px 0;
	}
	.readme {
		max-height: 70vh;
		overflow: auto;
	}
	.readme pre {
		font-size: 8px;
	}
	table {
		margin: 12px 0;
	}
</style>
