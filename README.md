# 🧩 llmscheme — живые схемы проекта для людей и LLM

> Универсальный конструктор логических схем: один формат (`block-llm`) — три
> способа работы: 🎒 офлайн-скилл для агента, 🐳 docker-сервис с REST + MCP и
> 🖥 единый редактор. Ядро (валидация, id, layout, CAS, экспорты) — ОДНА
> кодовая база (`src/core`), поэтому агент, браузер и сервер всегда согласны.

- **Схема** = `<проект>/.block_llm/scheme.json`: узлы (прямоугольник / квадрат /
  круг / ромб / 📊 таблица до 10×50), сплошные и пунктирные стрелки, зоны,
  `refs` на реальные файлы. Человекочитаемый экспорт `SCHEME.md` (mermaid +
  таблицы — рендерится на GitHub). Редактор `.block_llm/scheme.html` — один
  файл, открывается двойным кликом, работает офлайн.
- **CAS по `rev`**: каждая запись атомарна (tmp+rename), увеличивает `rev`,
  хранит бэкапы/журнал/автосейвы в `cache/`. Браузер, CLI и MCP не затирают
  друг друга.

## ⬇️ Скачивание

```bash
git clone https://github.com/Fluttershy174PUNK/llmscheme.git
cd llmscheme
```

Без git: **Code → Download ZIP** на GitHub или
[прямая ссылка](https://github.com/Fluttershy174PUNK/llmscheme/archive/refs/heads/main.zip).

```
llmscheme-skill/         🎒 скилл для агента (SKILL.md + block_llm_core + block_llm_tools)
llmscheme-service-mcp/   🐳 docker-сервис: REST API + MCP-сервер + хостинг редактора
src/core, src/app        🧠 исходники (ядро + Svelte-редактор)
demo-example-skill/      🐱 демо-проект «генератор котиков» с живой схемой
```

---

## 🎒 1. Скилл — офлайн, без установки

Нужен только Node >= 20. Без `npm install`, без сети.

```bash
# установка для всех проектов (pi / Gemini CLI / Codex читают ~/.agents/skills):
git clone https://github.com/Fluttershy174PUNK/llmscheme.git /tmp/llmscheme
cp -r /tmp/llmscheme/llmscheme-skill ~/.agents/skills/block-llm
# для Claude Code дополнительно:
ln -s ~/.agents/skills/block-llm ~/.claude/skills/block-llm
```

Или прямо из репозитория: `node llmscheme-skill/block_llm_tools/block.mjs …`

В проекте:

```bash
node <skill-dir>/block_llm_tools/block.mjs init [проект] --name "Мой проект"
node <skill-dir>/block_llm_tools/block.mjs validate [проект] --json
node <skill-dir>/block_llm_tools/block.mjs get [проект] --json
node <skill-dir>/block_llm_tools/block.mjs node add --label "Parse args" --ref src/args.ts
node <skill-dir>/block_llm_tools/block.mjs edge add --from n1 --to n2 --label ok
node <skill-dir>/block_llm_tools/block.mjs doctor [проект]
```

Полезные фишки:

- 📊 **таблица**: `node add --shape table --label "Спека" --table-cols "имя,тип" --table-rows "in|file;out|file"` (до 10 колонок, до 50 строк);
- ↩️ **многострочный label**: `\n` внутри — элемент растягивается вниз, в mermaid это `<br/>`;
- #️⃣ **сетка и магнит** в редакторе — кнопки `#` и `⊕`.

Цикл: агент читает схему перед правками кода, обновляет после (`--rev N` для
CAS), человек правит `.block_llm/scheme.html` двойным кликом и передаёт
дифф агенту (Tier A) или сохраняет сам (Tier B в Chromium). Полная карта
команд и ритуалы: [llmscheme-skill/SKILL.md](llmscheme-skill/SKILL.md).

🐱 Попробовать сразу: открой `demo-example-skill/.block_llm/scheme.html` в
браузере или прочитай `demo-example-skill/SCHEME.md` — реальный проект
«генератор котиков», оживлённый собственным скиллом.

---

## 🐳 2. Сервис — docker, мультипользовательский, REST + MCP

Один `server.mjs`, ноль runtime-зависимостей, образ Node 22 alpine. Все данные
(пользователи, api-ключи) — в `lightdb.json` на volume; каждая схема — полный
block-llm проект (история, бэкапы) на том же volume.

```bash
cd llmscheme-service-mcp
cp .env.example .env        # ⚠️ поменяй ADMIN_PASSWORD!
docker compose up -d --build
# → http://localhost:8080, volume в ./data/
```

Что получаешь:

- 👥 **Пользователи**: `admin` (из env) создаёт учётки (роли admin/user), вход
  по логину+паролю, каждый видит только свои схемы.
- 🔑 **API-ключи**: `POST /api/apikey` выдаёт ключ (показывается один раз);
  скрипты и MCP ходят с `X-Api-Key`.
- 🖥 **Редактор в браузере**: `GET /editor/<схема>?t=<token>` — тот же редактор,
  SAVE пишет на сервер (tier S).
- 🌐 **Полный REST**: CRUD схем, node/edge/zone add-update-remove, экспорты
  `md`/`diff` — таблица эндпойнтов в
  [llmscheme-service-mcp/README.md](llmscheme-service-mcp/README.md).
- 🔌 **MCP**: `POST /mcp` (JSON-RPC, 12 инструментов: get/put/node_add/edge_add/diff…).
  `GET /api/mcp-config` возвращает готовую конфигу для mcp-клиента (ключ
  создаётся, если нет).
- ⚙️ **Эксплуатация**: логи в stdout (docker logs, ротация 3×10МБ), квота
  lightdb (`DB_QUOTA_MB`), лимит тела запроса (`MAX_BODY_MB`), graceful
  shutdown, `/health` для healthcheck контейнера.

Путь новичка — три команды выше; единственный обязательный env —
`ADMIN_PASSWORD`, у остального разумные дефолты.

---

## 🛠 3. Разработка

```bash
cd src
npm install
npm run build:skill   # пересобрать core.mjs + шаблон редактора в llmscheme-skill/
npm test              # 21 тест: validate/CAS/layout/экспорты/CLI e2e/правила поиска
npm run check         # CI: артефакты соответствуют исходникам, редактор <= 150КБ
```

Источники: `src/core` (TS-ядро без фреймворков) → бандлится в CLI скилла и в
браузерный редактор; `src/app` (Svelte 5) → single-file шаблон редактора.
Сервис бандлит то же ядро (`llmscheme-service-mcp/core.mjs`).

🔒 **Безопасность публичного деплоя**: у сервиса нет TLS — для интернета ставь
за reverse-proxy; api-ключи и хэши паролей (scrypt) живут только на volume;
`.env`, `data/`, `config.json` в gitignore. Скилл сам не ходит в сеть и пишет
только в `.block_llm/`, `SCHEME.md` и `.gitignore` целевого проекта.

Лицензия: MIT.
