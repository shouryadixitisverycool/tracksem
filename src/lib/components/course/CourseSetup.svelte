<script lang="ts">
    import type { Course } from "$lib/types";
    import { getGrades } from "$lib/stores/grades.svelte";
    import { LETTERS } from "$lib/grading";
    import NumberField from "$lib/components/NumberField.svelte";
    import TextField from "./TextField.svelte";
    import SetupRow from "./SetupRow.svelte";
    import { fmt } from "./display";

    const grades = getGrades();

    interface Props {
        course: Course;
        ondeleted: () => void;
    }

    let { course, ondeleted }: Props = $props();

    const PALETTE = ["#22d3ee", "#a78bfa", "#f472b6", "#fbbf24", "#4ade80", "#60a5fa", "#fb923c"];
    const swatch = (i: number) => PALETTE[i % PALETTE.length];

    const total = $derived(course.components.reduce((sum, c) => sum + c.weight, 0));
    const balanced = $derived(Math.abs(total - 100) < 0.01);
    const scale = $derived(Math.max(100, total));
    const uid = $props.id();

    // ─── Reorder ────────────────────────────────────────────────────────────────

    let draggingId = $state<string | null>(null);
    let dragOverId = $state<string | null>(null);
    let dragPlacement = $state<"before" | "after">("before");

    function clearDrag() {
        draggingId = null;
        dragOverId = null;
        dragPlacement = "before";
    }

    function handleDragStart(id: string, event: DragEvent) {
        if (course.components.length < 2) {
            event.preventDefault();
            return;
        }
        draggingId = id;
        dragOverId = null;
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", id);
        }
    }

    function handleDragOver(id: string, event: DragEvent) {
        if (!draggingId) return;
        if (draggingId === id) {
            dragOverId = null;
            return;
        }
        event.preventDefault();
        dragOverId = id;
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        dragPlacement = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    }

    function handleDragLeave(id: string, event: DragEvent) {
        const row = event.currentTarget as HTMLElement;
        if (!(event.relatedTarget instanceof Node) || !row.contains(event.relatedTarget)) {
            if (dragOverId === id) dragOverId = null;
        }
    }

    function handleDrop(id: string, event: DragEvent) {
        event.preventDefault();
        const draggedId = draggingId;
        const placement = dragPlacement;
        clearDrag();
        if (!draggedId || draggedId === id) return;
        const ids = course.components.map((c) => c.id).filter((cid) => cid !== draggedId);
        const targetIndex = ids.indexOf(id);
        if (targetIndex === -1) return;
        ids.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, draggedId);
        grades.reorderComponents(course.id, ids);
    }

    function handleReorderKey(id: string, event: KeyboardEvent) {
        if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const ids = course.components.map((c) => c.id);
        const index = ids.indexOf(id);
        const next = index + (event.key === "ArrowUp" ? -1 : 1);
        if (index < 0 || next < 0 || next >= ids.length) return;
        [ids[index], ids[next]] = [ids[next], ids[index]];
        grades.reorderComponents(course.id, ids);
    }

    // ─── Reset & delete ─────────────────────────────────────────────────────────

    let confirmReset = $state(false);
    let resetting = $state(false);
    let resetError = $state<string | null>(null);
    let deleting = $state(false);

    async function handleReset() {
        resetting = true;
        resetError = null;
        try {
            await grades.resetCourse(course.id);
        } catch (error) {
            resetError = error instanceof Error ? error.message : "reset failed";
        } finally {
            resetting = false;
            confirmReset = false;
        }
    }

    async function handleDelete() {
        if (deleting || !confirm(`Delete ${course.name} and all its marks?`)) return;
        deleting = true;
        try {
            await grades.deleteCourse(course.id);
            ondeleted();
        } catch (error) {
            deleting = false;
            alert(`Could not delete ${course.name}: ${error instanceof Error ? error.message : "unknown error"}`);
        }
    }
</script>

