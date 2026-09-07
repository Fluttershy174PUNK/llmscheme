# PROJECT.md — карта репозитория для LLM-программиста

> Прочти это перед первым изменением кода. Здесь: что где лежит, что генерится,
> что нельзя править руками, как всё собирается и проверяется.

## Что это

**llmscheme** — живые логические схемы проекта для людей и LLM. Один формат
данных (`block-llm`), три потребителя одного ядра:

| потребитель | где | как использует ядро |
|---|---|---|
| 🎒 CLI-скилл для агента | `llmscheme-skill/` | офлайн, Node ≥ 20, без зависимостей |
| 🐳 HTTP-сервис + MCP | `llmscheme-service-mcp/` | REST API, браузерный редактор, MCP-сервер |
| 🖥 Svelte-редактор | `src/app/` | собирается в single-file HTML |

Ядро (валидация, CAS по `rev`, layout, экспорты) написано **один раз** в
`src/core/src/*.ts` и бандлится esbuild'ом в оба артефакта. Браузер, CLI и
сервер всегда согласны — это главный инвариант проекта.

```
src/core/src (TS, истина) ──build:skill──▶ llmscheme-skill/block_llm_core/core.mjs
                          ──build:core───▶ llmscheme-service-mcp/core.mjs
src/app (Svelte 5) ───────build:app─────▶ llmscheme-skill/block_llm_core/editor-template.gen.html
```

## Структура (67 файлов в git)

```
README.md                      — пользовательская документация (3 способа установки)
PROJECT.md                     — этот файл
LICENSE                        — MIT
.dockerignore                  — контекст сборки = корень репо (см. compose)
.gitignore                     — data/, .env, editor-template.gen.html, локальная тестовая среда

src/                           — ИСТОЧНИКИ (единственное место для правок логики)
  package.json                 — scripts: build:skill / build:core / build:app / check / test / typecheck
  core/src/                    — ядро, ~1000 строк TS, без зависимостей:
    types.ts                   —   Scheme/Node/Edge/Zone, shape: rect|square|circle|diamond|table
    validate.ts                —   валидация схемы (errors + warnings)
    ids.ts                     —   генерация id (n1, e1, z1), nextId в meta
    layout.ts                  —   auto-layout (autoPlace)
    diff.ts                    —   diffSchemes (для GET /diff и tier A)
    exportMd.ts                —   SCHEME.md (mermaid + таблицы + секция Sync)
    renderHtml.ts              —   встраивание scheme-data в HTML, DATA_MARKER
    saveSchema.ts              —   атомарная запись (tmp+rename), бэкапы, journal, ротация cache/
    gitmd.ts                   —   gitignore-строка для целевого проекта
    pathjail.ts                —   jail путей (refs не выходят за проект)
    index.ts                   —   публичные экспорты ядра (entry для esbuild)
  app/                         — Svelte 5 (runes) редактор:
    src/App.svelte             —   весь редактор (~890 строк): канвас SVG, инсспектор,
    src/app.css                —   палитра фигур, сетка/магнит, таблицы 10×50
    src/pristine.ts            —   PRISTINE_HTML (self-reference для сохранения tier A/B)
    src/main.ts, index.html    —   точки входа vite + vite-plugin-singlefile
    app.css дизайн             —   пиксель-стиль: Press Start 2P (base64), PICO-8 палитра
                                   --bg #1a1c2c --panel #29366f --accent #ffcd75 --err #ff004d
  scripts/build-skill.mjs      — сборщик артефактов + --check (CI): артефакты == исходникам,
                                 бюджет editor-template ≤ 150КБ
  test/core.test.mjs           — 22 теста (node --test): validate/CAS/layout/экспорты/CLI e2e

llmscheme-skill/               — 🎒 артефакт №1: скилл для агента (копируется в ~/.agents/skills/)
  SKILL.md                     — ритуалы агента (read-before-write, CAS, rev)
  block_llm_tools/block.mjs    — CLI (init/get/node/edge/put/sync/diff/doctor/…), бандл ядра
  block_llm_core/core.mjs      — ядро (СГЕНЕРЕНО из src/core)
  block_llm_core/editor-template.gen.html — редактор (СГЕНЕРЕН из src/app, ≤150КБ)
  block_llm_core/references/   — SCHEME_FORMAT.md, EDITOR.md (deep refs для агента)

llmscheme-service-mcp/         — 🐳 артефакт №2: docker-сервис (один файл server.mjs)
  server.mjs                   — ~1300 строк, ноль runtime-зависимостей (node:22-alpine):
                                   - HTTP-роутер + auth (scrypt пароли, bearer-токены,
                                     api-ключи ls_, cookie-сессии ls_token HttpOnly)
                                   - users: admin из env, роли admin|user, изоляция по uid
                                   - schemes: <uid>/<project>/<scheme>/, CAS по rev
                                   - консоль /admin (в этом же файле, шаблон-строка):
                                     вкладки редактирование/администрирование (у админа),
                                     проекты→схемы, слайдер «все юзеры» (?user=all),
                                     юзеры + api-ключи, MCP-конфиг на юзера
                                   - login-страница, /editor/<name> автосоздаёт схему
                                   - MCP: POST /mcp JSON-RPC (12 инструментов)
                                   - lightdb.json: юзеры/ключи/токены (атомарно, квота)
  core.mjs                     — ядро (СГЕНЕРЕНО из src/core, копия скиллового)
  Dockerfile                   — node:22-alpine, USER uid 100 (adduser -G users llm),
                                 HEALTHCHECK /health
  docker-compose.yml           — build: context .. + dockerfile llmscheme-service-mcp/Dockerfile;
                                 volume ./data:/data; ротация логов 3×10МБ
  .env.example                 — ADMIN_PASSWORD (единственный обязательный env)
  README.md                    — API-таблица, деплой, конфиг

llmscheme-hermes-plugin/       — заглушка: plugin.json манифест, реализации нет
demo-example-skill/            — демо-проект «генератор котиков» со живой схемой
```

