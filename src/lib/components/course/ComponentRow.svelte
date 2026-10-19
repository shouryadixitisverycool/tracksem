<script lang="ts">
    import type { Component, Course } from "$lib/types";
    import { grades, computeEffectiveCompPct, predictItem } from "$lib/stores/grades.svelte";
    import { componentPrediction } from "$lib/gradeMath";
    import { getGradeColor } from "$lib/grading";
    import NumberField from "$lib/components/NumberField.svelte";
    import EditableName from "./EditableName.svelte";
    import ScaleTargetSelect from "./ScaleTargetSelect.svelte";
    import ClassStatsFields from "./ClassStatsFields.svelte";
    import SubItemRow from "./SubItemRow.svelte";

    interface Props {
        course: Course;
        comp: Component;
        dragging: boolean;
        dropPlacement: "before" | "after" | null;
        ondragstart: (event: DragEvent) => void;
        ondragend: () => void;
        ondragover: (event: DragEvent) => void;
        ondragleave: (event: DragEvent) => void;
        ondrop: (event: DragEvent) => void;
        onreorderkey: (event: KeyboardEvent) => void;
    }

    let { course, comp, dragging, dropPlacement, ondragstart, ondragend, ondragover, ondragleave, ondrop, onreorderkey }:
        Props = $props();

    let isOpen = $state(false);
    let isStatsOpen = $state(false);

    const pct = $derived(computeEffectiveCompPct(course, comp));
    const barColor = $derived(getGradeColor(pct));
    const contrib = $derived(pct !== null ? (pct * comp.weight) / 100 : null);
    const subItems = $derived(comp.subItems ?? []);
    const hasSubItems = $derived(subItems.length > 0);
    const compPred = $derived.by(() => {
        if (comp.scaleTargetId) return null;
        const predicted = componentPrediction(course, comp);
        if (predicted) return predicted;
        return comp.statsMode === "per-sub" ? null : predictItem(course, comp, pct);
    });
    const hasAnyStats = $derived(!comp.scaleTargetId && comp.classAvg != null);
    const effectiveScore = $derived(pct !== null ? (pct / 100) * comp.maxScore : null);

    const setScaleTarget = (targetId: string | null) => grades.updateScaleTarget(course.id, comp.id, targetId);
</script>

<div
    class="comp-card"
    role="group"
    aria-label={comp.name}
    class:expanded={isOpen}
    class:dragging
    class:drag-over-before={dropPlacement === "before"}
    class:drag-over-after={dropPlacement === "after"}
    {ondragover}
    {ondragleave}
    {ondrop}
