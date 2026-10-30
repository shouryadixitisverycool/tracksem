import type { Course, Component, SubItem } from './types';
import {
    ITEM_CORRELATION,
    buildDistribution,
    combineItems,
    combinedPercentile,
    conditionalMoments,
    distributionMoments,
    gradeFromPercentile,
    inverseNormalCdf,
    percentileToScore,
    predictGrade,
    type CombineItem,
    type PredictedGrade,
    type ScoreDistribution,
} from './curveGrading.ts';

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

/** Spread assumed for items without class stats when nothing has been observed, as a fraction of full marks */
const DEFAULT_ASSUMED_SPREAD = 0.15;
/** Class average assumed for a component without stats when nothing has been observed, as a fraction of full marks */
const DEFAULT_ASSUMED_MEAN = 0.6;

export type StatsSource = Pick<SubItem, 'maxScore' | 'classAvg' | 'classMedian' | 'classMax' | 'classStdDev' | 'classFullPct'>;

// ── Lookup & scale resolution ────────────────────────────────────────────────

type FoundItem =
    | { kind: 'component'; comp: Component }
    | { kind: 'sub'; sub: SubItem; parent: Component };

function findItem(course: Course, id: string): FoundItem | null {
    for (const comp of course.components) {
        if (comp.id === id) return { kind: 'component', comp };
        const sub = comp.subItems?.find((item) => item.id === id);
        if (sub) return { kind: 'sub', sub, parent: comp };
    }
    return null;
}

const itemOf = (item: FoundItem): Component | SubItem => (item.kind === 'component' ? item.comp : item.sub);

/** Id of the component an item belongs to (the item itself for components) */
const ownerOf = (item: FoundItem): string => (item.kind === 'component' ? item.comp.id : item.parent.id);

/** Course weight an item carries on its own: a part gets an even share of its component */
function itemCourseWeight(item: FoundItem): number {
    if (item.kind === 'component') return Math.max(item.comp.weight, 0);
    return Math.max(item.parent.weight, 0) / (item.parent.subItems?.length || 1);
}

/** "Midsem", or "Quizzes / Quiz 1" for a part */
export function itemLabel(course: Course, id: string): string | null {
    const item = findItem(course, id);
    if (!item) return null;
    return item.kind === 'component' ? item.comp.name : `${item.parent.name} / ${item.sub.name}`;
}

export interface ScaleSource {
    id: string;
    /** Relative weight when several sources are averaged */
    weight: number;
}

/**
 * What an item is scaled from, with the weight each source gets. "Whole course" means every other
 * weighted component except ones that are themselves scaled from the whole course. Empty when the
 * item isn't scaled.
 */
export function scaleSources(course: Course, id: string): ScaleSource[] {
    const item = findItem(course, id);
    const rule = item ? itemOf(item).scale : null;
    if (!item || !rule) return [];

    const own = ownerOf(item);
    const found: FoundItem[] =
        rule.from === 'course'
            ? course.components
                  .filter((comp) => comp.id !== own && comp.weight > 0 && comp.scale?.from !== 'course')
                  .map((comp) => ({ kind: 'component' as const, comp }))
            : rule.from
                  .map((sourceId) => findItem(course, sourceId))
                  .filter((source): source is FoundItem => source !== null && itemOf(source).id !== id);

    return found.map((source) => ({
        id: itemOf(source).id,
        weight: rule.combine === 'equal' ? 1 : itemCourseWeight(source),
    }));
}

/**
 * Ids whose percentage `id` reads (its scale sources, or its sub-items). Whole-course items list
 * none: they skip any component that leads back to them, so they can't close a cycle.
 */
function scaleDependencies(item: FoundItem): string[] {
    const rule = itemOf(item).scale;
    if (rule) return rule.from === 'course' ? [] : rule.from;
    if (item.kind === 'sub') return [];
    return item.comp.subItems?.map((sub) => sub.id) ?? [];
}

/**
 * True if scaling `sourceId` from `targetId` would make an item depend on itself
 * (including targeting itself, its own parent component, or its own sub-item).
 */
