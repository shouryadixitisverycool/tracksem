<script lang="ts">
	import { goto } from '$app/navigation';
</script>

<div class="page">
	<div class="card">
		<div class="brand">
			<div class="brand-icon mono">&gt;_</div>
			<div>
				<div class="brand-title mono">tracksem</div>
				<div class="brand-sub mono">local sqlite mode</div>
			</div>
		</div>

		<p class="hint mono">
			data is stored in `data/tracksem.db` on this machine. no sign-in is required anymore.
		</p>

		<button class="submit mono" type="button" onclick={() => goto('/')}>
			&gt; open tracker
		</button>
	</div>
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
		gap: 1.25rem;
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

	.hint {
		text-align: center;
		font-size: 0.72rem;
		color: oklch(0.4 0.02 265);
		margin: 0;
		line-height: 1.6;
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

	.submit:hover {
		background: oklch(0.2 0.05 215);
		border-color: #22d3ee88;
	}

	.mono {
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
	}
</style>
