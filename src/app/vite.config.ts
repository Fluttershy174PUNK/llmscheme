import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";

// single-file editor: all JS/CSS/fonts inline — file:// safe (§8)
export default defineConfig({
	plugins: [svelte(), viteSingleFile()],
	build: {
		target: "es2022",
		cssCodeSplit: false,
		assetsInlineLimit: 100_000_000,
		reportCompressedSize: false,
	},
});
