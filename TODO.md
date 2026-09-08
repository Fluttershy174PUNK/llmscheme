# TODO.md — что осталось сделать в v2

> Точное состояние на момент записи: typecheck 0 ошибок · 54/54 теста · `check: OK`.
> Закоммичено: фаза 0 (`4f2797f`), фаза 1 (`e1745a8`), фаза 2 (`527c438`).
> Не закоммичено: `src/service/lib/*` (написано, typecheck чист, **не запускается** — нет точки входа).
>
> Общий план и решения R1–R14: [PLAN.md](PLAN.md). Здесь — только остаток работ,
> по файлам, с гейтами. Порядок обязателен: 3 → 4 → 5 → 6 → 7.

## Готово (не трогать)

| модуль | файлы | строк | покрытие |
|---|---|---|---|
| `src/core/` | 14 `.ts` | 1268 | 33 теста: валидация/CAS/layout/diff/экспорты/идемпотентность/ротация/jail/gitmd |
| `src/cli/block.ts` | 1 | 767 | 21 тест: все 12 команд + `pull`, exit-коды, `--json`, мусорные флаги |
| `src/build/` | 3 `.ts` | 419 | проверено вручную: `check` ловит дрейф и ручную правку артефакта |
| `skill/` | 19 файлов | — | verbatim-копия, sha256-манифест, работает офлайн из чистой копии |
| `src/service/lib/` | 7 `.ts` | 1835 | typecheck чист; **тестов ещё нет** |
| `src/ui/pixel.css` | 1 | 204 | — |
| `src/editor/core/i18n.ts` | 1 | 143 | — |

Из 18 багов v1 закрыты и покрыты тестами: **B1 B2 B7 B8 B10 B11 B12 B14**.
Оставшиеся: B3 B4 B5 B6 B9 B13 B15 B16 B17 B18 — все в фазах 3–4 ниже.

---

## Фаза 3 (остаток) — сервис запускается

Написаны `http/auth/store/schemes/routes/mcp/config`. Не хватает точки входа и раздачи страниц.

### 3.1 `src/service/server.ts` (~120 строк)

- `loadConfig()` → `new Store(...)` → `ensureAdmin()` → `new Schemes(...)`.
- `http.createServer`: прочитать тело (`readBody`, лимит `MAX_BODY_MB`),
  `decodePathname`, залогировать **без query** (B9).
- Порядок обработки: `/mcp` → `handleMcpHttp`; `/health`; page-роуты (3.2);
  `Router.match` с auth-гейтом (`/api/login` и `/api/readme` — без auth);
  иначе 404.
- Единый `catch`: `CasError`→409, `ValidationError`/`DataError`→400,
  `HttpError`→её status, остальное→500 + лог. Никогда не ронять процесс.
- graceful shutdown (SIGTERM/SIGINT), `unhandledRejection`/`uncaughtException` → лог.
- **B5**: граница `/editor` точная — `pathname === "/editor"` или
  `startsWith("/editor/")`. v1-овский `startsWith("/editor")` создавал схемы
  `ial` и `OO` на запросы `/editorial` и `/editorFOO`.

### 3.2 `src/service/lib/pages.ts` (~60 строк)

- `GET /` и `/admin` → `console.html`; без auth → **401** + та же страница
  (браузер показывает форму, скрипты получают JSON по `Accept`).
- `GET /editor/<name>` → `editor.html` с подставленной схемой:
  `assertSchemeName` **до** `schemes.ensure()` (B5), затем `renderHtml`.
- `GET /assets/<file>` уже в `routes.ts` (`serveAsset`).
- Пути к артефактам — из env (`ASSETS_DIR`, по умолчанию рядом с `server.ts`).

### 3.3 Тесты сервиса `src/test/service.test.ts` (~250 строк)

Поднять `server.ts` на случайном порту в tmp-`DATA_DIR`, гонять `fetch`.
По тесту на каждый закрытый баг:

- **B5**: `GET /editorial` → 404 и **никакой** новой папки в `schemes/`.
- **B6**: logout по cookie → тот же токен как Bearer даёт 401.
- **B7**: `PUT` телом без `meta` → 400 (не 500).
- **B8**: `PUT` с `nodes: null` → 400; схема на диске читается дальше.
- **B9**: лог запроса не содержит `?t=`.
- **B13**: `GET /api/mcp-config` **не** отзывает ключи и не создаёт новый;
  `POST /api/keys/rotate` — отзывает.
