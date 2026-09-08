<script lang="ts">
	// console — single Svelte 5 runes component, hash-routed.
	// four screens: #/login, #/projects, #/users, #/settings
	import { onMount } from "svelte";
	import { api, getToken, setToken, confirmDialog, promptDialog } from "./api.ts";
	import { DICT, loadLang, saveLang, type Lang } from "../editor/core/i18n.ts";

	type Screen = "login" | "projects" | "users" | "settings";
	let route: Screen = $state(parseHash());
	let lang: Lang = $state(loadLang());
	const t = $derived(DICT[lang]);

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
	let allUsers = $state(false); // admin toggle, lives in the top bar
	let projectsErr = $state("");

	// --- users state (admin) ---
	let users: { id: number; login: string; role: "admin" | "user"; apiKeys: number; createdAt: string }[] =
		$state([]);
	let usersErr = $state("");

	// --- settings (own password + keys) ---
	let newPass = $state("");
	let myKeys: { hash: string; createdAt: string }[] = $state([]);
	let allKeys: { user: string; hash: string; createdAt: string }[] = $state([]);
	let mcpConfig: { url: string; hasKey: boolean; activeKeys: number; hint: string } | null =
		$state(null);

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
		if (getToken()) {
			try {
				me = await api("/api/me");
			} catch {
				me = null;
			}
		}
		try {
			const r = (await api("/api/readme")) as { markdown: string; url: string };
			readmeMd = r.markdown;
			readmeUrl = r.url;
		} catch {
			/* no readme */
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
		if (!(await confirmDialog(t.logoutAll + "?"))) return;
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
			if (me.role === "admin") {
				allKeys = (await api("/api/admin/keys")) as typeof allKeys;
				users = (await api("/api/users")) as typeof users;
			} else {
				myKeys = (await api("/api/keys")) as typeof myKeys;
			}
			mcpConfig = (await api("/api/mcp-config")) as typeof mcpConfig;
		} catch (e) {
			meErr = (e as Error).message;
		}
	}

	$effect(() => {
		if (route === "projects" && me) loadProjects();
		if (route === "users" && me) loadUsers();
		if (route === "settings" && me) loadSettings();
	});

	// reload the current screen when the "show all users' data" toggle flips
	function onShowAll() {
		if (route === "projects") loadProjects();
		else if (route === "settings") loadSettings();
	}

	// ---------- projects ----------
	async function createScheme() {
		const name = await promptDialog(t.newScheme + " (project/scheme или scheme):");
		if (!name) return;
		try {
			await api("/api/schemes", {
				method: "POST",
				body: JSON.stringify({ name }),
			});
			await loadProjects();
		} catch (e) {
			projectsErr = (e as Error).message;
		}
	}

	async function deleteScheme(name: string) {
		const ok = await confirmDialog(`${t.confirmDeleteScheme} ${name}?`);
		if (!ok) return;
		try {
			await api(`/api/scheme/${encodeURIComponent(name)}`, { method: "DELETE" });
			await loadProjects();
		} catch (e) {
			projectsErr = (e as Error).message;
		}
	}

	// a "project" is a group of schemes sharing the same prefix. Deleting it
	// deletes every scheme in the group (one DELETE per scheme — the store has
	// no bulk endpoint).
	async function deleteProject(project: string) {
		const members = schemes.filter((s) => s.project === project);
		if (!members.length) return;
		const ok = await confirmDialog(`${t.delProject} "${project}" (${members.length} ${t.allProjects})?`);
		if (!ok) return;
		try {
			for (const s of members) {
				await api(`/api/scheme/${encodeURIComponent(s.project ? `${s.project}/${s.name}` : s.name)}`, {
					method: "DELETE",
				});
			}
			await loadProjects();
		} catch (e) {
			projectsErr = (e as Error).message;
		}
	}

	// ---------- users ----------
	async function createUser() {
		const login = await promptDialog(t.login + ":");
		if (!login) return;
		const password = await promptDialog(t.password + ":");
		if (!password) return;
		const role = (await promptDialog(`${t.role} (${t.admin}/${t.userRole}):`, "user")) === "admin"
			? "admin"
			: "user";
		try {
			await api("/api/users", {
				method: "POST",
				body: JSON.stringify({ login, password, role }),
			});
			await loadUsers();
		} catch (e) {
			usersErr = (e as Error).message;
		}
	}

	async function deleteUser(id: number, login: string) {
		if (!(await confirmDialog(`${t.confirmDeleteUser} ${login}?`))) return;
		try {
			await api(`/api/user/${id}`, { method: "DELETE" });
			await loadUsers();
		} catch (e) {
			usersErr = (e as Error).message;
		}
	}

	async function changePassForUser(login: string) {
		const pw = await promptDialog(`${t.newPassword} (${login}):`);
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

	async function changeRole(id: number, role: "admin" | "user") {
		try {
			await api(`/api/user/${id}`, {
				method: "PATCH",
				body: JSON.stringify({ role }),
			});
			await loadUsers();
		} catch (e) {
			usersErr = (e as Error).message;
		}
	}

	// ---------- settings ----------
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
			setToken("");
			me = null;
			go("login");
		} catch (e) {
			meErr = (e as Error).message;
		}
	}

	async function createOwnKey() {
		try {
			const r = (await api("/api/keys", { method: "POST" })) as {
				apiKey: string;
				mcpConfig: unknown;
			};
			alert(`${t.shownOnce}\n\n${r.apiKey}\n\n${JSON.stringify(r.mcpConfig, null, 2)}`);
			await loadSettings();
		} catch (e) {
			meErr = (e as Error).message;
		}
	}

	async function revokeKey(hash: string, login?: string) {
		if (!(await confirmDialog(t.confirmRevoke))) return;
		try {
			await api(`/api/keys/${hash}/revoke`, {
				method: "POST",
				body: JSON.stringify(login ? { login } : {}),
			});
			await loadSettings();
		} catch (e) {
			meErr = (e as Error).message;
		}
	}

	function renderReadme(md: string): string {
		return md
			.split(/\n{2,}/)
			.map((p) => {
				if (p.startsWith("```")) {
					const m = p.match(/^```\w*\n([\s\S]*?)\n```$/);
					return m
						? `<pre>${m[1]!.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!)}</pre>`
						: "";
				}
				if (p.startsWith("# ")) return `<h1>${p.slice(2)}</h1>`;
				if (p.startsWith("## ")) return `<h2>${p.slice(3)}</h2>`;
				if (p.startsWith("### ")) return `<h3>${p.slice(4)}</h3>`;
				return `<p>${p.replace(/\n/g, "<br>")}</p>`;
			})
			.join("\n");
	}

	// unique project names (non-empty) for the "del project" section
	const projectNames = $derived([...new Set(schemes.map((s) => s.project).filter(Boolean))]);
