<script lang="ts">
    import { tick, type Snippet } from "svelte";

    interface Props {
        value: string;
        onCommit: (name: string) => void;
        small?: boolean;
        label: string;
        children?: Snippet;
    }

    let { value, onCommit, small = false, label, children }: Props = $props();

    let editing = $state(false);
    let cancelled = false;

    function focusOnMount(node: HTMLInputElement) {
        tick().then(() => {
            node.focus();
            node.select();
        });
    }
</script>

{#if editing}
    <input
        class="name-input mono"
        {value}
        maxlength="100"
        aria-label="rename {label}"
        use:focusOnMount
        onblur={(e) => {
            const next = e.currentTarget.value.trim();
            editing = false;
            if (!cancelled && next && next !== value) onCommit(next);
            cancelled = false;
        }}
        onkeydown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") {
                cancelled = true;
                e.currentTarget.blur();
            }
        }}
    />
{:else}
    <button class="name-display mono" class:small title="rename {label}" onclick={() => (editing = true)}>
        {value}
        {@render children?.()}
        <span class="edit-hint" aria-hidden="true">✏</span>
    </button>
{/if}
