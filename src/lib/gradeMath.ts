import type { Course, Component } from './types';
import type { PredictedGrade } from './curveGrading';

export interface CourseCurvedGrade extends PredictedGrade {
    /** Fraction (0–1) of total course weight that fed this prediction */
    coverage: number;
    /** Predicted final standing with ungraded / stat-less components projected in */
    projected: PredictedGrade | null;
}

export interface RequiredScore {
    /** Raw marks needed on the component (may exceed maxScore when unreachable) */
    score: number;
    maxScore: number;
    reachable: boolean;
    /** True when the component's class stats were assumed rather than entered */
    assumedStats: boolean;
}

// TODO(model agent): stub — returns false until scale resolution is moved here
export function wouldCreateScaleCycle(_course: Course, _sourceId: string, _targetId: string | null): boolean {
    return false;
}

// TODO(model agent): stub
export function componentPrediction(_course: Course, _comp: Component): PredictedGrade | null {
    return null;
}

// TODO(model agent): stub
export function requiredScoreForPercentile(
    _course: Course,
    _componentId: string,
    _targetPercentile: number,
): RequiredScore | null {
    return null;
}