## Золотые правила

1. **Не редактируй артефакты руками**: `core.mjs` (оба), `editor-template.gen.html`,
   `block.mjs` — генерируются. Правь `src/core/src/*.ts` / `src/app/src/*`,
   затем `npm run build:skill`. `npm run check` падает, если артефакт разошёлся
   с исходниками или редактор превысил 150КБ.
2. **Редактор ≤ 150КБ** — бюджет single-file HTML (шрифты inlined base64).
3. **CAS по `rev`** — любая запись схемы требует rev прочитанного; браузер,
   REST и MCP не затирают друг друга. Не обходи.
4. **Схема живёт в `<…>/.block_llm/scheme.json`**, `SCHEME.md` и `scheme.html`
   — генерируемые экспорты. `cache/` не коммитится.
5. **В сервисе scheme name = `project/scheme`** (один уровень вложенности) или
   просто `scheme`. Валидация: `[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)?`, без `..`.
   Пользователь изолирован: `data/schemes/<uid>/…`, чужое недоступно.
6. **Дизайн консоли сервиса** = дизайн редактора: Press Start 2P + PICO-8
   палитра. `FONT_CSS` извлекается из editor-template при старте — правь
   шрифт только в `src/app/src/app.css`.

## Сборка и проверка

```bash
cd src
npm install
npm run build:skill   # пересобрать все артефакты (core + editor + CLI-бандл)
npm test              # 22 теста ядра
npm run check         # CI: артефакты соответствуют исходникам + бюджет 150КБ
npm run typecheck     # tsc по ядру
```

## Сервис: запуск и деплой

```bash
cd llmscheme-service-mcp
cp .env.example .env          # ADMIN_PASSWORD обязателен
mkdir -p data && sudo chown -R 100:100 data   # uid контейнера
docker compose up -d --build
```

Страницы: `/` → login → `/admin` (консоль), `/editor/<project/scheme>` —
редактор (схема автосоздаётся), `/editor` = `default`, `/health`, `POST /mcp`.
Auth: cookie `ls_token` (страницы) / `Authorization: Bearer <token>` (XHR) /
`X-Api-Key: llm_…` (скрипты, MCP). Токены живут `TOKEN_TTL_DAYS` (30).

API (все под auth, кроме `/api/login`): полный список —
`llmscheme-service-mcp/README.md`. Имена схем с проектом: `/api/scheme/web%2Fauth`
или `/api/scheme/web/auth` — оба варианта валидны (%2F декодируется по сегментам).

## MCP-инструменты (12)

`list_schemes, get_scheme, get_scheme_md, create_scheme, put_scheme (CAS),
delete_scheme, node_add, node_update, node_remove, edge_add, edge_remove, diff`
— `GET /api/mcp-config[?login=<user>]` отдаёт готовую конфигу для клиента.

## Публичный репозиторий — чек-лист приватности

В git **нет** и не должно оказаться:

- ❌ `.env` (пароли) — в .gitignore; в git только `.env.example` с
  `change-me-now`
- ❌ `llmscheme-service-mcp/data/` (lightdb с хэшами паролей и api-ключами) —
  в .gitignore
- ❌ документация локальной тестовой среды (IP, пароли песочницы) —
  в .gitignore
- ❌ `editor-template.gen.html` копия в service-папке (мусор сборки) — в
  .gitignore
- ❌ `node_modules/`, `dist/`, `.block_llm/cache/` — в .gitignore
- ❌ IP-адресов/паролей/токенов в коде — секреты только через env
- ✅ `demo-example-skill/cats.txt`, картинки, схемы — публичные демо-данные
- ✅ GitHub-URL в README/LICENSE — публичное имя репозитория, это ок

Перед push: `git status --porcelain` пуст; `git ls-files | grep -iE
"env$|data/|test_dev"` — ничего, кроме `.env.example`.

## Известные упрощения (осознанные)

- `server.mjs` — один файл ~1300 строк: роутер, auth, консоль, MCP вместе.
  Ноль зависимостей = так и задумано; разделять при росте — на `lib/*.mjs`.
- Консоль — серверный шаблон-строка + vanilla JS (~120 строк клиента), без
  сборки. Не тащи React/Vite, пока не перестанет помещаться.
- Проекты — один уровень (`a/b`); глубже — расширить `schemeRoot` и
  `listSchemes` (рекурсия уже частично написана).
- lightdb — один JSON с квотой; SQL не нужен до тысяч юзеров.
- TLS нет — только за reverse-proxy (задокументировано).
