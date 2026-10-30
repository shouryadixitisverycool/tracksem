<script lang="ts">
    import type { Component, Course, SubItem } from "$lib/types";
    import { getGrades, computeEffectiveSubPct, predictItem } from "$lib/stores/grades.svelte";
    import { itemDistribution, standingOf } from "$lib/gradeMath";
    import { distributionMoments } from "$lib/curveGrading";
    import { getGradeColor } from "$lib/grading";
    import NumberField from "$lib/components/NumberField.svelte";
    import ClassStatsFields from "./ClassStatsFields.svelte";
    import InlineNumber from "./InlineNumber.svelte";
    import ScaleEditor from "./ScaleEditor.svelte";
    import { fmt, scaleSummary } from "./display";

    const grades = getGrades();

    interface Props {
        course: Course;
        comp: Component;
        sub: SubItem;
        /** null when the component has no best-of rule */
        counts: boolean | null;
    }

    let { course, comp, sub, counts }: Props = $props();

    let scaleOpen = $state(false);

    const pct = $derived(computeEffectiveSubPct(course, sub));
    const color = $derived(getGradeColor(pct));
    const perSub = $derived(comp.statsMode === "per-sub");
    const prediction = $derived.by(() => {
        if (sub.scale) return standingOf(course, sub.id);
        if (perSub) return predictItem(course, sub, pct);
        return predictItem(course, comp, pct);
    });
    const scaledFrom = $derived(scaleSummary(course, sub.scale));
    const estimatedSd = $derived.by(() => {
        if (sub.classStdDev != null) return null;
        const dist = itemDistribution(course, sub);
        return dist ? distributionMoments(dist).sd : null;
    });
</script>

<div class="part-row" class:dropped={counts === false}>
    <span class="part-name">{sub.name}</span>
    <span class="part-score">
        {#if scaledFrom}
            <span class="mono" style="color: {pct === null ? 'inherit' : color}" title="worked out from {scaledFrom}">
                {pct === null ? "—" : fmt((pct / 100) * sub.maxScore)}
            </span>
        {:else}
            <NumberField
                class="num-input mono score-input"
                ariaLabel="{sub.name} score"
                placeholder="—"
                max={sub.maxScore}
                value={sub.score}
                onCommit={(v) => grades.updateSubScore(course.id, comp.id, sub.id, v)}
            />
        {/if}
        <span class="dim mono">
            /
            <InlineNumber
                value={sub.maxScore}
                exclusiveMin
                ariaLabel="{sub.name} full marks"
                onCommit={(v) => grades.updateSubMaxScore(course.id, comp.id, sub.id, v)}
            />
        </span>
    </span>
    <span class="part-bar">
        <span class="bar"><i style="width: {Math.min(Math.max(pct ?? 0, 0), 100)}%; background: {color}"></i></span>
        <span class="mono pct" style="color: {color}">{pct === null ? "—" : `${pct.toFixed(0)}%`}</span>
    </span>
    <span class="part-counts">
        {#if counts === true}
            <span class="pill counts mono">counts</span>
        {:else if counts === false}
            <span class="pill mono">dropped</span>
        {/if}
    </span>
    <span class="part-curve mono" style="color: {prediction?.color ?? 'inherit'}">
        {#if prediction}P{Math.floor(prediction.percentile)}{:else}<span class="dim">—</span>{/if}
    </span>
    <span class="part-scale">
        <button
            class="link mono"
            class:muted={!scaledFrom}
            aria-expanded={scaleOpen}
            title={scaledFrom ? `scaled from ${scaledFrom}` : "work this part's marks out from other items"}
            onclick={() => (scaleOpen = !scaleOpen)}>{scaledFrom ? "scaled" : "scale"}</button
        >
    </span>
</div>
{#if scaleOpen}
    <div class="part-scale-box">
        <ScaleEditor
            {course}
            itemId={sub.id}
            name={sub.name}
            rule={sub.scale}
            maxScore={sub.maxScore}
            onchange={(rule) => grades.updateSubScale(course.id, comp.id, sub.id, rule)}
        />
    </div>
{/if}
{#if perSub}
    <div class="part-stats">
        <span class="dim mono">class</span>
        <ClassStatsFields
            compact
            idPrefix="sub-{sub.id}"
            label={sub.name}
            maxScore={sub.maxScore}
            score={pct !== null ? (pct / 100) * sub.maxScore : null}
            classAvg={sub.classAvg}
            classMedian={sub.classMedian}
            classMax={sub.classMax}
            classStdDev={sub.classStdDev}
            classFullPct={sub.classFullPct}
            {estimatedSd}
            onCommit={(field, value) => grades.updateSubClassStats(course.id, comp.id, sub.id, field, value)}
        />
    </div>
{/if}
