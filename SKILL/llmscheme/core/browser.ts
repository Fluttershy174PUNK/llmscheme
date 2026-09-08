// Browser-safe subset of the core. The editor and the console import from
// here so esbuild never pulls in node:fs via saveSchema/pathjail/gitmd.
// The full surface (with the server-only modules) is still in index.ts for
// the CLI and the service.
//
// ponytail: this is one place to keep in sync with index.ts; the
// duplication is small (10 lines of exports) and buys a clean browser build.
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
export { renderHtml, extractSchemeJson, DATA_MARKER, HtmlError } from "./renderHtml.ts";
