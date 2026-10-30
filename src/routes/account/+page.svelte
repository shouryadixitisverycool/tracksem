<script lang="ts">
	import { onMount } from 'svelte';
	import { base, resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getGrades } from '$lib/stores/grades.svelte';

	type Message = { text: string; error: boolean } | null;
	type Access = 'read' | 'write';
	type TokenInfo = {
		id: string;
		name: string;
		scopes: string[];
		createdAt: number;
		lastUsedAt: number | null;
		expiresAt: number | null;
	};
	type ConnectedApp = { id: string; clientName: string; scopes: string[]; createdAt: number; lastUsedAt: number | null };
	type Change = {
		id: string;
		createdAt: number;
		actor: string;
		tool: string;
		summary: string;
		courseId: string | null;
		undoneAt: number | null;
		canUndo: boolean;
	};

	const grades = getGrades();
	const mcpUrl = $derived(`${page.url.origin}${base}/mcp`);

	// password
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirm = $state('');
	let passwordMessage = $state<Message>(null);
	let passwordBusy = $state(false);

	// agent access
	let copied = $state(false);

	// access tokens
	let tokens = $state<TokenInfo[]>([]);
	let tokenMessage = $state<Message>(null);
	let tokenBusy = $state(false);
	let newName = $state('');
	let newAccess = $state<Access>('read');
	let newExpiry = $state('90');
	let createdToken = $state<string | null>(null);
	let tokenCopied = $state(false);

	// connected apps
	let apps = $state<ConnectedApp[]>([]);
	let appMessage = $state<Message>(null);
	let appBusy = $state<string | null>(null);

	// agent changes
	let changes = $state<Change[]>([]);
	let changeMessage = $state<Message>(null);
	let changeBusy = $state<string | null>(null);

	function errorText(error: unknown): string {
		return error instanceof Error ? error.message : 'something went wrong';
	}

	/** Fetch JSON from the API; non-2xx responses throw the server's error message */
	async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
		let res: Response;
		try {
			res = await fetch(url, {
				method,
				headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body)
			});
		} catch {
			throw new Error('network error, try again');
		}
		if (!res.ok) {
			const data = (await res.json().catch(() => null)) as { error?: string } | null;
			throw new Error(data?.error ?? `something went wrong (${res.status})`);
		}
		return (await res.json()) as T;
	}

	async function copy(text: string, which: 'mcp' | 'token') {
		try {
			await navigator.clipboard.writeText(text);
			if (which === 'mcp') copied = true;
			else tokenCopied = true;
		} catch {
			// clipboard unavailable; the text is still selectable
		}
	}

	async function submitPassword(event: SubmitEvent) {
		event.preventDefault();
		passwordMessage = null;
		if (newPassword !== confirm) {
			passwordMessage = { text: "new passwords don't match", error: true };
			return;
		}
		passwordBusy = true;
		try {
			await request(resolve('/api/auth/password'), 'POST', { currentPassword, newPassword });
			currentPassword = newPassword = confirm = '';
			passwordMessage = { text: 'password changed. other devices were signed out', error: false };
		} catch (error) {
			passwordMessage = { text: errorText(error), error: true };
		} finally {
			passwordBusy = false;
		}
	}

	async function loadTokens() {
		try {
			tokens = (await request<{ tokens: TokenInfo[] }>(resolve('/api/tokens'))).tokens;
		} catch (error) {
			tokenMessage = { text: errorText(error), error: true };
		}
	}

	async function loadApps() {
		try {
			apps = (await request<{ apps: ConnectedApp[] }>(resolve('/api/connected-apps'))).apps;
		} catch (error) {
			appMessage = { text: errorText(error), error: true };
		}
	}

	async function loadChanges() {
		try {
			changes = (await request<{ changes: Change[] }>(`${resolve('/api/agent-changes')}?limit=30`)).changes;
		} catch (error) {
			changeMessage = { text: errorText(error), error: true };
		}
	}

	async function createToken(event: SubmitEvent) {
		event.preventDefault();
		tokenMessage = null;
		createdToken = null;
		tokenBusy = true;
		const days = newExpiry === 'never' ? null : Number(newExpiry);
		try {
			const result = await request<{ token: string }>(resolve('/api/tokens'), 'POST', {
				name: newName,
				access: newAccess,
				expiresInDays: days
			});
			createdToken = result.token;
			tokenCopied = false;
			newName = '';
			await loadTokens();
		} catch (error) {
			tokenMessage = { text: errorText(error), error: true };
		} finally {
			tokenBusy = false;
		}
	}

	async function revokeToken(token: TokenInfo) {
		tokenMessage = null;
		try {
			await request(resolve('/api/tokens'), 'DELETE', { id: token.id });
			tokenMessage = { text: `revoked ${token.name}`, error: false };
			await loadTokens();
		} catch (error) {
			tokenMessage = { text: errorText(error), error: true };
		}
	}

	async function disconnectApp(app: ConnectedApp) {
		appBusy = app.id;
		appMessage = null;
		try {
			await request(resolve('/api/connected-apps'), 'DELETE', { id: app.id });
			appMessage = { text: `disconnected ${app.clientName}`, error: false };
			await loadApps();
		} catch (error) {
			appMessage = { text: errorText(error), error: true };
		} finally {
			appBusy = null;
		}
	}

	async function undoChange(change: Change) {
		changeBusy = change.id;
		changeMessage = null;
		try {
			await request(resolve('/api/agent-changes/undo'), 'POST', { id: change.id });
			changeMessage = { text: 'undone', error: false };
			await loadChanges();
			await grades.refresh();
		} catch (error) {
			changeMessage = { text: errorText(error), error: true };
		} finally {
			changeBusy = null;
		}
	}

	function onVisibilityChange() {
		if (document.visibilityState === 'visible') loadChanges();
	}

	onMount(() => {
		loadTokens();
		loadApps();
		loadChanges();
	});

	const EXPIRY_LABELS: Record<string, string> = { '30': '30 days', '90': '90 days', '365': '1 year', never: 'never' };

	/** "3m ago", "2d ago", or a date for anything older than a week */
	function ago(ms: number): string {
		const diff = Date.now() - ms;
		const minutes = Math.floor(diff / 60_000);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days < 7) return `${days}d ago`;
		return new Date(ms).toLocaleDateString();
	}

	function lastUsed(ms: number | null): string {
		return ms === null ? 'never' : ago(ms);
	}

	function expiry(ms: number | null): string {
		if (ms === null) return 'never';
		return ms < Date.now() ? 'expired' : new Date(ms).toLocaleDateString();
	}

	function accessLabel(scopes: string[]): string {
		return scopes.includes('write') ? 'read & edit' : 'read only';
	}
