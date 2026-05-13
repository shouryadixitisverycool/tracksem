<script lang="ts">
    import { goto } from "$app/navigation";
    import { grades } from "$lib/stores/grades.svelte";
    import CourseCard from "$lib/components/CourseCard.svelte";
    import { BRANCHES, getSemesters, getCourses } from "$lib/data/courses";

    function getOverallGrade(): { grade: number | null; count: number } {
        let total = 0;
        let count = 0;
        for (const course of grades.courses) {
            const proj = grades.projectedGrade(course.id);
            if (proj.grade !== null) {
                total += proj.grade;
                count++;
            }
        }
        if (count === 0) return { grade: null, count: 0 };
        return { grade: total / count, count };
    }

    const overall = $derived(getOverallGrade());

    function gradeColor(g: number | null): string {
        if (g === null) return "#6b7280";
        if (g >= 90) return "#4ade80";
        if (g >= 80) return "#86efac";
        if (g >= 65) return "#fbbf24";
        if (g >= 50) return "#fb923c";
        return "#f87171";
    }

    const courseColors = [
        "#22d3ee",
        "#a78bfa",
        "#34d399",
        "#fb923c",
        "#f472b6",
        "#60a5fa",
        "#f97316",
        "#10b981"
    ];

    function pickRandomColor(): string {
        return courseColors[Math.floor(Math.random() * courseColors.length)];
    }

    let addOpen = $state(false);
    let creatingCourse = $state(false);
    let newCourseName = $state("");
    let newCourseFullName = $state("");
    let newCourseColor = $state(pickRandomColor());

    function openAddCourse() {
        addOpen = true;
        newCourseColor = pickRandomColor();
    }

    function closeAddCourse() {
        addOpen = false;
        newCourseName = "";
        newCourseFullName = "";
        newCourseColor = pickRandomColor();
    }

    async function handleAddCourse() {
        const name = newCourseName.trim();
        if (!name || creatingCourse) return;
        const fullName = newCourseFullName.trim() || name;
        creatingCourse = true;
        await grades.addCourse(name, fullName, newCourseColor || pickRandomColor());
        creatingCourse = false;
        closeAddCourse();
    }

    // ─── Onboarding state (first-time / empty semester) ─────────────────────────

    let selectedBranch = $state("");
    let selectedSemester = $state("");
    let seeding = $state(false);

    // ─── Encryption key state ────────────────────────────────────────────────────

    function generateKey(): string {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    let useCustomKey = $state(false);
    let defaultKey = $state(generateKey());
    let customKey = $state("");
    const activeKey = $derived(useCustomKey ? customKey : defaultKey);

    const availableSemesters = $derived(
        selectedBranch ? getSemesters(selectedBranch) : []
    );
    const previewCourses = $derived(
        selectedBranch && selectedSemester
            ? getCourses(selectedBranch, selectedSemester)
            : []
    );

    async function handleSeed() {
        if (!selectedBranch || !selectedSemester || seeding) return;
        seeding = true;
        await grades.seedFromCatalog(selectedBranch, selectedSemester);
        seeding = false;
    }

    // ─── Semester switcher ───────────────────────────────────────────────────────

    let switcherOpen = $state(false);
    let renamingId = $state<string | null>(null);
    let renameValue = $state("");
    let deletingId = $state<string | null>(null);

    function openSwitcher() { switcherOpen = true; }
    function closeSwitcher() {
        switcherOpen = false;
        renamingId = null;
        renameValue = "";
        deletingId = null;
    }

    async function handleSwitch(id: string) {
        if (id === grades.activeSemesterId) { closeSwitcher(); return; }
        await grades.switchSemester(id);
        closeSwitcher();
    }

    function startRename(id: string, currentLabel: string) {
        renamingId = id;
        renameValue = currentLabel;
    }

    async function commitRename(id: string) {
        const label = renameValue.trim();
        if (label) await grades.renameSemester(id, label);
        renamingId = null;
        renameValue = "";
    }

    function startDelete(id: string) { deletingId = id; }

    async function confirmDelete(id: string) {
        await grades.deleteSemester(id);
        deletingId = null;
        closeSwitcher();
    }
</script>

<div class="page">
    <!-- Header -->
    <header class="header">
        <div class="header-inner">
            <div class="brand">
                <div class="brand-icon mono">&gt;_</div>
                <div>
                    <div class="brand-title mono">tracksem</div>
                    <div class="brand-sub">
                        sem 2 · {new Date().getFullYear()}
                    </div>
                </div>
            </div>

            <!-- Semester switcher -->
            {#if grades.semesters.length > 0}
                <div class="sem-switcher">
                    <button class="sem-trigger mono" onclick={openSwitcher}>
                        <span class="sem-dot active-dot"></span>
                        <span class="sem-label">{grades.activeSemester?.label ?? "—"}</span>
                        <span class="sem-chevron">▾</span>
                    </button>

                    {#if switcherOpen}
                        <button
                            class="switcher-backdrop"
                            type="button"
                            onclick={closeSwitcher}
                            aria-label="Close semester switcher"
                        ></button>
                        <div class="sem-dropdown" role="menu">
                            <div class="sem-dropdown-label mono">// semesters</div>
                            {#each grades.semesters as sem (sem.id)}
                                <div
                                    class="sem-row"
                                    class:active={sem.id === grades.activeSemesterId}
                                >
                                    {#if renamingId === sem.id}
                                        <input
                                            class="sem-rename-input mono"
                                            bind:value={renameValue}
                                            onkeydown={(e) => {
                                                if (e.key === 'Enter') commitRename(sem.id);
                                                if (e.key === 'Escape') { renamingId = null; }
                                            }}
                                            onclick={(e) => e.stopPropagation()}
                                        />
                                        <button
                                            class="sem-action-btn mono"
                                            onclick={(e) => { e.stopPropagation(); commitRename(sem.id); }}
                                        >✓</button>
                                        <button
                                            class="sem-action-btn mono"
                                            onclick={(e) => { e.stopPropagation(); renamingId = null; }}
                                        >✕</button>
                                    {:else if deletingId === sem.id}
                                        <span class="sem-delete-confirm mono">delete "{sem.label}"?</span>
                                        <button
                                            class="sem-action-btn danger mono"
                                            onclick={(e) => { e.stopPropagation(); confirmDelete(sem.id); }}
                                        >yes</button>
                                        <button
                                            class="sem-action-btn mono"
                                            onclick={(e) => { e.stopPropagation(); deletingId = null; }}
                                        >no</button>
                                    {:else}
                                        <button
                                            class="sem-switch-btn"
                                            onclick={() => handleSwitch(sem.id)}
                                            role="menuitem"
                                        >
                                            <span class="sem-indicator">
                                                {sem.id === grades.activeSemesterId ? "●" : "○"}
                                            </span>
                                            <span class="sem-name mono">{sem.label}</span>
                                            <span class="sem-count mono">{sem.courseCount} courses</span>
                                        </button>
                                        <button
                                            class="sem-icon-btn mono"
                                            title="rename"
                                            onclick={(e) => { e.stopPropagation(); startRename(sem.id, sem.label); }}
                                        >✎</button>
                                        {#if grades.semesters.length > 1}
                                            <button
                                                class="sem-icon-btn danger mono"
                                                title="delete"
                                                onclick={(e) => { e.stopPropagation(); startDelete(sem.id); }}
                                            >✕</button>
                                        {/if}
                                    {/if}
                                </div>
                            {/each}
                            <div class="sem-divider"></div>
                            <button
                                class="sem-new-btn mono"
                                onclick={() => { closeSwitcher(); goto('/new-semester'); }}
                                role="menuitem"
                            >
                                + new semester
                            </button>
                        </div>
                    {/if}
                </div>
            {/if}

            <div class="header-right">
                {#if overall.grade !== null}
                    <div
                        class="overall-pill"
                        style="border-color: {gradeColor(overall.grade)}40; color: {gradeColor(overall.grade)}"
                    >
                        <span class="mono text-sm">avg {overall.grade.toFixed(1)}%</span>
                        <span class="mono text-xs" style="opacity: 0.6">
                            across {overall.count} course{overall.count > 1 ? "s" : ""}
                        </span>
                    </div>
                {/if}

                <div class="user-group">
                    <span class="user-email mono">local sqlite</span>
                </div>
            </div>
        </div>
    </header>

    <!-- Course grid -->
    <main class="main">
        {#if grades.semesters.length === 0}
            <!-- First-time onboarding — no semesters yet, redirect to /new-semester -->
            <div class="onboard-wrap">
                <div class="onboard-card">
                    <div class="onboard-header mono">// setup</div>
                    <div class="onboard-sub">
                        select your branch and semester to get started
                    </div>

                    <!-- Encryption key -->
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

                    {#if previewCourses.length > 0}
                        <div class="onboard-preview">
                            <div class="onboard-preview-label mono">// courses to add</div>
                            {#each previewCourses as c}
                                <div class="onboard-preview-item">
                                    <span
                                        class="onboard-dot"
                                        style="background: {c.color}"
                                    ></span>
                                    <span class="mono">{c.name}</span>
                                    <span class="onboard-full">{c.fullName}</span>
                                    {#if c.components.length > 0}
                                        <span class="onboard-comp-count mono">
                                            {c.components.length} components
                                        </span>
                                    {:else}
                                        <span class="onboard-comp-count mono">defaults</span>
                                    {/if}
                                </div>
                            {/each}
                        </div>

                        <button
                            class="onboard-btn mono"
                            disabled={seeding}
                            onclick={async () => {
                                if (!selectedBranch || !selectedSemester || seeding) return;
                                seeding = true;
                                const label = `${selectedBranch} · ${selectedSemester}`;
                                await grades.createSemester(label, selectedBranch, selectedSemester);
                                await grades.seedFromCatalog(selectedBranch, selectedSemester);
                                seeding = false;
                            }}
                        >
                            {seeding ? "setting up..." : "confirm"}
                        </button>
                    {/if}
                </div>
            </div>
        {:else if grades.courses.length === 0}
            <!-- Semester exists but no courses -->
            <div class="onboard-wrap">
                <div class="onboard-card">
                    <div class="onboard-header mono">// empty semester</div>
                    <div class="onboard-sub">
                        no courses in <strong>{grades.activeSemester?.label}</strong> yet
                    </div>
                    <button
                        class="onboard-btn mono"
                        onclick={() => goto('/new-semester')}
                    >
                        + set up a new semester
                    </button>
                    <button
                        class="onboard-btn-secondary mono"
                        disabled={seeding}
                        onclick={async () => {
                            const s = grades.activeSemester;
                            if (!s || s.branch === 'unknown' || seeding) return;
                            seeding = true;
                            await grades.seedFromCatalog(s.branch, s.semester);
                            seeding = false;
                        }}
                    >
                        {seeding ? "seeding..." : "re-seed from catalog"}
                    </button>
                </div>
            </div>
        {:else}
            <div class="section-label mono">// courses</div>
            <div class="grid">
                {#each grades.courses as course (course.id)}
                    <CourseCard {course} />
                {/each}

                <div class="add-card" style="--accent: {newCourseColor}">
                    <button class="add-card-closed mono" onclick={openAddCourse}>
                        + add course
                    </button>
                </div>
            </div>
        {/if}

        {#if addOpen}
            <button
                class="modal-backdrop"
                type="button"
                onclick={closeAddCourse}
                aria-label="Close add course dialog"
            ></button>
            <div class="modal" role="dialog" aria-modal="true" aria-labelledby="add-course-title">
                <div class="modal-card" style="--accent: {newCourseColor}">
                    <div class="modal-header">
                        <div id="add-course-title" class="add-title mono">+ add course</div>
                        <button
                            class="modal-close mono"
                            disabled={creatingCourse}
                            onclick={closeAddCourse}
                            aria-label="close"
                        >
                            ×
                        </button>
                    </div>
                    <input
                        class="add-input mono"
                        placeholder="Short name (e.g. DSA)"
                        bind:value={newCourseName}
                    />
                    <input
                        class="add-input mono"
                        placeholder="Full name"
                        bind:value={newCourseFullName}
                    />
                    <div class="add-row">
                        <button
                            class="add-btn mono"
                            disabled={creatingCourse || newCourseName.trim().length === 0}
                            onclick={handleAddCourse}
                        >
                            {creatingCourse ? "adding..." : "create"}
                        </button>
                        <button
                            class="add-cancel mono"
                            disabled={creatingCourse}
                            onclick={closeAddCourse}
                        >
                            cancel
                        </button>
                    </div>
                    <div class="add-hint mono text-xs">
                        defaults: Quiz x2 · Midsem · Endsem
                    </div>
                </div>
            </div>
        {/if}

        {#if grades.courses.length > 0}
            <div class="hint mono">
                click a course to enter scores &amp; manage components
            </div>
        {/if}
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
        gap: 1rem;
    }

    .brand {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-shrink: 0;
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

    .header-right {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-width: 0;
    }

    .overall-pill {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        border: 1px solid;
        border-radius: 20px;
        padding: 0.4rem 0.85rem;
        background: oklch(1 0 0 / 4%);
        flex-shrink: 0;
    }

    .user-group {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-width: 0;
        padding-left: 0.75rem;
        border-left: 1px solid oklch(1 0 0 / 8%);
    }

    .user-email {
        font-size: 0.68rem;
        color: oklch(0.38 0.02 265);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 180px;
    }

    /* ── Semester switcher ──────────────────────── */

    .sem-switcher {
        position: relative;
        flex: 1;
        min-width: 0;
        max-width: 240px;
    }

    .sem-trigger {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        background: oklch(1 0 0 / 4%);
        border: 1px solid oklch(1 0 0 / 10%);
        border-radius: 6px;
        padding: 0.35rem 0.6rem;
        color: oklch(0.75 0.02 265);
        font-size: 0.7rem;
        cursor: pointer;
        transition: all 0.15s ease;
        white-space: nowrap;
        overflow: hidden;
        width: 100%;
        text-align: left;
    }

    .sem-trigger:hover {
        border-color: oklch(1 0 0 / 18%);
        color: oklch(0.9 0.01 265);
        background: oklch(1 0 0 / 7%);
    }

    .active-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #22d3ee;
        flex-shrink: 0;
    }

    .sem-label {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .sem-chevron {
        font-size: 0.6rem;
        opacity: 0.5;
        flex-shrink: 0;
    }

    .switcher-backdrop {
        position: fixed;
        inset: 0;
        background: transparent;
        border: none;
        padding: 0;
        margin: 0;
        cursor: default;
        z-index: 59;
    }

    .sem-dropdown {
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        min-width: 260px;
        background: oklch(0.13 0.02 265);
        border: 1px solid oklch(1 0 0 / 14%);
        border-radius: 8px;
        box-shadow: 0 12px 40px oklch(0 0 0 / 50%);
        z-index: 60;
        overflow: hidden;
        padding: 0.4rem 0;
    }

    .sem-dropdown-label {
        font-size: 0.6rem;
        color: oklch(0.38 0.02 265);
        letter-spacing: 0.07em;
        text-transform: uppercase;
        padding: 0.3rem 0.75rem 0.5rem;
    }

    .sem-row {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0 0.4rem;
    }

    .sem-row.active .sem-switch-btn {
        color: oklch(0.9 0.01 265);
    }

    .sem-switch-btn {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 0.45rem;
        background: transparent;
        border: none;
        border-radius: 5px;
        padding: 0.4rem 0.35rem;
        cursor: pointer;
        text-align: left;
        color: oklch(0.65 0.02 265);
        transition: all 0.12s ease;
        min-width: 0;
    }

    .sem-switch-btn:hover {
        background: oklch(1 0 0 / 5%);
        color: oklch(0.9 0.01 265);
    }

    .sem-indicator {
        font-size: 0.6rem;
        color: #22d3ee;
        flex-shrink: 0;
        width: 10px;
    }

    .sem-name {
        font-size: 0.72rem;
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .sem-count {
        font-size: 0.6rem;
        color: oklch(0.38 0.02 265);
        flex-shrink: 0;
    }

    .sem-icon-btn {
        background: transparent;
        border: none;
        color: oklch(0.35 0.02 265);
        font-size: 0.7rem;
        padding: 0.3rem 0.25rem;
        cursor: pointer;
        border-radius: 4px;
        flex-shrink: 0;
        transition: color 0.12s ease;
        line-height: 1;
    }

    .sem-icon-btn:hover {
        color: oklch(0.7 0.02 265);
        background: oklch(1 0 0 / 5%);
    }

    .sem-icon-btn.danger:hover {
        color: #f87171;
    }

    .sem-rename-input {
        flex: 1;
        background: oklch(1 0 0 / 5%);
        border: 1px solid oklch(1 0 0 / 15%);
        border-radius: 4px;
        padding: 0.25rem 0.4rem;
        color: oklch(0.9 0.01 265);
        font-size: 0.7rem;
        outline: none;
        min-width: 0;
    }

    .sem-rename-input:focus {
        border-color: #22d3ee44;
    }

    .sem-action-btn {
        background: transparent;
        border: none;
        color: oklch(0.5 0.02 265);
        font-size: 0.68rem;
        padding: 0.2rem 0.3rem;
        cursor: pointer;
        border-radius: 3px;
        flex-shrink: 0;
        transition: color 0.12s ease;
        line-height: 1;
    }

    .sem-action-btn:hover {
        color: oklch(0.85 0.02 265);
    }

    .sem-action-btn.danger:hover {
        color: #f87171;
    }

    .sem-delete-confirm {
        font-size: 0.65rem;
        color: oklch(0.55 0.02 265);
        flex: 1;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .sem-divider {
        height: 1px;
        background: oklch(1 0 0 / 8%);
        margin: 0.4rem 0;
    }

    .sem-new-btn {
        display: block;
        width: 100%;
        background: transparent;
        border: none;
        padding: 0.4rem 0.75rem;
        color: oklch(0.5 0.02 265);
        font-size: 0.7rem;
        cursor: pointer;
        text-align: left;
        transition: all 0.12s ease;
        letter-spacing: 0.03em;
    }

    .sem-new-btn:hover {
        color: #22d3ee;
        background: oklch(1 0 0 / 4%);
    }

    /* ── Main layout ────────────────────────────── */

    .main {
        flex: 1;
        max-width: 1200px;
        width: 100%;
        margin: 0 auto;
        padding: 2rem;
    }

    .section-label {
        font-size: 0.7rem;
        color: oklch(0.4 0.02 265);
        letter-spacing: 0.05em;
        margin-bottom: 1rem;
    }

    .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 1rem;
    }

    .add-card {
        border: 1px dotted oklch(1 0 0 / 12%);
        border-radius: 10px;
        padding: 1.25rem;
        min-height: 220px;
        background: oklch(0.12 0.02 265 / 40%);
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
    }

    .add-card-closed {
        width: 100%;
        height: 100%;
        min-height: 140px;
        border: none;
        background: transparent;
        color: oklch(0.6 0.02 265);
        font-size: 0.8rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        cursor: pointer;
    }

    .add-card-closed:hover {
        color: oklch(0.9 0.01 265);
    }

    .modal-backdrop {
        position: fixed;
        inset: 0;
        background: oklch(0 0 0 / 45%);
        backdrop-filter: blur(4px);
        border: none;
        padding: 0;
        margin: 0;
        cursor: pointer;
        z-index: 100;
    }

    .modal {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 110;
        padding: 2rem;
    }

    .modal-card {
        width: min(560px, 92vw);
        background: oklch(0.12 0.02 265);
        border: 1px solid oklch(1 0 0 / 12%);
        border-radius: 12px;
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 0.8rem;
        box-shadow: 0 20px 60px oklch(0 0 0 / 40%);
    }

    .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
    }

    .modal-close {
        font-size: 0.9rem;
        background: none;
        border: 1px solid oklch(1 0 0 / 12%);
        border-radius: 6px;
        color: oklch(0.6 0.02 265);
        padding: 0.25rem 0.5rem;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .modal-close:hover:enabled {
        color: oklch(0.9 0.01 265);
        border-color: oklch(1 0 0 / 18%);
        background: oklch(1 0 0 / 6%);
    }

    .modal-close:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .add-title {
        font-size: 0.75rem;
        letter-spacing: 0.08em;
        color: oklch(0.6 0.02 265);
        text-transform: uppercase;
    }

    .add-input {
        background: oklch(1 0 0 / 4%);
        border: 1px solid oklch(1 0 0 / 10%);
        border-radius: 6px;
        padding: 0.45rem 0.6rem;
        color: oklch(0.9 0.01 265);
        font-size: 0.75rem;
        outline: none;
    }

    .add-input:focus {
        border-color: color-mix(in oklch, var(--accent, #6b7280) 40%, transparent);
        box-shadow: 0 0 0 1px color-mix(in oklch, var(--accent, #6b7280) 40%, transparent);
    }

    .add-row {
        display: flex;
        align-items: center;
        gap: 0.6rem;
    }

    .add-btn {
        flex: 1;
        font-size: 0.72rem;
        background: none;
        border: 1px solid oklch(1 0 0 / 12%);
        border-radius: 6px;
        color: oklch(0.6 0.02 265);
        padding: 0.45rem 0.6rem;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .add-cancel {
        font-size: 0.72rem;
        background: none;
        border: 1px solid oklch(1 0 0 / 12%);
        border-radius: 6px;
        color: oklch(0.45 0.02 265);
        padding: 0.45rem 0.6rem;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .add-btn:hover:enabled {
        color: oklch(0.9 0.01 265);
        border-color: color-mix(in oklch, var(--accent, #6b7280) 40%, transparent);
        background: color-mix(in oklch, var(--accent, #6b7280) 12%, transparent);
    }

    .add-cancel:hover:enabled {
        color: oklch(0.9 0.01 265);
        border-color: oklch(1 0 0 / 18%);
        background: oklch(1 0 0 / 6%);
    }

    .add-btn:disabled,
    .add-cancel:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .add-hint {
        font-size: 0.65rem;
        color: oklch(0.45 0.02 265);
        margin-top: 0.2rem;
    }

    .hint {
        text-align: center;
        font-size: 0.7rem;
        color: oklch(0.35 0.02 265);
        margin-top: 2rem;
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

    /* ── Onboarding ─────────────────────────────── */

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
    }

    .onboard-sub strong {
        color: oklch(0.72 0.02 265);
        font-weight: 600;
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

    .onboard-btn-secondary {
        font-size: 0.72rem;
        background: none;
        border: 1px solid oklch(1 0 0 / 8%);
        border-radius: 6px;
        color: oklch(0.45 0.02 265);
        padding: 0.5rem 0.6rem;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .onboard-btn-secondary:hover:enabled {
        color: oklch(0.7 0.02 265);
        border-color: oklch(1 0 0 / 16%);
    }

    .onboard-btn-secondary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    /* ── Mobile ≤ 768px ──────────────────────── */
    @media (max-width: 768px) {
        .header {
            padding: 0.875rem 1rem;
        }
        .header-inner {
            flex-wrap: wrap;
            gap: 0.5rem;
        }
        .header-right {
            flex-wrap: wrap;
            gap: 0.5rem;
        }
        .overall-pill {
            padding: 0.3rem 0.65rem;
        }
        .user-group {
            padding-left: 0;
            border-left: none;
        }
        .user-email {
            max-width: 140px;
            font-size: 0.62rem;
        }
        .main {
            padding: 1.25rem 0.75rem;
        }
        .grid {
            grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr));
        }
        .add-card {
            min-height: 120px;
        }
        .add-card-closed {
            min-height: 80px;
        }
        .modal {
            padding: 1rem;
        }
        .modal-card {
            width: 100%;
        }
        .sem-switcher {
            max-width: 160px;
        }
    }

    /* ── Extra-small ≤ 480px ─────────────────── */
    @media (max-width: 480px) {
        .header {
            padding: 0.75rem 0.65rem;
        }
        .main {
            padding: 1rem 0.5rem;
        }
        .grid {
            grid-template-columns: 1fr;
            gap: 0.75rem;
        }
    }
</style>
