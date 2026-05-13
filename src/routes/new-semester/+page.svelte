<script lang="ts">
    import { goto } from "$app/navigation";
    import { grades } from "$lib/stores/grades.svelte";
    import { BRANCHES, getSemesters, getCourses } from "$lib/data/courses";

    const isFirstSemester = $derived(grades.semesters.length === 0);

    let selectedBranch = $state("");
    let selectedSemester = $state("");
    let semesterLabel = $state("");
    let seeding = $state(false);

    const availableSemesters = $derived(selectedBranch ? getSemesters(selectedBranch) : []);
    const previewCourses = $derived(
        selectedBranch && selectedSemester
            ? getCourses(selectedBranch, selectedSemester)
            : []
    );

    // Auto-generate label when branch/semester change
    $effect(() => {
        if (selectedBranch && selectedSemester) {
            semesterLabel = `${selectedBranch} · ${selectedSemester}`;
        } else if (selectedBranch) {
            semesterLabel = selectedBranch;
        } else {
            semesterLabel = "";
        }
    });

    function generateKey(): string {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    let useCustomKey = $state(false);
    let defaultKey = $state(generateKey());
    let customKey = $state("");

    async function handleStart() {
        if (!selectedBranch || !selectedSemester || seeding) return;
        seeding = true;
        const label = semesterLabel.trim() || `${selectedBranch} · ${selectedSemester}`;
        await grades.createSemester(label, selectedBranch, selectedSemester);
        await grades.seedFromCatalog(selectedBranch, selectedSemester);
        seeding = false;
        goto("/");
    }
</script>

<div class="page">
    <header class="header">
        <div class="header-inner">
            <div class="brand">
                <div class="brand-icon mono">&gt;_</div>
                <div>
                    <div class="brand-title mono">tracksem</div>
                    <div class="brand-sub">new semester</div>
                </div>
            </div>
            {#if !isFirstSemester}
                <a href="/" class="cancel-link mono">← back</a>
            {/if}
        </div>
    </header>

    <main class="main">
        <div class="onboard-wrap">
            <div class="onboard-card">
                <div class="onboard-header mono">// new semester</div>
                <div class="onboard-sub">
                    {#if isFirstSemester}
                        select your branch and semester to get started
                    {:else}
                        set up a new semester — your previous semesters are still accessible from the header
                    {/if}
                </div>

                <!-- Encryption key (cosmetic) -->
                <div class="enc-block">
                    <div class="enc-label-row">
                        <span class="enc-label mono">// encryption key</span>
                        <div class="enc-toggle">
                            <button
                                class="enc-tab mono"
                                class:active={!useCustomKey}
                                onclick={() => { useCustomKey = false; }}
                            >default</button>
                            <button
                                class="enc-tab mono"
                                class:active={useCustomKey}
                                onclick={() => { useCustomKey = true; }}
                            >custom</button>
                        </div>
                    </div>

                    {#if !useCustomKey}
                        <div class="enc-key-row">
                            <span class="enc-key mono">{defaultKey}</span>
                            <button
                                class="enc-regen mono"
                                title="regenerate"
                                onclick={() => { defaultKey = generateKey(); }}
                            >↺</button>
                        </div>
                        <div class="enc-hint mono">
                            a random key has been generated for you — your data is encrypted before leaving your device
                        </div>
                    {:else}
                        <input
                            class="enc-input mono"
                            type="text"
                            placeholder="enter your own key (min 8 chars)"
                            bind:value={customKey}
                            spellcheck="false"
                            autocomplete="off"
                        />
                        <div class="enc-hint mono">
                            use your own passphrase — only you can decrypt your data
                        </div>
                    {/if}
                </div>

                <select
                    class="onboard-select mono"
                    bind:value={selectedBranch}
                    onchange={() => { selectedSemester = ""; }}
                >
                    <option value="">select branch</option>
                    {#each BRANCHES as branch}
                        <option value={branch}>{branch}</option>
                    {/each}
                </select>

                {#if selectedBranch}
                    <select
                        class="onboard-select mono"
                        bind:value={selectedSemester}
                    >
                        <option value="">select semester</option>
                        {#each availableSemesters as sem}
                            <option value={sem}>{sem}</option>
                        {/each}
                    </select>
                {/if}

                {#if selectedBranch && selectedSemester}
                    <div class="label-row">
                        <label class="label-text mono" for="sem-label">// semester label</label>
                        <input
                            id="sem-label"
                            class="label-input mono"
                            type="text"
                            placeholder="e.g. Monsoon 2025"
                            bind:value={semesterLabel}
                            spellcheck="false"
                        />
                        <div class="label-hint mono">auto-generated — rename it to something memorable</div>
                    </div>
                {/if}

                {#if previewCourses.length > 0}
                    <div class="onboard-preview">
                        <div class="onboard-preview-label mono">// courses to add</div>
                        {#each previewCourses as c}
                            <div class="onboard-preview-item">
                                <span class="onboard-dot" style="background: {c.color}"></span>
                                <span class="mono">{c.name}</span>
                                <span class="onboard-full">{c.fullName}</span>
                                {#if c.components.length > 0}
                                    <span class="onboard-comp-count mono">{c.components.length} components</span>
                                {:else}
                                    <span class="onboard-comp-count mono">defaults</span>
                                {/if}
                            </div>
                        {/each}
                    </div>

                    <button
                        class="onboard-btn mono"
                        disabled={seeding || !semesterLabel.trim()}
                        onclick={handleStart}
                    >
                        {seeding ? "setting up..." : "start semester"}
                    </button>
                {/if}
            </div>
        </div>
    </main>
</div>

<style>
    .page {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
    }

    .header {
        border-bottom: 1px solid oklch(1 0 0 / 7%);
        padding: 1.25rem 2rem;
        position: sticky;
        top: 0;
        background: oklch(0.08 0.02 265 / 90%);
        backdrop-filter: blur(12px);
        z-index: 50;
    }

    .header-inner {
        max-width: 1200px;
        margin: 0 auto;
        display: flex;
        justify-content: space-between;
        align-items: center;
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
        color: oklch(0.5 0.02 265);
        margin-top: 1px;
    }

    .cancel-link {
        font-size: 0.7rem;
        color: oklch(0.45 0.02 265);
        text-decoration: none;
        letter-spacing: 0.04em;
        transition: color 0.15s ease;
    }

    .cancel-link:hover {
        color: oklch(0.75 0.02 265);
    }

    .main {
        flex: 1;
        max-width: 1200px;
        width: 100%;
        margin: 0 auto;
        padding: 2rem;
    }

    .onboard-wrap {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 50vh;
    }

    .onboard-card {
        width: min(480px, 100%);
        background: oklch(0.12 0.02 265);
        border: 1px solid oklch(1 0 0 / 12%);
        border-radius: 12px;
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 0.8rem;
        box-shadow: 0 20px 60px oklch(0 0 0 / 40%);
    }

    .onboard-header {
        font-size: 0.75rem;
        letter-spacing: 0.08em;
        color: oklch(0.6 0.02 265);
        text-transform: uppercase;
    }

    .onboard-sub {
        font-size: 0.72rem;
        color: oklch(0.45 0.02 265);
        line-height: 1.5;
    }

    .onboard-select {
        background: oklch(1 0 0 / 4%);
        border: 1px solid oklch(1 0 0 / 10%);
        border-radius: 6px;
        padding: 0.45rem 0.6rem;
        color: oklch(0.9 0.01 265);
        font-size: 0.75rem;
        outline: none;
        cursor: pointer;
        appearance: none;
    }

    .onboard-select:focus {
        border-color: oklch(1 0 0 / 20%);
        box-shadow: 0 0 0 1px oklch(1 0 0 / 10%);
    }

    .label-row {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
    }

    .label-text {
        font-size: 0.62rem;
        color: oklch(0.4 0.02 265);
        letter-spacing: 0.06em;
        text-transform: uppercase;
    }

    .label-input {
        background: oklch(1 0 0 / 4%);
        border: 1px solid oklch(1 0 0 / 10%);
        border-radius: 6px;
        padding: 0.45rem 0.6rem;
        color: oklch(0.9 0.01 265);
        font-size: 0.75rem;
        outline: none;
        transition: border-color 0.15s ease;
    }

    .label-input:focus {
        border-color: #22d3ee44;
    }

    .label-hint {
        font-size: 0.6rem;
        color: oklch(0.35 0.02 265);
    }

    .onboard-preview {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        padding: 0.6rem 0;
    }

    .onboard-preview-label {
        font-size: 0.65rem;
        color: oklch(0.4 0.02 265);
        letter-spacing: 0.05em;
        margin-bottom: 0.2rem;
    }

    .onboard-preview-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.72rem;
        color: oklch(0.8 0.01 265);
        padding: 0.3rem 0.5rem;
        background: oklch(1 0 0 / 3%);
        border-radius: 4px;
    }

    .onboard-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
    }

    .onboard-full {
        color: oklch(0.5 0.02 265);
        font-size: 0.65rem;
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .onboard-comp-count {
        font-size: 0.6rem;
        color: oklch(0.4 0.02 265);
        flex-shrink: 0;
    }

    .onboard-btn {
        font-size: 0.72rem;
        background: none;
        border: 1px solid oklch(1 0 0 / 12%);
        border-radius: 6px;
        color: oklch(0.6 0.02 265);
        padding: 0.5rem 0.6rem;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .onboard-btn:hover:enabled {
        color: oklch(0.9 0.01 265);
        border-color: #22d3ee66;
        background: #22d3ee18;
    }

    .onboard-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    /* ── Encryption key field ────────────────────── */

    .enc-block {
        background: oklch(1 0 0 / 3%);
        border: 1px solid oklch(1 0 0 / 8%);
        border-radius: 8px;
        padding: 0.65rem 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .enc-label-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
    }

    .enc-label {
        font-size: 0.62rem;
        color: oklch(0.4 0.02 265);
        letter-spacing: 0.06em;
        text-transform: uppercase;
    }

    .enc-toggle {
        display: flex;
        background: oklch(0.08 0.02 265);
        border: 1px solid oklch(1 0 0 / 8%);
        border-radius: 5px;
        padding: 2px;
        gap: 2px;
    }

    .enc-tab {
        font-size: 0.6rem;
        padding: 0.15rem 0.5rem;
        background: transparent;
        border: none;
        border-radius: 3px;
        color: oklch(0.42 0.02 265);
        cursor: pointer;
        transition: all 0.15s ease;
        letter-spacing: 0.03em;
    }

    .enc-tab:hover {
        color: oklch(0.7 0.02 265);
    }

    .enc-tab.active {
        background: oklch(0.16 0.02 265);
        color: #22d3ee;
        border: 1px solid oklch(1 0 0 / 8%);
    }

    .enc-key-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        background: oklch(0.08 0.02 265);
        border: 1px solid oklch(1 0 0 / 8%);
        border-radius: 5px;
        padding: 0.3rem 0.5rem;
    }

    .enc-key {
        flex: 1;
        font-size: 0.68rem;
        color: #22d3ee;
        letter-spacing: 0.06em;
        word-break: break-all;
        user-select: all;
    }

    .enc-regen {
        background: none;
        border: none;
        color: oklch(0.45 0.02 265);
        font-size: 0.85rem;
        cursor: pointer;
        padding: 0.1rem 0.2rem;
        border-radius: 3px;
        line-height: 1;
        flex-shrink: 0;
        transition: color 0.15s ease;
    }

    .enc-regen:hover {
        color: oklch(0.8 0.02 265);
    }

    .enc-input {
        background: oklch(0.08 0.02 265);
        border: 1px solid oklch(1 0 0 / 8%);
        border-radius: 5px;
        padding: 0.3rem 0.5rem;
        color: oklch(0.9 0.01 265);
        font-size: 0.72rem;
        outline: none;
        transition: border-color 0.15s ease;
        letter-spacing: 0.04em;
    }

    .enc-input::placeholder {
        color: oklch(0.3 0.02 265);
    }

    .enc-input:focus {
        border-color: #22d3ee44;
    }

    .enc-hint {
        font-size: 0.6rem;
        color: oklch(0.38 0.02 265);
        line-height: 1.4;
    }

    @media (max-width: 768px) {
        .header { padding: 0.875rem 1rem; }
        .main { padding: 1.25rem 0.75rem; }
    }

    @media (max-width: 480px) {
        .header { padding: 0.75rem 0.65rem; }
        .main { padding: 1rem 0.5rem; }
    }
</style>
