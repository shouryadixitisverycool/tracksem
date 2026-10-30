import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Component, Course, ScaleRule, SubItem } from './types';
import {
    componentPrediction,
    computeEffectiveCompPct,
    courseCurvedGrade,
    explainScale,
    getScaleTargetPct,
    predictItem,
    requiredScoreForPercentile,
    wouldCreateScaleCycle,
} from './gradeMath.ts';

function course(components: Component[], classSize: number | null = 200): Course {
    return { id: 'c', name: 'C', fullName: 'Course', color: '#fff', classSize, components };
}

function comp(id: string, weight: number, extra: Partial<Component> = {}): Component {
    return { id, name: id, weight, maxScore: 100, score: null, ...extra };
}

function sub(id: string, score: number | null, extra: Partial<SubItem> = {}): SubItem {
    return { id, name: id, score, maxScore: 10, ...extra };
}

const abs = (...from: string[]): ScaleRule => ({ from, mode: 'absolute', combine: 'weight' });
const rule = (from: string[] | 'course', extra: Partial<ScaleRule> = {}): ScaleRule => ({ from, mode: 'absolute', combine: 'weight', ...extra });

const near = (a: number, b: number, tolerance = 1e-6) => Math.abs(a - b) < tolerance;

test('scale cycles terminate and resolve to null', () => {
    const c = course([
        comp('a', 20, { scale: abs('b') }),
        comp('b', 20, { scale: abs('a') }),
        comp('mid', 30, { score: 70, classAvg: 50, classStdDev: 15 }),
    ]);
    assert.equal(computeEffectiveCompPct(c, c.components[0]), null);
    assert.equal(getScaleTargetPct(c, 'a'), null);
    assert.equal(componentPrediction(c, c.components[0]), null);
    const grade = courseCurvedGrade(c)!;
    assert.ok(near(grade.coverage, 30 / 70));

    const selfSub = course([comp('q', 20, { subItems: [sub('q1', 5, { scale: abs('q') })] })]);
    assert.equal(computeEffectiveCompPct(selfSub, selfSub.components[0]), null);
    assert.equal(courseCurvedGrade(selfSub), null);
});

test('wouldCreateScaleCycle', () => {
    const c = course([
        comp('a', 20, { scale: abs('b') }),
        comp('b', 20),
        comp('q', 20, { subItems: [sub('q1', 5), sub('q2', 6, { scale: abs('a') })] }),
        comp('m', 20),
    ]);
    assert.equal(wouldCreateScaleCycle(c, 'm', null), false);
    assert.equal(wouldCreateScaleCycle(c, 'm', 'm'), true);
    assert.equal(wouldCreateScaleCycle(c, 'q1', 'q'), true);
    assert.equal(wouldCreateScaleCycle(c, 'q', 'q1'), true);
    assert.equal(wouldCreateScaleCycle(c, 'b', 'a'), true);
    assert.equal(wouldCreateScaleCycle(c, 'b', 'q'), true);
    assert.equal(wouldCreateScaleCycle(c, 'm', 'a'), false);
    assert.equal(wouldCreateScaleCycle(c, 'm', 'q2'), false);
    assert.equal(wouldCreateScaleCycle(c, 'q1', 'b'), false);
});

test('a scaled component matches its target and is not double counted', () => {
    const midStats = { classAvg: 50, classMedian: 47, classStdDev: 15 };
    const scaled = course([
        comp('mid', 30, { score: 72, ...midStats }),
        comp('end', 40, { scale: abs('mid') }),
        comp('quiz', 30, { score: 6, maxScore: 10, classAvg: 7, classStdDev: 1.5 }),
    ]);
    const merged = course([
        comp('mid', 70, { score: 72, ...midStats }),
        comp('quiz', 30, { score: 6, maxScore: 10, classAvg: 7, classStdDev: 1.5 }),
    ]);
    const a = courseCurvedGrade(scaled)!;
    const b = courseCurvedGrade(merged)!;
    assert.ok(near(a.percentile, b.percentile));
    assert.equal(a.coverage, 1);
    assert.deepEqual(componentPrediction(scaled, scaled.components[1]), componentPrediction(scaled, scaled.components[0]));
});

