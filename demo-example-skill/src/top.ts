// pick the head of the top-list
import type { ScoredCat } from "./score.ts";
export function topCat(scored: ScoredCat[]): ScoredCat | undefined {
	return scored[0];
}
