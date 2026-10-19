<script lang="ts">
    import type { Component, Course, SubItem } from "$lib/types";
    import { grades, computeEffectiveSubPct, predictItem } from "$lib/stores/grades.svelte";
    import { getGradeColor } from "$lib/grading";
    import NumberField from "$lib/components/NumberField.svelte";
    import EditableName from "./EditableName.svelte";
    import ScaleTargetSelect from "./ScaleTargetSelect.svelte";
    import ClassStatsFields from "./ClassStatsFields.svelte";

    interface Props {
        course: Course;
        comp: Component;
        sub: SubItem;
    }

    let { course, comp, sub }: Props = $props();

    let statsOpen = $state(false);

    const subPct = $derived(computeEffectiveSubPct(course, sub));
    const subColor = $derived(getGradeColor(subPct));
    const isPerSub = $derived(comp.statsMode === "per-sub");
    const subPred = $derived(isPerSub && !sub.scaleTargetId ? predictItem(course, sub, subPct) : null);

    const setScaleTarget = (targetId: string | null) =>
        grades.updateSubScaleTarget(course.id, comp.id, sub.id, targetId);
</script>

<div class="sub-row" class:per-sub={isPerSub}>
    <div class="sub-name-cell">
        <EditableName
            small
            value={sub.name}
            label={sub.name}
            onCommit={(name) => grades.updateSubName(course.id, comp.id, sub.id, name)}
        />
    </div>

    <div class="sub-score-cell">
        {#if sub.scaleTargetId}
            <ScaleTargetSelect
                {course}
                sourceId={sub.id}
                kind="sub"
                parentId={comp.id}
                value={sub.scaleTargetId}
                variant="chip"
                onchange={setScaleTarget}
            />
        {:else}
            <NumberField
                class="num-input mono score-input"
                ariaLabel="{sub.name} score"
                placeholder="—"
                max={sub.maxScore}
                disabled={!!comp.scaleTargetId}
                value={sub.score}
                onCommit={(v) => grades.updateSubScore(course.id, comp.id, sub.id, v)}
            />
            <span class="unit mono">/ </span>
            <NumberField
                class="num-input mono max-input"
                ariaLabel="{sub.name} max score"
                allowEmpty={false}
                exclusiveMin
                disabled={!!comp.scaleTargetId}
                value={sub.maxScore}
                onCommit={(v) => v !== null && grades.updateSubMaxScore(course.id, comp.id, sub.id, v)}
            />
        {/if}
    </div>

    <div class="sub-pct-cell">
        {#if subPct !== null}
            <span class="mono text-xs" style="color: {subColor}">{subPct.toFixed(1)}%</span>
        {:else}
            <span class="dimmed mono text-xs">—</span>
        {/if}
    </div>

    {#if isPerSub}
        <div class="sub-curve-cell">
            {#if subPred}
                <span
                    class="curve-pill mono"
                    style="color: {subPred.color}; border-color: {subPred.color}40; background: {subPred.color}12"
                >
                    {subPred.letter}
                    <span class="curve-pctl">P{subPred.percentile.toFixed(0)}</span>
                </span>
            {:else if !sub.scaleTargetId && sub.classAvg != null}
                <span class="curve-pill mono dimmed" style="border-color: oklch(1 0 0 / 8%)">—</span>
            {/if}
        </div>
        <button
            class="stats-toggle-btn sub-stats-btn"
            class:active={statsOpen || sub.classAvg != null || sub.scaleTargetId}
            class:open={statsOpen}
            onclick={() => (statsOpen = !statsOpen)}
            title="{sub.name} class statistics"
            aria-label="toggle {sub.name} class statistics"
            aria-expanded={statsOpen}
        >
            <svg class="dropdown-icon" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 6l4 4 4-4" />
            </svg>
        </button>
    {/if}

    <button
        class="remove-btn small"
        onclick={() => grades.removeSubItem(course.id, comp.id, sub.id)}
        title="remove {sub.name}"
        aria-label="remove {sub.name}">×</button
    >
</div>

{#if isPerSub && statsOpen}
    <div class="sub-stats-panel">
        <div class="sub-stats-toolbar">
            <ScaleTargetSelect
                {course}
                sourceId={sub.id}
                kind="sub"
                parentId={comp.id}
                value={sub.scaleTargetId}
                variant="select"
                onchange={setScaleTarget}
            />
        </div>
        {#if !sub.scaleTargetId}
            <ClassStatsFields
                idPrefix="sub-{sub.id}"
                maxScore={sub.maxScore}
                score={sub.score}
                classAvg={sub.classAvg}
                classMedian={sub.classMedian}
                classMax={sub.classMax}
                classStdDev={sub.classStdDev}
                classFullPct={sub.classFullPct}
                onCommit={(field, value) => grades.updateSubClassStats(course.id, comp.id, sub.id, field, value)}
            />
        {:else}
            <div class="stats-hint mono">marks and class statistics are scaled from the selected item</div>
        {/if}
    </div>
{/if}
