<script lang="ts">
	// console — single Svelte 5 runes component, hash-routed.
	// four screens: #/login, #/projects, #/users, #/settings
	import { onMount } from "svelte";
	import {
		api,
		getToken,
		setToken,
		confirmDialog,
		promptDialog,
		chooseDialog,
		infoDialog,
		keyDialog,
	} from "./api.ts";
	import { DICT, loadLang, saveLang, type Lang } from "../editor/core/i18n.ts";

	type Screen = "login" | "projects" | "users" | "settings";
	interface SchemeSummary {
		owner?: string;
		project: string;
		name: string;
		rev: number;
		nodes: number;
		edges: number;
		updatedAt: string;
	}
	interface UserRow {
		id: number;
		login: string;
		role: "admin" | "user";
		apiKeys: number;
		createdAt: string;
	}
	interface KeyRow {
		user: string;
		hash: string;
		createdAt: string;
	}

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
	let schemes: SchemeSummary[] = $state([]);
	let allUsers = $state(false); // admin toggle, lives in the top bar
	let projectsErr = $state("");

	// --- users state (admin) ---
	let users: UserRow[] = $state([]);
	let usersErr = $state("");

	// --- settings (own password + keys) ---
	let curPass = $state("");
	let newPass = $state("");
	let myKeys: { hash: string; createdAt: string }[] = $state([]);
	let allKeys: KeyRow[] = $state([]);
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
			schemes = (await api(url)) as SchemeSummary[];
			projectsErr = "";
		} catch (e) {
			projectsErr = (e as Error).message;
		}
	}

	async function loadUsers() {
		if (!me || me.role !== "admin") return;
		try {
			users = (await api("/api/users")) as UserRow[];
			usersErr = "";
		} catch (e) {
			usersErr = (e as Error).message;
		}
	}

	async function loadSettings() {
		if (!me) return;
		try {
			if (me.role === "admin") {
				allKeys = (await api("/api/admin/keys")) as KeyRow[];
				users = (await api("/api/users")) as UserRow[];
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

	const fullName = (s: SchemeSummary): string => (s.project ? `${s.project}/${s.name}` : s.name);

	// groups: one entry per project ("" = schemes without a project, shown last)
	const projectGroups = $derived.by(() => {
		const map = new Map<string, SchemeSummary[]>();
		for (const s of schemes) {
			const key = s.project || "";
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(s);
		}
		const groups = [...map.entries()].map(([project, items]) => ({ project, items }));
		groups.sort((a, b) =>
			a.project === "" ? 1 : b.project === "" ? -1 : a.project.localeCompare(b.project),
		);
		return groups;
	});

	// ---------- projects ----------
	async function createProject() {
		const name = await promptDialog(`${t.newName} (${t.projectWord}):`);
		if (!name) return;
		try {
			// a project is a name prefix; give it a conventional first scheme
			await api("/api/schemes", {
				method: "POST",
				body: JSON.stringify({ name: `${name}/main` }),
			});
			await loadProjects();
		} catch (e) {
			projectsErr = (e as Error).message;
		}
	}

	async function createScheme(project: string) {
		const name = await promptDialog(`${t.newName} (${t.schemeWord}):`);
		if (!name) return;
		const full = project ? `${project}/${name}` : name;
		try {
			await api("/api/schemes", {
				method: "POST",
				body: JSON.stringify({ name: full }),
			});
			await loadProjects();
		} catch (e) {
			projectsErr = (e as Error).message;
		}
	}

	async function renameScheme(from: string) {
		const to = await promptDialog(`${t.newName}:`, from);
		if (!to || to === from) return;
		try {
			await api(`/api/scheme/${encodeURIComponent(from)}/rename`, {
				method: "POST",
				body: JSON.stringify({ to }),
			});
			await loadProjects();
		} catch (e) {
			projectsErr = (e as Error).message;
		}
	}

	async function duplicateScheme(from: string) {
		const to = await promptDialog(`${t.newName}:`, `${from}-copy`);
		if (!to) return;
		try {
			await api(`/api/scheme/${encodeURIComponent(from)}/duplicate`, {
				method: "POST",
				body: JSON.stringify({ to }),
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

	async function renameProject(from: string) {
		const to = await promptDialog(`${t.newName} (${t.projectWord}):`, from);
		if (!to || to === from) return;
		try {
			for (const s of schemes.filter((x) => x.project === from)) {
				await api(`/api/scheme/${encodeURIComponent(`${from}/${s.name}`)}/rename`, {
					method: "POST",
					body: JSON.stringify({ to: `${to}/${s.name}` }),
				});
			}
			await loadProjects();
		} catch (e) {
			projectsErr = (e as Error).message;
		}
	}

	async function duplicateProject(from: string) {
		const to = await promptDialog(`${t.newName} (${t.projectWord}):`, `${from}-copy`);
		if (!to) return;
		try {
			for (const s of schemes.filter((x) => x.project === from)) {
				await api(`/api/scheme/${encodeURIComponent(`${from}/${s.name}`)}/duplicate`, {
					method: "POST",
					body: JSON.stringify({ to: `${to}/${s.name}` }),
				});
			}
			await loadProjects();
		} catch (e) {
			projectsErr = (e as Error).message;
		}
	}

	async function deleteProject(project: string) {
		const members = schemes.filter((s) => s.project === project);
		if (!members.length) return;
		const ok = await confirmDialog(`${t.delProject} "${project}" (${members.length})?`);
		if (!ok) return;
		try {
			for (const s of members) {
				await api(`/api/scheme/${encodeURIComponent(`${project}/${s.name}`)}`, {
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
		const login = await promptDialog(`${t.login}:`);
		if (!login) return;
		const password = await promptDialog(`${t.password}:`);
		if (!password) return;
		const role = await chooseDialog(t.role, [
			{ value: "user", label: t.userRole },
			{ value: "admin", label: t.admin },
		]);
		if (!role) return;
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
				body: JSON.stringify({ current: curPass, password: newPass }),
			});
			setToken("");
			me = null;
			go("login");
		} catch (e) {
			meErr = (e as Error).message;
		}
	}

	// issue a key for `login` (admin) or for self (no login). The secret and the
	// mcp schema are shown once, each in its own field — keys are hashed at rest.
	async function generateKey(login?: string) {
		try {
			const r = (await api("/api/keys", {
				method: "POST",
				body: login ? JSON.stringify({ login }) : undefined,
			})) as { apiKey: string; mcpConfig: unknown };
			await keyDialog(
				t.shownOnce,
				t.apiKey,
				r.apiKey,
				t.mcpSchema,
				JSON.stringify(r.mcpConfig, null, 2),
			);
			await loadSettings();
		} catch (e) {
			meErr = (e as Error).message;
		}
	}

	// the raw secret cannot be re-shown (hashed at rest) — only the schema shape.
	function showMcpSchema(login: string) {
		const url = mcpConfig?.url ?? "/mcp";
		const schema = JSON.stringify(
			{
				mcpServers: {
					llmscheme: { url, headers: { "X-Api-Key": `(${t.keySecretNote})` } },
				},
			},
			null,
			2,
		);
		void infoDialog(`${t.showMcpSchema} — ${login}`, schema);
	}

	async function revokeKey(hash: string, login?: string) {
		if (!(await confirmDialog(t.confirmRevoke))) return;
		try {
			await api(`/api/keys/${hash}/revoke`, {
				method: "POST",
				body: login ? JSON.stringify({ login }) : undefined,
			});
			await loadSettings();
		} catch (e) {
			meErr = (e as Error).message;
		}
	}

	const keysFor = (login: string): KeyRow[] => allKeys.filter((k) => k.user === login);

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
			<button onclick={createProject}>{t.newProject}</button>
			{#if projectsErr}<p class="err">{projectsErr}</p>{/if}

			{#if schemes.length === 0}
				<p class="hint">{t.noSchemes}</p>
			{/if}

			{#each projectGroups as g (g.project || "__bare__")}
				<div class="project-block">
					<div class="project-head">
						<span class="project-name">{g.project || t.noProject}</span>
						<button class="mini" onclick={() => createScheme(g.project)}>{t.newScheme}</button>
						{#if g.project}
							<button class="mini" onclick={() => renameProject(g.project)}>{t.rename}</button>
							<button class="mini" onclick={() => duplicateProject(g.project)}>{t.duplicate}</button>
							<button class="mini warn" onclick={() => deleteProject(g.project)}>{t.delProject}</button>
						{/if}
					</div>
					<table>
						<thead>
							<tr>
								<th>{t.schemeWord}</th>
								<th>rev</th>
								<th>{t.lastEdit}</th>
								{#if me?.role === "admin" && allUsers}<th>{t.ownedBy}</th>{/if}
								<th></th>
							</tr>
						</thead>
						<tbody>
							{#each g.items as s (fullName(s))}
								<tr>
									<td>{s.name}</td>
									<td>{s.rev}</td>
									<td>{new Date(s.updatedAt).toLocaleString()}</td>
									{#if me?.role === "admin" && allUsers}<td>{s.owner}</td>{/if}
									<td class="row-actions">
										<a class="mini-link" href={`/editor/${encodeURIComponent(fullName(s))}`}>{t.edit}</a>
										<button class="mini" onclick={() => renameScheme(fullName(s))}>{t.rename}</button>
										<button class="mini" onclick={() => duplicateScheme(fullName(s))}>{t.duplicate}</button>
										<button class="mini warn" onclick={() => deleteScheme(fullName(s))}>{t.delScheme}</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/each}
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
					{#each users as u (u.id)}
						<tr>
							<td>{u.login}</td>
							<td><button class="mini" onclick={() => changePassForUser(u.login)}>{t.changePassword}</button></td>
							<td>
								<span class="seg">
									<button class:on={u.role === "user"} onclick={() => changeRole(u.id, "user")}>{t.userRole}</button>
									<button class:on={u.role === "admin"} onclick={() => changeRole(u.id, "admin")}>{t.admin}</button>
								</span>
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
				<label>{t.currentPassword} <input type="password" bind:value={curPass} /></label>
				<label>{t.newPassword} <input type="password" bind:value={newPass} /></label>
				<button type="submit">{t.change}</button>
			</form>
			{#if meErr}<p class="err">{meErr}</p>{/if}

			<h3>{t.keys}</h3>
			{#if me.role === "admin"}
				<!-- admin: every user, their keys, and per-key mcp/revoke -->
				{#each users as u (u.id)}
					<div class="keys-block">
						<div class="project-head">
							<span class="project-name">{u.login}</span>
							<button class="mini" onclick={() => generateKey(u.login)}>{t.generateKey}</button>
						</div>
						{#if keysFor(u.login).length === 0}
							<p class="hint">{t.noKeys}</p>
						{:else}
							<table>
								<thead><tr><th>key</th><th>{t.created}</th><th></th></tr></thead>
								<tbody>
									{#each keysFor(u.login) as k (k.hash)}
										<tr>
											<td><code>{k.hash.slice(0, 12)}…</code></td>
											<td>{new Date(k.createdAt).toLocaleString()}</td>
											<td class="row-actions">
												<button class="mini" onclick={() => showMcpSchema(u.login)}>{t.showMcpSchema}</button>
												<button class="mini warn" onclick={() => revokeKey(k.hash, u.login)}>{t.revoke}</button>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						{/if}
					</div>
				{/each}
			{:else}
				<!-- regular user: only their own keys -->
				<button onclick={() => generateKey()}>{t.newKey}</button>
				{#if myKeys.length === 0}
					<p class="hint">{t.noKeys}</p>
				{:else}
					<table>
						<thead><tr><th>key</th><th>{t.created}</th><th></th></tr></thead>
						<tbody>
							{#each myKeys as k (k.hash)}
								<tr>
									<td><code>{k.hash.slice(0, 12)}…</code></td>
									<td>{new Date(k.createdAt).toLocaleString()}</td>
									<td class="row-actions">
										<button class="mini" onclick={() => showMcpSchema(me?.login ?? "")}>{t.showMcpSchema}</button>
										<button class="mini warn" onclick={() => revokeKey(k.hash)}>{t.revoke}</button>
									</td>
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
