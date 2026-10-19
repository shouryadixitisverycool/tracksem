<script lang="ts">
    import NumberField from "$lib/components/NumberField.svelte";
    import { validateStats, type StatsIssue } from "$lib/curveGrading";
    import type { StatField } from "$lib/stores/grades.svelte";

    interface Props {
        /** Unique prefix for input ids */
        idPrefix: string;
        maxScore: number;
        /** Student's marks on this item (same scale as maxScore), used to sanity-check the stats */
        score: number | null;
        classAvg?: number | null;
        classMedian?: number | null;
        classMax?: number | null;
        classStdDev?: number | null;
        classFullPct?: number | null;
        onCommit: (field: StatField, value: number | null) => void;
    }

    let { idPrefix, maxScore, score, classAvg, classMedian, classMax, classStdDev, classFullPct, onCommit }: Props =
        $props();

    const issues = $derived(
        validateStats({ maxScore, score, classAvg, classMedian, classMax, classStdDev, classFullPct }) ?? []
    );

    function toneFor(field: StatsIssue["field"]): "error" | "warning" | null {
        const fieldIssues = issues.filter((issue) => issue.field === field);
        if (fieldIssues.some((issue) => issue.level === "error")) return "error";
        return fieldIssues.length > 0 ? "warning" : null;
    }
</script>

<div class="stats-inputs">
    <div class="stats-field">
        <label class="stats-label mono" for="{idPrefix}-avg">avg</label>
        <NumberField
            id="{idPrefix}-avg"
            class="num-input mono stats-input"
            value={classAvg}
            max={maxScore}
            placeholder="class avg"
            tone={toneFor("classAvg")}
            onCommit={(v) => onCommit("classAvg", v)}
        />
    </div>
    <div class="stats-field">
        <label class="stats-label mono" for="{idPrefix}-median">median</label>
        <NumberField
            id="{idPrefix}-median"
            class="num-input mono stats-input"
            value={classMedian}
            max={maxScore}
            placeholder="optional"
            tone={toneFor("classMedian")}
            onCommit={(v) => onCommit("classMedian", v)}
        />
    </div>
    <div class="stats-field">
        <label class="stats-label mono" for="{idPrefix}-max">max</label>
        <NumberField
            id="{idPrefix}-max"
            class="num-input mono stats-input"
            value={classMax}
            max={maxScore}
            placeholder={String(maxScore)}
            title="Highest score in the class. Defaults to the paper max (assumes someone got full marks)."
            tone={toneFor("classMax")}
            onCommit={(v) => onCommit("classMax", v)}
        />
        {#if classMax == null}
            <span class="assumed-badge mono" title="No class max entered, so the paper max is assumed">
                assumed {maxScore}
            </span>
        {/if}
    </div>
    <div class="stats-field">
        <label class="stats-label mono" for="{idPrefix}-sd">σ</label>
        <NumberField
            id="{idPrefix}-sd"
            class="num-input mono stats-input"
            value={classStdDev}
            placeholder="auto"
            tone={toneFor("classStdDev")}
            onCommit={(v) => onCommit("classStdDev", v)}
        />
    </div>
    <div class="stats-field">
        <label class="stats-label mono" for="{idPrefix}-full" title="Percentage of the class that scored full marks">
            full %
        </label>
        <NumberField
            id="{idPrefix}-full"
            class="num-input mono stats-input"
            value={classFullPct}
            max={100}
            placeholder="optional"
            title="Percentage of the class that scored full marks"
            tone={toneFor("classFullPct")}
            onCommit={(v) => onCommit("classFullPct", v)}
        />
    </div>
</div>
{#if issues.length > 0}
    <ul class="stats-issues mono">
        {#each issues as issue, i (i)}
            <li class="stats-issue {issue.level}">{issue.level === "error" ? "✕" : "⚠"} {issue.message}</li>
        {/each}
    </ul>
{/if}
