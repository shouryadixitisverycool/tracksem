<script lang="ts">
    import type { Course } from "$lib/types";
    import { computeEffectiveCompPct } from "$lib/stores/grades.svelte";
    import { requiredScoreForPercentile } from "$lib/gradeMath";
    import { getCurvedGradeColor, type CurvedLetter } from "$lib/curveGrading";
    import { CURVED_CUTOFFS, LETTER_CUTOFFS, getGradeColor } from "$lib/grading";
    import { needCandidates, remainingSubAverage, requiredPct, type NeedMode } from "$lib/need";

    interface Props {
        course: Course;
    }

    let { course }: Props = $props();

    let selectedId = $state<string | null>(null);
    let mode = $state<NeedMode>("same");
    const selectId = $props.id();

    const candidates = $derived(needCandidates(course));
    const compId = $derived.by(() => {
        if (selectedId && candidates.some((c) => c.id === selectedId)) return selectedId;
        return candidates.find((c) => computeEffectiveCompPct(course, c) === null)?.id ?? candidates[0]?.id ?? null;
    });
    const comp = $derived(candidates.find((c) => c.id === compId) ?? null);

    const absoluteRows = $derived(
        comp
            ? LETTER_CUTOFFS.map((cutoff) => {
                  const pct = requiredPct(course, comp.id, cutoff.min, mode);
                  return {
                      ...cutoff,
                      pct,
                      remaining: pct !== null && pct > 0 && pct <= 100 ? remainingSubAverage(course, comp, pct) : null
                  };
              })
            : []
    );

    const curvedRows = $derived(
        comp
            ? CURVED_CUTOFFS.map((cutoff) => ({
                  ...cutoff,
                  required: requiredScoreForPercentile(course, comp.id, cutoff.percentile)
              }))
            : []
    );
    const hasCurved = $derived(curvedRows.some((row) => row.required !== null));

    const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
</script>

{#if comp}
    <section class="need-panel" aria-labelledby="{selectId}-title">
        <div class="section-label mono" id="{selectId}-title" style="margin-bottom: 0">// what do I need</div>
        <div class="need-controls mono">
            <label class="meta-field" for={selectId}>
                on
                <select id={selectId} class="meta-select mono" value={comp.id} onchange={(e) => (selectedId = e.currentTarget.value)}>
                    {#each candidates as candidate (candidate.id)}
                        <option value={candidate.id}>
                            {candidate.name}{computeEffectiveCompPct(course, candidate) === null ? "" : " (graded)"}
                        </option>
                    {/each}
                </select>
            </label>
            <div class="mode-toggle mono" role="group" aria-label="assumption for other ungraded components">
                <button
                    class="mode-btn"
                    class:active={mode === "same"}
                    aria-pressed={mode === "same"}
                    title="every other ungraded component scores the same %"
                    onclick={() => (mode = "same")}>others score the same</button
                >
                <button
                    class="mode-btn"
                    class:active={mode === "last"}
                    aria-pressed={mode === "last"}
                    title="ignore other ungraded components, as if this is the last one that counts"
                    onclick={() => (mode = "last")}>this is the last one</button
                >
            </div>
        </div>

        <div class="need-grid mono">
            <table class="need-table">
                <caption>absolute grade — marks needed on {comp.name}</caption>
                <tbody>
                    {#each absoluteRows as row (row.letter)}
                        <tr>
                            <td style="color: {getGradeColor(row.min)}">{row.letter} <span class="dimmed">≥{row.min}%</span></td>
                            <td>
                                {#if row.pct === null}
                                    <span class="dimmed">—</span>
                                {:else if row.pct <= 0}
                                    <span class="need-secured">secured ✓</span>
                                {:else if row.pct > 100}
                                    <span class="need-unreachable" title="needs {row.pct.toFixed(1)}%">not reachable</span>
                                {:else}
                                    {fmt((row.pct / 100) * comp.maxScore)}/{fmt(comp.maxScore)}
                                    <span class="dimmed">({row.pct.toFixed(1)}%)</span>
                                    {#if row.remaining}
                                        <div class="need-hint">
                                            ≈ {row.remaining.pct > 100 ? "over 100" : Math.max(row.remaining.pct, 0).toFixed(1)}% avg on
                                            the {row.remaining.count} remaining
                                        </div>
                                    {/if}
                                {/if}
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>

            <table class="need-table">
                <caption>curved grade — marks needed on {comp.name}</caption>
                <tbody>
                    {#each curvedRows as row (row.letter)}
                        {@const color = getCurvedGradeColor(row.letter as CurvedLetter)}
                        <tr>
                            <td style="color: {color}">{row.letter} <span class="dimmed">≥P{row.percentile}</span></td>
                            <td>
                                {#if !row.required}
                                    <span class="dimmed">—</span>
                                {:else if !row.required.reachable}
                                    <span class="need-unreachable">not reachable</span>
                                {:else if row.required.score <= 0}
                                    <span class="need-secured">secured ✓</span>
                                {:else}
                                    {fmt(row.required.score)}/{fmt(row.required.maxScore)}
                                {/if}
                                {#if row.required?.assumedStats}
                                    <span class="assumed-badge" title="class stats for this component were assumed">assumed</span>
                                {/if}
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
        <div class="need-hint mono">
            {#if mode === "same"}
                absolute targets assume every other ungraded component scores the same %.
            {:else}
                absolute targets ignore other ungraded components, as if {comp.name} is the last one that counts.
            {/if}
            {#if !hasCurved}
                curved targets appear once the course has class statistics.
            {:else}
                curved targets use the class statistics; "assumed" means they were estimated.
            {/if}
        </div>
    </section>
{/if}
