// i18n for the editor and the console — one dictionary, both languages.
// v1 hardcoded the console to Russian and toggled the login language through
// window.__lang (an inline onclick cannot see a script-scope `let`).
export type Lang = "en" | "ru";

export const LANG_KEY = "blm-lang";

export function loadLang(): Lang {
	try {
		return localStorage.getItem(LANG_KEY) === "ru" ? "ru" : "en";
	} catch {
		return "en";
	}
}

export function saveLang(lang: Lang) {
	try {
		localStorage.setItem(LANG_KEY, lang);
	} catch {
		/* private mode: the toggle still works for this session */
	}
}

export const DICT = {
	en: {
		add: "+ node",
		zone: "+ zone",
		connect: "connect",
		del: "delete",
		save: "SAVE",
		saved: "saved",
		saving: "saving…",
		unsaved: "unsaved",
		undo: "undo",
		redo: "redo",
		log: "log",
		auto: "auto layout",
		fit: "fit",
		openLocal: "open local",
		exportLocal: "export",
		patch: "patch to project",
		users: "users",
		projects: "projects",
		logout: "logout",
		keys: "keys",
		grid: "grid",
		snap: "snap",
		gridStep: "grid step",
		label: "label",
		desc: "description",
		shape: "shape",
		refs: "refs (one per line)",
		x: "x",
		y: "y",
		w: "w",
		h: "h",
		edge: "edge",
		node: "node",
		zone2: "zone",
		style: "style",
		from: "from",
		to: "to",
		side: "side",
		labelPos: "caption on",
		warnings: "warnings",
		errors: "errors",
		changes: "changes vs loaded rev",
		connectHint: "connect: click a + port on the source, then a port on the target",
		fixFirst: "FIX ERRORS FIRST:",
		nodesInside: "nodes inside",
		autoSize: "auto-size",
		copied: "copied",
		pasted: "pasted",
		duplicated: "duplicated",
		undone: "undone",
		redone: "redone",
		shortcuts: "shortcuts",
		draftFound: "Unsaved draft found. Restore it?",
		restore: "restore",
		discard: "discard",
		closeWithUnsaved: "You have unsaved changes. Leave anyway?",
	},
	ru: {
		add: "+ нода",
		zone: "+ зона",
		connect: "связь",
		del: "удалить",
		save: "ЗАПИСАТЬ",
		saved: "сохранено",
		saving: "запись…",
		unsaved: "не сохранено",
		undo: "отменить",
		redo: "вернуть",
		log: "журнал",
		auto: "автораскладка",
		fit: "вписать",
		openLocal: "открыть файл",
		exportLocal: "экспорт",
		patch: "выгрузить в проект",
		users: "юзеры",
		projects: "проекты",
		logout: "выйти",
		keys: "ключи",
		grid: "сетка",
		snap: "магнит",
		gridStep: "шаг сетки",
		label: "подпись",
		desc: "описание",
		shape: "форма",
		refs: "refs (по одному в строке)",
		x: "x",
		y: "y",
		w: "ширина",
		h: "высота",
		edge: "ребро",
		node: "узел",
		zone2: "зона",
		style: "стиль",
		from: "из",
		to: "в",
		side: "сторона",
		labelPos: "подпись на",
		warnings: "предупреждения",
		errors: "ошибки",
		changes: "изменения против загруженной ревизии",
		connectHint: "связь: клик по + порту источника, затем по порту цели",
		fixFirst: "СНАЧАЛА ИСПРАВЬ ОШИБКИ:",
		nodesInside: "узлов внутри",
		autoSize: "авторазмер",
		copied: "скопировано",
		pasted: "вставлено",
		duplicated: "дублировано",
		undone: "отменено",
		redone: "возвращено",
		shortcuts: "горячие клавиши",
		draftFound: "Найден несохранённый черновик. Восстановить?",
		restore: "восстановить",
		discard: "отклонить",
		closeWithUnsaved: "Есть несохранённые изменения. Всё равно выйти?",
	},
} as const;

export type Dict = (typeof DICT)["en"];
