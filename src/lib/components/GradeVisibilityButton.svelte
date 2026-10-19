<script lang="ts">
    let { label, hidden = false, onchange }: {
        label: string;
        hidden?: boolean;
        onchange: (hidden: boolean) => void;
    } = $props();
</script>

<button
    type="button"
    class:hidden
    aria-label={`Show ${label} grade on dashboard`}
    aria-pressed={!hidden}
    title={`${hidden ? 'Show' : 'Hide'} ${label} grade on dashboard`}
    onclick={() => onchange(!hidden)}
>
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        {#if hidden}
            <path d="m3 3 18 18 M10.6 10.6a2 2 0 0 0 2.8 2.8 M9.9 5.2A11 11 0 0 1 12 5c7 0 10 7 10 7a16 16 0 0 1-3 4.1 M6.6 6.6C3.5 8.6 2 12 2 12s3 7 10 7a11 11 0 0 0 5.4-1.4" />
        {:else}
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
        {/if}
    </svg>
</button>

<style>
    button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        padding: 0;
        border: 0;
        border-radius: 3px;
        background: transparent;
        color: oklch(0.6 0.02 265);
        cursor: pointer;
        transition: color 0.15s;
    }
    button.hidden {
        color: oklch(0.45 0.02 265);
    }
    button:hover {
        color: oklch(0.9 0.02 265);
    }
    button:focus-visible {
        outline: 2px solid oklch(0.7 0.14 250);
        outline-offset: 3px;
    }
</style>
