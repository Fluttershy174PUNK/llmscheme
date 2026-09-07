// drop duplicate cats by name (added by agent from scheme n13)
import type { Cat } from "./cat.ts";
export function dedupCats(cats: Cat[]): Cat[] {
	const seen = new Set<string>();
	return cats.filter((c) =>
		seen.has(c.name) ? false : (seen.add(c.name), true),
	);
}
