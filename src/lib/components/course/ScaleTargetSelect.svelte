<script lang="ts">
    import type { Course } from "$lib/types";
    import { wouldCreateScaleCycle } from "$lib/gradeMath";

    interface Props {
        course: Course;
        /** Component or sub-item being scaled */
        sourceId: string;
        kind: "component" | "sub";
        /** For sub-items: the component that owns them */
        parentId?: string;
        value: string | null | undefined;
        /** "chip": active-scaling pill with a clear button; "select": compact picker with an "off" option */
        variant: "chip" | "select";
        onchange: (targetId: string | null) => void;
    }

    let { course, sourceId, kind, parentId, value, variant, onchange }: Props = $props();

    const options = $derived.by(() => {
        const list: { id: string; label: string }[] = [];
        for (const target of course.components) {
            if (kind === "component" && target.id === sourceId) continue;
            if (!(kind === "sub" && target.id === parentId)) list.push({ id: target.id, label: target.name });
            for (const sub of target.subItems ?? []) {
                if (sub.id !== sourceId) list.push({ id: sub.id, label: `↳ ${target.name} / ${sub.name}` });
            }
        }
        return list.filter((option) => option.id === value || !wouldCreateScaleCycle(course, sourceId, option.id));
    });

    const currentLabel = $derived(options.find((option) => option.id === value)?.label ?? "");
</script>

{#if variant === "chip"}
    <div class="scaled-score-control" class:sub-scaled-control={kind === "sub"}>
        <label class="scaled-select-wrap mono">
            <span>scaled</span>
            <select
                class="scaled-select mono"
                value={value ?? ""}
                aria-label={kind === "sub" ? "change sub-item scale target" : "change scale target"}
                onchange={(e) => onchange(e.currentTarget.value || null)}
            >
                {#each options as option (option.id)}
                    <option value={option.id}>{option.label}</option>
                {/each}
            </select>
            <span class="scaled-target-label">{currentLabel}</span>
        </label>
        <button
            class="scaled-clear-btn"
            title="turn off scaling"
            aria-label="turn off scaling"
            onclick={() => onchange(null)}
        >×</button>
    </div>
{:else}
    <label class="scale-control mono" class:sub-scale-control={kind === "sub"}>
        <span>scale</span>
        <select
            class="scale-select mono"
            value={value ?? ""}
            onchange={(e) => onchange(e.currentTarget.value || null)}
        >
            <option value="">off</option>
            {#each options as option (option.id)}
                <option value={option.id}>{option.label}</option>
            {/each}
        </select>
    </label>
{/if}
