// fetch wrapper for the console. One place to handle auth (401 → login) and
// the common case of "the response is JSON, may carry an error".
import { loadLang } from "../editor/core/i18n.ts";

const TOKEN_KEY = "llmscheme-token";

// dialog labels follow the console language (loadLang reads localStorage, which
// the console's $effect keeps in sync with the active lang).
const labels = () => {
	const ru = loadLang() === "ru";
	return {
		ok: ru ? "ок" : "OK",
		cancel: ru ? "отмена" : "cancel",
		confirm: ru ? "подтверждение" : "confirm",
		input: ru ? "ввод" : "input",
		choose: ru ? "выбор" : "choose",
		copy: ru ? "копировать" : "copy",
		copied: ru ? "скопировано" : "copied",
	};
};

export function getToken(): string {
	try {
		return localStorage.getItem(TOKEN_KEY) ?? "";
	} catch {
		return "";
	}
}

export function setToken(t: string) {
	try {
		if (t) localStorage.setItem(TOKEN_KEY, t);
		else localStorage.removeItem(TOKEN_KEY);
	} catch {
		/* private mode: in-memory only */
	}
}

export interface ApiError extends Error {
	status: number;
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
	const headers = new Headers(init.headers);
	if (!headers.has("content-type") && init.body && typeof init.body === "string")
		headers.set("content-type", "application/json");
	const tok = getToken();
	if (tok) headers.set("Authorization", `Bearer ${tok}`);
	const r = await fetch(path, { ...init, headers });
	if (r.status === 401) {
		setToken("");
		// the caller decides whether to bounce to /#/login; we just rethrow
		const e = new Error("auth required") as ApiError;
		e.status = 401;
		throw e;
	}
	if (!r.ok) {
		const text = (await r.text()).slice(0, 300);
		const e = new Error(`${r.status}: ${text || r.statusText}`) as ApiError;
		e.status = r.status;
		throw e;
	}
	// 204 No Content
	if (r.status === 204) return undefined as T;
	const ct = r.headers.get("content-type") ?? "";
	if (ct.includes("application/json")) return (await r.json()) as T;
	return (await r.text()) as T;
}

// confirm dialog — replaces window.confirm() with a single, themed flow
export function confirmDialog(message: string, confirmLabel?: string): Promise<boolean> {
	return new Promise((resolve) => {
		const L = labels();
		const dlg = document.createElement("dialog");
		const form = document.createElement("form");
		form.method = "dialog";
		const h3 = document.createElement("h3");
		h3.textContent = L.confirm;
		const p = document.createElement("p");
		p.textContent = message;
		const menu = document.createElement("menu");
		const cancel = document.createElement("button");
		cancel.value = "cancel";
		cancel.textContent = L.cancel;
		const ok = document.createElement("button");
		ok.value = "ok";
		ok.textContent = confirmLabel ?? L.ok;
		ok.autofocus = true;
		menu.append(cancel, ok);
		form.append(h3, p, menu);
		dlg.append(form);
		document.body.appendChild(dlg);
		dlg.addEventListener("close", () => {
			const accepted = dlg.returnValue === "ok";
			dlg.remove();
			resolve(accepted);
		});
		dlg.showModal();
	});
}

export function promptDialog(message: string, defaultValue = ""): Promise<string | null> {
	return new Promise((resolve) => {
		const L = labels();
		const dlg = document.createElement("dialog");
		const form = document.createElement("form");
		form.method = "dialog";
		const h3 = document.createElement("h3");
		h3.textContent = L.input;
		const p = document.createElement("p");
		p.textContent = message;
		const input = document.createElement("input");
		input.name = "x";
		input.value = defaultValue;
		input.autofocus = true;
		const menu = document.createElement("menu");
		const cancel = document.createElement("button");
		cancel.value = "cancel";
		cancel.textContent = L.cancel;
		const ok = document.createElement("button");
		ok.value = "ok";
		ok.textContent = L.ok;
		menu.append(cancel, ok);
		form.append(h3, p, input, menu);
		dlg.append(form);
		document.body.appendChild(dlg);
		dlg.addEventListener("close", () => {
			const accepted = dlg.returnValue === "ok";
			const v = accepted ? input.value : null;
			dlg.remove();
			resolve(v);
		});
		dlg.showModal();
	});
}

