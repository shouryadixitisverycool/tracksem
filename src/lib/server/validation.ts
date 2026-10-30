import { GRADE_POINTS } from '$lib/grading';

export const MAX_NAME_LENGTH = 100;

const SAFE_ID = /^[A-Za-z0-9_-]{1,255}$/;

export function isSafeId(value: unknown): value is string {
	return typeof value === 'string' && SAFE_ID.test(value);
}

export type Validated<T = unknown> = { ok: true; value: T } | { ok: false; error: string };
export type Validator = (value: unknown) => Validated;

const ok = <T>(value: T): Validated<T> => ({ ok: true, value });
const fail = (error: string): Validated<never> => ({ ok: false, error });

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

export const nonNegativeOrNull: Validator = (value) => {
	if (value === null || value === undefined) return ok(null);
	return isFiniteNumber(value) && value >= 0 ? ok(value) : fail('must be a number ≥ 0 or empty');
};

export const positiveNumber: Validator = (value) =>
	isFiniteNumber(value) && value > 0 ? ok(value) : fail('must be a number > 0');

export const weight: Validator = (value) =>
	isFiniteNumber(value) && value >= 0 && value <= 100 ? ok(value) : fail('weight must be between 0 and 100');

export const percentOrNull: Validator = (value) => {
	if (value === null || value === undefined) return ok(null);
	return isFiniteNumber(value) && value >= 0 && value <= 100 ? ok(value) : fail('must be between 0 and 100 or empty');
};

export const bestOf: Validator = (value) => {
	if (value === null || value === undefined) return ok(null);
	return Number.isInteger(value) && (value as number) >= 1 ? ok(value) : fail('best-of must be a whole number ≥ 1');
};

export const statsMode: Validator = (value) =>
	value === 'global' || value === 'per-sub' ? ok(value) : fail("stats mode must be 'global' or 'per-sub'");

export const name: Validator = (value) => {
	if (typeof value !== 'string') return fail('name must be text');
	const trimmed = value.trim();
	if (!trimmed) return fail('name cannot be empty');
	if (trimmed.length > MAX_NAME_LENGTH) return fail(`name must be at most ${MAX_NAME_LENGTH} characters`);
	return ok(trimmed);
};

export const MAX_SCALE_SOURCES = 50;

/**
 * A scale rule ({ from: ids | 'course', mode, combine }) or null to stop scaling. Shape check only;
 * same-course and cycle checks need the course and live in db.ts.
 */
export const scale: Validator = (value) => {
	if (value === null || value === undefined) return ok(null);
	if (typeof value !== 'object' || Array.isArray(value)) return fail('scale must be an object or null');
	const raw = value as Record<string, unknown>;
	const mode = raw.mode ?? 'absolute';
	const combine = raw.combine ?? 'weight';
	if (mode !== 'absolute' && mode !== 'relative') return fail("scale mode must be 'absolute' or 'relative'");
	if (combine !== 'weight' && combine !== 'equal') return fail("scale combine must be 'weight' or 'equal'");

	if (raw.from === 'course') return ok({ from: 'course', mode, combine });
	if (!Array.isArray(raw.from) || raw.from.length === 0) return fail("scale from must be a list of item ids or 'course'");
	if (raw.from.length > MAX_SCALE_SOURCES) return fail(`scale from can list at most ${MAX_SCALE_SOURCES} items`);
	if (!raw.from.every(isSafeId)) return fail('invalid scale source id');
	return ok({ from: [...new Set(raw.from as string[])], mode, combine });
};

export const classSize: Validator = (value) => {
	if (value === null || value === undefined) return ok(null);
	return Number.isInteger(value) && (value as number) > 0 ? ok(value) : fail('class size must be a whole number > 0');
};

export const credits: Validator = (value) => {
	if (value === null || value === undefined) return ok(null);
	return isFiniteNumber(value) && value >= 0 && value <= 40 ? ok(value) : fail('credits must be between 0 and 40');
};

export const officialGrade: Validator = (value) => {
	if (value === null || value === undefined || value === '') return ok(null);
	return typeof value === 'string' && value in GRADE_POINTS ? ok(value) : fail('unknown letter grade');
};

export const color: Validator = (value) =>
	typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value) ? ok(value) : fail('color must be a hex value');

export const COMPONENT_FIELDS: Record<string, Validator> = {
	score: nonNegativeOrNull,
	weight,
	maxScore: positiveNumber,
	name,
	bestOf,
	statsMode,
	scale,
	classAvg: nonNegativeOrNull,
	classMedian: nonNegativeOrNull,
	classMax: nonNegativeOrNull,
	classStdDev: nonNegativeOrNull,
	classFullPct: percentOrNull
};

export const SUB_ITEM_FIELDS: Record<string, Validator> = {
	score: nonNegativeOrNull,
	maxScore: positiveNumber,
	name,
	scale,
	classAvg: nonNegativeOrNull,
	classMedian: nonNegativeOrNull,
	classMax: nonNegativeOrNull,
	classStdDev: nonNegativeOrNull,
	classFullPct: percentOrNull
};

export const COURSE_FIELDS: Record<string, Validator> = {
	name,
	fullName: name,
	classSize,
	credits,
	officialGrade
};

export function validateField(fields: Record<string, Validator>, field: unknown, value: unknown): Validated {
	if (typeof field !== 'string' || !Object.hasOwn(fields, field)) return fail('unknown field');
	const result = fields[field](value);
	return result.ok ? result : fail(`${field}: ${result.error}`);
}

export function jsonError(status: number, error: string): Response {
	return Response.json({ error }, { status });
}

/** Parse a JSON request body, returning null for malformed or non-object bodies */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
	try {
		const body = await request.json();
		return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}
