# EDITOR.md — scheme.html: устройство и браузерные факты

Читай когда: пользователь говорит про scheme.html / браузер / «мои правки не
видно»; перед починкой редактора; при спорах о tiers записи.

## Что это

`.llmscheme/<type>_scheme/scheme.html` — самодостаточный single-file редактор
(бюджет 200 KB, реально ~135 KB). Внутри: SVG-канвас (drag/pan/zoom,
connect-mode), инспектор (label/description/shape/refs/x/y), подсветка сирот,
EN/RU, статусбар (rev + активный tier), кнопки **open local** / **export**.
Схема встроена в `<script type="application/json" id="scheme-data">` — та же
структура, что scheme.json. В бандле ТО ЖЕ ядро, что у CLI: валидация, выдача
id, layout, mermaid, экспорт — одинаковы у агента и у браузера по построению.

Открывается двойным кликом по file://. Работает без Node и без скилла.

## Тиры записи (кнопка SAVE)

- **Tier A — hand off to agent** (основной, работает везде): редактор
  генерирует готовый блок для чата агента — `cli/block.ts put - --rev N` через
  heredoc с полным json и комментарием «что изменилось против загруженной
  ревизии» (diff из ядра). Человек копирует → агент применяет. Не зависит от
  браузера вообще.
- **Tier B — FSA** (если `showSaveFilePicker` существует И не бросает
  SecurityError на file://): прямая запись scheme.json мимо агента. Проверка
  ленивая, по клику SAVE; при отказе автоматический откат на Tier A.
- **Tier C — download + `cli/block.ts sync --from FILE`**: аварийный, работает
  в Firefox: сохранить файл кнопкой браузера и подсунуть агенту командой sync.
- **Tier S — server** (когда редактор отдаёт llmscheme-service по http, а не
  file://): SAVE уходит `PUT /api/scheme/<имя>`; сервер пишет scheme.json +
  перегенерирует экспорты. Признак: адрес без `.html` в конце.

Статусбар показывает активный tier. Отказ от Tier A невозможен: это единственный
способ, не зависящий от браузера.

## Open local / export (доп. опции локального редактора)

Рядом с SAVE у скилл-редактора (file://) есть две кнопки на случай, когда
scheme.json пришёл извне или нужен бэкап:

- **open local** — `<input type=file>`: загрузить любой scheme.json (нужен
  `"format": "block-llm"`) как текущую схему. После загрузки можно править и
  сохранять как обычно.
- **export** — `<a download>`: скачать текущую схему как `<name>.json`.
  Работает в любом браузере, включая Firefox.

Обе — простые браузерные примитивы, без FSA и без сети. Серверный редактор
этих кнопок не показывает (там схема живёт на сервере).

## Проверенные факты о file:// (Firefox 154, headless, 2026-09)

| Факт | Значение |
|---|---|
| isSecureContext | true |
| origin | `null` (opaque) |
| showDirectoryPicker / showSaveFilePicker | **undefined** (FSA нет) → Tier B невозможен |
| fetch('./соседний.json') | **NetworkError** → поэтому JSON встроен в html |
| inline `<script type="module">` | исполняется |
| localStorage | доступен (только UI-предпочтения: язык) |
| `<a download>` + Blob | работает |

Chromium-факты — по спекам (WICG file-system-access: opaque origin → SecurityError;
Chrome CORS на file://), НЕ перепроверены вручную: на машине разработки Chrome
отсутствует. Проверь у себя: открой scheme.html в Chrome и нажми SAVE — если
появился диалог выбора файла, Tier B жив.

Следствия, зашитые в сборку: весь JS/CSS инлайн (для скилл-редактора),
шрифты woff2 как data:-URL, никаких cookies и внешних запросов. Инварианты
проверяются `npm run check` (нет внешних src/href кроме data:, размер <= 200 KB).

## Правила поведения

- scheme.html коммитится (точка входа человека, пересборка требует Node).
- localStorage используется только для языка; никаких данных схемы в нём —
  единый источник истины scheme.json.
- Правка scheme.html руками запрещена: он генерируется. Правка scheme.json
  руками → потом `cli/block.ts sync`.