</script>

<header class="topbar">
	<span class="title">llmscheme</span>
	{#if me}
		<nav>
			<button class:on={route === "projects"} onclick={() => go("projects")}>{t.projects}</button>
			{#if me.role === "admin"}<button class:on={route === "users"} onclick={() => go("users")}>{t.users}</button>{/if}
			<button class:on={route === "settings"} onclick={() => go("settings")}>{t.settings}</button>
		</nav>
		<span class="spacer"></span>
		{#if me.role === "admin"}
			<label class="showall">
				<input type="checkbox" bind:checked={allUsers} onchange={onShowAll} /> {t.showAll}
			</label>
		{/if}
		<span class="muted">{me.login} ({me.role})</span>
		<button onclick={revokeAllSessions}>{t.logoutAll}</button>
		<button onclick={doLogout}>{t.logout}</button>
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
				<h2>{t.login}</h2>
				<form
					onsubmit={(e) => {
						e.preventDefault();
						doLogin();
					}}
				>
					<label>{t.login} <input bind:value={loginName} autocomplete="username" required /></label>
					<label>{t.password} <input type="password" bind:value={loginPass} autocomplete="current-password" required /></label>
					{#if loginErr}<p class="err">{loginErr}</p>{/if}
					<button type="submit" disabled={loginBusy}>{loginBusy ? "..." : t.login}</button>
				</form>
				<details>
					<summary>{t.resetAdmin}</summary>
					<p class="hint">{t.resetHint}</p>
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
			<h2>{t.projects}</h2>
			<button onclick={createScheme}>{t.newScheme}</button>
			{#if projectsErr}<p class="err">{projectsErr}</p>{/if}

			{#if projectNames.length}
				<h3>{t.delProject}</h3>
				{#each projectNames as p}
					<span class="project-chip">
						{p}
						<button class="warn mini" onclick={() => deleteProject(p)}>×</button>
					</span>
				{/each}
			{/if}

			{#if schemes.length === 0}
				<p class="hint">{t.noSchemes}</p>
			{:else}
				<table>
					<thead>
						<tr>
							<th>{t.projects}</th>
							<th>scheme</th>
							<th>{t.edit}</th>
							{#if me?.role === "admin" && allUsers}<th>{t.ownedBy}</th>{/if}
							<th>{t.lastEdit}</th>
							<th>{t.delScheme}</th>
						</tr>
					</thead>
					<tbody>
						{#each schemes as s}
							<tr>
								<td>{s.project || "—"}</td>
								<td>{s.name}</td>
								<td>
									<a href={`/editor/${encodeURIComponent(s.project ? `${s.project}/${s.name}` : s.name)}`}>{t.edit}</a>
								</td>
								{#if me?.role === "admin" && allUsers}<td>{s.owner}</td>{/if}
								<td>{new Date(s.updatedAt).toLocaleString()}</td>
								<td>
									<button class="warn mini" onclick={() => deleteScheme(s.project ? `${s.project}/${s.name}` : s.name)}>×</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>
	{:else if route === "users" && me?.role === "admin"}
		<section>
			<h2>{t.users}</h2>
			<button onclick={createUser}>{t.newUser}</button>
			{#if usersErr}<p class="err">{usersErr}</p>{/if}
			<table>
				<thead>
					<tr><th>{t.login}</th><th>{t.password}</th><th>{t.role}</th><th></th></tr>
				</thead>
				<tbody>
					{#each users as u}
						<tr>
							<td>{u.login}</td>
							<td><button class="mini" onclick={() => changePassForUser(u.login)}>{t.changePassword}</button></td>
							<td>
								<select
									value={u.role}
									onchange={(e) => changeRole(u.id, (e.currentTarget as HTMLSelectElement).value as "admin" | "user")}
								>
									<option value="user">{t.userRole}</option>
									<option value="admin">{t.admin}</option>
								</select>
							</td>
							<td><button class="warn mini" onclick={() => deleteUser(u.id, u.login)}>×</button></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{:else if route === "settings" && me}
		<section>
			<h2>{t.settings}</h2>

			<h3>{t.changePassword}</h3>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					changeOwnPassword();
				}}
			>
				<label>{t.newPassword} <input type="password" bind:value={newPass} /></label>
				<button type="submit">{t.change}</button>
			</form>
			{#if meErr}<p class="err">{meErr}</p>{/if}

			<h3>{t.keys}</h3>
			{#if me.role === "admin"}
				<!-- admin: every user's keys, each with its MCP target -->
				{#if allKeys.length === 0}
					<p class="hint">{t.noKeys}</p>
				{:else}
					<table>
						<thead>
							<tr><th>{t.login}</th><th>key</th><th>{t.created}</th><th>mcp</th><th></th></tr>
						</thead>
						<tbody>
							{#each allKeys as k}
								<tr>
									<td>{k.user}</td>
									<td><code>{k.hash.slice(0, 12)}…</code></td>
									<td>{new Date(k.createdAt).toLocaleString()}</td>
									<td>{mcpConfig?.url ?? "/mcp"}</td>
									<td><button class="warn mini" onclick={() => revokeKey(k.hash, k.user)}>{t.revoke}</button></td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			{:else}
				<!-- regular user: only their own keys -->
				<button onclick={createOwnKey}>{t.newKey}</button>
				{#if myKeys.length === 0}
					<p class="hint">{t.noKeys}</p>
				{:else}
					<table>
						<thead><tr><th>key</th><th>{t.created}</th><th></th></tr></thead>
						<tbody>
							{#each myKeys as k}
								<tr>
									<td><code>{k.hash.slice(0, 12)}…</code></td>
									<td>{new Date(k.createdAt).toLocaleString()}</td>
									<td><button class="warn mini" onclick={() => revokeKey(k.hash)}>{t.revoke}</button></td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			{/if}

			<h3>{t.mcp}</h3>
			{#if mcpConfig}
				<pre>{JSON.stringify(mcpConfig, null, 2)}</pre>
			{/if}
		</section>
	{/if}
</main>
