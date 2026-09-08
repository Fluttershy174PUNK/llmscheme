# PLAN.md — llmscheme v2: единый план (структура · UI · функционал)

> Составлен после полного аудита v1: код прочитан, сервис поднят локально, все
> баги воспроизведены (curl + puppeteer), UI-схема `UI/page` скачана с live
> в `schemes/UI-page.json` (rev 2, 35 узлов, 8 зон). Ресерч: спека MCP
> `2026-07-28` (финал с 28.07.2026), MCP best practices, Node LTS/EOL,
> ротация api-ключей, offline-first автосейв, Svelte 5 runes.

---

## 0. Решения владельца (зафиксированы)

| # | решение |
|---|---|
| R1 | Ядро — прямо из `.ts` под Node ≥ 22.18 (native type-stripping). `core.mjs`-бандлы удаляются. |
| R2 | Скилл самодостаточный и офлайновый: скачал с гита → работает. Verbatim-копия ядра + скрипт синхронизации. |
| R3 | UI (логин + консоль + редактор) — single-file HTML, **один** скрипт сборки на три входа. Шаблонные строки в сервере удаляются. |
| R4 | Структура: `/src` + `/skill` + `/mcp-service` + `/plugin`, минималистично. |
| R5 | v1 → `../llmscheme-v1/` (без `.git`), история и remote остаются здесь, корень = чистый v2. |
| R6 | Автосейв = черновик в localStorage + явный SAVE на сервер. `rev` растёт только на SAVE → CAS агента не ломается. |
| R7 | Hotkeys: стандартный набор редактора + рамка-выделение + zoom-индикатор + `beforeunload`. |
| R8 | MCP dual-era: legacy `initialize` + современный `2026-07-28` (`server/discover`, `MCP-Protocol-Version`, `_meta`), `annotations`, валидация `Origin`. |
| R9 | Сброс токена и регенерация MCP-ключа — только явный POST + подтверждение в UI. **GET ничего не меняет.** |
| R10 | «patch to project» (n35): кнопка выдаёт команду + новая `block.mjs pull --url --key --name` (единственная сетевая команда скилла). |
| R11 | Реализуем все фичи UI-схемы `UI/page`, включая n35. |
| R12 | Мусор чистим; формат данных на диске не меняется → live-сервис переезжает без миграции. |
| R13 | Тулчейн сборки UI: **esbuild + `svelte/compiler`** (vite, rolldown, lightningcss, vite-plugin-singlefile уходят). Бюджет HTML: **200 КБ** editor, **80 КБ** console. |
| R14 | Редактор = общее ядро + два входа: **`src/editor/core`** (канвас, инспектор, палитра, undo/redo, hotkeys, автосейв, i18n — ~95 % кода), **`src/editor/skill`** (офлайн-версия), **`src/editor/service`** (серверная версия). |

