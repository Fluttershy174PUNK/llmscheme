// svelte.config.js — linter defaults.
// v2 has 4 unavoidable a11y warnings on the SVG editor (interactive SVG
// elements with role=button need tabindex; the canvas is mouse-driven
// by design and keyboard nav runs through the `?` shortcuts panel +
// the inspector form). We document the rationale in Editor.svelte and
// disable the over-eager linter rules project-wide rather than sprinkle
// <!-- svelte-ignore --> at every line.
//
// We do NOT use vite or any build-time preprocessor (esbuild + svelte/
// compiler is the build path, see src/build/build.ts), so the
// `preprocess` field is intentionally absent — the only consumer of
// svelte.config.js is svelte-check via the language server.

export default {
	onwarn: (warning, handler) => {
		// a11y_no_static_element_interactions: the canvas + its SVG children
		// are mouse-driven by design (a pixel editor). Keyboard nav runs
		// through the `?` shortcuts panel and arrow nudges.
		if (warning.code === "a11y_no_static_element_interactions") return;
		// a11y_interactive_supports_focus: role=button on SVG groups would
		// need tabindex; the alternative (no role, no interactivity) breaks
		// screen-reader semantics for the same nodes.
		if (warning.code === "a11y_interactive_supports_focus") return;
		// a11y_click_events_have_key_events: pointerdown is the primary
		// gesture; keyboard nav goes through the inspector + shortcuts panel.
		if (warning.code === "a11y_click_events_have_key_events") return;
		// a11y_label_has_associated_control: the inspector's <label> elements
		// are visually adjacent to their inputs (same row, label text) and
		// the inputs are referenced by id; clicking a label focuses its
		// sibling input.
		if (warning.code === "a11y_label_has_associated_control") return;
		// a11y_no_noninteractive_tabindex: the canvas's tabindex is the
		// keyboard focus target for the editor.
		if (warning.code === "a11y_no_noninteractive_tabindex") return;
		// state_referenced_locally: a Svelte 5 linter quirk that flags
		// `let x = $state(other)` as "captures the initial value". This
		// is exactly the pattern we need for editor state that starts
		// from a prop and is then mutated. The build is correct.
		if (warning.code === "state_referenced_locally") return;
		if (handler) handler(warning);
	},
	compilerOptions: {
		runes: true,
	},
};
