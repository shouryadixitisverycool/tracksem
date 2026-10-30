<script lang="ts">
    import type { Component, Course } from "$lib/types";
    import { getGrades, computeEffectiveCompPct, computeEffectiveSubPct, predictItem } from "$lib/stores/grades.svelte";
    import { componentPrediction, explainScale, itemDistribution } from "$lib/gradeMath";
    import { distributionMoments } from "$lib/curveGrading";
    import { LETTER_CUTOFFS, getGradeColor } from "$lib/grading";
    import { requiredAcrossRemaining } from "$lib/need";
    import NumberField from "$lib/components/NumberField.svelte";
    import ClassStatsFields from "./ClassStatsFields.svelte";
    import PartRow from "./PartRow.svelte";
    import BellCurve from "./BellCurve.svelte";
    import NeedBar from "./NeedBar.svelte";
    import InlineNumber from "./InlineNumber.svelte";
    import ScaleEditor from "./ScaleEditor.svelte";
    import { countedSubIds, fmt, listNames, scaleSummary, type GradeBasis, type TargetLetter } from "./display";

    const grades = getGrades();

    interface Props {
        course: Course;
        comp: Component;
        target: TargetLetter;
        basis: GradeBasis;
        onclose: () => void;
        onsetup: () => void;
    }

    let { course, comp, target, basis, onclose, onsetup }: Props = $props();

    const pct = $derived(computeEffectiveCompPct(course, comp));
    const color = $derived(getGradeColor(pct));
    const subs = $derived(comp.subItems ?? []);
    const scaled = $derived(!!comp.scale);
    const hasParts = $derived(subs.length > 0 && !scaled);
    const usesBestOf = $derived(hasParts && !!comp.bestOf && comp.bestOf < subs.length);
    const counted = $derived(countedSubIds(course, comp));
    const scaledFrom = $derived(scaleSummary(course, comp.scale));
    const scaleInfo = $derived(scaled ? explainScale(course, comp.id) : null);
    const sourceText = $derived(comp.scale?.from === "course" ? "the rest of the course" : scaledFrom);
    const targetMin = $derived(LETTER_CUTOFFS.find((c) => c.letter === target)?.min ?? 90);

    // Single items
    const prediction = $derived(hasParts ? componentPrediction(course, comp) : predictItem(course, comp, pct));
    const dist = $derived(!scaled ? itemDistribution(course, comp) : null);
    const estimatedSd = $derived(comp.classStdDev == null && dist ? distributionMoments(dist).sd : null);
    const afterThis = $derived(pct !== null && basis === "absolute" ? requiredAcrossRemaining(course, targetMin) : null);

    const rules = $derived.by(() => {
        const bits: string[] = [];
        if (scaled) {
            bits.push(`scaled from ${scaledFrom ?? "nothing"} · ${comp.scale!.mode}`);
            if (subs.length > 0) bits.push("parts are ignored while scaled");
        } else if (hasParts) {
            bits.push(usesBestOf ? `best ${comp.bestOf} of ${subs.length} ${comp.bestOf === 1 ? "counts" : "count"}` : `average of all ${subs.length} parts`);
            bits.push(comp.statsMode === "per-sub" ? "class stats per part" : "one set of class stats");
        } else {
            bits.push("not scaled");
        }
        return bits.join(" · ");
    });
    const uid = $props.id();
</script>

