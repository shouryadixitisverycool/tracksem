<script lang="ts">
    import NumberField from "$lib/components/NumberField.svelte";

    interface Props {
        value: number;
        onCommit: (value: number) => void;
        ariaLabel: string;
        max?: number | null;
        /** Reject 0 (e.g. full marks must be > 0) */
        exclusiveMin?: boolean;
    }

    let { value, onCommit, ariaLabel, max = null, exclusiveMin = false }: Props = $props();
</script>

<!-- A number that reads as text but edits in place: dashed underline, click or tab in to change -->
<span class="inline-num" style="--chars: {Math.max(String(value).length, 1)}">
    <NumberField
        class="num-input mono"
        {ariaLabel}
        title="click to change"
        allowEmpty={false}
        {exclusiveMin}
        {max}
        {value}
        onCommit={(v) => v !== null && onCommit(v)}
    />
</span>
