---
name: block-llm
description: Maintains living schemes of the current project in .llmscheme/ (a scheme per concern — logic, code, ui, or any other the user asks for), plus a human-readable SCHEME.md and an interactive scheme.html editor the user can open by double-click. On first use ASK which scheme to build; afterwards only UPDATE the schemes that already exist — never create a new scheme unless the user explicitly asks. Use whenever you explore, refactor, or extend a project's architecture, add or remove modules, trace data flow, answer "how does this work", or when the user says "update the scheme", "I edited the scheme - implement it". Russian triggers: "схема проекта", "обнови схему", "нарисуй архитектуру", "как это работает", "я поправил схему - воплоти".
license: MIT
compatibility: Requires Node >= 22.18 and Bash. No network, no npm install in the
  target project. Interactive editor needs a Chromium-based browser (or use the
  agent-only workflow). This skill is a LOCAL tool: it never needs a service URL
  or an API key.
---

# block-llm — живые схемы проекта

Схемы лежат в `<project>/.llmscheme/<type>_scheme/`. В каждой папке схемы:
`scheme.json` (данные), `SCHEME.md` (читаемый экспорт), `scheme.html`
(редактор двойным кликом) и `cache/` (журнал, бэкапы, автосейвы). Схема
описывает ЧТО есть (модули, потоки данных, экраны), а не как написано.

## Какие схемы бывают — спроси, не угадывай

Схема может описывать **что угодно**. Частые примеры:

| `--type` | папка схемы | что описывает |
|---|---|---|
| `logic` | `.llmscheme/logic_scheme/` | модули + потоки данных |
| `code` | `.llmscheme/code_scheme/` | граф вызовов / структура кода |
| `ui` | `.llmscheme/ui_scheme/` | экраны, маршруты, UI-компоненты |
| `db` | `.llmscheme/db_scheme/` | таблицы и связи |
| `api` | `.llmscheme/api_scheme/` | эндпоинты и вызовы |
| … | `.llmscheme/<type>_scheme/` | любой смысл по запросу юзера |

Это НЕ фиксированный список: `--type` принимает любое безопасное слово
(лат. буквы, цифры, `_`, `-`). Тип схемы — это просто имя папки, а её смысл
определяет пользователь.

### Главное правило: не плоди схемы сам

1. **Первое обращение** — если в проекте нет `.llmscheme/` (или схемы нужного
   типа нет), а пользователь хочет схему → **СПРОСИ, схему чего делать**.
   Предложи варианты под задачу (логика? код? экраны? что-то ещё?) и жди ответа.
2. **Схема уже есть** — работай только с ней: `validate` + `get` + обновляй.
   НЕ переинициализируй, НЕ пересобирай с нуля.
3. **Новые схемы** — создавай ТОЛЬКО по явному запросу пользователя. Кому-то
   нужна одна `ui`-схема, кому-то `logic` + `code` — решает он, не ты.
   Никогда не создавай «на всякий случай» и не догенерируй недостающие типы.

Когда выбрал тип — передавай `--type` в каждую команду. Каждый тип полностью
независим — свой счётчик rev, свой журнал, свой SCHEME.md.

Быстрый путь — схема уже есть: `validate --json --type <T>` + `get --json
--type <T>` и работай от схемы. НЕ переинициализируй и НЕ пересобирай
архитектуру с нуля. Нет `.llmscheme/` вверх от cwd, а пользователь хочет схему →
сначала `init --type <T>`, потом строй узел за узлом.

Замени `<skill-dir>` ниже на каталог с этим SKILL.md.
(Claude Code: `<skill-dir>` = `${CLAUDE_SKILL_DIR}`.)

## Быстрый старт

```bash
node <skill-dir>/cli/block.ts init [project] --type logic --name "Auth Flow"
node <skill-dir>/cli/block.ts get [project] --type logic --json
node <skill-dir>/cli/block.ts node add --type logic --shape rect --label "Parse args" --desc "reads argv" --ref src/args.ts
node <skill-dir>/cli/block.ts node add --type logic --shape table --label "Spec" --table-cols "name,kind" --table-rows "in|file;out|file"
node <skill-dir>/cli/block.ts edge add --type logic --from n1 --to n2 --label ok
node <skill-dir>/cli/block.ts validate [project] --type logic
```

