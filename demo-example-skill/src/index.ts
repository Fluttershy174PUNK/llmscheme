// fast lookup by name (implemented by agent from scheme n14)
import type { Cat } from "./cat.ts";
export function indexByName(cats: Cat[]): Map<string, Cat> {
	return new Map(cats.map((c) => [c.name, c]));
}