// choose one of a set of buttons (e.g. role). Returns the chosen value, or null on cancel.
export function chooseDialog(
	message: string,
	options: { value: string; label: string }[],
	defaultIndex = 0,
): Promise<string | null> {
	return new Promise((resolve) => {
		const L = labels();
		const dlg = document.createElement("dialog");
		const form = document.createElement("form");
		form.method = "dialog";
		const h3 = document.createElement("h3");
		h3.textContent = L.choose;
		const p = document.createElement("p");
		p.textContent = message;
		const menu = document.createElement("menu");
		const cancel = document.createElement("button");
		cancel.value = "cancel";
		cancel.textContent = L.cancel;
		menu.append(cancel);
		for (const [i, opt] of options.entries()) {
			const b = document.createElement("button");
			b.value = opt.value;
			b.textContent = opt.label;
			if (i === defaultIndex) b.autofocus = true;
			menu.append(b);
		}
		form.append(h3, p, menu);
		dlg.append(form);
		document.body.appendChild(dlg);
		dlg.addEventListener("close", () => {
			const v = dlg.returnValue && dlg.returnValue !== "cancel" ? dlg.returnValue : null;
			dlg.remove();
			resolve(v);
		});
		dlg.showModal();
	});
}

// single-OK info dialog (e.g. "key + mcp schema shown once")
export function infoDialog(title: string, message: string): Promise<void> {
	return new Promise((resolve) => {
		const L = labels();
		const dlg = document.createElement("dialog");
		const form = document.createElement("form");
		form.method = "dialog";
		const h3 = document.createElement("h3");
		h3.textContent = title;
		const pre = document.createElement("pre");
		pre.textContent = message;
		const menu = document.createElement("menu");
		const ok = document.createElement("button");
		ok.value = "ok";
		ok.textContent = L.ok;
		ok.autofocus = true;
		menu.append(ok);
		form.append(h3, pre, menu);
		dlg.append(form);
		document.body.appendChild(dlg);
		dlg.addEventListener("close", () => {
			dlg.remove();
			resolve();
		});
		dlg.showModal();
	});
}

// a new api key is shown in its OWN field, the generated mcp schema in another.
// Each field gets a copy button so the secret can be grabbed without selecting.
export function keyDialog(
	title: string,
	keyLabel: string,
	apiKey: string,
	mcpLabel: string,
	mcpJson: string,
): Promise<void> {
	return new Promise((resolve) => {
		const L = labels();
		const dlg = document.createElement("dialog");
		const form = document.createElement("form");
		form.method = "dialog";
		const h3 = document.createElement("h3");
		h3.textContent = title;

		const field = (label: string, value: string, mono: boolean) => {
			const wrap = document.createElement("div");
			wrap.className = "keyfield";
			const lbl = document.createElement("div");
			lbl.className = "keyfield-label";
			lbl.textContent = label;
			const row = document.createElement("div");
			row.className = "keyfield-row";
			const box = document.createElement(mono ? "pre" : "input");
			if (mono) {
				box.textContent = value;
				(box as HTMLPreElement).className = "keyfield-value";
			} else {
				(box as HTMLInputElement).value = value;
				(box as HTMLInputElement).readOnly = true;
				(box as HTMLInputElement).className = "keyfield-value";
			}
			const copy = document.createElement("button");
			copy.type = "button";
			copy.textContent = L.copy;
			copy.className = "mini";
			copy.onclick = () => {
				void navigator.clipboard?.writeText(value).catch(() => {});
				copy.textContent = L.copied;
			};
			row.append(box, copy);
			wrap.append(lbl, row);
			return wrap;
		};

		form.append(h3, field(keyLabel, apiKey, false), field(mcpLabel, mcpJson, true));
		const menu = document.createElement("menu");
		const ok = document.createElement("button");
		ok.value = "ok";
		ok.textContent = L.ok;
		ok.autofocus = true;
		menu.append(ok);
		form.append(menu);
		dlg.append(form);
		document.body.appendChild(dlg);
		dlg.addEventListener("close", () => {
			dlg.remove();
			resolve();
		});
		dlg.showModal();
	});
}
