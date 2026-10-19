<script lang="ts">
	import "./layout.css";
	import { grades } from "$lib/stores/grades.svelte";
	import UndoToast from "$lib/components/UndoToast.svelte";

	let { children } = $props();

	$effect(() => {
		if (!grades.loaded && !grades.loadError) {
			grades.load();
		}
	});

	function handleBeforeUnload(event: BeforeUnloadEvent) {
		if (!grades.hasPendingWrites) return;
		event.preventDefault();
		event.returnValue = "";
	}

	function handleVisibilityChange() {
		if (document.visibilityState === "visible") grades.refresh();
	}
</script>

<svelte:window onbeforeunload={handleBeforeUnload} />
<svelte:document onvisibilitychange={handleVisibilityChange} />

<svelte:head>
	<title>tracksem — {grades.activeSemester?.label ?? 'grades'}</title>
	<meta
		name="description"
		content="Track your semester course grades and projections"
	/>
</svelte:head>

{#if grades.loaded}
	{@render children()}
	<UndoToast />
{:else if grades.loadError}
	<div class="loading">
		<span class="mono">couldn't load your grades: {grades.loadError}</span>
		<button class="retry mono" onclick={() => grades.load()}>retry</button>
	</div>
{:else}
	<div class="loading">
		<span class="mono">loading…</span>
	</div>
{/if}

<style>
	.loading {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: 1rem;
		text-align: center;
		color: oklch(0.5 0.02 265);
		font-family: "JetBrains Mono", monospace;
		font-size: 0.8rem;
	}
	.retry {
		background: none;
		border: 1px solid oklch(1 0 0 / 15%);
		border-radius: 6px;
		color: oklch(0.8 0.01 265);
		padding: 0.4rem 0.9rem;
		cursor: pointer;
	}
	.retry:hover {
		border-color: #22d3ee66;
		color: #22d3ee;
	}
</style>
