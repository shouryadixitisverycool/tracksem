/** Absolute letter cutoffs (minimum %), highest first */
export const LETTER_CUTOFFS = [
    { letter: 'A', min: 90 },
    { letter: 'A-', min: 80 },
    { letter: 'B', min: 70 },
    { letter: 'B-', min: 60 },
    { letter: 'C', min: 50 },
    { letter: 'C-', min: 40 },
    { letter: 'D', min: 33 },
] as const;

/** Curved letter cutoffs (minimum percentile) shown in the "what do I need" calculator */
export const CURVED_CUTOFFS = [
    { letter: 'A', percentile: 90 },
    { letter: 'A-', percentile: 80 },
    { letter: 'B', percentile: 65 },
    { letter: 'B-', percentile: 50 },
    { letter: 'C', percentile: 35 },
] as const;

/** IIIT-H 10-point scale */
export const GRADE_POINTS: Record<string, number> = {
    'A': 10,
    'A-': 9,
    'B': 8,
    'B-': 7,
    'C': 6,
    'C-': 5,
    'D': 4,
    'F': 0,
};

export const LETTERS = Object.keys(GRADE_POINTS);

/** Letter grade scale: A, A-, B, B-, C, C-, D, F */
export function getLetterGrade(grade: number | null): string {
    if (grade === null) return '—';
    return LETTER_CUTOFFS.find((cutoff) => grade >= cutoff.min)?.letter ?? 'F';
}

/** Color for the grade tier */
export function getGradeColor(grade: number | null): string {
    if (grade === null) return '#6b7280';
    if (grade >= 90) return '#4ade80';
    if (grade >= 80) return '#86efac';
    if (grade >= 70) return '#60a5fa';
    if (grade >= 60) return '#93c5fd';
    if (grade >= 50) return '#fbbf24';
    if (grade >= 40) return '#fcd34d';
    if (grade >= 33) return '#fb923c';
    return '#f87171';
}

/** Color for a value on the 10-point GPA scale, using the matching letter tier */
export function getGpaColor(gpa: number | null): string {
    if (gpa === null) return getGradeColor(null);
    const tiers: [number, number][] = [[9.5, 90], [8.5, 80], [7.5, 70], [6.5, 60], [5.5, 50], [4.5, 40], [4, 33]];
    return getGradeColor(tiers.find(([points]) => gpa >= points)?.[1] ?? 0);
}
