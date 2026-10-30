<script lang="ts">
    import { getGrades } from "$lib/stores/grades.svelte";

    const grades = getGrades();

    const saveState = $derived(grades.saveState);
    const failures = $derived(grades.saves.failures);
    const detail = $derived(failures.map((failure) => failure.message).join("\n"));
</script>

<div class="save-status mono" role="status" aria-live="polite">
    {#if saveState === "error"}
        <span class="failed" title={detail}>save failed{failures.length > 1 ? ` (${failures.length})` : ""}</span>
        <button class="save-action" onclick={() => grades.saves.retry()}>retry</button>
        <button
            class="save-action"
            title="discard unsaved changes and reload from the server"
            onclick={() => grades.discardFailedSaves()}>discard</button
        >
    {:else if saveState === "saving"}
        <span class="saving">saving…</span>
    {:else}
        <span class="saved">saved</span>
    {/if}
</div>

<style>
    .save-status {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.65rem;
        white-space: nowrap;
    }
    .saved {
        color: oklch(0.42 0.02 265);
    }
    .saving {
        color: #22d3ee;
    }
    .failed {
        color: #f87171;
        cursor: help;
    }
    .save-action {
        background: none;
        border: 1px solid #f8717140;
        border-radius: 4px;
        color: #fca5a5;
        font: inherit;
        padding: 0.1rem 0.4rem;
        cursor: pointer;
    }
    .save-action:hover {
        background: #f8717115;
    }
</style>