>
    <div class="comp-row">
        <button
            class="expand-btn"
            class:has-sub={hasSubItems}
            aria-label={hasSubItems ? `${isOpen ? "collapse" : "expand"} ${comp.name} sub-items` : `split ${comp.name} into sub-items`}
            aria-expanded={hasSubItems ? isOpen : undefined}
            onclick={() => {
                if (hasSubItems) {
                    isOpen = !isOpen;
                } else {
                    grades.addSubItem(course.id, comp.id);
                    isOpen = true;
                }
            }}
        >
            {#if hasSubItems}
                <span class="chevron mono" class:open={isOpen}>›</span>
            {:else}
                <span class="plus-expand mono" title="add sub-items">⊕</span>
            {/if}
        </button>

        <div class="comp-name-cell">
            <button
                class="comp-drag-handle"
                title="drag to reorder, or use arrow keys"
                aria-label="Reorder {comp.name}. Use up and down arrow keys to move."
                draggable={course.components.length > 1}
                disabled={course.components.length < 2}
                {ondragstart}
                {ondragend}
                onkeydown={onreorderkey}
            >
                <svg viewBox="0 0 8 12" aria-hidden="true">
                    <circle cx="2" cy="2" r="1" /><circle cx="6" cy="2" r="1" />
                    <circle cx="2" cy="6" r="1" /><circle cx="6" cy="6" r="1" />
                    <circle cx="2" cy="10" r="1" /><circle cx="6" cy="10" r="1" />
                </svg>
            </button>
            <EditableName value={comp.name} label={comp.name} onCommit={(name) => grades.updateName(course.id, comp.id, name)}>
                {#if hasSubItems}
                    <span class="sub-count">
                        {subItems.filter((s) => s.score !== null).length}/{subItems.length}
                        {#if comp.bestOf}· best {comp.bestOf}{/if}
                    </span>
                {/if}
            </EditableName>
        </div>

        <div class="comp-cell weight-cell">
            <NumberField
                class="num-input mono"
                ariaLabel="{comp.name} weight (%)"
                allowEmpty={false}
                max={100}
                value={comp.weight}
                onCommit={(v) => v !== null && grades.updateWeight(course.id, comp.id, v)}
            />
            <span class="unit mono">%</span>
        </div>

        <div class="comp-cell score-cell">
            {#if comp.scaleTargetId}
                <ScaleTargetSelect
                    {course}
                    sourceId={comp.id}
                    kind="component"
                    value={comp.scaleTargetId}
                    variant="chip"
                    onchange={setScaleTarget}
                />
            {:else if !hasSubItems}
                <NumberField
                    class="num-input mono score-input"
                    ariaLabel="{comp.name} score"
                    placeholder="—"
                    max={comp.maxScore}
                    value={comp.score}
                    onCommit={(v) => grades.updateScore(course.id, comp.id, v)}
                />
                <span class="unit mono">/ </span>
                <NumberField
                    class="num-input mono max-input"
                    ariaLabel="{comp.name} max score"
                    allowEmpty={false}
                    exclusiveMin
                    value={comp.maxScore}
                    onCommit={(v) => v !== null && grades.updateMaxScore(course.id, comp.id, v)}
                />
            {:else}
                <button class="sub-summary mono" aria-expanded={isOpen} onclick={() => (isOpen = !isOpen)}>
                    {isOpen ? "▾" : "▸"}
                    {subItems.filter((s) => s.score !== null).length} of {subItems.length} entered
                </button>
            {/if}
        </div>

        <div class="comp-cell pct-cell">
            {#if pct !== null}
                <div class="bar-stack">
                    <div class="bar-track">
                        <div
                            class="bar-fill"
                            style="width: {Math.min(Math.max(pct, 0), 100)}%; background: {barColor}"
                        ></div>
                    </div>
                    <span class="mono text-xs" style="color: {barColor}">{pct.toFixed(1)}%</span>
                </div>
            {:else}
                <span class="mono text-xs dimmed">—</span>
            {/if}
        </div>

        <div
            class="comp-cell contrib-cell mono text-xs"
            style="color: {contrib !== null ? barColor : 'oklch(0.35 0.02 265)'}"
        >
            {contrib !== null ? contrib.toFixed(2) + "%" : "—"}
        </div>

        <div class="comp-cell curve-cell">
            {#if compPred}
                <span
                    class="curve-pill mono"
                    style="color: {compPred.color}; border-color: {compPred.color}40; background: {compPred.color}12"
                >
                    {compPred.letter}
                    <span class="curve-pctl">P{compPred.percentile.toFixed(0)}</span>
                </span>
            {:else if hasAnyStats}
                <span class="curve-pill mono dimmed" style="border-color: oklch(1 0 0 / 8%)">—</span>
            {/if}
        </div>

        <button
            class="stats-toggle-btn"
            class:active={isStatsOpen || hasAnyStats}
            class:open={isStatsOpen}
            onclick={() => (isStatsOpen = !isStatsOpen)}
            title="{comp.name} class statistics"
            aria-label="toggle {comp.name} class statistics"
            aria-expanded={isStatsOpen}
        >
            <svg class="dropdown-icon" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 6l4 4 4-4" />
            </svg>
        </button>

        <button
            class="remove-btn"
            onclick={() => grades.removeComponent(course.id, comp.id)}
            title="remove {comp.name}"
            aria-label="remove {comp.name}">×</button
        >
    </div>

    {#if hasSubItems && isOpen}
        <div class="sub-panel">
            <div class="best-of-row mono">
                <span class="dimmed">scoring:</span>
                {#if comp.bestOf !== undefined}
                    best
                    <NumberField
                        class="bestof-input mono"
                        ariaLabel="{comp.name}: number of best scores to count"
                        integer
                        exclusiveMin
                        max={subItems.length}
                        disabled={!!comp.scaleTargetId}
                        value={comp.bestOf}
                        onCommit={(v) => grades.updateBestOf(course.id, comp.id, v ?? undefined)}
                    />
                    of {subItems.length}
                    <button
                        class="pill-btn mono"
                        disabled={!!comp.scaleTargetId}
                        onclick={() => grades.updateBestOf(course.id, comp.id, undefined)}>→ use all</button
                    >
                {:else}
                    average of all {subItems.length}
                    <button
                        class="pill-btn mono"
                        disabled={!!comp.scaleTargetId}
                        onclick={() => grades.updateBestOf(course.id, comp.id, Math.max(1, subItems.length - 1))}
                        >→ set best-of</button
                    >
                {/if}
                <span class="dimmed" style="margin-left: auto;"
                    >each worth {(comp.weight / subItems.length).toFixed(1)}%</span
                >
            </div>

            {#each subItems as sub (sub.id)}
                <SubItemRow {course} {comp} {sub} />
            {/each}

            <button class="add-sub-btn mono" onclick={() => grades.addSubItem(course.id, comp.id)}>
                + add {comp.name.toLowerCase()}
            </button>
        </div>
    {/if}

    {#if isStatsOpen}
        <div class="stats-panel">
            <div class="stats-header mono">
                <span class="dimmed">class statistics</span>
                <div class="stats-header-right">
                    {#if hasSubItems}
                        <div class="mode-toggle mono" role="group" aria-label="statistics mode">
                            <button
                                class="mode-btn"
                                class:active={comp.statsMode !== "per-sub"}
                                aria-pressed={comp.statsMode !== "per-sub"}
                                onclick={() => grades.updateStatsMode(course.id, comp.id, "global")}>global</button
                            >
                            <button
                                class="mode-btn"
                                class:active={comp.statsMode === "per-sub"}
                                aria-pressed={comp.statsMode === "per-sub"}
                                onclick={() => grades.updateStatsMode(course.id, comp.id, "per-sub")}>per-sub</button
                            >
                        </div>
                    {/if}
                    {#if compPred}
                        <span class="stats-prediction" style="color: {compPred.color}">
                            predicted: {compPred.letter} (P{compPred.percentile.toFixed(1)})
                        </span>
                    {/if}
                    {#if comp.statsMode !== "per-sub"}
                        <ScaleTargetSelect
                            {course}
                            sourceId={comp.id}
                            kind="component"
                            value={comp.scaleTargetId}
                            variant="select"
                            onchange={setScaleTarget}
                        />
                    {/if}
                </div>
            </div>
            {#if comp.statsMode !== "per-sub"}
                {#if !comp.scaleTargetId}
                    <ClassStatsFields
                        idPrefix="comp-{comp.id}"
                        maxScore={comp.maxScore}
                        score={effectiveScore}
                        classAvg={comp.classAvg}
                        classMedian={comp.classMedian}
                        classMax={comp.classMax}
                        classStdDev={comp.classStdDev}
                        classFullPct={comp.classFullPct}
                        onCommit={(field, value) => grades.updateClassStats(course.id, comp.id, field, value)}
                    />
                {/if}
                <div class="stats-hint mono">
                    {#if comp.scaleTargetId}
                        marks are scaled from the selected component while scaling is active
                    {:else}
                        enter the class average to predict your grade on the curve
                    {/if}
                    {#if !comp.scaleTargetId && !comp.classStdDev && comp.classAvg != null}
                        · σ is estimated from the class max{comp.classMax == null
                            ? ` — none entered, so the paper max (${comp.maxScore}) is assumed`
                            : ""}
                    {/if}
                </div>
            {:else}
                <div class="stats-hint mono">use the dropdown button on each sub-item to enter individual stats</div>
            {/if}
        </div>
    {/if}
</div>