- **B15**: `/mcp` с чужим `Origin` → 403; без `Origin` → работает.
- **B16**: legacy `initialize` → `protocolVersion` из запроса;
  `server/discover` → `supportedVersions`; `tools/list` → 12 инструментов
  **с `annotations`**; неизвестная версия → 400 со списком поддерживаемых;
  `Mcp-Method`/`Mcp-Name` расходятся с телом → 400 `-32020`.
- изоляция юзеров, `?user=all` только для admin, CAS-конфликт → 409,
  `project/scheme` через `%2F` и через обычный `/`, quota → 507, body > лимита → 413.

### 3.4 `mcp-service/` — деплой-обвязка

`Dockerfile` (контекст = корень; `COPY src/ schemes/ …`; `node src/service/server.ts`,
**ничего не собирается** в образе), `docker-compose.yml`, `.env.example`
(+ `ORIGIN_ALLOWLIST`, `ASSETS_DIR`), `README.md` (таблица API + MCP), `VERSION`.

**Гейт 3:** сервис поднимается локально; все тесты 3.3 зелёные; ни один GET не
мутирует состояние; `/editorial` → 404 без побочных папок; `curl`-сценарии обеих
эр MCP проходят; `docker build` succeeds (или хотя бы Dockerfile валиден, если
docker недоступен на машине).

---

## Фаза 4 — UI: редактор и консоль (самая большая)

Сборка уже готова (`src/build/build.ts` ждёт три входа) — остаётся написать
исходники. Все 35 узлов схемы `schemes/UI-page.json` расписаны в PLAN.md §3.

### 4.1 `src/editor/core/` — общий редактор (~900 строк, порт v1 `App.svelte` 1125 строк)

Портировать из `../llmscheme-v1/src/app/src/App.svelte`, **разбив на компоненты**
и выкинув мёртвое:

