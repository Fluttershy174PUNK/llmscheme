// verbose-only summary line
import type { Gallery } from "./gallery.ts";
export function report(g: Gallery, out: string): string {
	return `${g.title}: ${g.count} cats -> ${out}`;
}
