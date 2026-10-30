// Computed views of courses for MCP agents. Computed numbers are rounded to 2 decimals.
import type { Course, ScaleRule } from '../../types.ts';
import {
	componentPrediction,
	computeEffectiveCompPct,
	computeEffectiveSubPct,
	courseCurvedGrade,
	effectiveComponentWeight,
} from '../../gradeMath.ts';
import { absoluteGrade, computeGpa, curvedLetter, gradeForGpa, type GpaBasis, type GpaSummary } from '../../gpa.ts';
import { getLetterGrade } from '../../grading.ts';
import { courseProgress } from '../../need.ts';

/** One line per course for listings: computed grades, no component tree */
export type CourseSummary = {
	id: string;
	name: string;
	fullName: string;
	semesterId: string | null;
	credits: number | null;
	officialGrade: string | null;
	/** Weighted % over graded components (null when nothing is graded) */
	absolutePct: number | null;
	absoluteLetter: string | null;
	curvedLetter: string | null;
	curvedPercentile: number | null;
	/** Fraction 0–1 of course weight that has a score */
	gradedWeightFraction: number;
	/** Marks secured so far and the max reachable, on 0–100 of the whole course */
	secured: number;
	maxPossible: number;
};

export type ClassStats = {
	avg: number | null;
	median: number | null;
	max: number | null;
	stdDev: number | null;
	/** Percentage (0–100) of the class that scored full marks */
	fullPct: number | null;
};

export type SubItemDetail = {
	id: string;
	name: string;
	score: number | null;
	maxScore: number;
	/** Effective % (worked out from the scale sources when scaled), null if ungraded */
	pct: number | null;
	scale: ScaleRule | null;
	classStats: ClassStats;
};

export type ComponentDetail = {
	id: string;
	name: string;
	/** Weight as entered */
	weight: number;
	/** Weight after the shares of items scaled from this one are folded in (0 when it is scaled itself) */
	effectiveWeight: number;
	maxScore: number;
	/** Raw marks entered on the component itself (null when it's averaged from sub-items) */
	score: number | null;
	/** Effective % (0–100), null if ungraded */
	pct: number | null;
	bestOf: number | null;
	statsMode: 'global' | 'per-sub';
	/** Marks taken from other items instead of entered: sources ids or 'course', absolute or relative */
	scale: ScaleRule | null;
	classStats: ClassStats;
	/** Curved standing of this component on its own class stats */
	curved: { letter: string; percentile: number } | null;
	subItems: SubItemDetail[];
};

/** Course-level curved standing; projected fills in ungraded and stat-less components */
export type CurvedDetail = {
	letter: string;
	percentile: number;
	/** Fraction 0–1 of course weight that fed this prediction */
	coverage: number;
	projectedLetter: string | null;
	projectedPercentile: number | null;
};

/** The full editable tree plus computed values per component */
export type CourseDetail = CourseSummary & {
	classSize: number | null;
	hideAbsoluteGrade: boolean;
	hideRelativeGrade: boolean;
	templateId: string | null;
	totalWeight: number;
	curved: CurvedDetail | null;
	components: ComponentDetail[];
};

/** Rounds to 2 decimals; null for missing or non-finite values */
export function round2(value: number | null | undefined): number | null {
	if (value === null || value === undefined || !Number.isFinite(value)) return null;
	return Math.round(value * 100) / 100;
}

type StatsSource = {
	classAvg?: number | null;
	classMedian?: number | null;
	classMax?: number | null;
	classStdDev?: number | null;
	classFullPct?: number | null;
};

function statsOf(item: StatsSource): ClassStats {
	return {
		avg: item.classAvg ?? null,
		median: item.classMedian ?? null,
		max: item.classMax ?? null,
		stdDev: item.classStdDev ?? null,
		fullPct: item.classFullPct ?? null,
	};
}

/** Course-level GPA basis: same grade rules as the dashboard SGPA (official grade first, hidden grades skipped) */
export function semesterGpa(courses: Course[], basis: GpaBasis = 'curved'): GpaSummary {
	return computeGpa(
		courses.map((course) => ({
			credits: course.credits,
			letter: gradeForGpa(course, basis, absoluteGrade(course), curvedLetter(course)).letter,
		}))
	);
}

/** Cumulative GPA over every course given (uses the same default basis as the dashboard) */
export function cumulativeGpa(courses: Course[]): GpaSummary {
	return semesterGpa(courses);
}

export function summarizeCourse(course: Course): CourseSummary {
	const absolute = absoluteGrade(course);
	const curved = courseCurvedGrade(course);
	const progress = courseProgress(course);

	let totalWeight = 0;
	let gradedWeight = 0;
	for (const comp of course.components) {
		totalWeight += comp.weight;
		if (computeEffectiveCompPct(course, comp) !== null) gradedWeight += comp.weight;
	}

	return {
		id: course.id,
		name: course.name,
		fullName: course.fullName,
		semesterId: course.semesterId ?? null,
		credits: course.credits ?? null,
		officialGrade: course.officialGrade ?? null,
		absolutePct: round2(absolute),
		absoluteLetter: absolute === null ? null : getLetterGrade(absolute),
		curvedLetter: curved?.letter ?? null,
		curvedPercentile: round2(curved?.percentile),
		gradedWeightFraction: totalWeight > 0 ? round2(gradedWeight / totalWeight) ?? 0 : 0,
		secured: round2(progress.secured) ?? 0,
		maxPossible: round2(progress.maxPossible) ?? 0,
	};
}

function describeCurved(course: Course): CurvedDetail | null {
	const curved = courseCurvedGrade(course);
	if (!curved) return null;
	return {
		letter: curved.letter,
		percentile: round2(curved.percentile) ?? 0,
		coverage: round2(curved.coverage) ?? 0,
		projectedLetter: curved.projected?.letter ?? null,
		projectedPercentile: round2(curved.projected?.percentile),
	};
}

function describeComponent(course: Course, comp: Course['components'][number]): ComponentDetail {
	const prediction = componentPrediction(course, comp);
	return {
		id: comp.id,
		name: comp.name,
		weight: comp.weight,
		effectiveWeight: round2(effectiveComponentWeight(course, comp.id)) ?? 0,
		maxScore: comp.maxScore,
		score: comp.score,
		pct: round2(computeEffectiveCompPct(course, comp)),
		bestOf: comp.bestOf ?? null,
		statsMode: comp.statsMode ?? 'global',
		scale: comp.scale ?? null,
		classStats: statsOf(comp),
		curved: prediction ? { letter: prediction.letter, percentile: round2(prediction.percentile) ?? 0 } : null,
		subItems: (comp.subItems ?? []).map((sub) => ({
			id: sub.id,
			name: sub.name,
			score: sub.score,
			maxScore: sub.maxScore,
			pct: round2(computeEffectiveSubPct(course, sub)),
			scale: sub.scale ?? null,
			classStats: statsOf(sub),
		})),
	};
}

export function describeCourse(course: Course): CourseDetail {
	return {
		...summarizeCourse(course),
		classSize: course.classSize ?? null,
		hideAbsoluteGrade: !!course.hideAbsoluteGrade,
		hideRelativeGrade: !!course.hideRelativeGrade,
		templateId: course.templateId ?? null,
		totalWeight: course.components.reduce((sum, comp) => sum + comp.weight, 0),
		curved: describeCurved(course),
		components: course.components.map((comp) => describeComponent(course, comp)),
	};
}
