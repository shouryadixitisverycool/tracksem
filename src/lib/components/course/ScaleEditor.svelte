<script lang="ts">
    import type { Course, ScaleRule } from "$lib/types";
    import { computeEffectiveCompPct, computeEffectiveSubPct, explainScale, itemLabel, standingOf, wouldCreateScaleCycle } from "$lib/gradeMath";
    import { getGradeColor } from "$lib/grading";
    import { fmt, listNames } from "./display";

    interface Props {
        course: Course;
        /** Component or part being scaled */
        itemId: string;
        name: string;
        rule: ScaleRule | null | undefined;
        /** Full marks of the item, to show the result as marks; null for a component with parts */
        maxScore: number | null;
        onchange: (rule: ScaleRule | null) => void;
    }

    let { course, itemId, name, rule, maxScore, onchange }: Props = $props();

    let menuOpen = $state(false);
    let menuEl = $state<HTMLElement | null>(null);
    /** Items picked before switching to the whole course, restored when switching back */
    let lastItems = $state<string[]>([]);

    const whole = $derived(rule?.from === "course");
    const picked = $derived(rule && rule.from !== "course" ? rule.from : []);
    const result = $derived(rule ? explainScale(course, itemId) : null);
    const multi = $derived(whole || picked.length > 1);
    const relative = $derived(rule?.mode === "relative");

    const options = $derived.by(() => {
        const list: { id: string; label: string; note: string }[] = [];
        for (const comp of course.components) {
            const pct = computeEffectiveCompPct(course, comp);
            list.push({ id: comp.id, label: comp.name, note: pct === null ? "no marks yet" : `${fmt(comp.weight)}%` });
            for (const sub of comp.subItems ?? []) {
                const subPct = computeEffectiveSubPct(course, sub);
                list.push({ id: sub.id, label: `${comp.name} / ${sub.name}`, note: subPct === null ? "no marks yet" : "part" });
            }
        }
        return list.filter((o) => o.id !== itemId && !picked.includes(o.id) && !wouldCreateScaleCycle(course, itemId, o.id));
    });

    const sources = $derived(
        (result?.sources ?? []).map((source) => ({
            ...source,
            label: itemLabel(course, source.id) ?? "?",
            standing: relative && source.pct !== null ? standingOf(course, source.id) : null,
        })),
    );
    const sourceNames = $derived(whole ? "the rest of the course" : listNames(sources.map((s) => s.label)));
    const ungraded = $derived(sources.filter((s) => s.pct === null).map((s) => s.label));
    const statless = $derived(result?.mode === "relative" ? sources.filter((s) => s.pct !== null && !s.standing).map((s) => s.label) : []);

    function change(patch: Partial<ScaleRule>) {
        if (rule) onchange({ ...rule, ...patch });
    }

    function pick(id: string) {
        menuOpen = false;
        if (id === "course") {
            lastItems = picked;
            if (rule) change({ from: "course" });
            else onchange({ from: "course", mode: "absolute", combine: "weight" });
        } else if (!rule) {
            onchange({ from: [id], mode: "absolute", combine: "weight" });
        } else {
            change({ from: [...picked, id] });
        }
    }

    function remove(id: string) {
        const from = picked.filter((x) => x !== id);
        if (from.length > 0) change({ from });
    }

    function toggleWhole(event: MouseEvent) {
        // The window listener would otherwise close the menu this click opens
        event.stopPropagation();
        if (!whole) return pick("course");
        const restore = lastItems.filter((id) => itemLabel(course, id) !== null && !wouldCreateScaleCycle(course, itemId, id));
        if (restore.length > 0) change({ from: restore });
        else menuOpen = true;
    }

    function onWindowClick(event: MouseEvent) {
        if (menuOpen && menuEl && !menuEl.contains(event.target as Node)) menuOpen = false;
    }

    const marks = (pct: number) => (maxScore ? `${fmt((pct / 100) * maxScore)}/${fmt(maxScore)}` : null);
    const weightLabel = (weight: number) => (rule?.combine === "equal" ? "1×" : `${fmt(weight)}%`);
</script>

<svelte:window onclick={onWindowClick} />

