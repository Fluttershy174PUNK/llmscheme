// Console entry: single-page app, hash-routed, four screens.
// The server already gates /, /admin with the cookie check; this file
// assumes the user might be unauthenticated and redirects on 401.
import { mount } from "svelte";
import App from "./App.svelte";
// CSS is bundled into the HTML by build.ts, not via JS imports — keep
// this file the only side-effect-free module in the entry graph.
// import "../ui/pixel.css";

const target = document.querySelector("#app");
if (!target) throw new Error("missing #app");

mount(App, { target });
