<script lang="ts">
    import { getGrades, UNDO_DELETE_MS } from "$lib/stores/grades.svelte";

    const grades = getGrades();
</script>

{#if grades.pendingDeletes.length > 0}
    <div class="toasts" role="status" aria-live="polite">
        {#each grades.pendingDeletes as item (item.key)}
            <div class="toast mono">
                <span class="toast-text">deleted <strong>{item.label}</strong></span>
                <button class="undo-btn" onclick={() => grades.undoDelete(item.key)}>undo</button>
                <span class="countdown" style="animation-duration: {UNDO_DELETE_MS}ms"></span>
            </div>
        {/each}
    </div>
{/if}

<style>
    .toasts {
        position: fixed;
        left: 50%;
        bottom: max(1rem, env(safe-area-inset-bottom));
        transform: translateX(-50%);
        z-index: 200;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        width: min(420px, calc(100vw - 1.5rem));
    }
    .toast {
        position: relative;
        overflow: hidden;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.6rem 0.75rem;
        background: oklch(0.16 0.025 265);
        border: 1px solid oklch(1 0 0 / 14%);
        border-radius: 8px;
        box-shadow: 0 12px 32px oklch(0 0 0 / 45%);
        font-size: 0.75rem;
        color: oklch(0.8 0.01 265);
    }
    .toast-text {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .toast-text strong {
        color: oklch(0.95 0.01 265);
        font-weight: 600;
    }
    .undo-btn {
        min-height: 36px;
        padding: 0 0.9rem;
        background: #22d3ee18;
        border: 1px solid #22d3ee50;
        border-radius: 6px;
        color: #22d3ee;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
    }
    .undo-btn:hover {
        background: #22d3ee28;
    }
    .countdown {
        position: absolute;
        left: 0;
        bottom: 0;
        height: 2px;
        width: 100%;
        background: #22d3ee;
        transform-origin: left;
        animation-name: shrink;
        animation-timing-function: linear;
        animation-fill-mode: forwards;
    }
    @keyframes shrink {
        to {
            transform: scaleX(0);
        }
    }
</style>
