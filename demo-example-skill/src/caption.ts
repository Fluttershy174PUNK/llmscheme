// caption: mood -> text stamp drawn over the picture
import type { Mood } from "./mood.ts";
const STAMPS: Record<Mood, string> = {
	happy: ":purr:",
	grumpy: ">:(",
	sleepy: "z-z-Z",
};
export function caption(mood: Mood): string {
	return STAMPS[mood] ?? ":)";
}
export const MOODS = Object.keys(STAMPS) as Mood[];
