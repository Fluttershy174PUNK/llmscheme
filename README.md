# llmscheme

> **Одним предложением:** инструмент, который держит «карту» модулей и потоков
> данных твоего проекта в одном файле — читаемом одинаково тобой, AI-ассистентом
> и визуальным редактором.

Представь себе автообновляемую схему твоего кода. Вместо рисования квадратиков
и стрелок в презентации, которая устаревает в момент переименования файла,
схема живёт в `.llmscheme/logic_scheme/scheme.json` и перегенерируется при каждом
сохранении.

---

## Что в этом репозитории (раскладка v2)

```
llmscheme/
├── SKILL/llmscheme/          ← скилл для AI-агентов (drop-in)
├── SERVICE-MCP/llmscheme/    ← HTTP-сервис для Docker
├── HERMES-PLUGIN/llmscheme/  ← hermes-плагин (заглушка)
├── DEMO-PROJECT/             ← демо: проверь скилл на реальном проекте
├── src/                      ← весь исходный код (править только здесь)
├── .llm                      ← актуальная структура + план (для LLM)
├── .test_on_local_proxmox/   ← реальные скрипты деплоя и теста
├── README.md  PROJECT.md  INTRO.md  LICENSE
└── src/docs/                 ← подробные гайды
```

- **SKILL/llmscheme/** — самодостаточная копия `src/{core,cli}`. Положи в папку
  скиллов агента — и у него появится команда `block`.
- **SERVICE-MCP/llmscheme/** — Docker-образ. Dockerfile запускает
  `node src/service/server.ts` напрямую — без шага сборки в образе.
- **HERMES-PLUGIN/llmscheme/** — заглушка до финализации спеки hermes-плагинов.
- **DEMO-PROJECT/** — реальный проект со схемой. Проверяй на нём скилл целиком.

---

## Содержание

1. [Какую проблему это решает?](#какую-проблему-это-решает)
2. [Что такое «схема»?](#что-такое-схема)
3. [Три способа использования](#три-способа-использования)
4. [Быстрый старт (5 минут)](#быстрый-старт-5-минут)
5. [Как это работает (30 секунд)](#как-это-работает-30-секунд)
6. [Для LLM-агентов](#для-llm-агентов)
7. [Для человека (браузерный редактор)](#для-человека-браузерный-редактор)
8. [Для оператора (HTTP-сервис)](#для-оператора-http-сервис)
9. [Глоссарий](#глоссарий)
10. [Решение проблем](#решение-проблем)
11. [Куда читать дальше](#куда-читать-дальше)

---

## Какую проблему это решает?

Когда ты (или AI) работаешь над реальной кодовой базой, постоянно нужно отвечать:

- «Какие модули есть в проекте?»
- «Куда идут данные от этого к этому?»
- «Что вообще делает этот файл?»
- «Этот `ref` ещё указывает на живой файл?»

Большинство проектов отвечают на это либо так:

- **Grep + угадывание** — медленно, ошибочно, ломается при каждом изменении кода
- **Рукописные доки** — устаревают в момент изменения кода
- **Вики, которую никто не обновляет** — та же проблема

**llmscheme** держит один файл (`.llmscheme/logic_scheme/scheme.json`), который
описывает **ЧТО** есть в проекте — квадратики (модули) и стрелки (поток данных) —
и перегенерирует из него читаемый `SCHEME.md` и интерактивный `scheme.html` при
каждом изменении. Файл — источник истины. Markdown и HTML — просто красивые виды.

---

## Что такое «схема»?

Схема — это JSON-файл примерно такого вида:

```json
{
  "name": "Auth Flow",
  "nodes": [
    { "id": "n1", "label": "Login",   "refs": ["src/login.ts"] },
    { "id": "n2", "label": "Tokens",  "refs": ["src/tokens.ts"] }
  ],
  "edges": [
    { "id": "e1", "from": "n1", "to": "n2" }
  ]
}
```

Вот и всё. Схема — это просто список **узлов** (объекты проекта), связанных
**рёбрами** (как между ними текут данные). Можно добавить **зоны** (пунктирные
прямоугольники-группировки) и **подписи** (свободный текст на фигуре).

Открой `.llmscheme/logic_scheme/scheme.html` в браузере — получишь кликабельную
перетаскиваемую диаграмму. Открой `.llmscheme/logic_scheme/SCHEME.md` в любом
редакторе — получишь Markdown-сводку. Оба генерируются из одного JSON.

---

## Три способа использования

| Кто | Как | Что получает |
|---|---|---|
| **LLM-агент** (Claude Code, Cursor и т.п.) | Командная строка (`block`) | Скилл, который читает и пишет схему |
| **Человек** (ты) | Браузерный редактор | Визуальный редактор кликом и перетаскиванием |
| **Оператор** (ты, в проде) | HTTP-сервис + MCP | Веб-UI для нескольких пользователей |

Все три читают **один и тот же** формат на диске. Поменял в браузере — CLI видит
изменение. Поменял через CLI — браузер видит.

---

## Быстрый старт (5 минут)

Нужен [Node.js 22.18 или новее](https://nodejs.org/). Если Node свежий — всё готово.

### Шаг 1: установи dev-инструменты (один раз)

```bash
git clone <this-repo> llmscheme
cd llmscheme
npm install
```

Ставит `esbuild` и `svelte` (инструменты сборки). CLI и сервису они в рантайме не
нужны — только сборке HTML-редактора.

### Шаг 2: попробуй скилл в свежем проекте

```bash
mkdir my-project && cd my-project
node /path/to/llmscheme/SKILL/llmscheme/cli/block.ts init --type logic --name "Мой проект"
```

Создаёт `.llmscheme/logic_scheme/scheme.json`, строку в `.gitignore` и секцию в
`AGENTS.md`. А также `SCHEME.md` (читаемая сводка) и
`.llmscheme/logic_scheme/scheme.html` (браузерный редактор).

### Шаг 3: добавь пару узлов

```bash
node /path/to/llmscheme/SKILL/llmscheme/cli/block.ts node add \
    --type logic --label "Страница логина" --ref src/login.ts

node /path/to/llmscheme/SKILL/llmscheme/cli/block.ts node add \
    --type logic --label "Хранилище токенов" --ref src/tokens.ts

node /path/to/llmscheme/SKILL/llmscheme/cli/block.ts edge add \
    --type logic --from n1 --to n2
```

`node add` добавляет квадратик; `edge add` рисует стрелку.

### Шаг 4: открой визуальный редактор

Двойной клик по `.llmscheme/logic_scheme/scheme.html` в файловом менеджере, или:

```bash
xdg-open .llmscheme/logic_scheme/scheme.html      # Linux
open .llmscheme/logic_scheme/scheme.html          # macOS
start .llmscheme/logic_scheme/scheme.html         # Windows
```

Страница работает **без** веб-сервера — открывается прямо с `file://`, потому что
всё самодостаточно.

### Шаг 5: проверь здоровье

```bash
node /path/to/llmscheme/SKILL/llmscheme/cli/block.ts doctor --type logic
node /path/to/llmscheme/SKILL/llmscheme/cli/block.ts validate --type logic
```

`doctor` проверяет согласованность `scheme.json`, `SCHEME.md`, `scheme.html`.
`validate` проверяет JSON на ошибки (битые рёбра, неизвестные фигуры и т.п.).

### Шаг 6: проверь демо-проект

```bash
cd /path/to/llmscheme/DEMO-PROJECT
cat .llmscheme/logic_scheme/scheme.json   # настоящая схема
cat .llmscheme/logic_scheme/SCHEME.md     # её markdown-экспорт
open .llmscheme/logic_scheme/scheme.html  # браузерный редактор (схема)
open cats.html                  # браузерный UI демо (анимированный кот)
node src/run.ts                 # та же программа как TUI-кот
node src/run.ts --gif cat.gif   # …и как анимированный GIF
```

---

## Как это работает (30 секунд)

```
         ┌─────────────────┐
         │  scheme.json    │  ← единый источник истины
         │  (твои данные)  │
         └────────┬────────┘
                  │
      ┌───────────┼───────────┐
      │           │           │
      ▼           ▼           ▼
   block.ts   SCHEME.md   scheme.html
   (CLI)     (Markdown)  (браузер)
      │           │           │
      ▼           ▼           ▼
    Агент      Человек     Человек
   читает+    (любой      (визуальный
   пишет      редактор)    редактор)
```

- `scheme.json` — истина.
- `block.ts` — CLI-инструмент. Читает + пишет `scheme.json` и перегенерирует два
  других файла при каждом сохранении.
- `SCHEME.md` — автосгенерированный Markdown (для grep, LLM, code review).
- `scheme.html` — самодостаточный браузерный редактор (сервер не нужен).

Когда ты (или агент) запускаешь `node add` или `edge add`, CLI:

1. обновляет `.llmscheme/logic_scheme/scheme.json`;
2. перегенерирует `SCHEME.md` (mermaid-диаграмма + таблицы);
3. перегенерирует `.llmscheme/logic_scheme/scheme.html` (с новыми данными внутри).

Если правишь `scheme.html` в браузере и жмёшь SAVE — редактор отдаёт команду,
которую вставляешь агенту; агент запускает `block put`, и те же три шага.

---

## Для LLM-агентов

Положи каталог `SKILL/llmscheme/` в папку скиллов агента (для Claude Code:
`${CLAUDE_SKILL_DIR}`). У агента появится команда `block` с подкомандами `init`,
`get`, `node add`, `edge add`, `validate`, `diff`, `doctor`, `pull`, `sync`,
`restore`, `history`, `render`, `upgrade`, `version`.

Работа агента — держать схему синхронной с кодом. Ритуал:

1. `validate --json` — исправь ошибки до изменения кода;
2. `get --json` — прочитай текущее состояние, запомни `rev`;
3. сделай изменение кода;
4. `node add` / `node update` / `edge add` с `--rev N` (тот rev, что прочитал);
5. `doctor` — подтверди согласованность JSON + MD + HTML.

Скилл умеет вести до трёх схем на проект: `logic` (модули + потоки), `code`
(граф вызовов), `ui` (экраны/маршруты). Тип выбирается флагом `--type`. Если
пользователь не уточнил, какую схему — спроси.

Полная справка: [SKILL/llmscheme/SKILL.md](SKILL/llmscheme/SKILL.md) — это то, что
видит агент.

---

## Для человека (браузерный редактор)

Открой `.llmscheme/logic_scheme/scheme.html` в браузере. Получишь:

- **клик + перетаскивание** — двигать узел;
- **угловые ручки** — растягивать узел в любую сторону (при включённом магните размер прилипает к сетке);
- **клик по узлу** — выделить; **Ctrl+клик** — мультивыделение;
- **правая панель** — label, description, shape, позиция, refs;
- **верхняя панель** — добавить узел, добавить зону, соединить два узла (клик по
  зелёному `+` на одной стороне источника, потом по `+` на нужной стороне цели),
  undo/redo, удалить, сохранить;
- **open local / export** — открыть локальный `scheme.json` и скачать текущую
  схему (только в скилл-редакторе);
- **сетка и магнит** — вверху справа;
- **язык (EN / RU)** — вверху справа.

Шесть фигур: `rect`, `square`, `circle`, `ellipse` (овал), `diamond`, `table`.

При **SAVE** редактор даёт варианты:

- **Tier A** (работает всегда): команда для агента — вставил в терминал, агент
  применил;
- **Tier B** (Chromium): диалог «Сохранить как» пишет файлы напрямую;
- **Tier S** (редактор отдаёт HTTP-сервис): прямая запись на сервер.

Полный мануал: [SKILL/llmscheme/references/EDITOR.md](SKILL/llmscheme/references/EDITOR.md).

---

## Для оператора (HTTP-сервис)

HTTP-сервис — для общего многопользовательского режима: команда с одной схемой
на проект или веб-консоль для админов. Отдаёт:

- **веб-консоль** на `http://localhost:8080/` (логин, проекты, юзеры, настройки);
- **визуальный редактор** на `http://localhost:8080/editor/<имя-схемы>`;
- **REST API** на `http://localhost:8080/api/...` для скриптов;
- **MCP-эндпоинт** на `http://localhost:8080/mcp` для AI-клиентов.

### Запуск сервиса

```bash
cd llmscheme
npm install
npm run build              # разово: собирает HTML-артефакты
npm run sync-skill         # разово: обновляет SKILL/ из src/

ADMIN_PASSWORD=changeme PORT=8080 \
    DATA_DIR=./data \
    node src/service/server.ts
```

Открой `http://localhost:8080/` в браузере. Вход `admin` / `changeme`.
**Сразу смени пароль на странице настроек.**

### Или через Docker

```bash
cd SERVICE-MCP/llmscheme
cp .env.example .env
# отредактируй .env: задай надёжный ADMIN_PASSWORD

docker compose up -d
```

Контейнер запускает тот же `node src/service/server.ts`. Схемы и аккаунты живут в
именованном volume `llm-data`.

### Деплой на dev-песочницу (proxmox LXC 999)

```bash
export DEV_PASSWORD='…'           # из .test_on_local_proxmox/test_dev.md
export ADMIN_PASSWORD='changeme'
./.test_on_local_proxmox/deploy.sh     # сборка + rsync + docker up
./.test_on_local_proxmox/test.sh       # smoke-тест
```

Полная справка оператора: [SERVICE-MCP/llmscheme/README.md](SERVICE-MCP/llmscheme/README.md).

---

## Глоссарий

| Термин | Что значит |
|---|---|
| **scheme** | JSON-файл (`.llmscheme/<type>_scheme/scheme.json`), описывающий структуру проекта |
| **node** | Квадратик на диаграмме — модуль, файл или понятие проекта |
| **edge** | Стрелка между двумя узлами — поток данных, зависимость или вызов |
| **zone** | Пунктирный прямоугольник-группировка узлов — слой, подсистема |
| **rev** | Номер ревизии. Начинается с 0, растёт на каждой записи. Нужен для CAS |
| **CAS** | Compare-And-Swap. Запись проходит, только если `rev` на диске совпал с прочитанным |
| **core** | Модель данных + валидация. Чистый TypeScript, ноль зависимостей |
| **skill** | Каталог, который загружает AI-агент ради новых возможностей. Здесь `SKILL/llmscheme/` |
| **MCP** | Model Context Protocol — стандарт вызова инструментов агентом на сервере |
| **tier** | Стратегия сохранения редактора: A = команда агенту, B = прямая запись, C = скачивание, S = PUT на сервис |
| **--type** | Тип схемы: `logic` (модули+потоки), `code` (граф вызовов), `ui` (экраны/маршруты) |

---

## Решение проблем

### «Предупреждение, что мой `ref` протух»

```
stale-ref: src/foo.ts does not exist
```

Путь в `refs` узла указывает на несуществующий файл. Либо переименуй файл и
обнови схему, либо удали узел.

### «Два писателя перезаписали друг друга»

```
conflict: scheme changed on disk (rev 7 → 8), re-read and retry
```

Кто-то записал схему между твоим чтением и записью. Запусти `get --json`, узнай
новый `rev` и повтори запись с `--rev N`.

### «CLI говорит `node` не найден»

Node < 22.18, либо неверный путь к CLI.

- `node --version` должен быть 22.18+;
- путь должен указывать на `SKILL/llmscheme/cli/block.ts`.

### «Редактор показывает пустой холст»

Если в схеме нет узлов, редактор показывает приветственный посев (3 узла,
2 ребра). Добавь реальную схему через `block init` и обнови страницу.

### «MCP отвечает 403 origin not allowed»

Браузер прислал `Origin`, которому сервер не доверяет. Задай
`ORIGIN_ALLOWLIST` в окружении сервера списком разрешённых origin через запятую.

### «Забыл пароль админа»

Останови сервис. Удали `DATA_DIR/lightdb.json`. Перезапусти с `ADMIN_PASSWORD=...`
в окружении. **Сотрёт всех пользователей и сессии**, но схемы на диске останутся.

---

## Куда читать дальше

- **Если ты LLM-агент** (или настраиваешь его):
  [SKILL/llmscheme/SKILL.md](SKILL/llmscheme/SKILL.md)
- **Если пользуешься браузерным редактором:**
  [SKILL/llmscheme/references/EDITOR.md](SKILL/llmscheme/references/EDITOR.md)
  или [src/docs/EDITOR.md](src/docs/EDITOR.md)
- **Если запускаешь HTTP-сервис:**
  [SERVICE-MCP/llmscheme/README.md](SERVICE-MCP/llmscheme/README.md)
  или [src/docs/LOGIN.md](src/docs/LOGIN.md)
- **Если хочешь знать JSON-формат досконально:**
  [src/docs/SCHEME_FORMAT.md](src/docs/SCHEME_FORMAT.md)
- **Если обновляешься с v1:**
  [src/docs/MIGRATION.md](src/docs/MIGRATION.md)
- **Если контрибьютишь код:**
  [PROJECT.md](PROJECT.md)
- **Если нужен живой снимок проекта:**
  [.llm](.llm)
- **Если хочешь задеплоить на dev-песочницу:**
  [.test_on_local_proxmox/README.md](.test_on_local_proxmox/README.md)

---

## Лицензия

MIT.