<section class="setup-sec" aria-labelledby="{uid}-course">
    <div class="sec-label mono"><span id="{uid}-course">Course</span></div>
    <div class="course-fields mono">
        <label class="field-col wide">
            full name
            <TextField
                class="text-input mono"
                ariaLabel="full name"
                value={course.fullName}
                onCommit={(v) => grades.setCourseName(course.id, "fullName", v)}
            />
        </label>
        <label class="field-col">
            code
            <TextField class="text-input mono" ariaLabel="course code" value={course.name} onCommit={(v) => grades.setCourseName(course.id, "name", v)} />
        </label>
        <label class="field-col" for="{uid}-credits">
            credits
            <NumberField
                id="{uid}-credits"
                class="num-input mono"
                max={40}
                placeholder="?"
                value={course.credits}
                onCommit={(v) => grades.setCredits(course.id, v)}
            />
        </label>
        <label class="field-col" for="{uid}-size" title="Used to estimate how far above the average the topper sits">
            class size
            <NumberField
                id="{uid}-size"
                class="num-input mono"
                integer
                exclusiveMin
                placeholder="?"
                value={course.classSize}
                onCommit={(v) => grades.setClassSize(course.id, v)}
            />
        </label>
    </div>
    <div class="course-toggles mono">
        <span class="dim">on the dashboard, show</span>
        <label>
            <input
                type="checkbox"
                checked={!course.hideAbsoluteGrade}
                onchange={(e) => grades.setGradeVisibility(course.id, "hideAbsoluteGrade", !e.currentTarget.checked)}
            />
            % grade
        </label>
        <label>
            <input
                type="checkbox"
                checked={!course.hideRelativeGrade}
                onchange={(e) => grades.setGradeVisibility(course.id, "hideRelativeGrade", !e.currentTarget.checked)}
            />
            curve grade
        </label>
        <label class="official" title="Final grade once released; overrides predictions in SGPA / CGPA">
            <span class="dim">official grade</span>
            <select
                class="select mono"
                value={course.officialGrade ?? ""}
                onchange={(e) => grades.setOfficialGrade(course.id, e.currentTarget.value || null)}
            >
                <option value="">not released</option>
                {#each LETTERS as letter (letter)}
                    <option value={letter}>{letter}</option>
                {/each}
            </select>
        </label>
    </div>
</section>

<section class="setup-sec" aria-labelledby="{uid}-components">
    <div class="sec-label mono">
        <span id="{uid}-components">Components &amp; weights</span>
        <span class="lower" class:ok={balanced} class:warn={!balanced}>
            {#if balanced}
                ✓ adds up to 100%
            {:else}
                total {fmt(total)}% · {total < 100 ? `${fmt(100 - total)}% unassigned` : `${fmt(total - 100)}% over`}
            {/if}
        </span>
    </div>
    <div class="weight-bar mono" aria-hidden="true">
        {#each course.components as comp, i (comp.id)}
            {#if comp.weight > 0}
                <div style="flex-basis: calc({(comp.weight / scale) * 100}% - 2px); background: {swatch(i)}">
                    {comp.weight / scale >= 0.08 ? `${comp.name.split(" ")[0]} ${fmt(comp.weight)}` : ""}
                </div>
            {/if}
        {/each}
        {#if total < 100}
            <div class="gap" style="flex: 1">{fmt(100 - total)}%</div>
        {/if}
    </div>

    {#each course.components as comp, i (comp.id)}
        <SetupRow
            {course}
            {comp}
            swatch={swatch(i)}
            dragging={draggingId === comp.id}
            dropPlacement={dragOverId === comp.id ? dragPlacement : null}
            ondragstart={(event) => handleDragStart(comp.id, event)}
            ondragend={clearDrag}
            ondragover={(event) => handleDragOver(comp.id, event)}
            ondragleave={(event) => handleDragLeave(comp.id, event)}
            ondrop={(event) => handleDrop(comp.id, event)}
            onreorderkey={(event) => handleReorderKey(comp.id, event)}
        />
    {/each}

    <div class="setup-foot mono">
        <button class="link" onclick={() => grades.addComponent(course.id)}>+ add component</button>
        <span class="dim">"scaled from" means this item's marks are a scaled copy of another item</span>
    </div>
</section>

<div class="danger-zone mono">
    {#if confirmReset}
        <span class="warn">Replace every component with the {course.name} template? Marks are lost.</span>
        <button class="btn danger" disabled={resetting} onclick={handleReset}>{resetting ? "resetting…" : "yes, reset"}</button>
        <button class="btn" onclick={() => (confirmReset = false)}>cancel</button>
    {:else}
        <button
            class="link muted"
            onclick={() => {
                resetError = null;
                confirmReset = true;
            }}>reset to the {course.name} template…</button
        >
        <button class="link danger" disabled={deleting} onclick={handleDelete}>{deleting ? "deleting…" : "delete course…"}</button>
        {#if resetError}<span class="error" role="alert">{resetError}</span>{/if}
    {/if}
</div>
