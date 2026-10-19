<script lang="ts">
    import { untrack } from "svelte";

    interface Props {
        value: number | null | undefined;
        onCommit: (value: number | null) => void;
        min?: number;
        /** Reject `min` itself (e.g. max score must be > 0) */
        exclusiveMin?: boolean;
        max?: number | null;
        integer?: boolean;
        allowEmpty?: boolean;
        class?: string;
        id?: string;
        ariaLabel?: string;
        placeholder?: string;
        title?: string;
        disabled?: boolean;
        /** Highlight from external validation (e.g. class stats issues) */
        tone?: "error" | "warning" | null;
    }

    let {
        value,
        onCommit,
        min = 0,
        exclusiveMin = false,
        max = null,
        integer = false,
        allowEmpty = true,
        class: className = "",
        id,
        ariaLabel,
        placeholder,
        title,
        disabled = false,
        tone = null,
    }: Props = $props();

    const format = (v: number | null | undefined) => (v == null ? "" : String(v));

    let text = $state(untrack(() => format(value)));
    let focused = $state(false);
    let error = $state<string | null>(null);
    const errorId = $props.id();

    $effect(() => {
        const next = value;
        untrack(() => {
            if (!focused) {
                text = format(next);
                error = null;
            }
        });
    });

    function parse(raw: string): { value: number | null } | { error: string } {
        const trimmed = raw.trim().replace(",", ".");
        if (trimmed === "") return allowEmpty ? { value: null } : { error: "required" };
        const num = Number(trimmed);
        if (!Number.isFinite(num)) return { error: "not a number" };
        if (integer && !Number.isInteger(num)) return { error: "whole numbers only" };
        if (exclusiveMin ? num <= min : num < min) return { error: exclusiveMin ? `must be > ${min}` : `min ${min}` };
        if (max != null && num > max) return { error: `max ${max}` };
        return { value: num };
    }

    function commit() {
        const result = parse(text);
        if ("error" in result) {
            error = result.error;
            return;
        }
        error = null;
        text = format(result.value);
        if (result.value !== (value ?? null)) onCommit(result.value);
    }

    function revert() {
        text = format(value);
        error = null;
    }
</script>

<span class="num-field">
    <input
        {id}
        type="text"
        inputmode={integer ? "numeric" : "decimal"}
        autocomplete="off"
        class={className}
        class:invalid={error !== null}
        class:tone-error={tone === "error" && error === null}
        class:tone-warning={tone === "warning" && error === null}
        aria-label={ariaLabel}
        aria-invalid={error !== null || tone === "error"}
        aria-describedby={error ? errorId : undefined}
        {placeholder}
        {title}
        {disabled}
        value={text}
        onfocus={() => (focused = true)}
        oninput={(e) => {
            text = e.currentTarget.value;
            const result = parse(text);
            error = "error" in result ? result.error : null;
        }}
        onblur={() => {
            focused = false;
            commit();
        }}
        onkeydown={(e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                commit();
            } else if (e.key === "Escape") {
                revert();
                e.currentTarget.blur();
            }
        }}
    />
    {#if error}
        <span class="num-error mono" id={errorId} role="alert">{error}</span>
    {/if}
</span>

<style>
    .num-field {
        position: relative;
        display: inline-flex;
    }
    .invalid {
        border-color: #f87171 !important;
        color: #fca5a5 !important;
    }
    .tone-error {
        border-color: #f8717190 !important;
    }
    .tone-warning {
        border-color: #fbbf2490 !important;
    }
    .num-error {
        position: absolute;
        top: calc(100% + 3px);
        right: 0;
        z-index: 30;
        white-space: nowrap;
        font-size: 0.6rem;
        color: #f87171;
        background: oklch(0.1 0.02 265);
        border: 1px solid #f8717140;
        border-radius: 4px;
        padding: 0.1rem 0.35rem;
        pointer-events: none;
    }
</style>
