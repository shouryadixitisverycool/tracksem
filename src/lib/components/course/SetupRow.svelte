<script lang="ts">
    import type { Component, Course, ScaleRule } from "$lib/types";
    import { getGrades } from "$lib/stores/grades.svelte";
    import NumberField from "$lib/components/NumberField.svelte";
    import TextField from "./TextField.svelte";
    import ScaleEditor from "./ScaleEditor.svelte";
    import { scaleSummary } from "./display";

    const grades = getGrades();

    interface Props {
        course: Course;
        comp: Component;
        swatch: string;
        dragging: boolean;
        dropPlacement: "before" | "after" | null;
        ondragstart: (event: DragEvent) => void;
        ondragend: () => void;
        ondragover: (event: DragEvent) => void;
        ondragleave: (event: DragEvent) => void;
        ondrop: (event: DragEvent) => void;
        onreorderkey: (event: KeyboardEvent) => void;
    }

    let { course, comp, swatch, dragging, dropPlacement, ondragstart, ondragend, ondragover, ondragleave, ondrop, onreorderkey }:
        Props = $props();

    const subs = $derived(comp.subItems ?? []);
    const hasParts = $derived(subs.length > 0);
    const scaled = $derived(!!comp.scale);

    /** Id of the component or part whose scaling editor is open */
    let editing = $state<string | null>(null);
    const toggle = (id: string) => (editing = editing === id ? null : id);
</script>

{#snippet scaleChip(id: string, rule: ScaleRule | null | undefined)}
    {@const summary = scaleSummary(course, rule)}
    <button class="chip sm mono" class:on={!!summary} aria-expanded={editing === id} onclick={() => toggle(id)}>
        {summary ? `${summary} · ${rule?.mode} ✎` : "not scaled ✎"}
    </button>
{/snippet}

<div
    class="setup-row"
    role="group"
    aria-label={comp.name}
    class:dragging
    class:drop-before={dropPlacement === "before"}
    class:drop-after={dropPlacement === "after"}
    {ondragover}
    {ondragleave}
    {ondrop}
>
    <div class="setup-line">
        <button
            class="drag-handle"
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
        <span class="swatch" style="background: {swatch}"></span>
        <TextField
            class="text-input mono"
            ariaLabel="{comp.name} name"
            value={comp.name}
            onCommit={(name) => grades.updateName(course.id, comp.id, name)}
        />
        <span class="field mono">
            weight
            <NumberField
                class="num-input mono"
                ariaLabel="{comp.name} weight (%)"
                allowEmpty={false}
                max={100}
                value={comp.weight}
                onCommit={(v) => v !== null && grades.updateWeight(course.id, comp.id, v)}
            />%
        </span>
        <span class="field mono">
            {#if hasParts}
                {subs.length} {subs.length === 1 ? "part" : "parts"}
            {:else}
                out of
                <NumberField
                    class="num-input mono"
                    ariaLabel="{comp.name} max score"
                    allowEmpty={false}
                    exclusiveMin
                    value={comp.maxScore}
                    onCommit={(v) => v !== null && grades.updateMaxScore(course.id, comp.id, v)}
                />
            {/if}
        </span>
        <button class="remove" title="remove {comp.name}" aria-label="remove {comp.name}" onclick={() => grades.removeComponent(course.id, comp.id)}
            >✕</button
        >
    </div>

    <div class="setup-rules mono">
        {#if hasParts}
            <span class="rule-group" role="group" aria-label="{comp.name}: how parts count">
                count
                <button
                    class="chip sm"
                    class:on={!comp.bestOf}
                    aria-pressed={!comp.bestOf}
                    disabled={scaled}
                    onclick={() => grades.updateBestOf(course.id, comp.id, undefined)}>average of all</button
                >
                {#if comp.bestOf}
                    <span class="chip sm on">
                        best
                        <NumberField
                            class="num-input mono tiny-input"
                            ariaLabel="{comp.name}: number of best scores to count"
                            integer
                            exclusiveMin
                            allowEmpty={false}
                            max={subs.length}
                            disabled={scaled}
                            value={comp.bestOf}
                            onCommit={(v) => v !== null && grades.updateBestOf(course.id, comp.id, v)}
                        />
                        of {subs.length}
                    </span>
                {:else}
                    <button
                        class="chip sm"
                        aria-pressed="false"
                        disabled={scaled || subs.length < 2}
                        onclick={() => grades.updateBestOf(course.id, comp.id, Math.max(1, subs.length - 1))}
                        >best N of {subs.length}</button
                    >
                {/if}
            </span>
            <span class="rule-group" role="group" aria-label="{comp.name}: class stats">
                class stats
                <button
                    class="chip sm"
                    class:on={comp.statsMode !== "per-sub"}
                    aria-pressed={comp.statsMode !== "per-sub"}
                    onclick={() => grades.updateStatsMode(course.id, comp.id, "global")}>one set</button
                >
                <button
                    class="chip sm"
                    class:on={comp.statsMode === "per-sub"}
                    aria-pressed={comp.statsMode === "per-sub"}
                    onclick={() => grades.updateStatsMode(course.id, comp.id, "per-sub")}>per part</button
                >
            </span>
        {/if}
        <span class="rule-group">
            scaling
            {@render scaleChip(comp.id, comp.scale)}
        </span>
        {#if !hasParts}
            <button class="link" onclick={() => grades.addSubItem(course.id, comp.id)}>+ split into parts</button>
        {/if}
    </div>

    {#if editing === comp.id}
        <div class="setup-scale">
            <ScaleEditor
                {course}
                itemId={comp.id}
                name={comp.name}
                rule={comp.scale}
                maxScore={comp.maxScore}
                onchange={(rule) => grades.updateScale(course.id, comp.id, rule)}
            />
        </div>
    {/if}

    {#if hasParts}
        <div class="setup-parts">
            {#each subs as sub (sub.id)}
                <div class="setup-part mono">
                    <TextField
                        class="text-input mono"
                        ariaLabel="{sub.name} name"
                        value={sub.name}
                        onCommit={(name) => grades.updateSubName(course.id, comp.id, sub.id, name)}
                    />
                    <span class="field">
                        out of
                        <NumberField
                            class="num-input mono"
                            ariaLabel="{sub.name} max score"
                            allowEmpty={false}
                            exclusiveMin
                            value={sub.maxScore}
                            onCommit={(v) => v !== null && grades.updateSubMaxScore(course.id, comp.id, sub.id, v)}
                        />
                    </span>
                    <span class="field">
                        scaling
                        {@render scaleChip(sub.id, sub.scale)}
                    </span>
                    <button
                        class="remove"
                        title="remove {sub.name}"
                        aria-label="remove {sub.name}"
                        onclick={() => grades.removeSubItem(course.id, comp.id, sub.id)}>✕</button
                    >
                </div>
                {#if editing === sub.id}
                    <div class="setup-scale">
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
            {/each}
            <button class="link mono" onclick={() => grades.addSubItem(course.id, comp.id)}>+ part</button>
        </div>
    {/if}
</div>
