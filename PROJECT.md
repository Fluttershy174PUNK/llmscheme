# PROJECT.md — хаб репозитория для контрибьюторов

> **Для кого:** тех, кто хочет **менять код** самого llmscheme. Если просто
> **используешь** — читай [README.md](README.md).

Это «карта мест» кодовой базы. [README.md](README.md) объясняет, что проект
делает и как им пользоваться; этот файл — как проект устроен и как добавить
фичу.

---

## Версия в одном предложении

**Правь файлы в `src/`. Запусти `npm run verify`. Закоммить. Артефакты в
`SKILL/llmscheme/`, `SERVICE-MCP/llmscheme/` и `dist/` пересобираются из `src/`,
а `npm run check` доказывает, что они совпадают.**

---

## Карта репозитория (раскладка v2)

```
llmscheme/
│
├── src/                        ← ИСТОЧНИК истины. Править здесь.
│   │
│   ├── core/                   ← Модель данных. Чистый TypeScript, ноль зависимостей.
│   │                             Используется всеми остальными частями.
│   │                             • types.ts        — Scheme, SchemeNode и т.д.
│   │                             • validate.ts     — правила error/warn
│   │                             • layout.ts       — авторазмещение узлов
│   │                             • diff.ts         — что изменилось
│   │                             • exportMd.ts     — вывод Markdown
│   │                             • saveSchema.ts   — атомарная запись на диск
│   │                             • renderHtml.ts   — встройка данных в HTML
│   │                             • browser.ts      — то же, что index.ts, без node:fs
│   │                             • geometry.ts     — nodeW/nodeH (единственная истина)
│   │
│   ├── cli/                    ← CLI-инструмент `block`.
│   │                             Один файл, 16 подкоманд, без бандлера.
│   │
│   ├── service/                ← HTTP-сервис (REST + MCP).
│   │   ├── server.ts           ← точка входа
│   │   └── lib/                ← routing, auth, store, schemes, pages, config
│   │
│   ├── editor/                 ← Браузерный визуальный редактор.
│   │   ├── core/               ← общий Svelte 5 компонент (холст + инспектор)
│   │   ├── skill/              ← вход file:// (tier A/B/C)
│   │   └── service/            ← вход http (tier S — PUT /api/scheme)
│   │
│   ├── console/                ← Веб-консоль админа (логин, проекты, юзеры).
│   │                             Один Svelte 5 компонент, hash-роутер.
│   │
│   ├── ui/                     ← Общий CSS — пиксельный шрифт и палитра.
│   │                             Один файл. Импортируется редактором и консолью.
│   │
│   ├── build/                  ← Скрипты сборки.
│   │   ├── build.ts            ← esbuild + svelte/compiler → 3 single-file HTML
│   │   ├── sync-skill.ts       ← синк SKILL/llmscheme/ (закреплён sha256)
│   │   └── check.ts            ← проверка, что артефакты совпадают с исходниками
│   │
│   └── test/                   ← Тесты (node:test, без фреймворков).
│                                 73 теста: 33 core, 21 CLI, 19 service.
│
├── SKILL/llmscheme/            ← ГЕНЕРИРУЕТСЯ. Дословная копия src/{core,cli}.
│                                 Положи в папку скиллов агента — появится
│                                 команда `block`.
│
├── SERVICE-MCP/llmscheme/      ← ГЕНЕРИРУЕТСЯ + конфиг деплоя.
│   ├── editor.html             ← самодостаточный редактор (~110 КБ)
│   ├── console.html            ← самодостаточная консоль (~77 КБ)
│   ├── assets/                 ← woff2-шрифты + app.js
│   ├── Dockerfile              ← собирается на node:22, без шага компиляции
│   ├── docker-compose.yml
│   ├── .env.example
│   └── README.md               ← справка оператора
│
├── HERMES-PLUGIN/llmscheme/    ← Hermes-плагин (заглушка). В v1 был только
│                                 манифест; в v2 — рабочий plugin.mjs на том же ядре.
│
├── DEMO-PROJECT/               ← Демо: генератор котиков (TUI + GIF + браузер)
│   ├── src/cat.ts              ← TUI-рендер (ANSI-цвета, без зависимостей)
│   ├── src/gif.ts              ← GIF (LZW + глобальная палитра, без зависимостей)
│   ├── src/run.ts              ← точка входа
│   ├── cats.html               ← браузерный UI (анимированный кот, без сервера)
│   ├── cats.txt                ← список слов
│   ├── .llmscheme/logic_scheme/scheme.json  ← реальная схема (7 узлов, 7 рёбер, 1 зона)
│   ├── AGENTS.md               ← секция агента
│   ├── README.md
│   └── .gitignore
│
├── .test_on_local_proxmox/     ← Реальный деплой + тест на dev-песочницу.
│   ├── deploy.sh               ← сборка + rsync + docker compose up
│   ├── test.sh                 ← smoke-тест задеплоенного сервиса
│   ├── test_dev.md             ← hermes-скилл-справка по песочнице
│   └── README.md
│
├── src/docs/                   ← Пользовательские гайды
│   ├── SCHEME_FORMAT.md        ← JSON-формат, каждое поле, правила валидации
│   ├── EDITOR.md               ← tier'ы редактора + браузерные факты
│   ├── LOGIN.md                ← консоль + админ
│   └── MIGRATION.md            ← изменения v1 → v2
│
├── .github/workflows/
│   └── ci.yml                  ← typecheck → test → build → check на push
│
├── package.json                ← Node ≥ 22.18, devDeps: esbuild + svelte
├── tsconfig.json               ← strict, erasableSyntaxOnly
├── svelte.config.js            ← конфиг svelte-check (4 известных a11y-подавления)
│
└── README.md  PROJECT.md  INTRO.md  LICENSE  .llm
```

