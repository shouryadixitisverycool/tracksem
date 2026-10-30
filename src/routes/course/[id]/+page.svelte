<script lang="ts">
    import "$lib/components/course/course.css";
    import type { PageProps } from "./$types";
    import { untrack } from "svelte";
    import { goto } from "$app/navigation";
    import { resolve } from "$app/paths";
    import { getGrades } from "$lib/stores/grades.svelte";
    import SaveStatus from "$lib/components/SaveStatus.svelte";
    import GradeHero from "$lib/components/course/GradeHero.svelte";
    import ComponentCard from "$lib/components/course/ComponentCard.svelte";
    import ComponentPanel from "$lib/components/course/ComponentPanel.svelte";
    import CourseSetup from "$lib/components/course/CourseSetup.svelte";
    import { gradeBasis, reachableTarget } from "$lib/components/course/display";

    const grades = getGrades();

    let { data }: PageProps = $props();

    const course = $derived(grades.getCourse(data.courseId));
    const proj = $derived(grades.projectedGrade(data.courseId));
    const totalWeight = $derived(grades.totalWeight(data.courseId));
    const curved = $derived(grades.curvedGrade(data.courseId));

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

    let setup = $state(false);
    let openId = $state<string | null>(null);

    const target = $derived(course ? reachableTarget(course) : "A");
    const basis = $derived(course ? gradeBasis(course) : "absolute");

    // The open panel spans the full width under its row, so we need to know how many cards fit in a row
    let columns = $state(2);
    $effect(() => {
        const query = window.matchMedia("(max-width: 640px)");
        const update = () => (columns = query.matches ? 1 : 2);
        update();
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    });

    const rows = $derived.by(() => {
        const list = course?.components ?? [];
        const out: (typeof list)[] = [];
        for (let i = 0; i < list.length; i += columns) out.push(list.slice(i, i + columns));
        return out;
    });
    const openComp = $derived(course?.components.find((c) => c.id === openId) ?? null);

    function toggle(id: string) {
        openId = openId === id ? null : id;
    }

    function openSetup() {
        openId = null;
        setup = true;
        window.scrollTo({ top: 0 });
    }

    function addComponent() {
        grades.addComponent(data.courseId);
        openSetup();
    }
</script>

<svelte:window
    onkeydown={(e) => {
        if (e.key === "Escape" && openId && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) openId = null;
    }}
/>

{#if course}
    <div class="course-page">
        <header class="header">
            <div class="header-inner">
                <div class="nav-left">
                    <button class="btn mono" onclick={() => goto(resolve("/"))}>← back</button>
                    <div class="breadcrumb mono">
                        <span class="dim">tracksem /</span>
                        {#if setup}
                            <button class="link" style="color: {course.color}" onclick={() => (setup = false)}>{course.name}</button>
                            <span class="dim">/ setup</span>
                        {:else}
                            <span style="color: {course.color}">{course.name}</span>
                        {/if}
                    </div>
                    <SaveStatus />
                </div>
                {#if setup}
                    <button class="btn primary mono" onclick={() => (setup = false)}>done</button>
                {:else}
                    <button class="btn mono" onclick={openSetup}>edit setup</button>
                {/if}
            </div>
        </header>

        <main class="main">
            {#if setup}
                <CourseSetup {course} ondeleted={() => goto(resolve("/"))} />
            {:else}
                <GradeHero {course} {proj} {curved} {totalWeight} onsetup={openSetup} />

                <div class="cards" style="--cols: {columns}">
                    {#each rows as row, r (r)}
                        {#each row as comp (comp.id)}
                            <ComponentCard {course} {comp} {target} {basis} open={openId === comp.id} onclick={() => toggle(comp.id)} />
                        {/each}
                        {#if openComp && row.some((c) => c.id === openId)}
                            <ComponentPanel {course} comp={openComp} {target} {basis} onclose={() => (openId = null)} onsetup={openSetup} />
                        {/if}
                    {/each}
                    <button class="card add-card mono" onclick={addComponent}>+ add component</button>
                </div>
            {/if}
        </main>
    </div>
{:else}
    <div class="course-page">
        <main class="main">
            <p class="dim mono">
                {#if lookup === "loading"}
                    loading course…
                {:else if lookup === "error"}
                    couldn't load this course. Check your connection.
                {:else}
                    course not found
                {/if}
            </p>
            <button class="btn mono" onclick={() => goto(resolve("/"))}>← back</button>
        </main>
    </div>
{/if}