export function wouldCreateScaleCycle(course: Course, sourceId: string, targetId: string | null): boolean {
    if (!targetId) return false;
    if (targetId === sourceId) return true;

    const source = findItem(course, sourceId);
    const target = findItem(course, targetId);
    if (!source || !target) return false;
    if (source.kind === 'sub' && source.parent.id === targetId) return true;
    if (source.kind === 'component' && target.kind === 'sub' && target.parent.id === sourceId) return true;

    const visited = new Set<string>();
    const stack = [targetId];
    while (stack.length > 0) {
        const id = stack.pop()!;
        if (id === sourceId) return true;
        if (visited.has(id)) continue;
        visited.add(id);
        const item = findItem(course, id);
        if (item) stack.push(...scaleDependencies(item));
    }
    return false;
}

// ── Percentages ──────────────────────────────────────────────────────────────

function average(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function bestOfAverage(pcts: number[], bestOf: number | undefined): number {
    if (bestOf && bestOf < pcts.length) {
        return average([...pcts].sort((a, b) => b - a).slice(0, bestOf));
    }
    return average(pcts);
}

/** Weighted mean; equal weights when every weight is zero */
function weightedMean(entries: { weight: number; value: number }[]): number {
    const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
    if (!(total > 0)) return average(entries.map((entry) => entry.value));
    return entries.reduce((sum, entry) => sum + entry.weight * entry.value, 0) / total;
}

/**
 * Compute the effective percentage (0–100) for a component.
 * - If subItems exist: average of filled scores (best-of if bestOf set)
 * - Otherwise: score / maxScore * 100
 */
export function computeCompPct(comp: Component): number | null {
    if (comp.subItems && comp.subItems.length > 0) {
        const filled = comp.subItems
            .map(computeSubPct)
            .filter((pct): pct is number => pct !== null);
        return filled.length === 0 ? null : bestOfAverage(filled, comp.bestOf);
    }

    if (comp.score === null) return null;
    return (comp.score / comp.maxScore) * 100;
}

export function computeSubPct(sub: SubItem): number | null {
    if (sub.score === null) return null;
    return (sub.score / sub.maxScore) * 100;
}

/** `visited` holds the ids already on the scale chain; revisiting one is a cycle and yields null */
export function computeEffectiveSubPct(course: Course, sub: SubItem, visited: ReadonlySet<string> = new Set()): number | null {
    if (visited.has(sub.id)) return null;
    if (!sub.scale) return computeSubPct(sub);
    const item = findItem(course, sub.id);
    return item ? scaleResult(course, item, new Set(visited).add(sub.id)).pct : null;
}

export function computeEffectiveCompPct(course: Course, comp: Component, visited: ReadonlySet<string> = new Set()): number | null {
    if (visited.has(comp.id)) return null;
    const seen = new Set(visited).add(comp.id);
    if (comp.scale) return scaleResult(course, { kind: 'component', comp }, seen).pct;

    if (comp.subItems && comp.subItems.length > 0) {
        const filled = comp.subItems
            .map((sub) => computeEffectiveSubPct(course, sub, seen))
            .filter((pct): pct is number => pct !== null);
        return filled.length === 0 ? null : bestOfAverage(filled, comp.bestOf);
    }

    return computeCompPct(comp);
}

export function getScaleTargetPct(
    course: Course,
    targetId: string | null | undefined,
    visited: ReadonlySet<string> = new Set(),
): number | null {
    if (!targetId || visited.has(targetId)) return null;
    const target = findItem(course, targetId);
    if (!target) return null;
    return target.kind === 'component'
        ? computeEffectiveCompPct(course, target.comp, visited)
        : computeEffectiveSubPct(course, target.sub, visited);
}

export interface ScaleResult {
    /** The item's resulting %, null until a source has marks */
    pct: number | null;
    /** Method actually used; relative falls back to absolute when stats are missing */
    mode: 'absolute' | 'relative';
    /** Why relative fell back: this item has no class stats, or no graded source does */
    fallback: 'no-own-stats' | 'no-source-stats' | null;
    /** Combined curve standing of the graded sources (relative mode only) */
    standing: PredictedGrade | null;
    sources: (ScaleSource & { pct: number | null })[];
}

/** `visited` must already contain the item's own id */
function scaleResult(course: Course, item: FoundItem, visited: ReadonlySet<string>): ScaleResult {
    const own = itemOf(item);
    const rule = own.scale!;
    const sources = scaleSources(course, own.id).map((source) => ({
        ...source,
        pct: getScaleTargetPct(course, source.id, visited),
    }));
    const graded = sources.filter((source): source is ScaleSource & { pct: number } => source.pct !== null);
    const result: ScaleResult = { pct: null, mode: 'absolute', fallback: null, standing: null, sources };
    if (graded.length === 0) return { ...result, mode: rule.mode };

    result.pct = weightedMean(graded.map((source) => ({ weight: source.weight, value: source.pct })));
    if (rule.mode === 'absolute') return result;

    const standing = sourceStanding(course, graded, visited);
    if (!standing) return { ...result, fallback: 'no-source-stats' };
    const dist = itemDistribution(course, own);
    if (!dist || !(own.maxScore > 0)) return { ...result, standing, fallback: 'no-own-stats' };
    const score = percentileToScore(standing.percentile, dist);
    return { ...result, standing, mode: 'relative', pct: Math.min(Math.max((score / own.maxScore) * 100, 0), 100) };
}

/** How a scaled item gets its marks, for display; null when the item isn't scaled */
export function explainScale(course: Course, id: string): ScaleResult | null {
    const item = findItem(course, id);
    if (!item || !itemOf(item).scale) return null;
    return scaleResult(course, item, new Set([id]));
}

/**
 * Fraction of a scaled item that rides on each source: the graded sources (plus `assumeGraded`),
 * or all of them while none has marks.
 */
function sourceShares(
    course: Course,
    id: string,
    visited: ReadonlySet<string>,
    isGraded: (sourceId: string) => boolean = () => false,
): Map<string, number> {
    const sources = scaleSources(course, id);
    const graded = sources.filter((source) => isGraded(source.id) || getScaleTargetPct(course, source.id, visited) !== null);
    const pool = graded.length > 0 ? graded : sources;
    const total = pool.reduce((sum, source) => sum + source.weight, 0);
    return new Map(pool.map((source) => [source.id, total > 0 ? source.weight / total : 1 / pool.length]));
}

/** Share of scaled item `id` that moves with each source, treating `assumeGraded` as if it had marks */
export function scaleShares(course: Course, id: string, assumeGraded?: string): Map<string, number> {
    return sourceShares(course, id, new Set([id]), (sourceId) => sourceId === assumeGraded);
}

export function effectiveComponentWeight(course: Course, componentId: string): number {
    const comp = course.components.find((item) => item.id === componentId);
    if (!comp || comp.scale) return 0;

    return course.components.reduce(
        (sum, item) => sum + (item.scale ? item.weight * (scaleShares(course, item.id).get(componentId) ?? 0) : 0),
        comp.weight
    );
}

// ── Per-item predictions ─────────────────────────────────────────────────────

/** Item stats usable for a curve: an average within [0, max]; otherwise the item counts as stat-less */
function hasStats(item: StatsSource): boolean {
    return item.classAvg != null && item.maxScore > 0 && item.classAvg >= 0 && item.classAvg <= item.maxScore;
}

/** Fitted score distribution for an item with class stats; null without an average */
export function itemDistribution(course: Course, item: StatsSource): ScoreDistribution | null {
    if (!hasStats(item)) return null;
    return buildDistribution(item.maxScore, {
        avg: item.classAvg!,
        median: item.classMedian,
        max: item.classMax,
        stdDev: item.classStdDev,
        fullPct: item.classFullPct,
    }, course.classSize);
}

/** Curve prediction for one item scoring `pct`% against its own class stats */
export function predictItem(course: Course, item: StatsSource, pct: number | null): PredictedGrade | null {
    if (pct === null || !hasStats(item)) return null;
    return predictGrade((pct / 100) * item.maxScore, item.maxScore, {
        avg: item.classAvg!,
        median: item.classMedian,
        max: item.classMax,
        stdDev: item.classStdDev,
        fullPct: item.classFullPct,
    }, course.classSize);
}

/** Expected value of the mean of the top `k` of `n` standard normals (Blom's order-statistic approximation) */
function expectedTopMean(k: number, n: number): number {
    let sum = 0;
    for (let r = 1; r <= k; r++) sum += inverseNormalCdf((n - r + 1 - 0.375) / (n + 0.25));
    return sum / k;
}

/**
 * Distribution a global-stats component's percentage is ranked against. The stats describe a
 * single item, but with best-of every student drops their worst items too. Under the model
 * (score = μ + σ(√ρ·G + √(1−ρ)·E_j)) the class's best-k-of-n average is higher by
 * σ·√(1−ρ)·E[mean of top k of n normals]; the spread is left unchanged.
 */
function componentDistribution(course: Course, comp: Component, visited: ReadonlySet<string>): ScoreDistribution | null {
    const dist = itemDistribution(course, comp);
    if (!dist || !comp.bestOf || !comp.subItems?.length) return dist;

    const seen = new Set(visited).add(comp.id);
    const filled = comp.subItems.filter((sub) => computeEffectiveSubPct(course, sub, seen) !== null).length;
    if (comp.bestOf >= filled) return dist;

    const shift = distributionMoments(dist).sd * Math.sqrt(1 - ITEM_CORRELATION) * expectedTopMean(comp.bestOf, filled);
    return { ...dist, center: dist.center + shift };
}

// ── Course model: leaves ─────────────────────────────────────────────────────

/** One independently ranked item, with the course weight that rides on it */
interface Leaf {
    id: string;
    /** Component the item belongs to */
    componentId: string;
    weight: number;
    maxScore: number;
    /** Class distribution; null when the item has no usable stats */
    dist: ScoreDistribution | null;
    /** Student's marks; null when ungraded */
    score: number | null;
    unbounded?: boolean;
}

interface Override {
    dist: ScoreDistribution;
    score: number;
}

class LeafSet {
    leaves = new Map<string, Leaf>();

    add(leaf: Leaf): void {
        const existing = this.leaves.get(leaf.id);
        if (existing) existing.weight += leaf.weight;
        else this.leaves.set(leaf.id, { ...leaf });
    }

    list(): Leaf[] {
        return [...this.leaves.values()].filter((leaf) => leaf.weight > 0);
    }
}

function isObserved(leaf: Leaf): leaf is Leaf & { dist: ScoreDistribution; score: number } {
    return leaf.dist !== null && leaf.score !== null;
}

/**
 * Spread `weight` over the items whose scores determine `id`. Course percentages are linear in
 * item percentages, so a scaled item simply adds its weight to whatever its target expands to.
 * Returns false if `id` is already on the chain (a cycle) or doesn't exist.
 */
function expandTarget(
    course: Course,
    id: string,
    weight: number,
    visited: ReadonlySet<string>,
    out: LeafSet,
    overrides?: ReadonlyMap<string, Override>,
): boolean {
    if (visited.has(id)) return false;
    const item = findItem(course, id);
    if (!item) return false;
    if (item.kind === 'component') expandComponent(course, item.comp, weight, visited, out, overrides);
    else expandSub(course, item.sub, item.parent, weight, visited, out, overrides);
    return true;
}

/** Spread a scaled item's weight over its sources; false when none of them can be expanded */
function expandScaled(
    course: Course,
    id: string,
    weight: number,
    visited: ReadonlySet<string>,
    out: LeafSet,
    overrides?: ReadonlyMap<string, Override>,
): boolean {
    let expanded = false;
    const shares = sourceShares(course, id, visited, (sourceId) => overrides?.has(sourceId) ?? false);
    for (const [sourceId, share] of shares) {
        if (expandTarget(course, sourceId, weight * share, visited, out, overrides)) expanded = true;
    }
    return expanded;
}

function expandComponent(
    course: Course,
    comp: Component,
    weight: number,
    visited: ReadonlySet<string>,
    out: LeafSet,
    overrides?: ReadonlyMap<string, Override>,
): void {
    const seen = new Set(visited).add(comp.id);
    const ungraded: Leaf = { id: comp.id, componentId: comp.id, weight, maxScore: comp.maxScore, dist: null, score: null };

    if (comp.scale) {
        if (!expandScaled(course, comp.id, weight, seen, out, overrides)) out.add(ungraded);
        return;
    }

    const override = overrides?.get(comp.id);
    if (override) {
        out.add({ ...ungraded, dist: override.dist, score: override.score, unbounded: true });
        return;
    }

    if (comp.statsMode === 'per-sub' && comp.subItems && comp.subItems.length > 0) {
        const filled = comp.subItems
            .map((sub) => ({ sub, pct: computeEffectiveSubPct(course, sub, seen) }))
            .filter((entry): entry is { sub: SubItem; pct: number } => entry.pct !== null);
        if (filled.length === 0) {
            out.add(ungraded);
            return;
        }
        const kept = comp.bestOf && comp.bestOf < filled.length
            ? [...filled].sort((a, b) => b.pct - a.pct).slice(0, comp.bestOf)
            : filled;
        for (const { sub } of kept) expandSub(course, sub, comp, weight / kept.length, seen, out, overrides);
        return;
    }

    const pct = computeEffectiveCompPct(course, comp, visited);
    out.add({
        ...ungraded,
        dist: componentDistribution(course, comp, visited),
        score: pct === null ? null : (pct / 100) * comp.maxScore,
    });
}

function expandSub(
    course: Course,
    sub: SubItem,
    parent: Component,
    weight: number,
    visited: ReadonlySet<string>,
    out: LeafSet,
    overrides?: ReadonlyMap<string, Override>,
): void {
    const leaf: Leaf = { id: sub.id, componentId: parent.id, weight, maxScore: sub.maxScore, dist: null, score: null };
    if (sub.scale) {
        if (!expandScaled(course, sub.id, weight, new Set(visited).add(sub.id), out, overrides)) out.add(leaf);
        return;
    }
    out.add({ ...leaf, dist: itemDistribution(course, sub), score: sub.score });
}

function courseLeaves(course: Course, overrides?: ReadonlyMap<string, Override>): Leaf[] {
    const out = new LeafSet();
    for (const comp of course.components) {
        if (comp.weight > 0) expandComponent(course, comp, comp.weight, new Set(), out, overrides);
    }
    return out.list();
}

function toCombineItem(leaf: Leaf & { dist: ScoreDistribution; score: number }): CombineItem {
    return { weight: leaf.weight, dist: leaf.dist, score: leaf.score, unbounded: leaf.unbounded };
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Typical class mean and SD (fractions of full marks) of the observed leaves */
function observedShape(leaves: Leaf[]): { mean: number; spread: number } | null {
    const shapes = leaves.filter(isObserved).map((leaf) => {
        const { mean, sd } = distributionMoments(leaf.dist);
        return { mean: mean / leaf.dist.paperMax, spread: sd / leaf.dist.paperMax };
    });
    if (shapes.length === 0) return null;
    return { mean: median(shapes.map((s) => s.mean)), spread: median(shapes.map((s) => s.spread)) };
}

/**
 * Raw final percentile with every unobserved leaf (ungraded, or graded without class stats)
 * filled in by its expectation given the observed standing: latent z ~ N(ρ·z_obs, 1 − ρ²).
 * Leaves without stats are assumed normal with the observed leaves' typical spread.
 */
function projectLeaves(leaves: Leaf[], classSize: number | null | undefined): { percentile: number; spread: number } | null {
    const observed = leaves.filter(isObserved);
    const current = combinedPercentile(observed.map(toCombineItem), { classSize });
    if (!current) return null;

    const rho = ITEM_CORRELATION;
    const zObs = inverseNormalCdf(Math.min(Math.max(current.percentile, 0.01), 99.99) / 100);
    const spread = observedShape(observed)?.spread ?? DEFAULT_ASSUMED_SPREAD;

    const items = leaves.map((leaf): CombineItem => {
        if (isObserved(leaf)) return toCombineItem(leaf);
        if (leaf.dist) {
            const { mean } = conditionalMoments(leaf.dist, rho * zObs, Math.sqrt(1 - rho * rho));
            return { weight: leaf.weight, dist: leaf.dist, score: mean };
        }
        const assumed: ScoreDistribution = { center: 0, sigmaLeft: spread, sigmaRight: spread, paperMax: Infinity };
        return { weight: leaf.weight, dist: assumed, score: rho * zObs * spread };
    });

    return combinedPercentile(items, { classSize });
}

// ── Public course-level predictions ──────────────────────────────────────────

function totalCourseWeight(course: Course): number {
    return course.components.reduce((sum, comp) => sum + Math.max(comp.weight, 0), 0);
}

/** Overall curved grade: standing on the weighted total of items that have a score AND class stats */
export function courseCurvedGrade(course: Course): CourseCurvedGrade | null {
    const leaves = courseLeaves(course);
    const observed = leaves.filter(isObserved);
    const current = combineItems(observed.map(toCombineItem), { classSize: course.classSize });
    if (!current) return null;

    const total = totalCourseWeight(course);
    const used = observed.reduce((sum, leaf) => sum + leaf.weight, 0);
    const projected = projectLeaves(leaves, course.classSize);

    return {
        ...current,
        coverage: total > 0 ? Math.min(used / total, 1) : 0,
        projected: projected ? gradeFromPercentile(projected.percentile, projected.spread, course.classSize) : null,
    };
}

/** A component's own curved standing (scaled components take their sources') */
export function componentPrediction(course: Course, comp: Component): PredictedGrade | null {
    return itemPrediction(course, comp.id, new Set());
}

function itemPrediction(course: Course, id: string, visited: ReadonlySet<string>): PredictedGrade | null {
    if (visited.has(id)) return null;
    const item = findItem(course, id);
    if (!item) return null;

    const out = new LeafSet();
    if (item.kind === 'sub') {
        if (!item.sub.scale) return predictItem(course, item.sub, computeSubPct(item.sub));
        expandSub(course, item.sub, item.parent, 1, visited, out);
    } else {
        expandComponent(course, item.comp, 1, visited, out);
    }
    const observed = out.list().filter(isObserved);
    return combineItems(observed.map(toCombineItem), { classSize: course.classSize });
}

/** Combined curve standing of a set of weighted items */
function sourceStanding(course: Course, sources: ScaleSource[], visited: ReadonlySet<string>): PredictedGrade | null {
    const out = new LeafSet();
    for (const source of sources) expandTarget(course, source.id, source.weight > 0 ? source.weight : 1, visited, out);
    const observed = out.list().filter(isObserved);
    return combineItems(observed.map(toCombineItem), { classSize: course.classSize });
}

/** Curved standing of any item (component or part) on its own, for display */
export function standingOf(course: Course, id: string): PredictedGrade | null {
    return itemPrediction(course, id, new Set());
}

/** Distribution assumed for a component without its own stats: the typical shape of what's been graded */
function assumedDistribution(course: Course, comp: Component, leaves: Leaf[]): ScoreDistribution {
    const own = new LeafSet();
    expandComponent(course, comp, 1, new Set(), own);
    const shape = observedShape(own.list()) ?? observedShape(leaves) ?? { mean: DEFAULT_ASSUMED_MEAN, spread: DEFAULT_ASSUMED_SPREAD };
    return buildDistribution(comp.maxScore, {
        avg: shape.mean * comp.maxScore,
        stdDev: shape.spread * comp.maxScore,
    }, course.classSize);
}

/** Projected final percentile of the course as a function of the raw score on one component */
export interface PercentileSolver {
    maxScore: number;
    /** True when the component's class stats were assumed rather than entered */
    assumedStats: boolean;
    /** Projected final percentile if the component scores `score` raw marks; NaN when it can't be projected */
    percentileAt(score: number): number;
}

/**
 * Builds a solver for "what if I score X on this component". Other unobserved components are
 * projected from the resulting standing. Null for scaled or weightless components.
 */
export function percentileSolver(course: Course, componentId: string): PercentileSolver | null {
    const comp = course.components.find((item) => item.id === componentId);
    if (!comp || comp.scale || !(comp.maxScore > 0)) return null;

    const perSub = comp.statsMode === 'per-sub' && !!comp.subItems?.length;
    const ownDist = perSub ? null : componentDistribution(course, comp, new Set());
    const assumedStats = ownDist === null;
    const dist = ownDist ?? assumedDistribution(course, comp, courseLeaves(course));

    const leaves = courseLeaves(course, new Map([[comp.id, { dist, score: 0 }]]));
    const leaf = leaves.find((item) => item.id === comp.id);
    if (!leaf) return null;

    return {
        maxScore: comp.maxScore,
        assumedStats,
        percentileAt(score: number) {
            leaf.score = score;
            return projectLeaves(leaves, course.classSize)?.percentile ?? NaN;
        },
    };
}

/**
 * Raw score needed on a component for the course's projected final percentile to reach
 * `targetPercentile`. Other unobserved components are projected from the resulting standing.
 */
export function requiredScoreForPercentile(
    course: Course,
    componentId: string,
    targetPercentile: number,
): RequiredScore | null {
    if (!Number.isFinite(targetPercentile)) return null;
    const solver = percentileSolver(course, componentId);
    if (!solver) return null;

    const target = Math.min(Math.max(targetPercentile, 0.01), 99.99);
    const at = (score: number) => solver.percentileAt(score);

    const M = solver.maxScore;
    const result = (score: number): RequiredScore => ({ score, maxScore: M, reachable: score <= M, assumedStats: solver.assumedStats });

    const atZero = at(0);
    if (Number.isNaN(atZero)) return null;
    if (atZero >= target) return result(0);

    let hi = M;
    while (at(hi) < target) {
        hi *= 2;
        if (hi > 1000 * M) return null;
    }
    let lo = hi === M ? 0 : hi / 2;
    while (hi - lo > M * 1e-4) {
        const mid = (lo + hi) / 2;
        if (at(mid) < target) lo = mid;
        else hi = mid;
    }
    return result(hi);
}
