<script lang="ts">
    import { untrack } from "svelte";

    interface Props {
        value: string;
        onCommit: (value: string) => void;
        ariaLabel: string;
        class?: string;
        id?: string;
    }

    let { value, onCommit, ariaLabel, class: className = "", id }: Props = $props();

    let text = $state(untrack(() => value));
    let focused = false;

    $effect(() => {
        const next = value;
        untrack(() => {
            if (!focused) text = next;
        });
    });

    function commit() {
        const next = text.trim();
        if (!next) text = value;
        else if (next !== value) onCommit(next);
    }
</script>

<input
    {id}
    type="text"
    class={className}
    maxlength="100"
    autocomplete="off"
    aria-label={ariaLabel}
    bind:value={text}
    onfocus={() => (focused = true)}
    onblur={() => {
        focused = false;
        commit();
    }}
    onkeydown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
            text = value;
            e.currentTarget.blur();
        }
    }}
/>
