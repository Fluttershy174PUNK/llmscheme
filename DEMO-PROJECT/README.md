# Демо — генератор котиков (TUI + GIF + браузер)

> Рабочий пример для скилла **block-llm**: настоящий проект с настоящей
> схемой. Достаточно маленький, чтобы прочитать за один раз, и достаточно
> полный, чтобы прогнать весь ритуал скилла.

Программа берёт случайное прилагательное + существительное из `cats.txt`
и рисует котика тремя способами:

| вход | что | как запустить |
|---|---|---|
| `src/run.ts` | TUI-кот (ANSI-цвета) | `node src/run.ts` |
| `src/run.ts --gif` | анимированный GIF | `node src/run.ts --gif cat.gif` |
| `cats.html` | браузер: живой анимированный кот | `xdg-open cats.html` |

## Запуск

```bash
# TUI — один кот в терминале
node src/run.ts

# GIF — анимированный кот в файл
node src/run.ts --gif cat.gif
xdg-open cat.gif

# браузер — кот живёт и анимируется (хвост виляет, глаза мигают),
# кнопка «новый котик» генерит нового, чекбокс включает/выключает анимацию.
# Node и сервер не нужны — просто открыть файл.
xdg-open cats.html
```

## Схема

Логическая схема лежит в `.llmscheme/logic_scheme/` и описывает поток данных:

```text
cats.txt ──> pickAdj() / pickNoun() ──> compose() ──> render() / gif() ──> stdout / file
     └────> cats.html (браузер: кнопка «новый котик» → анимированный кот)
```

Открой `.llmscheme/logic_scheme/scheme.html` в браузере, чтобы править схему
визуально, или читай как JSON:

```bash
node <skill-dir>/cli/block.ts get . --type logic
node <skill-dir>/cli/block.ts validate . --type logic
node <skill-dir>/cli/block.ts doctor . --type logic
```

## Что это демо проверяет

- **7 узлов + 7 рёбер + 1 зона** — TUI, GIF и браузерный UI разнесены по
  отдельным узлам с `--ref` на реальные файлы
- **refs** на `cats.txt`, `src/cat.ts`, `src/gif.ts`, `src/run.ts`,
  `cats.html`
- полный **ритуал**: `init --type logic` → `get` → `node add` →
  `edge add` → `validate` → `doctor`
- **три типа схем**: logic (эта), code, ui — один проект, до трёх
  независимых схем
