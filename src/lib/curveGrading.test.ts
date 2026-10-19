import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildDistribution,
    combineItems,
    combineStandings,
    normalCdf,
    predictGrade,
    validateStats,
    type ClassStats,
    type ScoreDistribution,
} from './curveGrading.ts';

const CONFIGS: { max: number; stats: ClassStats; n?: number }[] = [
    { max: 100, stats: { avg: 50, stdDev: 15 } },
    { max: 100, stats: { avg: 75, median: 82, stdDev: 13 } },
    { max: 100, stats: { avg: 70, median: 82, stdDev: 12 } },
    { max: 100, stats: { avg: 70, median: 82 } },
    { max: 100, stats: { avg: 50, median: 40, max: 95 }, n: 60 },
    { max: 10, stats: { avg: 9.2, median: 10 } },
    { max: 10, stats: { avg: 9.2 } },
    { max: 10, stats: { avg: 9.2, fullPct: 30 } },
    { max: 10, stats: { avg: 8.5, median: 9, fullPct: 20 } },
    { max: 40, stats: { avg: 38.15, max: 40 }, n: 250 },
    { max: 15, stats: { avg: 2.9, median: 2.5, max: 11, stdDev: 1.746 }, n: 250 },
    { max: 100, stats: { avg: 48.25, median: 50, max: 87.5, stdDev: 194 }, n: 250 },
];

test('normalCdf is accurate into the tails', () => {
    const reference: [number, number][] = [
        [-1, 0.15865525393145707],
        [-3, 0.0013498980316301035],
        [-5, 2.866515718791939e-7],
        [-8, 6.220960574271785e-16],
        [1.96, 0.9750021048517795],
    ];
    for (const [z, p] of reference) {
        assert.ok(Math.abs(normalCdf(z) - p) / p < 1e-7, `Φ(${z})`);
    }
});

test('percentile is monotone in score and stays within [0, 100]', () => {
    for (const { max, stats, n } of CONFIGS) {
        let previous = -Infinity;
        for (let i = 0; i <= 400; i++) {
            const score = (i / 400) * max;
            const { percentile } = predictGrade(score, max, stats, n);
            assert.ok(percentile >= previous - 1e-9, `${JSON.stringify(stats)} at ${score}`);
            assert.ok(percentile >= 0 && percentile <= 100);
            previous = percentile;
        }
    }
});

test('the median scores P50', () => {
    for (const stats of [
        { avg: 75, median: 82, stdDev: 13 },
        { avg: 70, median: 82, stdDev: 12 },
        { avg: 50, median: 40 },
        { avg: 60, median: 62, max: 90 },
    ]) {
        assert.ok(Math.abs(predictGrade(stats.median, 100, stats).percentile - 50) < 1e-9);
    }
});

test('no cliff when mean and median are far apart', () => {
    for (const stats of [{ avg: 70, median: 82, stdDev: 12 }, { avg: 70, median: 82 }, { avg: 50, median: 40, stdDev: 10 }]) {
        const below = predictGrade(stats.median - 1, 100, stats).percentile;
        const above = predictGrade(stats.median + 1, 100, stats).percentile;
        assert.ok(above - below < 15, `${JSON.stringify(stats)}: ${below} → ${above}`);
    }
});

test('half the class on full marks puts full marks at the tie midpoint', () => {
    assert.ok(Math.abs(predictGrade(10, 10, { avg: 9.2, median: 10 }).percentile - 75) < 1e-6);
});

test('classFullPct sets the tied mass at full marks', () => {
    for (const fullPct of [10, 30, 60]) {
        const stats = { avg: 9, fullPct };
        assert.ok(Math.abs(predictGrade(10, 10, stats).percentile - ((100 - fullPct) + fullPct / 2)) < 1e-6);
        assert.ok(predictGrade(9.999, 10, stats).percentile <= 100 - fullPct + 1e-6);
    }
    const withMedian = { avg: 8.5, median: 9, fullPct: 20 };
    assert.ok(Math.abs(predictGrade(10, 10, withMedian).percentile - 90) < 1e-6);
    assert.ok(Math.abs(predictGrade(9, 10, withMedian).percentile - 50) < 1e-6);
});

test('high-average items without stats get a realistic spread below full marks', () => {
    const full = predictGrade(40, 40, { avg: 38.15, max: 40 }, 250).percentile;
    assert.ok(full > 70 && full < 95, `full marks at P${full}`);
});

test('class size clamps item percentiles to [50/n, 100 − 50/n]', () => {
    assert.equal(predictGrade(0, 100, { avg: 80, stdDev: 5 }, 20).percentile, 2.5);
    assert.equal(predictGrade(100, 100, { avg: 30, stdDev: 5 }, 20).percentile, 97.5);
});

test('impossible stats are ignored instead of dominating', () => {
    const typo = predictGrade(46, 100, { avg: 48.25, median: 50, max: 87.5, stdDev: 194 }, 250);
    const clean = predictGrade(46, 100, { avg: 48.25, median: 50, max: 87.5 }, 250);
    assert.equal(typo.percentile, clean.percentile);
    assert.ok(typo.spread < 0.3);
});