- `state.svelte.ts` — runes-стор схемы: выделение, undo/**redo** (B17), dirty-флаг,
  черновик в localStorage (R6). `compileModule` с runes проверен — работает.
- `Canvas.svelte` — SVG: узлы/рёбра/зоны, pan/zoom, drag, resize, рамка-выделение (R7).
- `Inspector.svelte` — **B3**: ветки node/edge/zone раздельно. В v1 блок полей
  ребра лежал *внутри* `{#if selectedKind === "node"}`, поэтому при выбранном
  узле рисовались и «n1», и «n1 (edge)», и style/from-side/to-side.
- `Toolbar.svelte` — save/log/lang/undo/redo/grid/snap/auto/delete + `?`-панель клавиш.
- `Palette.svelte` — 5 фигур (n37).
- `Statusbar.svelte` — rev, dirty, tier, счётчики.
- `hotkeys.ts` — R7: `Ctrl+S/Z/Shift+Z/D/A`, стрелки (`Shift` ×10), `F2`, `Esc`,
  `Delete`, `?`; `beforeunload` при несохранённом.
- `autosave.ts` — R6: debounce ~500мс в localStorage, «найден черновик — восстановить?».
- `geometry` берётся **из ядра** (`wrapLines/nodeW/nodeH`), браузерная копия не
  создаётся (B12 закрыт в фазе 1 — не регрессировать).
- Удалить `class:member` (O(nodes×zones) на узел, стиля `.member` в CSS нет — B14).
- `editor.css` — канвас/зоны/порты/таблицы поверх `src/ui/pixel.css`.

### 4.2 `src/editor/skill/` — офлайн-вход

`main.ts`, `pristine.ts` (снимок DOM **до** монтирования → самопересборка для
тира B), `SavePanel.svelte`: тиры **A** (команда `put --rev N` + diff в буфер),
**B** (FSA), **C** (скачать → `sync --from`), кнопки `open local` (n36),
`export` (n40), `patch to project` (n35 — готовая команда `block pull …`).
Ни одного `fetch("/api/…")`.

### 4.3 `src/editor/service/` — серверный вход

`main.ts`, `SavePanel.svelte`: тир **S** (`PUT /api/scheme/<имя>`), log-панель
(n31), навигация projects/users/logout (n18/n16/n17).
**B4**: имя схемы — из встроенных данных (`scheme.name`), не из последнего
сегмента URL. В v1 `/editor/slash/s1` → `PUT /api/scheme/s1` → 404.
Ни `PRISTINE_HTML`, ни FSA.

### 4.4 `src/console/` — консоль (n1–n40, зоны z1/z3/z4/z6/z8)

`main.ts` + `App.svelte` (роутер по hash: `#/login`, `#/projects`, `#/users`,
`#/settings`), `api.ts` (fetch-обёртка, 401 → login), `confirm.svelte.ts`
(единый диалог вместо `confirm()`), `console.css`. Компоненты:

- `login/` — n2 кот, n3/n4 форма, **n5 смена пароля** (POST `/api/password`),
  n14 lang, **n1 живой README** (GET `/api/readme`) + ссылка на репо.
- `projects/` — **n26 таблица из 6 колонок** (project · scheme · edit · **user** ·
  last_edit_date · del), n27 группировка, **n28 new project**, **n29 del project**
  (двойное подтверждение с вводом имени), n24 слайдер «все юзеры» (admin).
- `users/` — n8/n23 список, **n10 таблица `user · pass · mcp · key`**:
  `pass` → смена пароля юзера (admin), `mcp` → показать конфиг (GET, ничего не
  меняет), `key` → **rotate только с подтверждением** (R9/B13), создание юзера,
  удаление, `logout` (n13) + «выйти везде» (`/api/session/revoke-all`).
- `settings/` — свой пароль, свои ключи, **n33/n34 lang** (B18: консоль v1 была
  захардкожена на RU).
- Все строки — через `src/editor/core/i18n.ts` (EN+RU), никакого хардкода.

### 4.5 Прогнать сборку и проверить бюджеты

`npm run build` → `dist/editor.html` (font base64), `mcp-service/editor.html`
и `mcp-service/console.html` (font → `/assets/*.woff2`). Затем
`npm run sync-skill` + `npm run check`: бюджеты 200 КБ / 80 КБ, нет внешних
`src/href` в editor.html, оба woff2-сабсета inline, console.html **без** base64-шрифта.

**Гейт 4:** все три артефакта собираются и проходят `check`; каждая страница
открывается в браузере; **каждый узел `UI/page` реализован** (сверка по списку
PLAN.md §3); B3/B4/B17/B18 закрыты и проверены в браузере вручную.

---

## Фаза 5 — e2e, демо, плагин

### 5.1 `e2e/` — порт harness v1 + новые наборы

`package.json` (puppeteer), `harness.mjs` (api-клиент, cleanup `e2e*`,
incognito-контекст на набор), `run.mjs`, и наборы:
`test-login` (n1 живой readme, n5 смена пароля, n14 lang, reset-hint, creds),
`test-console` (вкладки, n26 колонка `user`, n28/n29 проекты, n10 pass/mcp/key
**с подтверждением**, revoke-all, logout),
`test-editor` (канвас, resize, undo/**redo**, copy/paste, мультивыделение,
рамка-выделение, автосейв-черновик восстанавливается, `Ctrl+S`, SAVE tier S,
**B4**: SAVE для `project/scheme` не 404, **B3**: инспектор узла без полей ребра),
`test-projects` (изоляция, `%2F`, слайдер),
`test-mcp` (обе эры, annotations, Origin 403, CAS),
`test-security` (401-стены, cookie-флаги, charset логина, traversal, revoke,
**B6** logout отзывает cookie, **B9** токена нет в логах, **B13** GET не отзывает).

### 5.2 `demo/` — демо-проект «генератор котиков»

Порт из v1 **без** `cache/` (360 КБ мусора): `src/*.ts`, `cats.txt`, `images/`,
`README.md`, `AGENTS.md`, `.block_llm/{scheme.json,scheme.html,VERSION}`,
`SCHEME.md`. Схема перегенерируется новым ядром (проверить, что md идемпотентен).

### 5.3 `plugin/` — hermes-плагин

В v1 это заглушка: `plugin.json` указывал `./plugin.mjs`, которого не существовало.
Минимально: `plugin.json` + `plugin.mjs` поверх того же ядра (read/update схемы,
CAS, экспорт md) — те же функции `ops.ts`, что у CLI и сервиса.

**Гейт 5:** `e2e` проходит против поднятого v2-сервиса; демо-проект жив
(`doctor: OK`, `scheme.html` открывается); плагин грузится.

---

## Фаза 6 — доки, CI, совместимость с live

### 6.1 Доки (сейчас `docs/` пуст, `README.md` и `PROJECT.md` удалены в фазе 0)

- `README.md` — что это, три способа работы, Node ≥ 22.18, быстрый старт.
- `PROJECT.md` — карта v2: `src/` правим · `skill/` генерится и сверяется ·
  `mcp-service/` деплой-обвязка · `schemes/` требования. Два правила вместо шести.
- `docs/MIGRATION.md` — переезд с v1: данные на диске не меняются
  (`lightdb.json`, `data/schemes/<uid>/…`), достаточно заменить контейнер;
  что поменялось в API (GET больше не мутирует, `?t=` убран, новые POST-эндпойнты).
- `docs/SCHEME_FORMAT.md`, `docs/EDITOR.md`, `docs/LOGIN.md` — перенести из v1,
  обновить пути (`cli/block.ts`, `editor.html`) и цифры бюджетов.

### 6.2 CI — добавить шаги, которых сейчас нет

`.github/workflows/ci.yml` сейчас: typecheck + test на node 22/24. Добавить
`npm run build` → `npm run sync-skill` → `npm run check` (артeфакты и бюджеты)
и e2e-джобу с поднятым сервисом (`docker compose up` или `node src/service/server.ts`).

### 6.3 Проверка на live-данных v1

Прогнать `pull`/`get`/`diff` против 10.0.20.250 (схемы `UI/page` rev 2,
`web/auth`) — убедиться, что v2 читает данные v1 без миграции.
`pull` уже проверен: 35 узлов, 8 зон приземлились корректно.

**Гейт 6:** CI зелёный целиком (typecheck → test → build → check → e2e);
доки описывают v2, а не v1; live-данные читаются.

---

## Фаза 7 — приёмка

1. `npm run verify` (typecheck + test + build + check) зелёный.
2. e2e зелёный на поднятом v2-сервисе.
3. Сверка UI со схемой: все 35 узлов `schemes/UI-page.json` реализованы
   (чек-лист PLAN.md §3) — и обновить саму схему (n12 «плюс нужно добавить…»
   выполнен, n5/n10/n26/n28/n29/n33/n34/n35/n36/n39/n40 закрыты).
4. Чек-лист багов: все **B1–B18** закрыты и покрыты тестом.
5. Приватность перед push: `git status` чист; `git ls-files | grep -iE
   "env$|data/|test_dev"` пусто; нет IP/паролей/токенов в коде.
6. Коммит → тег `v2.0.0`.

---

## Порядок и оценки

| фаза | что | файлов | риск |
|---|---|---|---|
| **3** | server.ts + pages.ts + тесты сервиса + mcp-service/ | ~10 | низкий: lib уже написан и typecheck-чист |
| **4** | редактор (3 входа) + консоль + CSS | ~20 | **высокий**: самая большая часть, много UX-деталей |
| **5** | e2e + demo + plugin | ~12 | средний: e2e-наборы хрупкие к таймингам |
| **6** | доки + CI + live-проверка | ~7 | низкий |
| **7** | приёмка | 0 | — |

Фаза 4 — критический путь. Разумно делать её по частям с проверкой в браузере
после каждой: 4.1 ядро редактора → 4.2/4.3 два входа → 4.4 консоль по экранам
(login → projects → users → settings) → 4.5 сборка и бюджеты.

## Осознанные упрощения (не делать, пока не понадобится)

- lightdb — один JSON с квотой. Потолок: тысячи юзеров → SQLite.
- Проекты — один уровень (`a/b`). Глубже — рекурсия в `Schemes.list`.
- TLS нет — только за reverse-proxy.
- Автосейв — черновик в localStorage, не на сервере: иначе `rev` рос бы сам и
  агент через MCP ловил вечный CAS-конфликт.
- Консоль — hash-роутер на одном single-file HTML, не SPA-фреймворк.
- `structuredContent` в MCP-ответах — без `outputSchema` у инструментов
  (клиенты и так читают `content[].text`); добавить, если понадобится строго
  типизированный вывод.
- `plugin/` — минимальный, без спеки Hermes: реализация появится, когда спека
  будет зафиксирована.
