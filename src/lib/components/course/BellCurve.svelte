<script lang="ts">
    import type { ScoreDistribution } from "$lib/curveGrading";
    import { fmt } from "./display";

    interface Props {
        dist: ScoreDistribution;
        score: number | null;
        avg: number;
        maxScore: number;
    }

    let { dist, score, avg, maxScore }: Props = $props();

    const W = 300;
    const H = 56;
    const base = H - 4;
    const x = (v: number) => (Math.min(Math.max(v, 0), maxScore) / maxScore) * W;
    const y = (v: number) => {
        const sigma = v < dist.center ? dist.sigmaLeft : dist.sigmaRight;
        const density = sigma > 0 ? Math.exp(-0.5 * ((v - dist.center) / sigma) ** 2) : v === dist.center ? 1 : 0;
        return base - density * (H - 10);
    };

    const points = $derived(Array.from({ length: 81 }, (_, i) => (i / 80) * maxScore));
    const curve = $derived(points.map((v, i) => `${i ? "L" : "M"}${x(v).toFixed(1)},${y(v).toFixed(1)}`).join(""));
    const shaded = $derived.by(() => {
        if (score === null) return "";
        const below = points.filter((v) => v <= score);
        if (below.length === 0) return "";
        const top = below.map((v, i) => `${i ? "L" : "M"}${x(v).toFixed(1)},${y(v).toFixed(1)}`).join("");
        return `${top}L${x(score).toFixed(1)},${y(score).toFixed(1)}L${x(score).toFixed(1)},${base}L0,${base}Z`;
    });
</script>

<svg class="bell" viewBox="-4 -12 {W + 8} {H + 24}" role="img" aria-label="class score distribution">
    <line x1="0" x2={W} y1={base} y2={base} class="bell-axis" />
    {#if shaded}<path d={shaded} class="bell-fill" />{/if}
    <path d={curve} class="bell-line" />
    <line x1={x(avg)} x2={x(avg)} y1="6" y2={base} class="bell-avg" />
    <text x={x(avg)} y={H + 8} text-anchor="middle" class="bell-label">avg {fmt(avg)}</text>
    {#if score !== null}
        <line x1={x(score)} x2={x(score)} y1="0" y2={base} class="bell-you" />
        <text x={x(score)} y="-3" text-anchor="middle" class="bell-label you">you {fmt(score)}</text>
    {/if}
    <text x="0" y={H + 8} class="bell-label">0</text>
    <text x={W} y={H + 8} text-anchor="end" class="bell-label">{fmt(maxScore)}</text>
</svg>
