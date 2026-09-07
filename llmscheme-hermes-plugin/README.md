# llmscheme-hermes-plugin (stub)

Будущий Hermes-плагин поверх единого ядра block-llm (`src/core`): те же
операции, что у CLI скилла и REST/MCP сервиса — validate, node/edge/zone
add-update-remove, put с CAS по `rev`, экспорт SCHEME.md.

Сейчас это манифест-заглушка: `plugin.json` описывает имя, точку входа и
разрешения. Реализация появится, когда будет зафиксирована спека
Hermes-плагинов; ядро уже готово и переиспользуется скиллом
(`llmscheme-skill/block_llm_core/core.mjs`) и сервисом
(`llmscheme-service-mcp/core.mjs`) — плагин соберётся из того же
`src/core` командой `npm run build:core` (репозиторий `src/`).
