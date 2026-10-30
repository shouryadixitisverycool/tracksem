<script lang="ts">
    import { untrack } from "svelte";
    import type { Component, Course } from "$lib/types";
    import { percentileSolver, requiredScoreForPercentile } from "$lib/gradeMath";
    import { getCurvedGradeColor, percentileToGrade, type CurvedLetter } from "$lib/curveGrading";
    import { CURVED_CUTOFFS, LETTER_CUTOFFS, getGradeColor, getLetterGrade } from "$lib/grading";
    import { otherUngraded, projectedPctIfScored, requiredPct, type NeedMode } from "$lib/need";
    import { fmt, fmtNeed, listNames, type GradeBasis, type TargetLetter } from "./display";

    interface Props {
        course: Course;
        comp: Component;
        target: TargetLetter;
        basis: GradeBasis;
    }

    let { course, comp, target, basis }: Props = $props();

    let scale = $state<GradeBasis>("absolute");
    $effect(() => {
        scale = basis;
    });
    let mode = $state<NeedMode>("same");

    /** Parts are graded as an average %, single items in raw marks */
    const hasParts = $derived((comp.subItems?.length ?? 0) > 0);
    const axisMax = $derived(hasParts ? 100 : comp.maxScore);
    const unit = $derived(hasParts ? "%" : "");
    const others = $derived(otherUngraded(course, comp.id));
    const effectiveMode = $derived<NeedMode>(others.length > 0 ? mode : "same");

    type Threshold = { letter: string; need: number; color: string; floor: string };

    const absolute = $derived<Threshold[]>(
        LETTER_CUTOFFS.map((cutoff) => ({
            letter: cutoff.letter,
            need: ((requiredPct(course, comp.id, cutoff.min, effectiveMode) ?? Infinity) / 100) * axisMax,
            color: getGradeColor(cutoff.min),
            floor: `${cutoff.min}%`,
        }))
    );

    const curveResults = $derived(
        CURVED_CUTOFFS.map((cutoff) => ({ cutoff, required: requiredScoreForPercentile(course, comp.id, cutoff.percentile) }))
    );
    const curveAvailable = $derived(curveResults.some((row) => row.required !== null));
    const curveAssumed = $derived(curveResults.some((row) => row.required?.assumedStats));
    const curved = $derived<Threshold[]>(
        curveResults.map(({ cutoff, required }) => ({
            letter: cutoff.letter,
            need: required ? (required.score / required.maxScore) * axisMax : Infinity,
            color: getCurvedGradeColor(cutoff.letter as CurvedLetter),
            floor: `P${cutoff.percentile}`,
        }))
    );
    const useCurve = $derived(scale === "curve" && curveAvailable);
    const thresholds = $derived(useCurve ? curved : absolute);

    // Lowest grade first
    const ascending = $derived([...thresholds].reverse());
    const secured = $derived(ascending.filter((t) => t.need <= 0));
    const reachable = $derived(ascending.filter((t) => t.need > 0 && t.need <= axisMax));
    const outOfReach = $derived(ascending.filter((t) => t.need > axisMax));
    const bestSecured = $derived(secured.length > 0 ? secured[secured.length - 1] : null);

    const segments = $derived.by(() => {
        const list: { from: number; to: number; letter: string; color: string }[] = [];
        let from = 0;
        let letter = bestSecured?.letter ?? (useCurve ? "below C" : "F");
        let color = bestSecured?.color ?? "#7a819c";
        for (const t of reachable) {
            list.push({ from, to: t.need, letter, color });
            from = t.need;
            letter = t.letter;
            color = t.color;
        }
        list.push({ from, to: axisMax, letter, color });
        return list;
    });

    // Ticks closer than ~7% of the bar drop to a second row so labels don't collide
    const ticks = $derived.by(() => {
        let lastLeft = -Infinity;
        let lowered = false;
        return reachable.map((t) => {
            const left = (t.need / axisMax) * 100;
            lowered = left - lastLeft < 7 ? !lowered : false;
            lastLeft = left;
            const align = left < 4 ? "start" : left > 96 ? "end" : null;
            return { ...t, left, lowered, align };
        });
    });

    let tryScore = $state(untrack(() => Math.round(axisMax * 0.7)));
    $effect(() => {
        const max = axisMax;
        untrack(() => {
            if (tryScore > max) tryScore = max;
        });
    });

    const solver = $derived(useCurve ? percentileSolver(course, comp.id) : null);
    const whatIf = $derived.by(() => {
        const pct = (tryScore / axisMax) * 100;
        if (useCurve) {
            const percentile = solver?.percentileAt((pct / 100) * comp.maxScore) ?? NaN;
            if (Number.isNaN(percentile)) return null;
            const letter = percentileToGrade(percentile);
            return { letter, color: getCurvedGradeColor(letter), detail: `≈P${Math.floor(percentile)}` };
        }
        const total = projectedPctIfScored(course, comp.id, pct, effectiveMode);
        if (total === null) return null;
        return { letter: getLetterGrade(total), color: getGradeColor(total), detail: `${(Math.floor(total * 10) / 10).toFixed(1)}% overall` };
    });

    const inSegment = (segment: { from: number; to: number }) =>
        tryScore >= segment.from && (tryScore < segment.to || segment.to === axisMax);

    const otherNames = $derived(listNames(others.map((c) => c.name)));
    const uid = $props.id();