Команды берут `[project]` из аргумента (корень проекта или папка схемы), иначе
ищут вверх от cwd. `--type` по умолчанию `logic`. Коды выхода: 0 ок, 1 ошибка
данных/конфликт, 2 ошибка использования. `--json` для машинного вывода. Без
npm install, без сети, без URL, без API-ключа.

CLI работает прямо из `.ts` — Node 22.18+ стрипает типы, без сборки и установки.

## Ритуал: прочитай схему до работы

1. `validate --json --type <T>` — исправь ошибки до правок кода; держи warnings в уме.
2. `get --json --type <T>` — запомни `rev` (для CAS на записи).
3. Обзор: читай `SCHEME.md`. Детали узлов: `.llmscheme/<type>_scheme/scheme.json`.

## Ритуал: синхронизируй схему с проектом (главная ценность)

После изменения кода прогнай чек-лист:

- новые модули/файлы → новые узлы с `--ref` на реальные пути (refs относительны
  корня ПРОЕКТА, не папки схемы);
- новые потоки данных → рёбра (solid = обычный поток, dashed = async/опционально);
- удалённое → удаляй узлы/рёбра, не оставляй трупов;
- `--desc` узла — краткие факты (что делает, не как);
- `--label` может содержать `\n` — квадратик растёт вниз (mermaid рендерит `<br/>`);
- `--shape table` + `--table-cols "a,b,c"` + `--table-rows "r1c1|r1c2;r2c1|r2c2"`
  — таблица (до 10 колонок, 50 строк; `;` разделяет строки, `|` ячейки);
- `--w N --h N` — явный размер (человек мог растянуть в редакторе; не сбрасывай
  без причины);
- `validate` показывает протухшие refs → обнови или удали узел.

Потом пиши с запомненной ревизией:

```bash
node <skill-dir>/cli/block.ts node add --type logic --label "Report" --ref src/report.ts --rev 7
```

SCHEME.md и scheme.html перегенерируются автоматически при каждой записи.

Если `rev` вырос неожиданно (человек правил схему) → `diff --rev N`, пойми
намерение, потом продолжай. НИКОГДА не перезаписывай вслепую.

## Правила надёжности

- Читай перед записью; передавай `--rev`, если читал схему ранее. На сообщение о
  конфликте — перечитай `get` и повтори, не дави.
- Предпочитай CLI ручной правке `scheme.json`. Если ты (или человек) правили JSON
  напрямую — запусти `sync`, иначе md/html разъедутся с json.
- Не удаляй `.llmscheme/<type>_scheme/cache/` во время работы (там бэкапы).
- `cache/` в git-ignore; коммить scheme.json, scheme.html, VERSION, SCHEME.md.
- После пачки записей запусти `doctor` — проверит согласованность json/md/html,
  протухшие refs и бюджет размера html.
- Этот скилл пишет ТОЛЬКО: `.llmscheme/`, идемпотентную строку `.gitignore` +
  секцию `AGENTS.md` (при `init`). Код проекта не трогает — правки кода твоя
  работа по явному запросу пользователя.

## Глубокие справки (читай по нужде)

- `references/SCHEME_FORMAT.md` — json-формат, правила валидации, миграции.
  Читай при работе с json напрямую, спорах о формате или перед `upgrade`.
- `references/EDITOR.md` — устройство редактора scheme.html, tier'ы записи
  (A/B/C), браузерные факты. Читай, когда пользователь упоминает редактор,
  браузер или «мои правки не видны».

## Карта команд

`init` `get` `validate` `node add|update|remove` `edge add|update|remove`
`zone add|update|remove` `put` `sync` `render` `diff` `history` `restore`
`doctor` `upgrade` `version` — полные опции: запусти команду без аргументов.