---

## Ежедневные команды

```bash
# установить dev-зависимости (один раз)
npm install

# typecheck
npm run typecheck

# запустить все тесты (73 штуки)
npm test

# собрать три HTML-артефакта + перегенерировать SKILL/
npm run build
npm run sync-skill

# проверить согласованность всего (typecheck + test + build + check)
npm run verify

# запустить сервис локально
PORT=8080 DATA_DIR=./data \
    ADMIN_PASSWORD=changeme \
    node src/service/server.ts

# задеплоить на dev-песочницу
./.test_on_local_proxmox/deploy.sh
./.test_on_local_proxmox/test.sh
```

---

## «Где править X?»

| Хочу поменять… | Править файл |
|---|---|
| …модель данных (новое поле узла) | `src/core/types.ts` + `src/core/validate.ts` |
| …спеку JSON-формата | `src/docs/SCHEME_FORMAT.md` |
| …Markdown-экспорт (mermaid-диаграмму) | `src/core/exportMd.ts` |
| …алгоритм автораскладки | `src/core/layout.ts` |
| …как сохранение пишется на диск | `src/core/saveSchema.ts` |
| …CLI-команду (новый флаг, поведение) | `src/cli/block.ts` |
| …REST-эндпоинт | `src/service/lib/routes.ts` |
| …MCP-инструмент (добавить инструмент, схему) | `src/service/lib/mcp.ts` (массив `TOOLS` + `callTool`) |
| …авторизацию (cookie, Bearer, API-ключ) | `src/service/lib/auth.ts` + `src/service/lib/store.ts` |
| …холст редактора (drag, zoom, select) | `src/editor/core/Editor.svelte` |
| …что редактор шлёт агенту на SAVE | `src/editor/core/Editor.svelte` (функция `copySaveCommand`) |
| …веб-консоль (логин, список проектов) | `src/console/App.svelte` |
| …палитру или пиксельный шрифт | `src/ui/pixel.css` |
| …переводы EN/RU | `src/editor/core/i18n.ts` |
| …сборку (какие входы, что бандлить) | `src/build/build.ts` |
| …формат на диске, что видит агент | `src/core/*` (потом `npm run sync-skill`) |
| …мануал скилла для агента | `src/skill/SKILL.md` (копия `SKILL/llmscheme/SKILL.md` после синка) |
| …справку оператора Docker-образа | `SERVICE-MCP/llmscheme/README.md` |
| …скрипт деплоя на песочницу | `.test_on_local_proxmox/deploy.sh` |
| …живой снимок для LLM | `.llm` |
| …CI-пайплайн | `.github/workflows/ci.yml` |

---

## Как собираются три артефакта

```
src/editor/skill/main.ts  ──┐
src/editor/service/main.ts ─┼── esbuild + svelte/compiler ──→  3 single-file HTML
src/console/main.ts       ──┘                                       │
                                                                   ▼
                                              ┌────────────────────┴────────────────────┐
                                              │                                         │
                                              ▼                                         ▼
                              SERVICE-MCP/llmscheme/editor.html             SKILL/llmscheme/editor.html
                              SERVICE-MCP/llmscheme/console.html           dist/editor.html
                              (отдаёт HTTP-сервис)                          (открывается с file://)
```

Скрипт сборки (`src/build/build.ts`) делает:

1. компилирует каждый `.svelte`-компонент в JS + CSS;
2. бандлит JS esbuild'ом;
3. бандлит CSS (шрифт либо встраивается base64, либо кладётся в `assets/`);
4. оборачивает результат в HTML со схемой внутри
   `<script type="application/json" id="scheme-data">`.

`npm run sync-skill` копирует `src/core/*` и `src/cli/block.ts` в
`SKILL/llmscheme/`, а `dist/editor.html` — в `SKILL/llmscheme/editor.html`.
sha256 каждого файла пишется в `SKILL/llmscheme/.manifest.json`.

`npm run check` проверяет:

- `SKILL/llmscheme/core/*.ts` и `src/core/*.ts` побайтово идентичны;
- `SKILL/llmscheme/editor.html` побайтово совпадает с тем, что собрал
  `npm run build`;
