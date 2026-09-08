# INTRO.md — стартовая страница HTTP-сервиса

> Эту страницу видит **оператор**, когда впервые заходит на сервис. Это
> «привет, вот что ты только что установил» — не экран логина для
> пользователя (он в `SERVICE-MCP/llmscheme/console.html`). У самой консоли
> свой приветственный поток.

---

## Добро пожаловать в llmscheme

Ты запускаешь один бинарь, который даёт:

1. **веб-консоль** для админов (логин, проекты, юзеры, настройки);
2. **визуальный редактор** для правки схем кликом и перетаскиванием;
3. **REST API** для скриптов;
4. **MCP-эндпоинт** для AI-ассистентов.

Один контейнер, без шага сборки при деплое.

---

## Сначала главное

```bash
# 1. открой консоль
http://localhost:8080/

# 2. войди под бутстрап-админом
login:    admin
password: changeme   (или тот ADMIN_PASSWORD, что задал)

# 3. СМЕНИ ПАРОЛЬ
вверху «settings» → change password

# 4. создай первого юзера (если ты не админ)
#    или первый проект (если админ)
#    консоль проведёт по шагам
```

---

## Что в этом репозитории

```
.
├── SKILL/llmscheme/              ← скилл агента (в Claude Code)
├── SERVICE-MCP/llmscheme/        ← развёртываемый сервис (Docker)
├── HERMES-PLUGIN/llmscheme/      ← hermes-плагин (заглушка)
├── DEMO-PROJECT/                 ← демо: проверь скилл на реальном проекте
├── src/                          ← весь исходный код (править здесь)
├── .llm                          ← актуальная структура + план (для LLM)
├── .test_on_local_proxmox/       ← деплой + тест на proxmox LXC
├── PROJECT.md  README.md         ← этот репозиторий
├── LICENSE                       ← MIT
├── INTRO.md                      ← ты здесь
└── src/docs/                     ← подробные гайды
```

---

## Краткая справка

| Задача | Команда |
|---|---|
| Запустить сервис | `node src/service/server.ts` |
| Запустить через Docker | `cd SERVICE-MCP/llmscheme && docker compose up` |
| Запустить тесты | `npm test` |
| Typecheck | `npm run typecheck` |
| Собрать HTML-артефакты | `npm run build` |
| Проверить всё | `npm run verify` |
| Синхронизировать скилл | `npm run sync-skill` |
| Проверить совпадение артефактов | `npm run check` |

---

## Три способа использовать llmscheme

### 1. Скилл (для AI-агентов)

```bash
# положи SKILL/llmscheme/ в папку скиллов агента
# (для Claude Code: ${CLAUDE_SKILL_DIR})

# у агента появятся команды:
node <skill-dir>/cli/block.ts init my-project --type logic
node <skill-dir>/cli/block.ts node add --type logic --label "Login" --ref src/login.ts
node <skill-dir>/cli/block.ts validate --type logic
```

### 2. Браузерный редактор (для человека, офлайн)

```bash
# в любом проекте со схемой:
xdg-open .llmscheme/logic_scheme/scheme.html     # Linux
open .llmscheme/logic_scheme/scheme.html         # macOS
```

Страница самодостаточна. Открывается прямо с `file://` — без веб-сервера.
Кликай и перетаскивай. SAVE отдаёт команду для агента.

### 3. Сервис (для команд, общее редактирование)

```bash
# открой консоль
http://localhost:8080/

# войди, создавай проекты, правь схемы в браузере
# или через REST API:
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/schemes
```

---

## Нужна помощь?

- **README.md** — что такое llmscheme, быстрый старт за 5 минут, глоссарий
- **PROJECT.md** — карта репозитория для контрибьюторов, ежедневные команды
- **src/docs/** — подробные гайды (формат, редактор, консоль, миграция)

Справка оператора: [SERVICE-MCP/llmscheme/README.md](SERVICE-MCP/llmscheme/README.md).
