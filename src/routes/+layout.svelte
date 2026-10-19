<script lang="ts">
	import "./layout.css";
	import { grades } from "$lib/stores/grades.svelte";

	let { children } = $props();

	$effect(() => {
		if (!grades.loaded) {
			grades.load();
		}
	});
</script>

<svelte:head>
	<title>tracksem — {grades.activeSemester?.label ?? 'grades'}</title>
	<meta
		name="description"
		content="Track your semester course grades and projections"
	/>
</svelte:head>

{#if grades.loaded}
	{@render children()}
{:else}
	<div class="loading">
		<span class="mono">loading…</span>
	</div>
{/if}

<style>
	.loading {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		color: oklch(0.5 0.02 265);
		font-family: "JetBrains Mono", monospace;
		font-size: 0.8rem;
	}
</style>