</script>

<svelte:head>
	<title>tracksem — account</title>
</svelte:head>

<svelte:document onvisibilitychange={onVisibilityChange} />

<div class="page">
	<header class="top">
		<a href={resolve('/')} class="back mono">← back</a>
		<div class="who mono">
			{page.data.user?.name}
			<span>{page.data.user?.rollNumber}</span>
		</div>
	</header>

	<section class="card" aria-labelledby="agent-access-title">
		<h2 id="agent-access-title" class="title mono">agent access</h2>
		<p class="hint">Let an AI agent read or edit your grades through this MCP server.</p>

		<div class="copy-row">
			<code class="mono url">{mcpUrl}</code>
			<button class="small mono" type="button" onclick={() => copy(mcpUrl, 'mcp')}>
				{copied ? 'copied' : 'copy'}
			</button>
		</div>

		<div class="howto">
			<h3 class="mono">claude.ai, ChatGPT, Claude Desktop</h3>
			<p class="hint">
				Add a custom connector with this URL. You will sign in here and choose read-only or read &amp; edit.
			</p>
		</div>

		<div class="howto">
			<h3 class="mono">Claude Code, Cursor, other clients with headers</h3>
			<p class="hint">Create an access token below, then run:</p>
			<pre class="cmd mono">claude mcp add --transport http tracksem {mcpUrl} --header "Authorization: Bearer &lt;token&gt;"</pre>
		</div>
	</section>

	<section class="card" aria-labelledby="tokens-title">
		<h2 id="tokens-title" class="title mono">access tokens</h2>

		{#if createdToken}
			<div class="new-token" role="group" aria-label="new access token">
				<p class="mono strong">copy this token now</p>
				<code class="mono token">{createdToken}</code>
				<p class="hint">It won't be shown again.</p>
				<div class="row">
					<button class="small mono" type="button" onclick={() => copy(createdToken!, 'token')}>
						{tokenCopied ? 'copied' : 'copy token'}
					</button>
					<button class="small mono" type="button" onclick={() => (createdToken = null)}>dismiss</button>
				</div>
			</div>
		{/if}

		{#if tokens.length === 0}
			<p class="hint">No active tokens.</p>
		{:else}
			<ul class="list">
				{#each tokens as token (token.id)}
					<li class="item">
						<div class="item-main">
							<span class="mono name">{token.name}</span>
							<span class="meta mono">
								{accessLabel(token.scopes)} · created {ago(token.createdAt)} · last used {lastUsed(token.lastUsedAt)} ·
								expires {expiry(token.expiresAt)}
							</span>
						</div>
						<button class="danger small mono" type="button" aria-label="revoke {token.name}" onclick={() => revokeToken(token)}>
							revoke
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		<form class="form" onsubmit={createToken}>
			<label class="field mono">
				<span>name</span>
				<input type="text" bind:value={newName} maxlength="60" placeholder="e.g. claude code laptop" required />
			</label>
			<label class="field mono">
				<span>access</span>
				<select bind:value={newAccess}>
					<option value="read">read only</option>
					<option value="write">read &amp; edit</option>
				</select>
			</label>
			<label class="field mono">
				<span>expires</span>
				<select bind:value={newExpiry}>
					{#each Object.entries(EXPIRY_LABELS) as [value, label] (value)}
						<option {value}>{label}</option>
					{/each}
				</select>
			</label>
			{#if tokenMessage}
				<p class="message mono" class:error={tokenMessage.error} role="status">{tokenMessage.text}</p>
			{/if}
			<button class="submit mono" type="submit" disabled={tokenBusy || tokens.length >= 20}>
				{tokenBusy ? '…' : '> create token'}
			</button>
		</form>
	</section>

	<section class="card" aria-labelledby="apps-title">
		<h2 id="apps-title" class="title mono">connected apps</h2>
		{#if apps.length === 0}
			<p class="hint">No apps connected through OAuth.</p>
		{:else}
			<ul class="list">
				{#each apps as app (app.id)}
					<li class="item">
						<div class="item-main">
							<span class="mono name">{app.clientName}</span>
							<span class="meta mono">
								{accessLabel(app.scopes)} · connected {ago(app.createdAt)} · last used {lastUsed(app.lastUsedAt)}
							</span>
						</div>
						<button
							class="danger small mono"
							type="button"
							aria-label="disconnect {app.clientName}"
							disabled={appBusy === app.id}
							onclick={() => disconnectApp(app)}
						>
							disconnect
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		{#if appMessage}
			<p class="message mono" class:error={appMessage.error} role="status">{appMessage.text}</p>
		{/if}
	</section>

	<section class="card" aria-labelledby="changes-title">
		<h2 id="changes-title" class="title mono">agent changes</h2>
		{#if changes.length === 0}
			<p class="hint">No changes from agents yet.</p>
		{:else}
			<ul class="list">
				{#each changes as change (change.id)}
					<li class="item">
						<div class="item-main">
							<span class="mono name">{change.summary}</span>
							<span class="meta mono">{change.actor} · {ago(change.createdAt)}</span>
						</div>
						{#if change.canUndo}
							<button
								class="small mono"
								type="button"
								aria-label="undo: {change.summary}"
								disabled={changeBusy === change.id}
								onclick={() => undoChange(change)}
							>
								undo
							</button>
						{:else}
							<span class="tag mono">undone</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if changeMessage}
			<p class="message mono" class:error={changeMessage.error} role="status">{changeMessage.text}</p>
		{/if}
	</section>

	<form class="card" onsubmit={submitPassword}>
		<h2 class="title mono">password</h2>
		<label class="field mono">
			<span>current password</span>
			<input type="password" bind:value={currentPassword} autocomplete="current-password" required />
		</label>
		<label class="field mono">
			<span>new password</span>
			<input type="password" bind:value={newPassword} autocomplete="new-password" minlength="8" required />
		</label>
		<label class="field mono">
			<span>confirm new password</span>
			<input type="password" bind:value={confirm} autocomplete="new-password" minlength="8" required />
		</label>

		{#if passwordMessage}
			<p class="message mono" class:error={passwordMessage.error} role="status">{passwordMessage.text}</p>
		{/if}

		<button class="submit mono" type="submit" disabled={passwordBusy}>
			{passwordBusy ? '…' : '> change password'}
		</button>
	</form>
</div>

<style>
	.page {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		padding: 1.5rem;
		background: oklch(0.08 0.02 265);
	}

	.top {
		width: 100%;
		max-width: 640px;
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
	}

	.back {
		font-size: 0.72rem;
		color: oklch(0.5 0.02 265);
		text-decoration: none;
	}

	.back:hover {
		color: #22d3ee;
	}

	.who {
		font-size: 0.95rem;
		color: oklch(0.95 0.01 265);
		text-align: right;
	}

	.who span {
		display: block;
		margin-top: 2px;
		font-size: 0.7rem;
		color: oklch(0.45 0.02 265);
	}

	.card {
		width: 100%;
		max-width: 640px;
		background: oklch(0.11 0.02 265);
		border: 1px solid oklch(1 0 0 / 8%);
		border-radius: 12px;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.title {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 600;
		color: oklch(0.92 0.01 265);
	}

	.howto h3 {
		margin: 0 0 0.25rem;
		font-size: 0.72rem;
		font-weight: 600;
		color: oklch(0.8 0.02 265);
	}

	.hint {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.5;
		color: oklch(0.55 0.02 265);
	}

	.strong {
		margin: 0;
		font-size: 0.72rem;
		color: #facc15;
	}

	.copy-row,
	.row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.url,
	.token {
		flex: 1;
		min-width: 0;
		padding: 0.55rem 0.7rem;
		background: oklch(0.08 0.02 265);
		border: 1px solid oklch(1 0 0 / 10%);
		border-radius: 6px;
		font-size: 0.72rem;
		color: #22d3ee;
		overflow-wrap: anywhere;
	}

	.cmd {
		margin: 0.4rem 0 0;
		padding: 0.6rem 0.7rem;
		background: oklch(0.08 0.02 265);
		border: 1px solid oklch(1 0 0 / 10%);
		border-radius: 6px;
		font-size: 0.68rem;
		color: oklch(0.85 0.02 265);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.new-token {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1rem;
		border: 1px solid #facc1566;
		border-radius: 8px;
		background: oklch(0.14 0.04 90 / 40%);
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		padding: 0.65rem 0.75rem;
		border: 1px solid oklch(1 0 0 / 8%);
		border-radius: 6px;
	}

	.item-main {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}

	.name {
		font-size: 0.8rem;
		color: oklch(0.92 0.01 265);
		overflow-wrap: anywhere;
	}

	.meta {
		font-size: 0.66rem;
		color: oklch(0.5 0.02 265);
	}

	.tag {
		flex-shrink: 0;
		font-size: 0.66rem;
		color: oklch(0.5 0.02 265);
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		padding-top: 0.5rem;
		border-top: 1px solid oklch(1 0 0 / 8%);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.7rem;
		color: oklch(0.55 0.02 265);
	}

	.field input,
	.field select {
		padding: 0.6rem 0.75rem;
		background: oklch(0.08 0.02 265);
		border: 1px solid oklch(1 0 0 / 10%);
		border-radius: 6px;
		color: oklch(0.92 0.01 265);
		font-size: 0.85rem;
		font-family: inherit;
	}

	.field input:focus,
	.field select:focus {
		outline: none;
		border-color: #22d3ee88;
	}

	.message {
		margin: 0;
		font-size: 0.72rem;
		color: #4ade80;
	}

	.message.error {
		color: #f87171;
	}

	.submit,
	.small {
		padding: 0.55rem 0.9rem;
		background: oklch(0.16 0.04 215);
		border: 1px solid #22d3ee44;
		border-radius: 6px;
		color: #22d3ee;
		font-size: 0.8rem;
		cursor: pointer;
		white-space: nowrap;
	}

	.submit {
		padding: 0.7rem 1rem;
		font-size: 0.85rem;
	}

	.submit:hover:not(:disabled),
	.small:hover:not(:disabled) {
		background: oklch(0.2 0.05 215);
		border-color: #22d3ee88;
	}

	.submit:disabled,
	.small:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.danger {
		background: oklch(0.14 0.03 25);
		border-color: #f8717144;
		color: #f87171;
	}

	.danger:hover:not(:disabled) {
		background: oklch(0.18 0.05 25);
		border-color: #f8717188;
	}

	.mono {
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
	}
</style>
