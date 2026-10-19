import type { Component, Course } from './types';
import { computeEffectiveCompPct, computeEffectiveSubPct } from './stores/grades.svelte';

export type CourseProgress = {
    /** Weighted marks earned so far, on a 0–100 scale of the whole course */
    secured: number;
    /** Course total if every ungraded component gets full marks */
    maxPossible: number;
    totalWeight: number;
};

export function courseProgress(course: Course): CourseProgress {
    let earned = 0;
    let ungradedWeight = 0;
    let totalWeight = 0;
    for (const comp of course.components) {
        totalWeight += comp.weight;
        const pct = computeEffectiveCompPct(course, comp);
        if (pct === null) ungradedWeight += comp.weight;
        else earned += (pct * comp.weight) / 100;
    }
    if (totalWeight === 0) return { secured: 0, maxPossible: 0, totalWeight };
    return {
        secured: (earned * 100) / totalWeight,
        maxPossible: ((earned + ungradedWeight) * 100) / totalWeight,
        totalWeight
    };
}

/**
 * "same": every other ungraded component scores the same % as this one.
 * "last": other ungraded components are left out, as if this were the last one to count.
 */
export type NeedMode = 'same' | 'last';

/** Components the calculator can solve for (scaled components follow their target instead) */
export function needCandidates(course: Course): Component[] {
    return course.components.filter((comp) => !comp.scaleTargetId && comp.weight > 0);
}

/**
 * % the component must average for the course total to reach `targetPct`, given current weights.
 * Components scaled to it move with it. Returns null when it carries no weight.
 */
export function requiredPct(course: Course, componentId: string, targetPct: number, mode: NeedMode): number | null {
    const comp = course.components.find((c) => c.id === componentId);
    if (!comp) return null;

    let solveWeight = 0;
    let earned = 0;
    let gradedWeight = 0;
    let otherUngraded = 0;
    let totalWeight = 0;

    for (const item of course.components) {
        totalWeight += item.weight;
        if (item.id === componentId || item.scaleTargetId === componentId) {
            solveWeight += item.weight;
            continue;
        }
        const pct = computeEffectiveCompPct(course, item);
        if (pct === null) {
            otherUngraded += item.weight;
        } else {
            earned += (pct * item.weight) / 100;
            gradedWeight += item.weight;
        }
    }

    if (solveWeight <= 0) return null;
    if (mode === 'same') return ((targetPct * totalWeight) / 100 - earned) * 100 / (solveWeight + otherUngraded);
    return ((targetPct * (gradedWeight + solveWeight)) / 100 - earned) * 100 / solveWeight;
}

/**
 * For a partially graded component averaged over sub-items (no best-of), the average needed on
 * the remaining sub-items to reach `componentPct`. Null when not applicable.
 */
export function remainingSubAverage(course: Course, comp: Component, componentPct: number): { pct: number; count: number } | null {
    if (!comp.subItems?.length || comp.bestOf) return null;
    const filled = comp.subItems
        .map((sub) => computeEffectiveSubPct(course, sub))
        .filter((pct): pct is number => pct !== null);
    const remaining = comp.subItems.length - filled.length;
    if (filled.length === 0 || remaining === 0) return null;
    const sum = filled.reduce((a, b) => a + b, 0);
    return { pct: (componentPct * comp.subItems.length - sum) / remaining, count: remaining };
}
