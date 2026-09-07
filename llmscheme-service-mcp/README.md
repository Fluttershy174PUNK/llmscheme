# 🐳 llmscheme-service

> HTTP-сервис + MCP-сервер поверх единого ядра схем (`src/core`): пользователи,
> api-ключи, схемы, редактор в браузере, полный REST. Один файл `server.mjs`,
> ноль runtime-зависимостей. Данные — lightdb (один JSON) + папки схем на volume.

## 🚀 Запуск (docker)

```bash
cd llmscheme-service-mcp   # папка сервиса в репозитории
cp .env.example .env      # ⚠️ и поменять ADMIN_PASSWORD
mkdir -p data && sudo chown -R 100:100 data   # контейнер работает под uid 100 (llm)
docker compose up -d --build
```

Volume создаётся рядом с compose-файлом: `llmscheme-service-mcp/data/`
(lightdb + схемы). Он должен принадлежать uid 100:100 — иначе сервис не
сможет писать (compose-контекст уже настроен на корень репозитория).

## ⚙️ Конфиг (env)

| переменная | по умолчанию | смысл |
|---|---|---|
| `PORT` | `8080` | порт (в compose мапится `${PORT:-8080}:8080`) |
| `ADMIN_PASSWORD` | — (обязателен) | пароль учётки `admin` (создаётся при первом старте) |
| `TOKEN_TTL_DAYS` | `30` | жизнь bearer-токена сессии |
| `DB_QUOTA_MB` | `64` | лимит размера lightdb.json (507 при превышении) |
| `MAX_BODY_MB` | `8` | лимит тела запроса (413 при превышении) |
| `MCP_ENABLED` | `true` | выключить `/mcp` = `false` |

## 👥 Логин и пользователи

```bash
# токен сессии
curl -s -X POST localhost:8080/api/login -H 'content-type: application/json' \
  -d '{"login":"admin","password":"..."}'
# → {"token":"...","role":"admin"}  — дальше: Authorization: Bearer <token>
```

- `GET /api/me` — кто я; `POST /api/logout` — отозвать токен.
- Админ: `GET/POST /api/users` (role: `admin|user`), `GET /api/keys` — все ключи.
- 🔑 `POST /api/apikey` — выдать api-ключ себе (`{"login":"alice"}` — админом
  для другого). Ключ показывается один раз.
- 🔌 `GET /api/mcp-config` — готовая конфига подключения MCP (ключ создаётся,
  если нет). Для другого пользователя: `?login=alice` (админ).

## 🗺 Схемы (у каждого пользователя свои)

| метод | путь | что делает |
|---|---|---|
| GET | `/api/schemes` | список моих схем |
| POST | `/api/schemes` | `{"name":"x"}` создать пустую / `{"name":"x","scheme":{...rev:0}}` залить |
| GET | `/api/scheme/x` | схема целиком |
| PUT | `/api/scheme/x` | записать целиком (CAS: `rev` в теле = rev на диске) |
| DELETE | `/api/scheme/x` | удалить со всей историей |
| GET | `/api/scheme/x/md` | SCHEME.md (mermaid + таблицы) |
| GET | `/api/scheme/x/diff?rev=N` | что изменилось с ревизии N |
| POST | `/api/scheme/x/node` | добавить узел (`label` с `\n` — растянется вниз; `shape: rect\|square\|circle\|diamond\|table`; `table: {cols,rows}` до 10×50; без `x/y` — авто-layout) |
| PUT/DELETE | `/api/scheme/x/node/:id` | изменить / удалить узел (рёбра узла чистятся) |
| POST | `/api/scheme/x/edge` | связать (`from`, `to`, `style: solid\|dashed`, `label`) |
| PUT/DELETE | `/api/scheme/x/edge/:id` | изменить / удалить связь |
| POST | `/api/scheme/x/zone` | зона (`x`,`y`,`w`,`h`,`label`) |
| DELETE | `/api/scheme/x/zone/:id` | удалить зону |

Каждая схема — полноценный проект block-llm на volume: `scheme.json`,
перегенерируемые `scheme.html` + `SCHEME.md`, `cache/` (journal/autosave/backup,
ротация) — та же механика, что у скилла.

## 🖥 Консоль и редактор в браузере

1. Открой `http://host:8080/` — страница логина (токен хранится в
   localStorage, API-ключ не нужен).
2. Попадаешь в консоль `/admin`: список схем (открыть/удалить/создать),
   админам — пользователи (создать, выдать api-ключ) и готовый MCP-конфиг.
3. `Открыть` ведёт на `/editor/<имя>?t=<token>` — редактор схемы
   (схема создаётся автоматически, если её ещё нет; `/editor` без имени
   открывает схему `default`).
4. Рисуй узлы/связи, жми SAVE — уходит `PUT /api/scheme/<имя>` (tier S),
   ревизия и md/html обновляются на сервере.
5. 🎨 В канвасе: палитра фигур слева (клик — выбрать, клик по канвасу —
   поставить), сетка `#` и магнит `⊕` в топбаре, 📊 таблица до 10×50.

## 🔌 MCP

`POST /mcp` — JSON-RPC (streamable HTTP), авторизация `X-Api-Key`.

- `initialize`, `tools/list`, `tools/call`, `ping`.
- инструменты: `list_schemes`, `get_scheme`, `get_scheme_md`, `create_scheme`,
  `put_scheme` (CAS), `delete_scheme`, `node_add`, `node_update`, `node_remove`,
  `edge_add`, `edge_remove`, `diff`.

Готовая конфига: `GET /api/mcp-config` → вставить в mcp-клиент как есть.

## 📋 Логи и лимиты

- Логи — в stdout (docker logs), одна строка на запрос + ошибки; ротация логов
  docker: `max-size 10m × 3` в compose.
- Лимиты: `DB_QUOTA_MB` на lightdb, `MAX_BODY_MB` на запрос, ротация
  autosave/backup в ядре.
- Все записи атомарны (tmp+rename), CAS по rev — браузер, REST и MCP не
  затирают друг друга.
- 🔒 Схема пользователя изолирована: `/api/scheme/:name` всегда ищется в папке
  этого пользователя, «чужую» схему не прочитать и не записать.
