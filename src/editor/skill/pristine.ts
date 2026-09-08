// Captured BEFORE Svelte mounts (inline module scripts run after DOM parse,
// so #app is still empty here): the single-file html exactly as served.
// The editor regenerates scheme.html by replacing the embedded JSON in this
// string — no fetch, no fs, works on file://.
//
// The Tier B FSA path does not actually rebuild the artifact from this
// (a full template + embedded JSON is ~135KB, which the user can rebuild
// locally with `npm run sync-skill`). The pristine snapshot is here so the
// editor can do "save back into a copy of myself" if a future tier needs it
// without an extra fetch.
export const PRISTINE_HTML = document.documentElement.outerHTML;
