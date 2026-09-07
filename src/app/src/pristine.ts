// Captured BEFORE Svelte mounts (inline module scripts run after DOM parse,
// so #app is still empty here): the single-file html exactly as served.
// The editor regenerates scheme.html by replacing the embedded JSON in this
// string (§4.2) — no fetch, no fs, works on file://.
export const PRISTINE_HTML = '<!doctype html>\n' + document.documentElement.outerHTML;
