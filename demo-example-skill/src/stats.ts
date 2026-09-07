// verbose-only stats: mood histogram (optional branch)
import { MOODS } from "./caption.ts";
import type { Mood } from "./mood.ts";
export function stats(moods: Mood[]): string {
	const hist = Object.fromEntries(
		MOODS.map((m) => [m, moods.filter((x) => x === m).length]),
	);
	return `moods: ${JSON.stringify(hist)}`;
}
