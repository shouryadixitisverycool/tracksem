<script lang="ts">
    import NumberField from "$lib/components/NumberField.svelte";
    import { validateStats, type StatsIssue } from "$lib/curveGrading";
    import type { StatField } from "$lib/stores/grades.svelte";

    interface Props {
        /** Unique prefix for input ids */
        idPrefix: string;
        /** Item name, for input labels */
        label: string;
        maxScore: number;
        /** Student's marks on this item (same scale as maxScore), used to sanity-check the stats */
        score: number | null;
        classAvg?: number | null;
        classMedian?: number | null;
        classMax?: number | null;
        classStdDev?: number | null;
        classFullPct?: number | null;
        /** σ the curve uses when none is entered; shown as the placeholder */
        estimatedSd?: number | null;
        /** One inline row with short labels, for per-part stats */
        compact?: boolean;
        onCommit: (field: StatField, value: number | null) => void;
    }

    let {
        idPrefix,
        label,
        maxScore,
        score,
        classAvg,
        classMedian,
        classMax,
        classStdDev,
        classFullPct,
        estimatedSd = null,
        compact = false,
        onCommit,
    }: Props = $props();

    const issues = $derived(
        validateStats({ maxScore, score, classAvg, classMedian, classMax, classStdDev, classFullPct }) ?? []
    );

    function toneFor(field: StatsIssue["field"]): "error" | "warning" | null {
        const fieldIssues = issues.filter((issue) => issue.field === field);
        if (fieldIssues.some((issue) => issue.level === "error")) return "error";
        return fieldIssues.length > 0 ? "warning" : null;
    }

    const fields = $derived([
        { key: "classAvg", long: "average", short: "avg", value: classAvg, max: maxScore, placeholder: "—", title: "Class average" },
        { key: "classMedian", long: "median", short: "median", value: classMedian, max: maxScore, placeholder: "—", title: "Class median" },
        {
            key: "classMax",
            long: "highest",
            short: "max",
            value: classMax,
            max: maxScore,
            placeholder: String(maxScore),
            title: "Highest score in the class. Left blank, the paper max is assumed.",
        },
        {
            key: "classStdDev",
            long: "std dev",
            short: "σ",
            value: classStdDev,
            max: null,
            placeholder: estimatedSd != null ? `≈${Math.round(estimatedSd * 10) / 10}` : "auto",
            title: "Standard deviation. Left blank, it is estimated from the highest mark.",
        },
        {
            key: "classFullPct",
            long: "% full marks",
            short: "full %",
            value: classFullPct,
            max: 100,
            placeholder: "—",
            title: "Percentage of the class that scored full marks",
        },
    ] as const);
</script>

<div class="stat-fields mono" class:compact>
    {#each fields as field (field.key)}
        <label class="stat-field" for="{idPrefix}-{field.key}" title={field.title}>
            <span>{compact ? field.short : field.long}</span>
            <NumberField
                id="{idPrefix}-{field.key}"
                class="num-input mono"
                ariaLabel="{label} class {field.long}"
                value={field.value}
                max={field.max}
                placeholder={field.placeholder}
                tone={toneFor(field.key)}
                onCommit={(v) => onCommit(field.key, v)}
            />
        </label>
    {/each}
</div>
{#if issues.length > 0}
    <ul class="stats-issues mono">
        {#each issues as issue, i (i)}
            <li class="stats-issue {issue.level}">{issue.level === "error" ? "✕" : "⚠"} {issue.message}</li>
        {/each}
    </ul>
{/if}
