// write the gallery html to disk
import fs from "node:fs";
import type { Gallery } from "./gallery.ts";
export function writeGallery(g: Gallery, out = "cats.html"): string {
	fs.writeFileSync(out, g.html);
	return out;
}
