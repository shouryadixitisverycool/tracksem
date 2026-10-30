<script lang="ts">
	import { base, resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data: pageData }: { data: PageData } = $props();

	let mode = $state<'login' | 'register'>('login');
	let name = $state('');
	let rollNumber = $state('');
	let password = $state('');
	let confirm = $state('');
	let error = $state<string | null>(null);
	let busy = $state(false);

	function switchMode(next: 'login' | 'register') {
		mode = next;
		error = null;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		if (mode === 'register' && password !== confirm) {
			error = "passwords don't match";
			return;
		}
		busy = true;
		try {
			const path = mode === 'login' ? resolve('/api/auth/login') : resolve('/api/auth/register');
			const body = mode === 'login' ? { rollNumber, password } : { name, rollNumber, password };
			const res = await fetch(path, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (res.ok) {
				// Full load so the grades store starts fresh for this account
				window.location.assign(pageData.next ? `${base}${pageData.next}` : resolve('/'));
				return;
			}
			const data = (await res.json().catch(() => null)) as { error?: string } | null;
			error = data?.error ?? `something went wrong (${res.status})`;
		} catch {
			error = 'network error, try again';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>tracksem — {mode === 'login' ? 'sign in' : 'create account'}</title>
</svelte:head>

<div class="page">
	<form class="card" onsubmit={submit}>
		<div class="brand">
			<div class="brand-icon mono">&gt;_</div>
			<div>
				<div class="brand-title mono">tracksem</div>
				<div class="brand-sub mono">your grades, only visible to you</div>
			</div>
		</div>

		<div class="tabs mono" role="tablist">
			<button type="button" role="tab" aria-selected={mode === 'login'} class:active={mode === 'login'} onclick={() => switchMode('login')}>
				sign in
			</button>
			<button type="button" role="tab" aria-selected={mode === 'register'} class:active={mode === 'register'} onclick={() => switchMode('register')}>
				create account
			</button>
		</div>

		{#if mode === 'register'}
			<label class="field mono">
				<span>name</span>
				<input bind:value={name} autocomplete="name" maxlength="100" required />
			</label>
		{/if}

		<label class="field mono">
			<span>roll number</span>
			<input bind:value={rollNumber} autocomplete="username" inputmode="text" maxlength="20" required />
		</label>

		<label class="field mono">
			<span>password</span>
			<input
				type="password"
				bind:value={password}
				autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
				minlength={mode === 'register' ? 8 : undefined}
				required
			/>
		</label>

		{#if mode === 'register'}
			<label class="field mono">
				<span>confirm password</span>
				<input type="password" bind:value={confirm} autocomplete="new-password" minlength="8" required />
			</label>
		{/if}

		{#if error}
			<p class="error mono" role="alert">{error}</p>
		{/if}

		<button class="submit mono" type="submit" disabled={busy}>
			{#if busy}
				…
			{:else}
				&gt; {mode === 'login' ? 'sign in' : 'create account'}
			{/if}
		</button>
	</form>
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

	.brand {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.brand-icon {
		font-size: 1.5rem;
		color: #22d3ee;
		line-height: 1;
	}

	.brand-title {
		font-size: 1.1rem;
		font-weight: 700;
		color: oklch(0.95 0.01 265);
		letter-spacing: -0.02em;
	}

	.brand-sub {
		font-size: 0.7rem;
		color: oklch(0.45 0.02 265);
		margin-top: 2px;
	}

	.tabs {
		display: grid;
		grid-template-columns: 1fr 1fr;
		border: 1px solid oklch(1 0 0 / 8%);
		border-radius: 6px;
		overflow: hidden;
	}

	.tabs button {
		padding: 0.5rem;
		background: none;
		border: none;
		color: oklch(0.5 0.02 265);
		font-size: 0.75rem;
		font-family: inherit;
		cursor: pointer;
	}

	.tabs button.active {
		background: oklch(0.16 0.04 215);
		color: #22d3ee;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.7rem;
		color: oklch(0.55 0.02 265);
	}

	.field input {
		padding: 0.6rem 0.75rem;
		background: oklch(0.08 0.02 265);
		border: 1px solid oklch(1 0 0 / 10%);
		border-radius: 6px;
		color: oklch(0.92 0.01 265);
		font-size: 0.85rem;
		font-family: inherit;
	}

	.field input:focus {
		outline: none;
		border-color: #22d3ee88;
	}

	.error {
		margin: 0;
		font-size: 0.72rem;
		color: #f87171;
	}

	.submit {
		padding: 0.7rem 1rem;
		background: oklch(0.16 0.04 215);
		border: 1px solid #22d3ee44;
		border-radius: 6px;
		color: #22d3ee;
		font-size: 0.85rem;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.submit:hover:not(:disabled) {
		background: oklch(0.2 0.05 215);
		border-color: #22d3ee88;
	}

	.submit:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.mono {
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
	}
</style>
