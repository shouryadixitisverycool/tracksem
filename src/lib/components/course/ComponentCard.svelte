<script lang="ts">
    import type { Component, Course } from "$lib/types";
    import { computeEffectiveCompPct, computeEffectiveSubPct } from "$lib/stores/grades.svelte";
    import { componentPrediction, requiredScoreForPercentile } from "$lib/gradeMath";
    import { CURVED_CUTOFFS, LETTER_CUTOFFS, getGradeColor } from "$lib/grading";
    import { requiredPct } from "$lib/need";
    import { countedSubIds, fmt, fmtNeed, scaleSummary, type GradeBasis, type TargetLetter } from "./display";

    interface Props {
        course: Course;
        comp: Component;
        target: TargetLetter;
        basis: GradeBasis;
        open: boolean;
        onclick: () => void;
    }

    let { course, comp, target, basis, open, onclick }: Props = $props();

    const pct = $derived(computeEffectiveCompPct(course, comp));
    const color = $derived(getGradeColor(pct));
    const subs = $derived(comp.subItems ?? []);
    const hasParts = $derived(subs.length > 0 && !comp.scale);
    const usesBestOf = $derived(hasParts && !!comp.bestOf && comp.bestOf < subs.length);
    const counted = $derived(countedSubIds(course, comp));
    const scaledFrom = $derived(scaleSummary(course, comp.scale));
    const prediction = $derived(componentPrediction(course, comp));
    const showAvg = $derived(!hasParts || comp.statsMode !== "per-sub" ? comp.classAvg : null);

    type Estimate = { letter: string; need: number; curve: boolean };

    /** Best curved grade still reachable on this component; null when the curve can't be estimated */
    function curveEstimate(): Estimate | null {
        const results = CURVED_CUTOFFS.map((c) => ({ letter: c.letter, req: requiredScoreForPercentile(course, comp.id, c.percentile) }));
        if (results.every((r) => r.req === null)) return null;
        const best = results.find((r) => r.req?.reachable) ?? results[results.length - 1];
        const need = best.req ? (best.req.score / best.req.maxScore) * 100 : Infinity;
        return { letter: best.letter, need, curve: true };
    }

    const estimate = $derived.by((): Estimate | null => {
        if (pct !== null || scaledFrom) return null;
        if (basis === "curve") {
            const curve = curveEstimate();
            if (curve) return curve;
        }
        const min = LETTER_CUTOFFS.find((c) => c.letter === target)?.min ?? 90;
        const need = requiredPct(course, comp.id, min, "same");
        return need === null ? null : { letter: target, need, curve: false };
    });

    /** "Theory Assignment 1" → "TA 1" so chips stay short */
    function shortName(name: string): string {
        if (name.length <= 12) return name;
        const words = name.split(/\s+/);
        const initials = words.filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0].toUpperCase()).join("");
        const rest = words.filter((w) => !/^[A-Za-z]/.test(w)).join(" ");
        return [initials, rest].filter(Boolean).join(" ");
    }
</script>

<button class="card" class:todo={pct === null} class:open {onclick} aria-expanded={open}>
    <span class="card-top">
        <span class="card-name">{comp.name}</span>
        {#if pct !== null}
            <span class="mono"><span style="color: {color}">{fmt((pct * comp.weight) / 100)}</span><span class="dim">/{comp.weight} pts</span></span>
        {:else}
            <span class="dim mono">{comp.weight}% · {hasParts ? `${subs.length} parts` : `out of ${fmt(comp.maxScore)}`}</span>
        {/if}
    </span>

    {#if scaledFrom}
        <span class="card-body mono">
            {#if pct === null}
                <span class="dim">from</span> {scaledFrom} <span class="dim">· waits for marks</span>
            {:else}
                <span style="color: {color}">{fmt((pct / 100) * comp.maxScore)}/{fmt(comp.maxScore)}</span>
                <span class="dim">from {scaledFrom}</span>
            {/if}
        </span>
    {:else if pct === null}
        <span class="card-body mono">
            {#if estimate === null}
                <span class="dim">no weight yet</span>
            {:else}
                {@const { letter, need, curve } = estimate}
                {@const grade = curve ? `${letter} on the curve` : letter}
                {@const approx = curve ? "≈" : ""}
                {#if need <= 0}
                    <span class="dim">{grade} is safe whatever you score</span>
                {:else if need > 100}
                    <span class="unreachable">{grade} is out of reach</span>
                {:else if hasParts}
                    need <span class="need-num">{approx}{fmtNeed(need)}%</span>
                    <span class="dim">average for {grade}</span>
                {:else}
                    need <span class="need-num">{approx}{fmtNeed((need / 100) * comp.maxScore)}</span>
                    <span class="dim">/ {fmt(comp.maxScore)} for {grade}</span>
                {/if}
            {/if}
        </span>
    {:else}
        <span class="card-body chips mono">
            {#if hasParts}
                {#each subs as sub (sub.id)}
                    {@const subPct = computeEffectiveSubPct(course, sub)}
                    <span class="chip-score" class:dropped={usesBestOf && subPct !== null && !counted.has(sub.id)}>
                        <span class="dim">{shortName(sub.name)}</span>
                        {#if subPct === null}
                            <span class="dim">—</span>
                        {:else}
                            <span style="color: {getGradeColor(subPct)}">
                                {sub.scale ? `${fmt((subPct / 100) * sub.maxScore)}/${fmt(sub.maxScore)}` : `${fmt(sub.score ?? 0)}/${fmt(sub.maxScore)}`}
                            </span>
                        {/if}
                    </span>
                {/each}
                {#if usesBestOf}<span class="dim small">best {comp.bestOf} {comp.bestOf === 1 ? "counts" : "count"}</span>{/if}
            {:else}
                <span class="chip-score"><span style="color: {color}">{fmt(comp.score ?? 0)}/{fmt(comp.maxScore)}</span></span>
            {/if}
        </span>
    {/if}

    <span class="card-foot mono">
        {#if scaledFrom}
            <span>{comp.scale?.mode}{prediction ? " · " : ""}</span>
            {#if prediction}<span style="color: {prediction.color}">P{Math.floor(prediction.percentile)}</span>{/if}
        {:else if pct === null}
            <span class="cyan-link">enter {hasParts ? "scores" : "score"} →</span>
        {:else if prediction}
            {#if showAvg != null}class avg {fmt(showAvg)} ·{/if}
            <span style="color: {prediction.color}">P{Math.floor(prediction.percentile)}</span>
        {:else}
            <span class="cyan-link">+ add class stats</span>
        {/if}
    </span>
</button>
