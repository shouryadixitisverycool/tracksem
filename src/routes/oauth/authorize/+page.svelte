<script lang="ts">
	import { page } from '$app/state';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let access = $state<'read' | 'write'>('write');
</script>

<svelte:head>
	<title>tracksem — connect app</title>
</svelte:head>

<div class="page">
	{#if data.client}
		<form class="card" method="POST" action="?/approve">
			<div class="who mono">
				{page.data.user?.name}
				<span>{page.data.user?.rollNumber}</span>
			</div>

			<p class="title">{data.client.name} wants access to your tracksem grades</p>
			<p class="mono small">you'll be sent back to {data.client.redirectHost}</p>

			{#if data.scopes.includes('write')}
				<fieldset class="choice">
					<legend class="mono small">access</legend>
					<label class="mono">
						<input type="radio" name="access" value="read" bind:group={access} />
						read only
					</label>
					<label class="mono">
						<input type="radio" name="access" value="write" bind:group={access} />
						read and edit
					</label>
				</fieldset>
			{:else}
				<p class="mono small">read only</p>
			{/if}

			<p class="note">edits by agents show up in the change log on the account page, and you can undo them there.</p>

			{#each Object.entries(data.params) as [name, value] (name)}
				{#if value}
					<input type="hidden" {name} {value} />
				{/if}
			{/each}

			{#if form?.error}
				<p class="error mono" role="alert">{form.error}</p>
			{/if}

			<div class="actions">
				<button class="deny mono" type="submit" formaction="?/deny">deny</button>
				<button class="submit mono" type="submit">&gt; approve</button>
			</div>
		</form>
	{:else}
		<div class="card">
			<div class="who mono">tracksem</div>
			<p class="error mono" role="alert">{data.error}</p>
		</div>
	{/if}
</div>

<style>
	.page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		background: oklch(0.08 0.02 265);
	}

	.card {
		width: 100%;
		max-width: 400px;
		background: oklch(0.11 0.02 265);
		border: 1px solid oklch(1 0 0 / 8%);
		border-radius: 12px;
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
	}

	.who {
		font-size: 0.95rem;
		color: oklch(0.95 0.01 265);
	}

	.who span {
		display: block;
		margin-top: 2px;
		font-size: 0.7rem;
		color: oklch(0.45 0.02 265);
	}

	.title {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.4;
		color: oklch(0.92 0.01 265);
	}

	.small {
		margin: 0;
		font-size: 0.72rem;
		color: oklch(0.55 0.02 265);
	}

	.note {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.5;
		color: oklch(0.5 0.02 265);
	}

	.choice {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		border: none;
	}

	.choice legend {
		margin-bottom: 0.35rem;
		padding: 0;
	}

	.choice label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8rem;
		color: oklch(0.85 0.01 265);
		cursor: pointer;
	}

	.choice input {
		accent-color: #22d3ee;
	}

	.error {
		margin: 0;
		font-size: 0.72rem;
		color: #f87171;
	}

	.actions {
		display: grid;
		grid-template-columns: 1fr 2fr;
		gap: 0.6rem;
	}

	.submit,
	.deny {
		padding: 0.7rem 1rem;
		border-radius: 6px;
		font-size: 0.85rem;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.submit {
		background: oklch(0.16 0.04 215);
		border: 1px solid #22d3ee44;
		color: #22d3ee;
	}

	.submit:hover {
		background: oklch(0.2 0.05 215);
		border-color: #22d3ee88;
	}

	.deny {
		background: none;
		border: 1px solid oklch(1 0 0 / 10%);
		color: oklch(0.6 0.02 265);
	}

	.deny:hover {
		border-color: oklch(1 0 0 / 25%);
		color: oklch(0.85 0.01 265);
	}

	.mono {
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
	}
</style>
