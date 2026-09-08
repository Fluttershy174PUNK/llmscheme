import type { Validation } from "./types.ts";

// Plain fields + explicit assignment, NOT TS parameter properties
// (`constructor(public x: T)`): those need a transform, and Node's native
// type-stripping refuses them. Keeping the core as .ts means Node runs it
// directly — that only holds while every file stays erasable-syntax-only.
export class DataError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DataError";
	}
}

export class CasError extends Error {
	expected: number;
	actual: number;
	constructor(expected: number, actual: number) {
		super(`scheme changed on disk (rev ${expected} → ${actual}), re-read and retry`);
		this.name = "CasError";
		this.expected = expected;
		this.actual = actual;
	}
}

export class ValidationError extends Error {
	issues: Validation;
	constructor(issues: Validation) {
		super(`validation failed: ${issues.errors.map((e) => e.message).join("; ")}`);
		this.name = "ValidationError";
		this.issues = issues;
	}
}
