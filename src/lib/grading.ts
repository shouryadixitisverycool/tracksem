/** Letter grade scale: A, A-, B, B-, C, C-, D, F */
export function getLetterGrade(grade: number | null): string {
    if (grade === null) return '—';
    if (grade >= 90) return 'A';
    if (grade >= 80) return 'A-';
    if (grade >= 70) return 'B';
    if (grade >= 60) return 'B-';
    if (grade >= 50) return 'C';
    if (grade >= 40) return 'C-';
    if (grade >= 33) return 'D';
    return 'F';
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