{#snippet menu(label: string, dashed: boolean)}
    <span class="menu" bind:this={menuEl}>
        <button
            class="chip mono"
            class:dash={dashed}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onclick={() => (menuOpen = !menuOpen)}>{label}</button
        >
        {#if menuOpen}
            <span class="menu-list mono" role="menu">
                {#if !rule}
                    <button class="menu-item" role="menuitem" onclick={() => pick("course")}>
                        whole course <span class="dim">every other component</span>
                    </button>
                {/if}
                {#each options as option (option.id)}
                    <button class="menu-item" role="menuitem" onclick={() => pick(option.id)}>
                        {option.label} <span class="dim">{option.note}</span>
                    </button>
                {:else}
                    <span class="menu-empty dim">nothing else to add</span>
                {/each}
            </span>
        {/if}
    </span>
{/snippet}

{#if !rule}
    <div class="sec-label mono scale-off">
        <span>Scaling <span class="lower">· not scaled, you enter the marks</span></span>
        {@render menu("+ scale from other marks", true)}
    </div>
{:else}
    <div class="sec-label mono">
        <span>Scaling</span>
        <button class="link lower" onclick={() => onchange(null)}>stop scaling</button>
    </div>
    <div class="scale-grid mono">
        <span class="scale-k">from</span>
        <div class="scale-row">
            <button class="chip mono" class:on={whole} aria-pressed={whole} onclick={toggleWhole}>whole course</button>
            {#if whole}
                {#if menuOpen}
                    {@render menu("pick items ▾", true)}
                {:else}
                    <span class="dim small">every other component, except ones scaled from the whole course</span>
                {/if}
            {:else}
                {#each picked as id (id)}
                    <button
                        class="chip on mono"
                        title={picked.length > 1 ? "remove" : "use stop scaling to remove the last source"}
                        onclick={() => remove(id)}
                    >
                        {itemLabel(course, id) ?? "?"}
                        {#if picked.length > 1}<span class="x" aria-label="remove">✕</span>{/if}
                    </button>
                {/each}
                {#if options.length > 0}{@render menu("+ item ▾", true)}{/if}
            {/if}
        </div>

        {#if multi}
            <span class="scale-k">combine</span>
            <div class="scale-row">
                <span class="seg" role="group" aria-label="combine sources">
                    <button class:on={rule.combine === "weight"} aria-pressed={rule.combine === "weight"} onclick={() => change({ combine: "weight" })}
                        >by course weight</button
                    >
                    <button class:on={rule.combine === "equal"} aria-pressed={rule.combine === "equal"} onclick={() => change({ combine: "equal" })}
                        >equally</button
                    >
                </span>
            </div>
        {/if}

        <span class="scale-k">method</span>
        <div class="scale-row">
            <span class="seg" role="group" aria-label="scaling method">
                <button class:on={!relative} aria-pressed={!relative} onclick={() => change({ mode: "absolute" })}>absolute · same %</button>
                <button class:on={relative} aria-pressed={relative} onclick={() => change({ mode: "relative" })}
                    >relative · same percentile</button
                >
            </span>
        </div>
    </div>

    {#if result}
        <div class="scale-flow mono">
            {#each sources as source (source.id)}
                <div class="scale-src" class:muted={source.pct === null}>
                    <span class="scale-src-name">
                        {source.label}{#if multi}<span class="dim">{` · ${weightLabel(source.weight)}`}</span>{/if}
                    </span>
                    {#if source.pct === null}
                        <span class="dim">no marks yet</span>
                    {:else if result.mode === "relative" && source.standing}
                        <span class="scale-v" style="color: {source.standing.color}">P{Math.floor(source.standing.percentile)}</span>
                        <span class="dim">{fmt(source.pct)}%</span>
                    {:else}
                        <span class="scale-v" style="color: {getGradeColor(source.pct)}">{fmt(source.pct)}%</span>
                        {#if result.mode === "relative"}<span class="dim">no class stats</span>{/if}
                    {/if}
                </div>
            {/each}
            <span class="scale-arrow" aria-hidden="true">→</span>
            <div class="scale-out" class:pending={result.pct === null}>
                <span class="dim">{name}</span>
                {#if result.pct === null}
                    <span class="dim">waits for marks</span>
                {:else if result.mode === "relative" && result.standing}
                    <span class="scale-v">P{Math.floor(result.standing.percentile)} → {marks(result.pct) ?? `${fmt(result.pct)}%`}</span>
                    <span class="dim">{fmt(result.pct)}%</span>
                {:else}
                    <span class="scale-v">{fmt(result.pct)}%</span>
                    {#if marks(result.pct)}<span class="dim">{marks(result.pct)}</span>{/if}
                {/if}
            </div>
        </div>

        <p class="help mono">
            {#if relative}
                Relative: your standing in {multi ? "those items combined" : sourceNames} is placed on {name}'s own class curve.
            {:else if multi}
                Absolute: {name} gets the {rule.combine === "weight" ? "course-weighted" : "plain"} average % of {whole ? "the rest of the course" : "those items"}.
            {:else}
                Absolute: {name} gets the same % as {sourceNames}.
            {/if}
            {#if ungraded.length > 0 && result.pct !== null}
                {listNames(ungraded)} {ungraded.length === 1 ? "has" : "have"} no marks yet, so {ungraded.length === 1 ? "it's" : "they're"} skipped.
            {/if}
            {#if result.fallback === "no-own-stats"}
                <span class="warn">Add {name}'s class average to use relative scaling. Until then it copies the %.</span>
            {:else if result.fallback === "no-source-stats"}
                <span class="warn">None of the graded sources has class stats, so it copies the % for now.</span>
            {:else if statless.length > 0}
                <span class="warn">
                    {listNames(statless)} {statless.length === 1 ? "has" : "have"} no class stats, so {statless.length === 1 ? "it's" : "they're"} left out of
                    the standing.
                </span>
            {/if}
        </p>
    {/if}
{/if}