test('a component scaled from a per-sub sub-item folds into that sub-item', () => {
    const stats = { classAvg: 6, classStdDev: 2 };
    const scaled = course([
        comp('q', 20, { statsMode: 'per-sub', subItems: [sub('q1', 8, stats), sub('q2', 5, stats)] }),
        comp('end', 30, { scale: abs('q1') }),
    ]);
    const merged = course([
        comp('q1', 40, { score: 8, maxScore: 10, ...stats }),
        comp('q2', 10, { score: 5, maxScore: 10, ...stats }),
    ]);
    assert.ok(near(courseCurvedGrade(scaled)!.percentile, courseCurvedGrade(merged)!.percentile));
});

test('per-sub best-of combines only the top subs', () => {
    const stats = { classAvg: 6, classMedian: 6.5, classStdDev: 2 };
    const subs = [sub('s1', 9, stats), sub('s2', 3, stats), sub('s3', 7, stats)];
    const bestTwo = course([comp('q', 20, { statsMode: 'per-sub', bestOf: 2, subItems: subs })]);
    const topOnly = course([comp('q', 20, { statsMode: 'per-sub', subItems: [subs[0], subs[2]] })]);
    const all = course([comp('q', 20, { statsMode: 'per-sub', subItems: subs })]);
    assert.ok(near(courseCurvedGrade(bestTwo)!.percentile, courseCurvedGrade(topOnly)!.percentile));
    assert.ok(courseCurvedGrade(bestTwo)!.percentile > courseCurvedGrade(all)!.percentile);
});

test('global best-of ranks against a class that also dropped its worst', () => {
    const quizzes = comp('q', 20, {
        maxScore: 10,
        bestOf: 3,
        classAvg: 6,
        classStdDev: 2,
        subItems: [sub('s1', 8), sub('s2', 7), sub('s3', 9), sub('s4', 2), sub('s5', 4)],
    });
    const c = course([quizzes]);
    const naive = predictItem(c, quizzes, computeEffectiveCompPct(c, quizzes))!;
    const shifted = componentPrediction(c, quizzes)!;
    assert.ok(shifted.percentile < naive.percentile - 5, `${shifted.percentile} vs ${naive.percentile}`);
});

test('coverage counts only weight that has both a score and stats', () => {
    const c = course([
        comp('mid', 30, { score: 60, classAvg: 50, classStdDev: 15 }),
        comp('lab', 20, { score: 80 }),
        comp('end', 50),
    ]);
    assert.ok(near(courseCurvedGrade(c)!.coverage, 0.3));

    const perSub = course([
        comp('q', 40, { statsMode: 'per-sub', subItems: [sub('q1', 7, { classAvg: 6 }), sub('q2', 8), sub('q3', null)] }),
        comp('end', 60),
    ]);
    assert.ok(near(courseCurvedGrade(perSub)!.coverage, 0.2));
    assert.equal(courseCurvedGrade(course([comp('end', 60)])), null);
});

test('class size clamps the course percentile', () => {
    const c = course([
        comp('mid', 50, { score: 0, classAvg: 80, classStdDev: 5 }),
        comp('end', 50, { score: 20, classAvg: 70, classStdDev: 8 }),
    ], 40);
    const grade = courseCurvedGrade(c)!;
    assert.ok(grade.percentile >= 50 / 40 - 1e-9);
});

test('projection pulls toward the middle for the ungraded part', () => {
    const c = course([
        comp('mid', 40, { score: 80, classAvg: 55, classStdDev: 15 }),
        comp('end', 60),
    ]);
    const grade = courseCurvedGrade(c)!;
    assert.ok(grade.projected);
    assert.ok(grade.projected.percentile > 50 && grade.projected.percentile < grade.percentile);

    const complete = course([comp('mid', 40, { score: 80, classAvg: 55, classStdDev: 15 })]);
    const full = courseCurvedGrade(complete)!;
    assert.ok(near(full.projected!.percentile, full.percentile));
});

test('required score rises with the target and flags unreachable targets', () => {
    const c = course([
        comp('mid', 40, { score: 60, classAvg: 55, classStdDev: 15 }),
        comp('end', 60, { classAvg: 50, classStdDev: 15 }),
    ]);
    const low = requiredScoreForPercentile(c, 'end', 40)!;
    const high = requiredScoreForPercentile(c, 'end', 80)!;
    assert.ok(high.score > low.score);
    assert.equal(high.reachable, true);
    assert.equal(high.assumedStats, false);

    const graded = course([c.components[0], { ...c.components[1], score: high.score }]);
    assert.ok(Math.abs(courseCurvedGrade(graded)!.percentile - 80) < 0.5);

    const extreme = requiredScoreForPercentile(c, 'end', 99.9)!;
    assert.equal(extreme.reachable, false);
    assert.ok(extreme.score > 100);
});

