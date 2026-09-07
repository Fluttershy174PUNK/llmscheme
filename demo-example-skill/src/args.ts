// parse CLI arguments into a typed config object
export interface Args {
	input: string;
	output: string;
	verbose: boolean;
}
export function parseArgs(argv: string[]): Args {
	const [input, output] = argv;
	return {
		input: input ?? "cats.txt",
		output: output ?? "cats.html",
		verbose: argv.includes("-v"),
	};
}
