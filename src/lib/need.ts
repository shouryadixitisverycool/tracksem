import type { Component, Course } from './types';
import { computeEffectiveCompPct, computeEffectiveSubPct, getScaleTargetPct, scaleShares } from './gradeMath.ts';

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

type NeedSplit = {
    /** Weight of the component plus everything scaled to it */
    solveWeight: number;
    /** Weighted marks already earned elsewhere */
    earned: number;
    gradedWeight: number;
    /** Weight of the other ungraded components */
    otherUngraded: number;
    totalWeight: number;
};

function needSplit(course: Course, componentId: string): NeedSplit | null {
    if (!course.components.some((c) => c.id === componentId)) return null;
    const split: NeedSplit = { solveWeight: 0, earned: 0, gradedWeight: 0, otherUngraded: 0, totalWeight: 0 };
    for (const item of course.components) {
        split.totalWeight += item.weight;
        if (item.id === componentId) {
            split.solveWeight += item.weight;
            continue;
        }
        const shares = item.scale ? scaleShares(course, item.id, componentId) : null;
        const share = shares?.get(componentId);
        if (shares && share !== undefined) {
            // Scaled partly from this component: that share moves with it, the rest is already decided
            split.solveWeight += item.weight * share;
            for (const [sourceId, other] of shares) {
                const pct = sourceId === componentId ? null : getScaleTargetPct(course, sourceId, new Set([item.id]));
                if (pct === null) continue;
                split.earned += (pct * item.weight * other) / 100;
                split.gradedWeight += item.weight * other;
            }
            continue;
        }
        const pct = computeEffectiveCompPct(course, item);
        if (pct === null) {
            split.otherUngraded += item.weight;
        } else {
            split.earned += (pct * item.weight) / 100;
            split.gradedWeight += item.weight;
        }
    }
    return split.solveWeight > 0 ? split : null;
}

/** True when scaled component `item` takes part of its marks from `componentId` */
function scalesFrom(course: Course, item: Component, componentId: string): boolean {
    return !!item.scale && scaleShares(course, item.id, componentId).has(componentId);
}

/**
 * % the component must average for the course total to reach `targetPct`, given current weights.
 * Components scaled to it move with it. Returns null when it carries no weight.
 */
export function requiredPct(course: Course, componentId: string, targetPct: number, mode: NeedMode): number | null {
    const s = needSplit(course, componentId);
    if (!s) return null;
    if (mode === 'same') return ((targetPct * s.totalWeight) / 100 - s.earned) * 100 / (s.solveWeight + s.otherUngraded);
    return ((targetPct * (s.gradedWeight + s.solveWeight)) / 100 - s.earned) * 100 / s.solveWeight;
}

/** Course % if the component averages `pct`%: the inverse of `requiredPct` */
export function projectedPctIfScored(course: Course, componentId: string, pct: number, mode: NeedMode): number | null {
    const s = needSplit(course, componentId);
    if (!s) return null;
    if (mode === 'same') return s.totalWeight > 0 ? ((s.earned + (pct * (s.solveWeight + s.otherUngraded)) / 100) * 100) / s.totalWeight : null;
    return ((s.earned + (pct * s.solveWeight) / 100) * 100) / (s.gradedWeight + s.solveWeight);
}

/** Ungraded components other than `componentId` and the items scaled to it */
export function otherUngraded(course: Course, componentId: string): Component[] {
    return course.components.filter(
        (item) =>
            item.id !== componentId &&
            !scalesFrom(course, item, componentId) &&
            item.weight > 0 &&
            computeEffectiveCompPct(course, item) === null
    );
}

/** Average % every ungraded component needs for the course to reach `targetPct`; null when nothing is left */
export function requiredAcrossRemaining(course: Course, targetPct: number): { pct: number; remaining: Component[] } | null {
    let earned = 0;
    let open = 0;
    let total = 0;
    const remaining: Component[] = [];
    for (const comp of course.components) {
        total += comp.weight;
        const pct = computeEffectiveCompPct(course, comp);
        if (pct !== null) earned += (pct * comp.weight) / 100;
        else if (comp.weight > 0) {
            open += comp.weight;
            remaining.push(comp);
        }
    }
    if (open <= 0) return null;
    return { pct: ((targetPct * total) / 100 - earned) * 100 / open, remaining };
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
