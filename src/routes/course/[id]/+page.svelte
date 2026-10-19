<script lang="ts">
    import "$lib/components/course/course.css";
    import type { PageProps } from "./$types";
    import { untrack } from "svelte";
    import { goto } from "$app/navigation";
    import { grades } from "$lib/stores/grades.svelte";
    import { getGradeColor } from "$lib/grading";
    import { courseProgress } from "$lib/need";
    import SaveStatus from "$lib/components/SaveStatus.svelte";
    import GradeHero from "$lib/components/course/GradeHero.svelte";
    import ComponentRow from "$lib/components/course/ComponentRow.svelte";
    import NeedCalculator from "$lib/components/course/NeedCalculator.svelte";

    let { data }: PageProps = $props();

    const course = $derived(grades.getCourse(data.courseId));
    const proj = $derived(grades.projectedGrade(data.courseId));
    const totalWeight = $derived(grades.totalWeight(data.courseId));
    const curved = $derived(grades.curvedGrade(data.courseId));
    const progress = $derived(course ? courseProgress(course) : null);

    let lookup = $state<"loading" | "missing" | "error">("loading");

    $effect(() => {
        const id = data.courseId;
        if (grades.getCourse(id)) return;
        untrack(() => {
            lookup = "loading";
            grades
                .ensureCourse(id)
                .then((found) => {
                    if (!found) lookup = "missing";
                })
                .catch(() => (lookup = "error"));
        });
    });

    let confirmReset = $state(false);
    let resetError = $state<string | null>(null);
    let resetting = $state(false);

    async function handleReset() {
        resetting = true;
        resetError = null;
        try {
            await grades.resetCourse(data.courseId);
        } catch (error) {
            resetError = error instanceof Error ? error.message : "reset failed";
        } finally {
            resetting = false;
            confirmReset = false;
        }
    }

    let draggingComponentId = $state<string | null>(null);
    let dragOverComponentId = $state<string | null>(null);
    let dragPlacement = $state<"before" | "after">("before");

    function clearComponentDrag() {
        draggingComponentId = null;
        dragOverComponentId = null;
        dragPlacement = "before";
    }

    function handleComponentDragStart(id: string, event: DragEvent) {
        if (!course || course.components.length < 2) {
            event.preventDefault();
            return;
        }
        draggingComponentId = id;
        dragOverComponentId = null;
        dragPlacement = "before";
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", id);
        }
    }

    function handleComponentDragOver(id: string, event: DragEvent) {
        if (!draggingComponentId) return;
        if (draggingComponentId === id) {
            dragOverComponentId = null;
            return;
        }
        event.preventDefault();
        dragOverComponentId = id;
        const card = event.currentTarget as HTMLElement;
        const rect = card.getBoundingClientRect();
        dragPlacement = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    }

    function handleComponentDragLeave(id: string, event: DragEvent) {
        const card = event.currentTarget as HTMLElement;
        if (!(event.relatedTarget instanceof Node) || !card.contains(event.relatedTarget)) {
            if (dragOverComponentId === id) dragOverComponentId = null;
        }
    }

    function handleComponentDrop(id: string, event: DragEvent) {
        event.preventDefault();
        const draggedId = draggingComponentId;
        const placement = dragPlacement;
        clearComponentDrag();
        if (!course || !draggedId || draggedId === id) return;
        const ids = course.components.map((component) => component.id).filter((cid) => cid !== draggedId);
        const targetIndex = ids.indexOf(id);
        if (targetIndex === -1) return;
        ids.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, draggedId);
        grades.reorderComponents(data.courseId, ids);
    }

    function handleComponentReorderKey(id: string, event: KeyboardEvent) {
        if (!course || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const ids = course.components.map((component) => component.id);
        const index = ids.indexOf(id);
        const nextIndex = index + (event.key === "ArrowUp" ? -1 : 1);
        if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return;
        [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
        grades.reorderComponents(data.courseId, ids);
    }

    let deletingCourse = $state(false);

    async function handleDeleteCourse() {
        if (deletingCourse) return;
        const name = course?.name ?? "this course";
        if (!confirm(`Delete ${name}?`)) return;
        deletingCourse = true;
        try {
            await grades.deleteCourse(data.courseId);
            goto("/");
        } catch (error) {
            deletingCourse = false;
            alert(`Could not delete ${name}: ${error instanceof Error ? error.message : "unknown error"}`);
        }
    }
</script>

{#if course}
<div class="course-page">
    <header class="header">
        <div class="header-inner">
            <div class="nav-left">
                <button class="back-btn mono" onclick={() => goto("/")}>← back</button>
                <div class="breadcrumb mono">
                    <span style="color: oklch(0.4 0.02 265)">tracksem /</span>
                    <span style="color: {course.color}">{course.name}</span>
                </div>
                <SaveStatus />
            </div>
            <div class="header-actions">
                {#if confirmReset}
                    <span class="mono text-xs" style="color: #fb923c">reset to catalog defaults?</span>
                    <button class="action-btn danger mono text-xs" disabled={resetting} onclick={handleReset}
                        >{resetting ? "resetting..." : "yes"}</button
                    >
                    <button class="action-btn mono text-xs" onclick={() => (confirmReset = false)}>no</button>
                {:else}
                    {#if resetError}
                        <span class="reset-error mono" role="alert">{resetError}</span>
                    {/if}
                    <button
                        class="action-btn mono text-xs"
                        onclick={() => {
                            resetError = null;
                            confirmReset = true;
                        }}>reset</button
                    >
                {/if}
                <button class="action-btn danger mono text-xs" disabled={deletingCourse} onclick={handleDeleteCourse}
                    >{deletingCourse ? "deleting..." : "delete course"}</button
                >
                <button class="action-btn add mono text-xs" onclick={() => grades.addComponent(data.courseId)}
                    >+ add component</button
                >
            </div>
        </div>
    </header>

    <main class="main">
        <GradeHero {course} {proj} {curved} {totalWeight} />

        <div class="section-label mono">// components</div>

        <div class="comp-list">
            {#each course.components as comp (comp.id)}
                <ComponentRow
                    {course}
                    {comp}
                    dragging={draggingComponentId === comp.id}
                    dropPlacement={dragOverComponentId === comp.id ? dragPlacement : null}
                    ondragstart={(event) => handleComponentDragStart(comp.id, event)}
                    ondragend={clearComponentDrag}
                    ondragover={(event) => handleComponentDragOver(comp.id, event)}
                    ondragleave={(event) => handleComponentDragLeave(comp.id, event)}
                    ondrop={(event) => handleComponentDrop(comp.id, event)}
                    onreorderkey={(event) => handleComponentReorderKey(comp.id, event)}
                />
            {/each}
        </div>

        <div class="totals mono">
            <span
                >total weight: <strong style="color: {totalWeight === 100 ? '#4ade80' : '#fb923c'}"
                    >{totalWeight}%</strong
                ></span
            >
            {#if progress && progress.totalWeight > 0}
                <span title="weighted marks earned so far, out of 100"
                    >secured so far: <strong style="color: {getGradeColor(progress.secured)}"
                        >{progress.secured.toFixed(2)} / 100</strong
                    ></span
                >
                <span title="course total if every ungraded component gets full marks"
                    >max possible: <strong style="color: {getGradeColor(progress.maxPossible)}"
                        >{progress.maxPossible.toFixed(2)}</strong
                    ></span
                >
            {/if}
        </div>

        <NeedCalculator {course} />

        <button class="add-full-btn mono" onclick={() => grades.addComponent(data.courseId)}>+ add component</button>
    </main>
</div>
{:else}
<div class="course-page">
    <main class="main">
        <div class="section-label mono">
            {#if lookup === "loading"}
                loading course…
            {:else if lookup === "error"}
                couldn't load this course — check your connection
            {:else}
                course not found
            {/if}
        </div>
        <button class="back-btn mono" onclick={() => goto("/")}>← back</button>
    </main>
</div>
{/if}