test('required score assumes stats when the component has none', () => {
    const c = course([
        comp('mid', 40, { score: 60, classAvg: 55, classStdDev: 15 }),
        comp('end', 60),
        comp('copy', 10, { scale: abs('mid') }),
    ]);
    const required = requiredScoreForPercentile(c, 'end', 70)!;
    assert.equal(required.assumedStats, true);
    assert.ok(required.score > 0 && required.score <= 100);
    assert.equal(requiredScoreForPercentile(c, 'copy', 70), null);
    assert.equal(requiredScoreForPercentile(c, 'missing', 70), null);
});

test('several sources average by course weight or equally', () => {
    const items = [comp('q1', 10, { score: 75 }), comp('mid', 30, { score: 52.5 }), comp('end', 40)];
    const weighted = course([...items, comp('q2', 10, { maxScore: 20, scale: abs('q1', 'mid', 'end') })]);
    assert.ok(near(computeEffectiveCompPct(weighted, weighted.components[3])!, (75 * 10 + 52.5 * 30) / 40));
    const equal = course([...items, comp('q2', 10, { scale: rule(['q1', 'mid'], { combine: 'equal' }) })]);
    assert.ok(near(computeEffectiveCompPct(equal, equal.components[3])!, (75 + 52.5) / 2));
    const none = course([comp('end', 40), comp('q2', 10, { scale: abs('end') })]);
    assert.equal(computeEffectiveCompPct(none, none.components[1]), null);
});

test('whole course skips the item itself and other whole-course items', () => {
    const c = course([
        comp('q1', 10, { score: 80 }),
        comp('mid', 30, { score: 60 }),
        comp('a', 10, { scale: rule('course') }),
        comp('b', 10, { scale: rule('course') }),
        comp('zero', 0, { score: 0 }),
    ]);
    const expected = (80 * 10 + 60 * 30) / 40;
    assert.ok(near(computeEffectiveCompPct(c, c.components[2])!, expected));
    assert.ok(near(computeEffectiveCompPct(c, c.components[3])!, expected));
    assert.deepEqual(explainScale(c, 'a')!.sources.map((s) => s.id), ['q1', 'mid']);
});

test('whole course leaves out components that read back from it', () => {
    const c = course([
        comp('mid', 30, { score: 60 }),
        comp('w', 20, { scale: rule('course') }),
        comp('copy', 20, { scale: abs('w') }),
    ]);
    assert.equal(wouldCreateScaleCycle(c, 'copy', 'w'), false);
    assert.ok(near(computeEffectiveCompPct(c, c.components[1])!, 60));
    assert.ok(near(computeEffectiveCompPct(c, c.components[2])!, 60));
    assert.ok(courseCurvedGrade(course([{ ...c.components[0], classAvg: 50, classStdDev: 10 }, c.components[1], c.components[2]])));
});

test('relative scaling places the source standing on the item curve', () => {
    const c = course([
        comp('mid', 30, { score: 65, classAvg: 50, classStdDev: 15 }),
        comp('q2', 10, { maxScore: 20, classAvg: 11, classStdDev: 4, scale: rule(['mid'], { mode: 'relative' }) }),
    ]);
    const result = explainScale(c, 'q2')!;
    assert.equal(result.mode, 'relative');
    assert.equal(result.fallback, null);
    const own = predictItem(c, c.components[1], result.pct)!;
    assert.ok(Math.abs(own.percentile - result.standing!.percentile) < 0.5, `${own.percentile} vs ${result.standing!.percentile}`);
    assert.ok(result.pct! > 55 && result.pct! < 100);
});

test('relative scaling falls back to absolute without stats', () => {
    const noOwn = course([
        comp('mid', 30, { score: 65, classAvg: 50, classStdDev: 15 }),
        comp('q2', 10, { scale: rule(['mid'], { mode: 'relative' }) }),
    ]);
    const a = explainScale(noOwn, 'q2')!;
    assert.equal(a.mode, 'absolute');
    assert.equal(a.fallback, 'no-own-stats');
    assert.ok(near(a.pct!, 65));

    const noSource = course([
        comp('lab', 30, { score: 70 }),
        comp('q2', 10, { classAvg: 50, scale: rule(['lab'], { mode: 'relative' }) }),
    ]);
    const b = explainScale(noSource, 'q2')!;
    assert.equal(b.fallback, 'no-source-stats');
    assert.ok(near(b.pct!, 70));
});
