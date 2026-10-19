import type { Course } from './types';
import { computeEffectiveCompPct, courseCurvedGrade } from './gradeMath';
import { GRADE_POINTS, getLetterGrade } from './grading';

export type GpaBasis = 'curved' | 'absolute';

/** Weighted % over graded components; mirrors grades.projectedGrade for courses outside the active semester */
export function absoluteGrade(course: Course): number | null {
    let weightedSum = 0;
    let filledWeight = 0;
    for (const comp of course.components) {
        const pct = computeEffectiveCompPct(course, comp);
        if (pct === null) continue;
        weightedSum += pct * comp.weight;
        filledWeight += comp.weight;
    }
    return filledWeight > 0 ? weightedSum / filledWeight : null;
}

/** Curved letter for courses outside the active semester */
export function curvedLetter(course: Course): string | null {
    return courseCurvedGrade(course)?.letter ?? null;
}

export type GpaGrade = { letter: string | null; source: 'official' | 'curved' | 'absolute' | null };

/** Official grade, else the predicted letter on the chosen basis (falling back to the other); hidden grades are skipped */
export function gradeForGpa(course: Course, basis: GpaBasis, absolute: number | null, curved: string | null): GpaGrade {
    if (course.officialGrade && course.officialGrade in GRADE_POINTS) {
        return { letter: course.officialGrade, source: 'official' };
    }
    const abs = absolute !== null && !course.hideAbsoluteGrade ? getLetterGrade(absolute) : null;
    const cur = curved && !course.hideRelativeGrade ? curved : null;
    const order: ['curved' | 'absolute', string | null][] =
        basis === 'curved' ? [['curved', cur], ['absolute', abs]] : [['absolute', abs], ['curved', cur]];
    const pick = order.find(([, letter]) => letter !== null);
    return pick ? { letter: pick[1], source: pick[0] } : { letter: null, source: null };
}

export type GpaSummary = {
    gpa: number | null;
    /** Credits that contributed */
    credits: number;
    /** Courses that contributed */
    counted: number;
    total: number;
};

export function computeGpa(entries: { credits: number | null | undefined; letter: string | null }[]): GpaSummary {
    let points = 0;
    let credits = 0;
    let counted = 0;
    for (const entry of entries) {
        if (!entry.letter || !entry.credits || !(entry.letter in GRADE_POINTS)) continue;
        points += GRADE_POINTS[entry.letter] * entry.credits;
        credits += entry.credits;
        counted++;
    }
    return { gpa: credits > 0 ? points / credits : null, credits, counted, total: entries.length };
}
