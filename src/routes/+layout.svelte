<script lang="ts">
	import "./layout.css";
	import { provideGrades } from "$lib/stores/grades.svelte";
	import { untrack } from "svelte";
	import { base } from "$app/paths";
	import UndoToast from "$lib/components/UndoToast.svelte";

	let { children, data } = $props();

	// The sign-in page renders without grades (and without a signed-in user)
	const signedIn = $derived(data.user !== null);

	// Seed SSR and hydration from the same snapshot. Keep this store across navigation
	// so new layout data cannot overwrite optimistic edits or pending saves.
	const grades = provideGrades(untrack(() => data.grades));

	// Refetch when an agent changes data. EventSource reconnects on its own.
	$effect(() => {
		if (!signedIn) return;
		const events = new EventSource(`${base}/api/events`);
		let retry: ReturnType<typeof setTimeout> | null = null;
		events.addEventListener("change", () => {
			grades.refresh();
			if (!grades.hasPendingWrites) return;
			if (retry) clearTimeout(retry);
			retry = setTimeout(() => {
				retry = null;
				grades.refresh();
			}, 1500);
		});
		return () => {
			if (retry) clearTimeout(retry);
			events.close();
		};
	});

	function handleBeforeUnload(event: BeforeUnloadEvent) {
		if (!grades.hasPendingWrites) return;
		event.preventDefault();
		event.returnValue = "";
	}

	function handleVisibilityChange() {
		if (signedIn && document.visibilityState === "visible") grades.refresh();
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

{@render children()}
{#if signedIn}
	<UndoToast />
{/if}