- `editor.html` в бюджете 200 КБ;
- `console.html` в бюджете 80 КБ;
- у `editor.html` нет внешних `src=` / `href=` (инвариант file://);
- оба woff2-сабсета встроены base64 (чтобы файл работал с `file://`).

Любая из проверок упала — сборка сломана, не релизь.

---

## Статус фаз (v2)

| фаза | описание | статус |
|---|---|---|
| 0 | архив v1, сброс корня | ✅ 916 КБ архив, корень = чистый v2 |
| 1 | core работает из .ts, 33 теста, CI | ✅ коммит `e1745a8` |
| 2 | CLI + скилл + sync/check, 54 теста | ✅ коммит `527c438` |
| 3 | сервис: server.ts + pages.ts + 19 тестов сервиса | ✅ 73/73 тестов |
| 4 | редактор + консоль (Svelte 5) + 3 single-file HTML | ✅ в бюджете |
| 5 | DEMO-PROJECT/ + HERMES-PLUGIN/ | ✅ |
| 6 | доки (README, PROJECT, INTRO, .llm) | ✅ (этот файл) |
| 7 | приёмка | ✅ см. ниже |

---

## Покрытие багов

Аудит v1 насчитал 18 багов. Все закрыты и покрыты тестами в v2:

| # | Что v1 делал не так | Как v2 исправил |
|---|---|---|
| B1 | Форматтер переписывал editor.html, ломая бюджет | `check.ts` сравнивает артефакт побайтово |
| B2 | `core.mjs` сервиса без валидации `w/h` | Одно общее ядро; валидация везде |
| B3 | Инспектор смешивал поля узла и ребра в одном `{#if}` | Отдельные ветки на `sel.kind === "node" \| "edge" \| "zone"` |
| B4 | SAVE `project/scheme` отдавал 404 | Имя схемы из встроенных данных, не из хвоста URL |
| B5 | `/editorial` и `/editorFOO` создавали мусорные папки схем | Маршрут ровно `/editor` или `/editor/<name>` |
| B6 | Logout не отзывал cookie-сессию, только Bearer | `currentTokenHash` читает любой транспорт |
| B7 | `PUT` без `meta` отдавал 500 | `Schemes.put` валидирует сначала, потом CAS — битое тело = 400 |
| B8 | `nodes: null` портил схему на диске | Строгая валидация отклоняет запись, схема здорова |
| B9 | `?t=<token>` в логе доступа | `logRequest` вырезает query |
| B10 | `SCHEME.md` не идемпотентен | `exportMd` берёт `meta.updatedAt` из схемы |
| B11 | Ротация автосейва была no-op | `AUTOSAVE_MIN_MS` + `AUTOSAVE_KEEP` реально ограничивают |
| B12 | `nodeW` / `nodeH` жили в двух копиях и разъехались | Одна истина в `src/core/geometry.ts` |
| B13 | `GET /api/mcp-config` отзывал ключи и выдавал новый | `GET` только читает; ротация — явный `POST` с подтверждением |
| B14 | Мёртвые экспорты (`jailReal`, `dirSizeLimitExceeded`) | `src/core/index.ts` — курируемая публичная поверхность |
| B15 | Нет проверки Origin на MCP | `checkOrigin` отдаёт 403 чужому Origin |
| B16 | MCP говорил только на протоколе 2025-го | Dual-era: modern (2026-07-28) + legacy (initialize) |
| B17 | Нет redo, автосейва, dirty-флага, `beforeunload` | Все четыре в `Editor.svelte` |
| B18 | Консоль захардкожена на русском, без смены пароля и колонки юзера | `App.svelte` i18n + настройки + экран юзеров |

---

## Чек-лист приёмки (фаза 7)

- [x] `npm run verify` зелёный (typecheck + test + build + check)
- [x] 73/73 юнит-тестов + 19/19 тестов сервиса
- [x] Три HTML-артефакта в бюджете (137 К / 111 К / 77 К)
- [x] `check` доказывает, что `SKILL/llmscheme/` совпадает с `src/`
- [x] Нет внешних `src/href` в `editor.html` (инвариант file://)
- [x] Нет IP/секретов в коде
- [x] Все 18 багов v1 (B1–B18) закрыты и покрыты тестом
- [x] Раскладка v2: `SKILL/`, `SERVICE-MCP/`, `HERMES-PLUGIN/`, `DEMO-PROJECT/`
- [x] Офлайн-редактор больше не пустой (приветственный посев)
- [x] `INTRO.md` и `.llm` существуют
- [x] `.test_on_local_proxmox/deploy.sh` и `test.sh` — реальные скрипты

---

## Чек-лист приватности (перед push)

```bash
git status                                          # чистое дерево
git ls-files | grep -iE 'env$|data/|test_dev/'     # ничего
grep -rE '10\.0\.20\.|admin:admin|llm_[a-f0-9]{20,}' \
    . --include='*.ts' --include='*.json' --include='*.md'   # ничего
```
