# EDITOR.md — scheme.html: устройство и браузерные факты

Читай когда: пользователь говорит про scheme.html / браузер / «мои правки не
видно»; перед починкой редактора; при спорах о tiers записи.

## Что это

`<project>/.block_llm/scheme.html` — самодостаточный single-file редактор
(бюджет 200 KB, реально ~135 KB). Внутри: SVG-канвас (drag/pan/zoom,
connect-mode), инспектор (label/description/shape/refs/x/y), подсветка сирот,
EN/RU, статусбар (rev + активный tier), undo/redo, автосейв-черновик.
Схема встроена в `<script type="application/json" id="scheme-data">` — та же
структура, что scheme.json. В бандле ТО ЖЕ ядро, что у CLI: валидация,
выдача id, layout, mermaid, экспорт — одинаковы у агента и у браузера по
построению.

Открывается двойным кликом по file://. Работает без Node и без скилла.

## Тиры записи (кнопка SAVE)

- **Tier A — hand off to agent** (основной, работает везде): редактор
  генерирует готовый блок для чата агента — `cli/block.ts put - --rev N`
  через heredoc с полным json и комментарием «что изменилось против
  загруженной ревизии» (diff из ядра). Человек копирует → агент применяет.
  Не зависит от браузера вообще.
- **Tier B — FSA** (если `showSaveFilePicker` существует и не бросает
  SecurityError на file://): прямая запись `scheme.json`. Проверка
  ленивая, по клику SAVE; при отказе автоматический откат на Tier A.
- **Tier S — server** (когда редактор отдаётся llmscheme-service по http,
  а не file://): SAVE уходит `PUT /api/scheme/<имя>` с Bearer-токеном.
  Сервер пишет scheme.json + перегенерирует экспорты. Признак: редактор
  загружен с `/editor/<name>` (а не `*.html`).
- **Tier C — download + `cli/block.ts sync --from FILE`**: аварийный,
  работает в Firefox: скачать файл кнопкой браузера и подсунуть агенту
  командой sync.

Статусбар показывает активный tier. Отказ от Tier A невозможен: это
единственный способ, не зависящий от браузера.

## Проверенные факты о file:// (Firefox 154, headless, 2026-09)

| Факт | Значение |
|---|---|
| isSecureContext | true |
| origin | `null` (opaque) |
| showDirectoryPicker / showSaveFilePicker | **undefined** (FSA нет) → Tier B невозможен |
| fetch('./соседний.json') | **NetworkError** → поэтому JSON встроен в html |
| inline `<script type="module">` | исполняется |
| localStorage | доступен (UI-предпочтения + черновик) |
| `<a download>` + Blob | работает |

Следствия, зашитые в сборку: весь JS/CSS инлайн, шрифты woff2 как data:-URL,
никаких cookies и внешних запросов. Инварианты проверяются `npm run check`
(нет внешних src/href, размер <= 200 KB).

## Автосейв-черновик

- Дебаунс ~500мс в `localStorage` (ключ `blm-draft`, TTL 7 дней).
- При открытии редактора: «найден несохранённый черновик, восстановить?»
- Не вытесняет существующий `scheme.json` — это просто резерв для случая,
  когда человек нажал SAVE, но файл ещё не записался (Tier A).
- `beforeunload` предупреждает о несохранённых изменениях.

## Правила поведения

- scheme.html коммитится (точка входа человека, пересборка требует Node).
- localStorage используется для языка, prefs (grid/snap), черновика. Никаких
  учётных данных в нём.
- Правка scheme.html руками запрещена: он генерируется. Правка scheme.json
  руками → потом `cli/block.ts sync`.

## Клавиатура

| Keys | Action |
|---|---|
| Ctrl+S | save |
| Ctrl+Z / Ctrl+Shift+Z | undo / redo |
| Ctrl+D | duplicate node |
| Ctrl+C / Ctrl+V | copy / paste |
| Ctrl+A | select all |
| arrows / Shift+arrows | nudge / nudge ×10 |
| F2 | rename |
| Delete | delete selected |
| Escape | deselect / cancel connect |
| Shift+drag | pan |
| wheel | zoom |
| ? | show shortcuts panel |