</script>

<section class="need" aria-labelledby="{uid}-title">
    <div class="sec-label mono">
        <span id="{uid}-title">What do I need on {comp.name}?</span>
        {#if curveAvailable}
            <span class="seg" role="group" aria-label="grade type">
                <button class:on={!useCurve} aria-pressed={!useCurve} onclick={() => (scale = "absolute")}>% grade</button>
                <button class:on={useCurve} aria-pressed={useCurve} onclick={() => (scale = "curve")}>curve</button>
            </span>
        {/if}
    </div>

    <div class="need-track-wrap">
        <div class="need-track">
            {#each segments as segment, i (i)}
                <div
                    class="need-seg mono"
                    class:current={inSegment(segment)}
                    style="flex-basis: calc({((segment.to - segment.from) / axisMax) * 100}% - 2px); color: {segment.color}; --seg: {segment.color}"
                >
                    {(segment.to - segment.from) / axisMax >= 0.07 ? segment.letter : ""}
                </div>
            {/each}
        </div>
        <div class="need-knob mono" style="left: {(tryScore / axisMax) * 100}%" aria-hidden="true">
            <span>if {fmt(tryScore)}{unit}</span>
        </div>
        <input
            type="range"
            min="0"
            max={axisMax}
            step={axisMax <= 20 ? 0.5 : 1}
            bind:value={tryScore}
            aria-label="Try a score on {comp.name}"
            aria-valuetext="{fmt(tryScore)}{unit}: {whatIf?.letter ?? 'unknown'}"
        />
    </div>

    <div class="need-ticks mono">
        {#if (ticks[0]?.left ?? 100) >= 7}<span class="edge" style="left: 0">0</span>{/if}
        {#each ticks as t (t.letter)}
            <span
                class:target={t.letter === target}
                class:lowered={t.lowered}
                class:edge={t.align !== null}
                class:end={t.align === "end"}
                style="left: {t.left}%"
            >
                <b>{useCurve ? "≈" : ""}{fmtNeed(t.need)}{unit}</b>{t.letter}
            </span>
        {/each}
        {#if (ticks.at(-1)?.left ?? 0) <= 93}<span class="edge end" style="left: 100%">{fmt(axisMax)}{unit}</span>{/if}
    </div>

    <div class="need-whatif">
        {#if whatIf}
            <span class="need-result">
                Score <span class="cyan">{fmt(tryScore)}{unit}</span> →
                <span style="color: {whatIf.color}">{whatIf.letter}</span>
                <span class="dim mono">{whatIf.detail}</span>
            </span>
        {/if}
        <span class="dim mono">
            {#if bestSecured}<span class="safe">✓ {bestSecured.letter}</span> already safe{/if}
            {#if bestSecured && outOfReach.length}·{/if}
            {#if outOfReach.length}<span class="unreachable">{outOfReach.map((t) => t.letter).join(", ")} out of reach</span>{/if}
        </span>
    </div>

    <div class="need-foot mono">
        <span>
            {#if useCurve}
                {curveAssumed
                    ? `≈ ${comp.name} has no class stats yet, so these are estimates`
                    : "≈ estimated from the class stats you've entered"}
            {:else if others.length > 0}
                {#if mode === "same"}
                    assumes {otherNames} {others.length > 1 ? "get" : "gets"} the same % ·
                    <button class="link" onclick={() => (mode = "last")}>ignore {others.length > 1 ? "them" : otherNames}</button>
                {:else}
                    ignores {otherNames}, as if {comp.name} is the last thing graded ·
                    <button class="link" onclick={() => (mode = "same")}>assume the same %</button>
                {/if}
            {/if}
        </span>
        <span>drag the bar to try a score</span>
    </div>
</section>
