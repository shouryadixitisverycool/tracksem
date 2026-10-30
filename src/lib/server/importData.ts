import type { Component, Course, ScaleRule, SubItem } from '$lib/types';
import type { ImportSemester } from './db';
import * as v from './validation';

const LIMITS = { semesters: 50, courses: 50, components: 100, subItems: 200, text: 200 };

class ImportError extends Error {}

type Obj = Record<string, unknown>;

function asObject(value: unknown, where: string): Obj {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ImportError(`${where} must be an object`);
	return value as Obj;
}

function asArray(value: unknown, where: string, max: number): unknown[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) throw new ImportError(`${where} must be a list`);
	if (value.length > max) throw new ImportError(`${where} has more than ${max} entries`);
	return value;
}

function check<T>(validator: v.Validator, value: unknown, where: string): T {
	const result = validator(value);
	if (!result.ok) throw new ImportError(`${where}: ${result.error}`);
	return result.value as T;
}

function text(value: unknown, where: string, fallback?: string): string {
	if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
	if (typeof value !== 'string' || !value.trim()) throw new ImportError(`${where} must be non-empty text`);
	return value.trim().slice(0, LIMITS.text);
}

function refId(value: unknown, fallback: string): string {
	return typeof value === 'string' && value.length > 0 && value.length <= 255 ? value : fallback;
}

function optionalRef(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 && value.length <= 255 ? value : null;
}

/** Scale rule, or the single scaleTargetId of older exports; an unreadable rule is dropped */
function scaleRule(raw: Obj): ScaleRule | null {
	const parsed = v.scale(raw.scale);
	if (parsed.ok && parsed.value) return parsed.value as ScaleRule;
	const legacy = optionalRef(raw.scaleTargetId);
	return legacy ? { from: [legacy], mode: 'absolute', combine: 'weight' } : null;
}

function stats(raw: Obj, where: string) {
	return {
		classAvg: check<number | null>(v.nonNegativeOrNull, raw.classAvg, `${where}.classAvg`),
		classMedian: check<number | null>(v.nonNegativeOrNull, raw.classMedian, `${where}.classMedian`),
		classMax: check<number | null>(v.nonNegativeOrNull, raw.classMax, `${where}.classMax`),
		classStdDev: check<number | null>(v.nonNegativeOrNull, raw.classStdDev, `${where}.classStdDev`),
		classFullPct: check<number | null>(v.percentOrNull, raw.classFullPct, `${where}.classFullPct`)
	};
}

function parseSubItem(value: unknown, where: string): SubItem {
	const raw = asObject(value, where);
	return {
		id: refId(raw.id, crypto.randomUUID()),
		name: check<string>(v.name, raw.name, `${where}.name`),
		score: check<number | null>(v.nonNegativeOrNull, raw.score, `${where}.score`),
		maxScore: check<number>(v.positiveNumber, raw.maxScore, `${where}.maxScore`),
		scale: scaleRule(raw),
		...stats(raw, where)
	};
}

function parseComponent(value: unknown, where: string): Component {
	const raw = asObject(value, where);
	const subItems = asArray(raw.subItems, `${where}.subItems`, LIMITS.subItems).map((sub, i) =>
		parseSubItem(sub, `${where}.subItems[${i}]`)
	);
	return {
		id: refId(raw.id, crypto.randomUUID()),
		name: check<string>(v.name, raw.name, `${where}.name`),
		weight: check<number>(v.weight, raw.weight, `${where}.weight`),
		maxScore: check<number>(v.positiveNumber, raw.maxScore, `${where}.maxScore`),
		score: check<number | null>(v.nonNegativeOrNull, raw.score, `${where}.score`),
		bestOf: check<number | null>(v.bestOf, raw.bestOf, `${where}.bestOf`) ?? undefined,
		statsMode: raw.statsMode === 'per-sub' ? 'per-sub' : 'global',
		scale: scaleRule(raw),
		...stats(raw, where),
		subItems: subItems.length > 0 ? subItems : undefined
	};
}

function parseCourse(value: unknown, where: string): Course {
	const raw = asObject(value, where);
	const name = check<string>(v.name, raw.name, `${where}.name`);
	return {
		id: crypto.randomUUID(),
		name,
		fullName: text(raw.fullName, `${where}.fullName`, name),
		color: v.color(raw.color).ok ? (raw.color as string) : '#22d3ee',
		hideAbsoluteGrade: raw.hideAbsoluteGrade === true,
		hideRelativeGrade: raw.hideRelativeGrade === true,
		classSize: check<number | null>(v.classSize, raw.classSize, `${where}.classSize`),
		credits: check<number | null>(v.credits, raw.credits, `${where}.credits`),
		officialGrade: check<string | null>(v.officialGrade, raw.officialGrade, `${where}.officialGrade`),
		templateId: v.isSafeId(raw.templateId) ? raw.templateId : null,
		components: asArray(raw.components, `${where}.components`, LIMITS.components).map((comp, i) =>
			parseComponent(comp, `${where}.components[${i}]`)
		)
	};
}

/** Validate a tracksem JSON export; returns semesters ready for importSemesters() */
export function parseImport(payload: unknown): { ok: true; semesters: ImportSemester[] } | { ok: false; error: string } {
	try {
		const root = asObject(payload, 'file');
		if (root.app !== undefined && root.app !== 'tracksem') throw new ImportError('not a tracksem export');
		const rawSemesters = asArray(root.semesters, 'semesters', LIMITS.semesters);
		if (rawSemesters.length === 0) throw new ImportError('the file contains no semesters');

		const semesters = rawSemesters.map((value, i) => {
			const where = `semesters[${i}]`;
			const raw = asObject(value, where);
			return {
				label: `${text(raw.label, `${where}.label`, `Semester ${i + 1}`)} (imported)`,
				branch: text(raw.branch, `${where}.branch`, 'unknown'),
				semester: text(raw.semester, `${where}.semester`, 'unknown'),
				courses: asArray(raw.courses, `${where}.courses`, LIMITS.courses).map((course, j) =>
					parseCourse(course, `${where}.courses[${j}]`)
				)
			};
		});
		return { ok: true, semesters };
	} catch (error) {
		if (error instanceof ImportError) return { ok: false, error: error.message };
		throw error;
	}
}
