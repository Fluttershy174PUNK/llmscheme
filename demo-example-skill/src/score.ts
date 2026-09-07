// score cats so the top-list can pick the best ones
import type { Cat } from "./cat.ts";
export interface ScoredCat {
	cat: Cat;
	score: number; // 0..100
	mood: "happy" | "sleepy"; // stamp drawn by caption.ts
}
// ponytail: naive heuristic — url cats look exotic (+15), name length drives the rest
export function scoreCats(cats: Cat[]): ScoredCat[] {
	return cats
		.map((cat) => {
			const score = (cat.name.length % 10) * 7 + (cat.kind === "url" ? 15 : 5);
			const mood: ScoredCat["mood"] = score > 40 ? "happy" : "sleepy";
			return { cat, score, mood };
		})
		.sort((a, b) => b.score - a.score);
}