{#snippet classStats(score: number | null)}
    <ClassStatsFields
        idPrefix="comp-{comp.id}"
        label={comp.name}
        maxScore={comp.maxScore}
        {score}
        classAvg={comp.classAvg}
        classMedian={comp.classMedian}
        classMax={comp.classMax}
        classStdDev={comp.classStdDev}
        classFullPct={comp.classFullPct}
        {estimatedSd}
        onCommit={(field, value) => grades.updateClassStats(course.id, comp.id, field, value)}
    />
{/snippet}

<section class="panel" aria-labelledby="{uid}-name">
    <header class="panel-head">
        <div>
            <h3 id="{uid}-name">{comp.name}{#if scaled} <span class="pill scaled mono">scaled</span>{/if}</h3>
            <div class="dim mono">
                <InlineNumber
                    value={comp.weight}
                    max={100}
                    ariaLabel="{comp.name} weight (%)"
                    onCommit={(v) => grades.updateWeight(course.id, comp.id, v)}
                />% of the course ·
                {#if hasParts}
                    {subs.length} parts
                {:else}
                    out of
                    <InlineNumber
                        value={comp.maxScore}
                        exclusiveMin
                        ariaLabel="{comp.name} full marks"
                        onCommit={(v) => grades.updateMaxScore(course.id, comp.id, v)}
                    />
                {/if}
                {#if pct !== null}
                    · <span style="color: {color}">{fmt((pct * comp.weight) / 100)}</span> / {comp.weight} pts
                {/if}
            </div>
        </div>
        <button class="btn mono" onclick={onclose}>close ▴</button>
    </header>

    {#if scaled}
        <div class="sec-label mono"><span>Your score <span class="lower">· worked out from the scaling below</span></span></div>
        <div class="score-box">
            <span class="score-entry">
                <span class="score-fixed mono" style="color: {pct === null ? 'inherit' : color}">
                    {pct === null ? "—" : fmt((pct / 100) * comp.maxScore)}
                </span>
                <span class="dim mono">/ {fmt(comp.maxScore)}</span>
            </span>
            <span class="score-result mono">
                {#if pct === null}
                    <span class="dim">waits for marks from {sourceText}</span>
                {:else}
                    <span class="big-result" style="color: {color}">{pct.toFixed(0)}% · +{fmt((pct * comp.weight) / 100)} pts</span>
                    <span class="dim">
                        {#if scaleInfo?.mode === "relative" && scaleInfo.standing}
                            P{Math.floor(scaleInfo.standing.percentile)} here, the same standing as in {sourceText}
                        {:else}
                            same % as {sourceText}
                        {/if}
                    </span>
                {/if}
            </span>
        </div>

        <div class="sec">
            <div class="sec-label mono">
                <span>Class stats <span class="lower">· relative scaling places your standing on this curve</span></span>
            </div>
            {@render classStats(pct !== null ? (pct / 100) * comp.maxScore : null)}
        </div>
    {:else if hasParts}
        <div class="part-row part-head mono">
            <span>part</span><span>score</span><span></span><span>{usesBestOf ? "counts?" : ""}</span><span>curve</span><span></span>
        </div>
        {#each subs as sub (sub.id)}
            <PartRow
                {course}
                {comp}
                {sub}
                counts={usesBestOf && computeEffectiveSubPct(course, sub) !== null ? counted.has(sub.id) : null}
            />
        {/each}
        <button class="link add-part mono" onclick={() => grades.addSubItem(course.id, comp.id)}>+ add part</button>

        {#if comp.statsMode !== "per-sub"}
            <div class="sec">
                <div class="sec-label mono">
                    <span>Class stats <span class="lower">· one set for every part, as marks out of {fmt(comp.maxScore)}</span></span>
                </div>
                {@render classStats(pct !== null ? (pct / 100) * comp.maxScore : null)}
            </div>
        {/if}
    {:else}
        <div class="sec-label mono"><span>Your score</span></div>
        <div class="score-box">
            <span class="score-entry">
                <NumberField
                    class="num-input mono big-input"
                    ariaLabel="{comp.name} score"
                    placeholder="—"
                    max={comp.maxScore}
                    value={comp.score}
                    onCommit={(v) => grades.updateScore(course.id, comp.id, v)}
                />
                <span class="dim mono">
                    /
                    <InlineNumber
                        value={comp.maxScore}
                        exclusiveMin
                        ariaLabel="{comp.name} full marks"
                        onCommit={(v) => grades.updateMaxScore(course.id, comp.id, v)}
                    />
                </span>
            </span>
            <span class="score-result">
                {#if pct === null}
                    <span class="dim mono">nothing entered yet</span>
                {:else}
                    <span class="big-result mono" style="color: {color}">
                        {pct.toFixed(0)}% · +{fmt((pct * comp.weight) / 100)} pts
                    </span>
                    {#if afterThis}
                        <span class="dim mono">
                            {#if afterThis.pct <= 0}
                                {target} is now locked in
                            {:else if afterThis.pct > 100}
                                {target} is now out of reach
                            {:else}
                                {listNames(afterThis.remaining.map((c) => c.name))}
                                {afterThis.remaining.length > 1 ? "now need" : "now needs"}
                                <span class="cyan">{Math.ceil(afterThis.pct)}%</span> for {target}
                            {/if}
                        </span>
                    {/if}
                {/if}
            </span>
        </div>

        <div class="sec">
            <div class="sec-label mono">
                <span>Class stats <span class="lower">· optional, from the results sheet</span></span>
            </div>
            {@render classStats(comp.score)}
            {#if dist && comp.classAvg != null}
                <div class="curve-box">
                    <BellCurve {dist} score={comp.score} avg={comp.classAvg} maxScore={comp.maxScore} />
                    <div class="curve-result mono">
                        {#if prediction}
                            <span class="big-result" style="color: {prediction.color}">P{Math.floor(prediction.percentile)}</span>
                            <span class="dim">ahead of about {Math.floor(prediction.percentile)}% of the class</span>
                            <span class="dim">{prediction.letter} on the curve for this item</span>
                        {:else}
                            <span class="dim">enter your score to see where you stand</span>
                        {/if}
                    </div>
                </div>
            {:else}
                <p class="help mono">
                    Add at least the average to see where you stand. Std dev is estimated from the highest mark if you
                    leave it blank.
                </p>
            {/if}
        </div>
    {/if}

    {#if pct === null && !scaled}
        <div class="sec">
            <NeedBar {course} {comp} {target} {basis} />
        </div>
    {/if}

    <div class="sec">
        <ScaleEditor
            {course}
            itemId={comp.id}
            name={comp.name}
            rule={comp.scale}
            maxScore={comp.maxScore}
            onchange={(rule) => grades.updateScale(course.id, comp.id, rule)}
        />
    </div>

    <footer class="rule mono">
        <span>{rules}</span>
        <button class="link" onclick={onsetup}>full setup</button>
    </footer>
</section>