test('validateStats flags hard errors', () => {
    const fieldsWith = (input: Parameters<typeof validateStats>[0], level: 'error' | 'warning') =>
        validateStats(input).filter((issue) => issue.level === level).map((issue) => issue.field);

    assert.deepEqual(fieldsWith({ maxScore: 100, classAvg: 48.25, classStdDev: 194 }, 'error'), ['classStdDev']);
    assert.deepEqual(fieldsWith({ maxScore: 10, classAvg: 12 }, 'error'), ['classAvg']);
    assert.deepEqual(fieldsWith({ maxScore: 10, classMedian: -1 }, 'error'), ['classMedian']);
    assert.deepEqual(fieldsWith({ maxScore: 100, classAvg: 60, classMedian: 80, classMax: 70 }, 'error'), ['classMedian']);
    assert.deepEqual(fieldsWith({ maxScore: 100, classAvg: 75, classMax: 70 }, 'error'), ['classAvg']);
    assert.deepEqual(fieldsWith({ maxScore: 100, score: 110 }, 'error'), ['score']);
    assert.deepEqual(fieldsWith({ maxScore: 100, classFullPct: 120 }, 'error'), ['classFullPct']);
    assert.deepEqual(fieldsWith({ maxScore: 100, classAvg: 60, classMax: 70, classStdDev: 30 }, 'error'), ['classStdDev']);
});

test('validateStats warns about suspicious but possible stats', () => {
    const warnings = (input: Parameters<typeof validateStats>[0]) =>
        validateStats(input).filter((issue) => issue.level === 'warning').map((issue) => issue.field);

    assert.deepEqual(warnings({ maxScore: 100, classAvg: 60, classMedian: 75, classStdDev: 10 }), ['classStdDev']);
    assert.deepEqual(warnings({ maxScore: 100, score: 90, classAvg: 60, classMax: 80 }), ['score']);
    assert.deepEqual(warnings({ maxScore: 100, classAvg: 50, classMax: 95, classStdDev: 5 }), ['classStdDev']);
    assert.deepEqual(warnings({ maxScore: 100, classAvg: 50, classMax: 60, classStdDev: 15 }), ['classStdDev']);
    assert.deepEqual(warnings({ maxScore: 100, classAvg: 60, classMax: 90, classFullPct: 10 }), ['classFullPct']);
    assert.deepEqual(validateStats({ maxScore: 100, score: 70, classAvg: 60, classMedian: 62, classMax: 95, classStdDev: 12, classFullPct: 0 }), []);
});

/** Linear congruential generator, so the Monte Carlo check is deterministic */
function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return (state + 0.5) / 4294967296;
    };
}

function monteCarloPercentile(items: { weight: number; dist: ScoreDistribution; score: number }[], samples: number): number {
    const random = seededRandom(42);
    const normal = () => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
    const sample = (dist: ScoreDistribution, z: number) =>
        Math.min(Math.max(dist.center + z * (z < 0 ? dist.sigmaLeft : dist.sigmaRight), 0), dist.paperMax);
    const mine = items.reduce((sum, item) => sum + (item.weight * item.score) / item.dist.paperMax, 0);

    let below = 0;
    for (let i = 0; i < samples; i++) {
        const shared = normal();
        let total = 0;
        for (const item of items) {
            total += (item.weight * sample(item.dist, Math.SQRT1_2 * shared + Math.SQRT1_2 * normal())) / item.dist.paperMax;
        }
        if (Math.abs(total - mine) < 1e-9) below += 0.5;
        else if (total < mine) below += 1;
    }
    return (below / samples) * 100;
}

test('combination agrees with a Monte Carlo class for skewed items', () => {
    const quiz = buildDistribution(100, { avg: 75, median: 82, stdDev: 13 });
    const midsem = buildDistribution(100, { avg: 50, stdDev: 15 });
    const cases = [
        [{ weight: 30, dist: quiz, score: 92 }, { weight: 30, dist: midsem, score: 50 }],
        [{ weight: 30, dist: quiz, score: 62 }, { weight: 30, dist: midsem, score: 50 }],
        [{ weight: 30, dist: quiz, score: 82 }, { weight: 1, dist: midsem, score: 50 }],
    ];
    for (const items of cases) {
        const model = combineItems(items, { classSize: 1e6 })!.percentile;
        const truth = monteCarloPercentile(items, 60000);
        assert.ok(Math.abs(model - truth) < 2.5, `model P${model.toFixed(1)} vs Monte Carlo P${truth.toFixed(1)}`);
    }
});

test('a single item combines to its own percentile', () => {
    const dist = buildDistribution(100, { avg: 75, median: 82, stdDev: 13 });
    const alone = combineItems([{ weight: 40, dist, score: 88 }])!.percentile;
    assert.ok(Math.abs(alone - predictGrade(88, 100, { avg: 75, median: 82, stdDev: 13 }).percentile) < 1e-9);
});

test('class size bounds one disaster in a combination', () => {
    const dist = buildDistribution(100, { avg: 80, stdDev: 5 });
    const other = buildDistribution(100, { avg: 50, stdDev: 15 });
    const combined = combineItems([{ weight: 50, dist, score: 0 }, { weight: 50, dist: other, score: 80 }], { classSize: 20 })!;
    assert.ok(combined.percentile >= 2.5);
    assert.ok(combined.percentile > 10, `P${combined.percentile}`);
});

test('combineStandings takes a correlation', () => {
    const standing = { z: 1, spread: 0.15 };
    const duplicated = combineStandings([{ weight: 20, standing }, { weight: 30, standing }], 1)!;
    assert.ok(Math.abs(duplicated.z - 1) < 1e-12);
    assert.ok(combineStandings([{ weight: 20, standing }, { weight: 30, standing }])!.z > 1);
});