Рантайм-зависимостей нет нигде: сервис и CLI работают прямо из `.ts` (Node ≥ 22.18,
native type-stripping, без warning'ов — проверено), скилл автономный
(`clone` → `node skill/block.mjs …`). Сборка нужна только для трёх HTML-артефактов.

---

## 1. Тулчейн (R13): что и почему

Выбрано: **esbuild + `svelte/compiler`**. Сравнение, измеренное локально:

| | v1 (факт) | **A: esbuild + svelte/compiler — ВЫБРАНО** | B: vite | C: vanilla TS |
|---|---|---|---|---|
| dev-зависимостей | 8 | **2** (`svelte`, `esbuild`) | 8 | 0 (+`typescript`) |
| `node_modules` | 117 МБ | **~50 МБ** | 117 МБ (rolldown 37 + lightningcss 19) | ~12 МБ |
| editor.html | 111 КБ (в git лежала отформатированная руками копия 167 КБ → 2 теста падали) | **135 КБ** — PoC собран и проверен в браузере: монтируется, 0 ошибок | 111 КБ | ~66 КБ (оценка) |
| сборка | vite + esbuild, 2 артефакта ядра | **один скрипт ~60 строк** | vite multi-entry | один скрипт ~40 строк |
| Node в рантайме | ≥ 20 (EOL 30.04.2026) | **≥ 22.18** | ≥ 22.18 | ≥ 22.18 |

Факты, определившие выбор:

- `node:module.stripTypeScriptTypes()` — stdlib-API (release candidate) — делает
  то, за что в v1 платили esbuild'ом для сервера/CLI. Ядро: 10 из 11 файлов
  стрипаются уже сейчас, 11-й ждёт патча parameter properties (фаза 1.1).
- Прямой `import './x.ts'` под Node 22.22 идёт **без ExperimentalWarning** —
  для CLI это важно (иначе шум в выводе агента).
- Node 20 достиг EOL **30 апреля 2026** (сегодня 8 сентября) — требование v1
  «Node ≥ 20» устарело само по себе.
- Браузер не умеет `.ts`/`.svelte` → сборка нужна только для editor.html и
  console.html. Всё остальное (сервис, CLI, тесты) бандлер не нужен.
- esbuild минифицирует Svelte-runtime хуже rolldown (104 КБ JS против 80 КБ,
  `define: process.env.NODE_ENV="production"` не помогает) — отсюда 135 КБ
  против 111 КБ. Поэтому бюджет поднимаем до **200 КБ**: он произвольный
  (single-file HTML для десктопа, не мобильная страница), а запас нужен под
  фичи v2 (redo, drag-select, hotkeys-панель, автосейв ≈ +10–20 КБ).

Сборка v2 (`src/build/build.ts`, ~60 строк): `svelte/compiler` → JS+CSS по
компонентам, esbuild бандлит **три входа** — `editor/skill` (woff2 → base64
inline), `editor/service` и `console` (woff2 → отдельный `/assets/*.woff2`).
На выходе — три single-file HTML (см. 2.1). Никаких vite-плагинов, rolldown,
lightningcss.

---

## 2. Структура v2

```
llmscheme/
  PLAN.md README.md PROJECT.md LICENSE
  src/                       ← ИСТОЧНИКИ (единственное место правок)
    core/                    ← ядро: types validate ids layout diff export save jail git render
                               чистый .ts, ноль зависимостей, без enum/parameter properties
    cli/                     ← block.ts: init get node edge zone put sync diff doctor history pull
    service/                 ← server.ts + lib/{http,auth,store,routes,mcp,pages}.ts
    console/                 ← Svelte-консоль: login/ projects/ users/ settings/ mcp/
    editor/
      core/                  ← ОБЩЕЕ: canvas/ inspector/ palette/ toolbar/ status/ hotkeys/
                               autosave/ i18n/ (95 % кода редактора)
      skill/                 ← вход офлайн-версии: PRISTINE_HTML (самопересборка), тиры A/B/C,
                               open-local, export, patch-to-project; НЕТ кода /api/
      service/               ← вход серверной версии: tier S (PUT /api/scheme), log-панель,
                               навигация /admin·users·logout; НЕТ PRISTINE/FSA
    ui/                      ← tokens.css + pixel.css (палитра и шрифт ОДИН раз на всё)
    build/                   ← build.ts (3 входа), sync-skill.ts, check.ts
    test/                    ← unit: ядро, CLI, service-lib (node --test)
  skill/                     ← АРТЕФАКТ: core/ (verbatim .ts), block.mjs, editor.html,
                               SKILL.md, references/, .manifest.json (sha256)
  mcp-service/               ← АРТЕФАКТ: Dockerfile, docker-compose.yml, .env.example, README,
                               editor.html + console.html + assets/*.woff2
                               (код НЕ копируется: контейнер запускает src/ напрямую)
  plugin/                    ← hermes-плагин поверх того же ядра (в v1 — заглушка без plugin.mjs)
  e2e/                       ← браузерные e2e (puppeteer)
  demo/                      ← демо-проект «генератор котиков» (БЕЗ cache/)
  docs/                      ← MIGRATION.md, SCHEME_FORMAT.md, EDITOR.md, LOGIN.md
  schemes/UI-page.json       ← живая UI-схема = источник требований (вместо «schemes-backup»)
  .github/workflows/ci.yml   ← typecheck → test → build → check → поднять сервис → e2e (фаза 1)
  .gitattributes             ← артефакты: linguist-generated -diff
  biome.json                 ← генерируемые файлы ИСКЛЮЧЕНЫ из форматтера
```

### 2.1 Артефакты сборки: где живут и почему

Три входа → три HTML. Собранное **лежит в git** — это осознанно: только так
скилл самодостаточен (R2: clone → работает, без `npm install` и без сети) и
tолько так docker-образ строится офлайн (Dockerfile ничего не собирает).

| артефакт | шрифт | размер (оценка) | почему так |
|---|---|---|---|
| `skill/editor.html` | base64 inline | ~135 КБ | `file://` не может fetch'нуть соседний файл (NetworkError — проверенный факт) → self-contained обязателен |
| `mcp-service/editor.html` | `/assets/*.woff2` | ~107 КБ | отдаётся по http → шрифт кэшируется браузером, HTML тоньше |
| `mcp-service/console.html` | `/assets/*.woff2` | ~30 КБ | то же |

Защита от бага B1 (в v1 форматтер прошёлся по сгенерированному HTML и раздул
его со 111 до 167 КБ → бюджет лопнул, 2 теста упали):

- `.gitattributes`: `skill/editor.html`, `mcp-service/*.html` → `linguist-generated -diff`;
- `biome.json` / ignore форматтера: те же пути исключены;
- `npm run check` в CI: пересобирает все три входа и сверяет **байты** с git +
  сверяет sha256 `skill/core/*.ts` с `src/core/*.ts` → ни дрейфа, ни ручных
  правок артефакта.

Структура делает правила самоочевидными: `src/` правим · `skill/` генерится и
сверяется по хэшам · `mcp-service/` только деплой-обвязка · `schemes/` —
требования. Шесть пунктов «золотых правил» PROJECT.md v1 сокращаются до двух.

---

### 2.2 Как редактор работает в рантайме (механика)

`skill/editor.html` — **шаблон с пустой схемой** (`{}`), он не является ничьей
схемой. Данные подставляются в момент записи CLI:

```
block.mjs node add --label "Auth"
  → saveSchema()
      .block_llm/scheme.json   ← данные (rev+1, атомарно tmp+rename, CAS, бэкап, журнал)
      SCHEME.md                ← экспорт (mermaid + таблицы)
      .block_llm/scheme.html   ← editor.html + JSON схемы в <script id="scheme-data">
```

Человек двойным кликом открывает `.block_llm/scheme.html` → видит свою схему.
Без Node, без сервера, без сети. Внутри — **то же ядро** `src/core` (валидация,
выдача id, layout, mermaid), поэтому браузер и агент согласны по построению
(главный инвариант проекта).

SAVE из браузера — четыре тира (v1-механика сохраняется):

| тир | условие | действие |
|---|---|---|
| **A** | всегда, любой браузер | в буфер кладётся готовая команда `block.mjs put - --rev N <<'EOF' …` + diff «что изменилось против загруженной ревизии» → человек отдаёт агенту |
| **B** | Chromium (`showSaveFilePicker`) | прямая запись `scheme.json` + `SCHEME.md` + `scheme.html` на диск |
| **C** | Firefox (FSA нет) | скачать файл → `block.mjs sync --from FILE` |
| **S** | редактор отдан **сервисом** по http | `PUT /api/scheme/<имя>` с CAS и cookie/bearer-автором |

Тир B возможен благодаря `PRISTINE_HTML` (`src/editor/skill/pristine.ts`):
снимок `document.documentElement.outerHTML` берётся **до** монтирования Svelte
→ редактор умеет пересобрать сам себя, заменив свой же встроенный JSON. Отказ
от тира A невозможен — это единственный путь, не зависящий от браузера.

Разделение `skill/` ↔ `service/` (R14) физическое, не по флагам: в
`editor/skill` нет ни одного `fetch("/api/…")`, в `editor/service` нет
`PRISTINE_HTML`/FSA. В v1 всё это было в одном файле под рантайм-проверкой
`serverMode = !location.pathname.endsWith(".html")` — костыль, из-за которого
кнопки `open local` / `export` (n36, n40) были **скрыты в server-режиме**, хотя
по схеме должны быть всегда.

---

## 3. UI: всё по узлам схемы `UI/page` (35 узлов, 8 зон)

Легенда: ✅ есть в v1 и переносится · 🔧 есть, но сломано/неполно · 🆕 делаем впервые.

### Зона z1 «login page» (n1–n5, n14)

| узел | что | v1 | v2 |
|---|---|---|---|
| n2 | pixel-кот | ✅ SVG `crispEdges` | ✅ |
| n3/n4 | login / password | ✅ | ✅ + `autocomplete`, Enter-submit, ошибка под формой |
| n5 | reset → подсказка смены пароля admin | 🔧 текст есть, смены через UI нет | 🆕 форма смены пароля (admin + юзер), подсказка остаётся для «потерял всё» |
| n14 | lang | 🔧 работает через `window.__lang` (костыль: `let` в скрипте невидим для inline-onclick) | 🆕 язык = реактивное состояние, `localStorage`, общий для логина/консоли/редактора |
| n1 | живой README + ссылка | 🔧 хардкод-заглушка | 🆕 тянем реальный README (серверный эндпойнт `/api/readme` или встроенный при сборке), рендерим markdown-фрагмент |
| e1 | n2 ⇢ n1 dashed | — | ✅ декоративная связь (кот → readme) |

### Зоны z3/z6 «admin» + «bar» (n8, n10, n11, n13, n15, n33)

| узел | что | v1 | v2 |
|---|---|---|---|
| n11/n15 | editor / projects (навигация) | ✅ | ✅ |
| n8 | users | ✅ таблица + создание | ✅ + роль, статус, число ключей |
| n10 | таблица `user · pass · mcp · key` | 🔧 `pass` = «change pass» не работает, `key` = «regenerate» без подтверждения | 🆕 **pass**: смена пароля юзера (admin) через диалог · **mcp**: показать конфиг · **key**: `regenerate` **только с подтверждением** (R9) |
| n13 | logout | 🔧 не отзывает cookie-токен (B6) | ✅ отзывает свою сессию + 🆕 «выйти на всех устройствах» (revoke-all, с подтверждением) |
| n33 | lang | ❌ консоль захардкожена на RU | 🆕 EN/RU для всей консоли |

### Зоны z4/z8 «projects» + «bar» (n18–n29, n34)

| узел | что | v1 | v2 |
|---|---|---|---|
| n21/n22 | projects / editor (навигация) | ✅ | ✅ |
| n26 | таблица `project · scheme · edit · user · last_edit_date · del` | 🔧 **колонки `user` нет** | 🆕 все 6 колонок; `del` с подтверждением; сортировка по дате |
| n27 | project 1 (группировка) | ✅ `tr.proj` | ✅ |
| n28 | new project | 🔧 проект = только префикс имени схемы | 🆕 явное создание проекта + имя/описание |
| n29 | del project | ❌ нет | 🆕 удаление проекта (все его схемы) — **двойное подтверждение** с вводом имени |
| n24 | circle «show all users projects» (admin, слайдер) | ✅ чекбокс | ✅ слайдер + колонка `user` в таблице |
| n34 | lang | ❌ | 🆕 |
| n20/n23 | logout / users (дубли в bar) | ✅ | ✅ (одна реализация на две точки схемы) |

### Зоны z5/z7/z9 «editor» + «bar» + «instrument bar»

| узел | что | v1 | v2 |
|---|---|---|---|
| n19/n18 | editor / projects (навигация) | ✅ 📁 | ✅ + n16 `users`, n17 `logout` в топбаре |
| n31 | log (журнал) | ✅ кнопка `log` | ✅ + отдельная панель, фильтр по op |
| n32 | save | 🔧 **SAVE для `project/scheme` → 404** (B4) | ✅ имя из данных схемы, не из URL; Ctrl+S; dirty-индикатор |
| n35 | patch to project | ❌ | 🆕 R10: готовая команда `block.mjs pull …` + копирование в буфер |
| n36 | open local file | 🔧 скрыт в server-mode | ✅ виден всегда: открыть локальный `scheme.json` рядом с серверной схемой |
| n40 | export (to local) | 🔧 скрыт в server-mode | ✅ `scheme.json` / `SCHEME.md` / `editor.html` — скачать |
| n37 | palette (фигуры) | ✅ rect/square/circle/diamond/table | ✅ |
| n38 | object settings (инспектор) | 🔧 **при выбранном узле рисуются и поля ребра** (B3) | ✅ ветки node/edge/zone раздельно; поля w/h, refs, таблица 10×50 |
| n39 | snaps sliders | 🔧 кнопки `#`/`⊕`, шаг захардкожен `GRID=20` | 🆕 слайдеры: шаг сетки 5–100, вкл/выкл магнит, вкл/выкл сетку |
| n12 | «плюс нужно добавить…» (resize, текст внутрь, ctrl+c/v/z, ctrl+мышь, подпись зоны) | ✅ всё сделано в v1 | ✅ переносится как есть + 🆕 redo |

### UX-улучшения (R6/R7, сверх схемы)

- **Автосейв черновика**: debounce ~500мс в `localStorage`, при загрузке — «найден несохранённый черновик, восстановить?» (работает и офлайн, и на сервере).
- **Hotkeys**: `Ctrl+S` сохранить · `Ctrl+Z`/`Ctrl+Shift+Z` undo/**redo** · `Ctrl+D` дублировать · `Ctrl+A` всё · стрелки (шаг, `Shift` ×10) · `F2` переименовать · `Escape` снять выделение · `Delete` удалить · `?` панель клавиш.
- **Рамка-выделение** мышью на пустом канвасе; **zoom-индикатор** + «вписать в экран»; `beforeunload` при несохранённом.
- **Подтверждения** (единый диалог, не `confirm()`): delete scheme/project/user, revoke/rotate key, revoke-all sessions.

---

## 4. Функционал: сервер и MCP

### 4.1 REST (v1 → v2)

Переносится: login/logout/me, users CRUD, apikey, schemes CRUD, node/edge/zone-опы, `md`, `diff`, `log`, `/health`, `/editor/<name>`, `/admin`.

Чинится (всё воспроизведено):

| баг | v1 | v2 |
|---|---|---|
| B4 | SAVE `project/scheme` → 404 | имя схемы из встроенных данных |
| B5 | `/editorial`, `/editorFOO` создают схемы `ial`, `OO` | точная граница `/editor` или `/editor/…`, иначе 404 |
| B6 | logout не отзывает cookie-токен | отзывает по cookie, а не только по `Authorization` |
| B7 | `PUT` без `meta` → 500 | 400 (валидация до обращения к `next.meta`) |
| B8 | `nodes: null` сохраняется → схема сломана навсегда, `GET /api/schemes` → 500 | строгая валидация: `nodes`/`edges` обязаны быть массивами, reject on first failure |
| B9 | `?t=<token>` в логах | query не логируется; токен в URL не нужен (cookie) |
| B13 | `GET /api/mcp-config` отзывает все ключи и выдаёт новый | GET только читает; создание/отзыв/ротация — POST с подтверждением |

Новое (R9): `POST /api/session/revoke`, `POST /api/session/revoke-all`, `POST /api/keys`, `POST /api/keys/:id/revoke`, `POST /api/keys/:id/rotate`, `POST /api/password` (смена своего пароля), `POST /api/user/:id/password` (admin), `GET /api/readme`.

### 4.2 MCP dual-era (R8)

- legacy: `initialize` (2025-06-18 / 2025-11-25), `tools/list`, `tools/call`, `ping`.
- modern (2026-07-28): `server/discover` → `{supportedVersions, capabilities, serverInfo, instructions}`; приём `MCP-Protocol-Version` + `_meta`; `UnsupportedProtocolVersionError` со списком версий.
- **валидация `Origin`** → 403 (требование спеки, защита от DNS-rebinding; в v1 отсутствует полностью).
- `annotations` у 12 инструментов: `readOnlyHint` (`list_schemes`, `get_scheme`, `get_scheme_md`, `diff`), `destructiveHint` (`delete_scheme`, `node_remove`, `edge_remove`), `idempotentHint` (`put_scheme`) → клиент сам показывает подтверждение агенту.
- убрать дублирование: MCP-хендлеры `node_add/update/remove`, `edge_add/remove` сейчас копируют REST 1-в-1 (~150 строк) → общие функции ядра.

### 4.3 Ядро (перенос + fixes)

1. Убрать TS parameter properties (`saveSchema.ts`: `CasError`, `ValidationError`) — иначе `.ts` не импортируется (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, проверено).
2. Строгий вход (B8).
3. `nodeW/nodeH` — **один источник в ядре** с тем же переносом по 34 символам, что в редакторе (B12: mermaid/md сейчас ≠ картинка на канвасе).
4. `exportMd` берёт `meta.updatedAt` вместо `new Date()` → SCHEME.md идемпотентен (B10).
5. Ротация автосейва: убрать `autosaveForce ?? true` (B11: лимит «1 в 30с» мёртв, в демо 47 файлов / 360КБ).
6. Удалить мёртвое: `jailReal`, `dirSizeLimitExceeded`, дубли re-export'ов (B14).
7. `tsconfig`: `erasableSyntaxOnly: true` — гарантия, что никто не вернёт enum/namespace и не сломает type-stripping.

### 4.4 Скилл (R2, R10)

- `skill/core/*.ts` — verbatim-копия `src/core`; `skill/block.mjs` — из `src/cli`.
- `src/build/sync-skill.ts` пишет `skill/.manifest.json` (sha256 каждого файла); `check.ts` сверяет → дрейф невозможен (в v1 так разошлись две `core.mjs`: сервисная без валидации `w/h` принимала `{"w":5,"h":-3}` — B2).
- Новая команда **`pull`**: `block.mjs pull --url <сервис> --key <api-ключ> --name <project/scheme> [--rev N]` → CAS-проверка, запись `.block_llm/`, перегенерация экспортов. Единственная сетевая; все остальные офлайн (инвариант SKILL.md).
- `SKILL.md`: Node ≥ 22.18 (вместо 20 — тот EOL 30.04.2026), команда `pull`.

---

## 5. Фазы и гейты

| фаза | что | гейт (всё зелёное → дальше) |
|---|---|---|
| **0** | коммит v1 как есть → `cp -r` в `../llmscheme-v1/` (без `.git`) → очистить корень → `.gitignore`/`.gitattributes`/`biome.json` + `schemes/UI-page.json`. Мусор не переносим: `cache/` 360КБ, `dist/` 112КБ, дубль `editor-template.gen.html` 164КБ, `.test_on_local_proxmox/`, `cats.html`, устаревший `schemes-backup/` (rev 1) | ✅ СДЕЛАНО: архив 916КБ, скилл из него работает офлайн (init→node→edge→validate OK); корень = каркас v2 |
| **1** | `src/core` (4.3) + `package.json` + `.github/workflows/ci.yml` (CI не пишем в фазе 0: нечего запускать, мёртвый workflow = scaffolding) | `node --test src/test/*` зелёный; `tsc --noEmit` чист; `import('./src/core/index.ts')` работает; SCHEME.md идемпотентен; CI запускается и проходит |
| **2** | `src/cli` + `skill/` + sync/check (4.4) | `node skill/block.mjs doctor demo` офлайн из чистой копии; `check` ловит намеренно испорченный `skill/core/*` |
| **3** | `src/service` + `mcp-service/` (4.1, 4.2) | сервис поднимается; ни один GET не мутирует; `/editorial` → 404; curl-сценарии MCP обеих эр проходят |
| **4** | UI: `src/console` + `src/editor` + `src/ui` (3) | каждая страница открывается; **каждый узел схемы `UI/page` реализован**; бюджеты HTML соблюдены |
| **5** | `plugin/`, `demo/`, `docs/`, README | плагин грузится; демо-схема живая и без `cache/`; доки описывают v2 |
| **6** | тесты (ниже) + прогон против live 10.0.20.250 | unit + e2e + check зелёные в CI; данные v1 читаются v2 без миграции |

Порядок обязателен: фаза 0 необратима, фаза 4 зависит от 3 (API), фаза 6 проверяет всё.

---

## 6. Тесты

- **Unit** (`node --test`, ноль фреймворков): ядро (валидация/строгий вход/CAS/layout/diff/экспорты/идемпотентность md/ротация), CLI (init→node→edge→validate→diff→render→doctor; `pull` против локального сервера), service-lib (auth/revoke/confirm-эндпойнты/Origin).
- **e2e** (puppeteer, harness v1 хороший — переносим): login, console, editor, projects, mcp, security + **новые наборы на каждый найденный баг**: B3 инспектор узла без полей ребра · B4 SAVE `project/scheme` · B5 `/editorial` 404 · B6 logout отзывает cookie · B7/B8 строгая валидация 400 · B9 нет токена в логах · B13 GET не отзывает ключи · redo · автосейв-черновик восстанавливается · подтверждения на revoke/rotate/delete.
- **check**: хэши `skill/` == исходники; бюджеты HTML; нет внешних `src/href`; оба woff2-сабсета inline в редакторе.
- **CI**: то же в GitHub Actions + поднятый сервис для e2e.

---

## 7. Баги v1 — чек-лист приёмки

B1 артефакт 167КБ > бюджета (форматтер прошёлся по генерируемому HTML) → 2 теста падали · B2 `core.mjs` сервиса без валидации `w/h` · B3 инспектор узла рисует поля ребра · B4 SAVE `project/scheme` → 404 · B5 `/editorial` создаёт мусорные схемы · B6 logout не отзывает cookie-токен · B7 `PUT` без `meta` → 500 · B8 `nodes:null` ломает схему навсегда · B9 `?t=token` в логах · B10 SCHEME.md не идемпотентен · B11 ротация автосейва мертва · B12 `nodeW/nodeH` в двух расходящихся копиях · B13 GET отзывает ключи · B14 мёртвый код (`jailReal`, `dirSizeLimitExceeded`, `class:member` — стиль отсутствует в CSS) · B15 нет Origin-валидации · B16 legacy-only MCP · B17 нет redo/автосейва/dirty/beforeunload · B18 консоль без lang, смены пароля и колонки `user`.

---

## 8. Осознанные упрощения (потолок + путь улучшения)

- lightdb — один JSON с квотой. `ponytail:` до тысяч юзеров; дальше — SQLite.
- Проекты — один уровень (`a/b`). Дальше — рекурсия в `store.listSchemes`.
- TLS нет — только за reverse-proxy.
- Автосейв — черновик локально, не на сервере: иначе `rev` рос бы сам и агент через MCP ловил вечный CAS-конфликт.
- Консоль и редактор — три single-file HTML (console, editor-skill,
  editor-service), не SPA: переходов внутри них нет.
- Скилл хранит verbatim-копию ядра (не бандл): дрейф ловится хэшами.
