import type { Component, Course, ScaleRule } from "$lib/types";
import { computeEffectiveSubPct, itemLabel } from "$lib/gradeMath";
import { LETTER_CUTOFFS } from "$lib/grading";
import { courseProgress } from "$lib/need";

/** Grades the "need X for …" hints can aim for */
export const TARGETS = LETTER_CUTOFFS.slice(0, 5);
export type TargetLetter = (typeof TARGETS)[number]["letter"];

/** Which grade the estimates are given in */
export type GradeBasis = "absolute" | "curve";

/** Follows the dashboard visibility toggles: the curve only when it's the sole grade shown */
export function gradeBasis(course: Course): GradeBasis {
    return course.hideAbsoluteGrade && !course.hideRelativeGrade ? "curve" : "absolute";
}

/** Highest target grade the course can still reach with full marks on everything left */
export function reachableTarget(course: Course): TargetLetter {
    const { maxPossible } = courseProgress(course);
    return (TARGETS.find((t) => t.min <= maxPossible + 1e-9) ?? TARGETS[TARGETS.length - 1]).letter;
}

/** Up to one decimal, without a trailing ".0" */
export const fmt = (n: number) => String(Math.round(n * 10) / 10);

/** Marks needed, rounded up so the grade is actually reached */
export const fmtNeed = (n: number) => fmt(Math.ceil(n * 10 - 1e-9) / 10);

/** "A", "A and B", "A, B and C" */
export function listNames(names: string[]): string {
    if (names.length <= 1) return names.join("");
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Ids of the graded sub-items that count toward the component under its best-of rule */
export function countedSubIds(course: Course, comp: Component): Set<string> {
    const graded = (comp.subItems ?? [])
        .map((sub) => ({ id: sub.id, pct: computeEffectiveSubPct(course, sub) }))
        .filter((item): item is { id: string; pct: number } => item.pct !== null);
    const kept = comp.bestOf && comp.bestOf < graded.length ? [...graded].sort((a, b) => b.pct - a.pct).slice(0, comp.bestOf) : graded;
    return new Set(kept.map((item) => item.id));
}

/** "whole course", "Quiz 1 + Midsem", or "Quiz 1 + 3 more"; null when not scaled */
export function scaleSummary(course: Course, rule: ScaleRule | null | undefined): string | null {
    if (!rule) return null;
    if (rule.from === "course") return "whole course";
    const names = rule.from.map((id) => itemLabel(course, id)).filter((name): name is string => name !== null);
    if (names.length === 0) return null;
    return names.length > 3 ? `${names.slice(0, 2).join(" + ")} + ${names.length - 2} more` : names.join(" + ");
}
