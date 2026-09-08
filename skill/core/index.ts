// Public surface of the core — the ONE implementation shared by the CLI skill,
// the HTTP service and the browser editor. Keeping this list lean is the point:
// everything not exported here is an internal detail free to change.
export * from "./types.ts";
export { DataError, CasError, ValidationError } from "./errors.ts";
export { validate, checkRefs } from "./validate.ts";
export { consumeNodeId, consumeEdgeId, consumeZoneId, emptyScheme } from "./ids.ts";
export { GRID_X, GRID_Y, autoLayout } from "./layout.ts";
export {
	wrapLines,
	nodeW,
	nodeH,
	WRAP_AT,
	MIN_W,
	MIN_H,
	CHAR_W,
	LINE_H,
	TABLE_COL_W,
	TABLE_MIN_W,
	TABLE_ROW_H,
	TABLE_HEAD_H,
} from "./geometry.ts";
export { exportMermaid, exportMd } from "./exportMd.ts";
export { diffSchemes } from "./diff.ts";
export {
	addNode,
	updateNode,
	removeNode,
	addEdge,
	updateEdge,
	removeEdge,
	addZone,
	updateZone,
	removeZone,
	type NodeInput,
	type NodePatch,
	type EdgeInput,
	type EdgePatch,
	type ZoneInput,
	type ZonePatch,
} from "./ops.ts";
export {
	DIR,
	AUTOSAVE_KEEP,
	BACKUP_KEEP,
	JOURNAL_MAX,
	AUTOSAVE_MIN_MS,
	readRaw,
	readSnapshot,
	saveSchema,
	type SaveOptions,
} from "./saveSchema.ts";
export { PathJailError, jail, findProjectDir } from "./pathjail.ts";
export { ensureGitignoreLine, ensureAgentsSection, AGENTS_START, AGENTS_END } from "./gitmd.ts";
export { renderHtml, extractSchemeJson, DATA_MARKER, HtmlError } from "./renderHtml.ts";
