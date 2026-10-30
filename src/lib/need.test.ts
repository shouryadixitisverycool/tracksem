import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Component, Course, ScaleRule } from './types';
import { computeEffectiveCompPct } from './gradeMath.ts';
import { otherUngraded, projectedPctIfScored, requiredAcrossRemaining, requiredPct } from './need.ts';

const comp = (id: string, weight: number, score: number | null, maxScore = 100): Component => ({
    id,
    name: id,
    weight,
    maxScore,
    score
});

const abs = (...from: string[]): ScaleRule => ({ from, mode: 'absolute', combine: 'weight' });

// 49 points earned, 6 lost, 45 open (Lab 15%, Endsem 30%)
const course: Course = {
    id: 'iss',
    name: 'ISS',
    fullName: 'ISS',
    color: '#22d3ee',
    components: [comp('quiz', 10, 8, 10), comp('ta', 25, 40, 40), comp('mid', 20, 40, 50), comp('lab', 15, null, 50), comp('end', 30, null)]
};

const close = (actual: number | null, expected: number) => {
    assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} ≉ ${expected}`);
};

test('requiredAcrossRemaining averages the target over every ungraded component', () => {
    const need = requiredAcrossRemaining(course, 90);
    assert.ok(need);
    close(need.pct, ((90 - 49) * 100) / 45);
    assert.deepEqual(need.remaining.map((c) => c.id), ['lab', 'end']);
});

test('requiredAcrossRemaining is null once everything is graded', () => {
    const done: Course = { ...course, components: course.components.map((c) => ({ ...c, score: c.score ?? 1 })) };
    assert.equal(requiredAcrossRemaining(done, 90), null);
});

test('projectedPctIfScored inverts requiredPct in both modes', () => {
    for (const mode of ['same', 'last'] as const) {
        const pct = requiredPct(course, 'end', 80, mode);
        assert.ok(pct !== null);
        close(projectedPctIfScored(course, 'end', pct, mode), 80);
    }
});

test('otherUngraded skips the component itself and items scaled to it', () => {
    const scaled: Course = {
        ...course,
        components: [...course.components, { ...comp('labx', 5, null), scale: abs('lab') }]
    };
    assert.deepEqual(otherUngraded(scaled, 'lab').map((c) => c.id), ['end']);
});

test('a component scaled from several sources moves with its share of the one being solved', () => {
    // makeup takes 10% from quiz (80%, weight 10) and lab (ungraded, weight 15): lab carries 15/25 of it
    const scaled: Course = {
        ...course,
        components: [...course.components, { ...comp('makeup', 10, null), scale: abs('quiz', 'lab') }]
    };
    for (const mode of ['same', 'last'] as const) {
        const pct = requiredPct(scaled, 'lab', 80, mode);
        assert.ok(pct !== null);
        const lab = scaled.components.find((c) => c.id === 'lab')!;
        const graded: Course = {
            ...scaled,
            components: scaled.components.map((c) =>
                c.id === 'lab' ? { ...lab, score: (pct / 100) * lab.maxScore } : mode === 'same' && c.id === 'end' ? { ...c, score: pct } : c
            )
        };
        const total = graded.components.reduce((sum, c) => sum + c.weight, 0);
        let earned = 0;
        let counted = 0;
        for (const c of graded.components) {
            const p = computeEffectiveCompPct(graded, c);
            if (p === null) continue;
            earned += (p * c.weight) / 100;
            counted += c.weight;
        }
        close((earned * 100) / (mode === 'same' ? total : counted), 80);
    }
    assert.deepEqual(otherUngraded(scaled, 'lab').map((c) => c.id), ['end']);
});
