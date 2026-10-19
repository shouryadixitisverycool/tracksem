<script lang="ts">
    import { goto } from "$app/navigation";
    import { grades } from "$lib/stores/grades.svelte";
    import CourseCard from "$lib/components/CourseCard.svelte";
    import SaveStatus from "$lib/components/SaveStatus.svelte";
    import { getGpaColor, getGradeColor } from "$lib/grading";
    import { absoluteGrade, computeGpa, curvedLetter, gradeForGpa, type GpaBasis } from "$lib/gpa";

    /** Unweighted average of visible absolute grades */
    function getOverallGrade(): { grade: number | null; count: number } {
        let total = 0;
        let count = 0;
        for (const course of grades.courses) {
            if (course.hideAbsoluteGrade) continue;
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

    // ─── SGPA / CGPA ─────────────────────────────────────────────────────────────

    const GPA_BASIS_KEY = "tracksem:gpaBasis";
    let gpaBasis = $state<GpaBasis>(
        typeof localStorage !== "undefined" && localStorage.getItem(GPA_BASIS_KEY) === "absolute" ? "absolute" : "curved"
    );

    function toggleGpaBasis() {
        gpaBasis = gpaBasis === "curved" ? "absolute" : "curved";
        localStorage.setItem(GPA_BASIS_KEY, gpaBasis);
    }

    const activeGpaEntries = $derived(
        grades.courses.map((course) => ({
            credits: course.credits,
            letter: gradeForGpa(
                course,
                gpaBasis,
                grades.projectedGrade(course.id).grade,
                grades.curvedGrade(course.id)?.letter ?? null
            ).letter
        }))
    );
    const sgpa = $derived(computeGpa(activeGpaEntries));
    const cgpa = $derived(
        computeGpa([
            ...activeGpaEntries,
            ...grades.allCourses
                .filter((course) => course.semesterId !== grades.activeSemesterId)
                .map((course) => ({
                    credits: course.credits,
                    letter: gradeForGpa(course, gpaBasis, absoluteGrade(course), curvedLetter(course)).letter
                }))
        ])
    );

    // ─── Export / import ─────────────────────────────────────────────────────────

    let dataMenuOpen = $state(false);
    let importing = $state(false);
    let dataMessage = $state<{ text: string; error: boolean } | null>(null);

    async function handleImport(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;
        importing = true;
        dataMessage = null;
        try {
            const count = await grades.importData(await file.text());
            dataMessage = { text: `imported ${count} semester${count === 1 ? "" : "s"} — find them in the semester switcher`, error: false };
        } catch (error) {
            dataMessage = { text: error instanceof Error ? error.message : "import failed", error: true };
        } finally {
            importing = false;
            dataMenuOpen = false;
        }
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

    let addError = $state<string | null>(null);

    async function handleAddCourse() {
        const name = newCourseName.trim();
        if (!name || creatingCourse) return;
        const fullName = newCourseFullName.trim() || name;
        creatingCourse = true;
        addError = null;
        try {
            await grades.addCourse(name, fullName, newCourseColor || pickRandomColor());
            closeAddCourse();
        } catch (error) {
            addError = error instanceof Error ? error.message : "could not add the course";
        } finally {
            creatingCourse = false;
        }
    }

    // ─── Onboarding (no semesters yet → /new-semester) ───────────────────────────

    $effect(() => {
        if (grades.loaded && grades.semesters.length === 0) goto("/new-semester");
    });

    let seeding = $state(false);
    let seedError = $state<string | null>(null);

    async function handleReseed() {
        const s = grades.activeSemester;
        if (!s || s.branch === "unknown" || seeding) return;
        seeding = true;
        seedError = null;
        try {
            await grades.seedFromCatalog(s.branch, s.semester);
        } catch (error) {
            seedError = error instanceof Error ? error.message : "seeding failed";
        } finally {
            seeding = false;
        }
    }

	// ─── Semester switcher ───────────────────────────────────────────────────────

	type SemesterDropPlacement = 'before' | 'after';

	let switcherOpen = $state(false);
	let renamingId = $state<string | null>(null);
	let renameValue = $state("");
	let deletingId = $state<string | null>(null);
	let draggingSemesterId = $state<string | null>(null);
	let dragOverSemesterId = $state<string | null>(null);
	let dragPlacement = $state<SemesterDropPlacement>('before');

	function openSwitcher() { switcherOpen = true; }
	function clearSemesterDrag() {
		draggingSemesterId = null;
		dragOverSemesterId = null;
		dragPlacement = 'before';
	}

	function closeSwitcher() {
		switcherOpen = false;
		renamingId = null;
		renameValue = "";
		deletingId = null;
		clearSemesterDrag();
	}

    let switcherError = $state<string | null>(null);

    async function handleSwitch(id: string) {
        if (id === grades.activeSemesterId) { closeSwitcher(); return; }
        switcherError = null;
        try {
            await grades.switchSemester(id);
            closeSwitcher();
        } catch (error) {
            switcherError = error instanceof Error ? error.message : "could not switch semester";
        }
    }

	function startRename(id: string, currentLabel: string) {
		renamingId = id;
		renameValue = currentLabel;
	}

    function commitRename(id: string) {
        const label = renameValue.trim().slice(0, 100);
        if (label) grades.renameSemester(id, label);
        renamingId = null;
        renameValue = "";
    }

	function startDelete(id: string) { deletingId = id; }

	async function confirmDelete(id: string) {
		switcherError = null;
		try {
			await grades.deleteSemester(id);
			deletingId = null;
			closeSwitcher();
		} catch (error) {
			switcherError = error instanceof Error ? error.message : "could not delete semester";
		}
	}

	function handleSemesterDragStart(id: string, event: DragEvent) {
		if (grades.semesters.length < 2 || renamingId || deletingId) {
			event.preventDefault();
			return;
		}

		draggingSemesterId = id;
		dragOverSemesterId = null;
		dragPlacement = 'before';

		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.dropEffect = 'move';
			event.dataTransfer.setData('text/plain', id);
		}
	}

	function handleSemesterDragOver(id: string, event: DragEvent) {
		if (!draggingSemesterId || draggingSemesterId === id) return;

		event.preventDefault();
		dragOverSemesterId = id;

		const row = event.currentTarget;
		if (row instanceof HTMLElement) {
			const rect = row.getBoundingClientRect();
			dragPlacement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
		}

		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'move';
		}
	}

	function getSemesterOrderAfterDrop(
		draggedId: string,
		targetId: string,
		placement: SemesterDropPlacement
	): string[] {
		const orderedIds = grades.semesters.map((semester) => semester.id).filter((id) => id !== draggedId);
		const targetIndex = orderedIds.indexOf(targetId);

		if (targetIndex === -1) return grades.semesters.map((semester) => semester.id);

		orderedIds.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, draggedId);
		return orderedIds;
	}

	async function handleSemesterDrop(id: string, event: DragEvent) {
		event.preventDefault();

		const draggedId = draggingSemesterId;
		const placement = dragPlacement;
		clearSemesterDrag();

		if (!draggedId || draggedId === id) return;

		grades.reorderSemesters(getSemesterOrderAfterDrop(draggedId, id, placement));
	}
</script>

<div class="page">
    <!-- Header -->
	<header class="header">
		<div class="header-inner">
			<div class="header-left">
				<div class="brand">
					<div class="brand-icon mono">&gt;_</div>
					<div>
						<div class="brand-title mono">tracksem</div>
						<div class="brand-sub">
							{grades.activeSemester?.label ?? "no semester yet"}
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
										role="group"
										class:active={sem.id === grades.activeSemesterId}
										class:dragging={draggingSemesterId === sem.id}
										class:drag-over-before={dragOverSemesterId === sem.id && dragPlacement === 'before'}
										class:drag-over-after={dragOverSemesterId === sem.id && dragPlacement === 'after'}
										ondragover={(event) => handleSemesterDragOver(sem.id, event)}
										ondrop={(event) => handleSemesterDrop(sem.id, event)}
									>
										{#if renamingId === sem.id}
											<span class="sem-drag-spacer" aria-hidden="true"></span>
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
											<span class="sem-drag-spacer" aria-hidden="true"></span>
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
												class="sem-drag-handle"
												type="button"
												title="drag to reorder"
												aria-label={`Reorder ${sem.label}`}
												draggable={grades.semesters.length > 1}
												disabled={grades.semesters.length < 2}
												onclick={(event) => { event.preventDefault(); event.stopPropagation(); }}
												ondragstart={(event) => handleSemesterDragStart(sem.id, event)}
												ondragend={clearSemesterDrag}
											>
												<svg class="sem-drag-icon" viewBox="0 0 8 12" aria-hidden="true">
													<circle cx="2" cy="2" r="1"></circle>
													<circle cx="6" cy="2" r="1"></circle>
													<circle cx="2" cy="6" r="1"></circle>
													<circle cx="6" cy="6" r="1"></circle>
													<circle cx="2" cy="10" r="1"></circle>
													<circle cx="6" cy="10" r="1"></circle>
												</svg>
											</button>
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
								{#if switcherError}
									<div class="sem-error mono" role="alert">{switcherError}</div>
								{/if}
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
			</div>

			<div class="header-right">
                <SaveStatus />

                {#if sgpa.gpa !== null}
                    <div
                        class="overall-pill"
                        style="border-color: {getGpaColor(sgpa.gpa)}40; color: {getGpaColor(sgpa.gpa)}"
                        title="{sgpa.counted} of {sgpa.total} courses · {sgpa.credits} credits (official grade, else predicted {gpaBasis} letter)"
                    >
                        <span class="mono text-xs" style="opacity: 0.6">SGPA</span>
                        <span class="mono text-sm">{sgpa.gpa.toFixed(2)}</span>
                    </div>
                {/if}
                {#if cgpa.gpa !== null}
                    <div
                        class="overall-pill"
                        style="border-color: {getGpaColor(cgpa.gpa)}40; color: {getGpaColor(cgpa.gpa)}"
                        title="{cgpa.counted} of {cgpa.total} courses across all semesters · {cgpa.credits} credits"
                    >
                        <span class="mono text-xs" style="opacity: 0.6">CGPA</span>
                        <span class="mono text-sm">{cgpa.gpa.toFixed(2)}</span>
                    </div>
                {/if}
                {#if sgpa.gpa !== null || cgpa.gpa !== null}
                    <button
                        class="basis-toggle mono"
                        onclick={toggleGpaBasis}
                        title="Letter used for SGPA/CGPA when no official grade is set (falls back to the other when unavailable)"
                        aria-label="GPA uses {gpaBasis} predicted grades; switch"
                    >
                        {gpaBasis}
                    </button>
                {/if}

                {#if overall.grade !== null}
                    <div
                        class="overall-pill subtle"
                        style="border-color: {getGradeColor(overall.grade)}40; color: {getGradeColor(overall.grade)}"
                        title="unweighted average of visible absolute grades"
                    >
                        <span class="mono text-xs">avg {overall.grade.toFixed(1)}%</span>
                        <span class="mono text-xs" style="opacity: 0.6">
                            across {overall.count} course{overall.count > 1 ? "s" : ""}
                        </span>
                    </div>
                {/if}

                <div class="data-menu">
                    <button
                        class="data-trigger mono"
                        aria-haspopup="menu"
                        aria-expanded={dataMenuOpen}
                        onclick={() => (dataMenuOpen = !dataMenuOpen)}
                    >
                        data ▾
                    </button>
                    {#if dataMenuOpen}
                        <button
                            class="switcher-backdrop"
                            type="button"
                            onclick={() => (dataMenuOpen = false)}
                            aria-label="Close data menu"
                        ></button>
                        <div class="data-dropdown">
                            <a class="data-item mono" href="/api/export" download onclick={() => (dataMenuOpen = false)}
                                >export JSON</a
                            >
                            <a class="data-item mono" href="/api/export/db" download onclick={() => (dataMenuOpen = false)}
                                >download database backup</a
                            >
                            <label class="data-item mono">
                                {importing ? "importing…" : "import JSON (as new semesters)"}
                                <input
                                    class="visually-hidden"
                                    type="file"
                                    accept="application/json,.json"
                                    disabled={importing}
                                    onchange={handleImport}
                                />
                            </label>
                        </div>
                    {/if}
                </div>
            </div>
        </div>
        {#if dataMessage}
            <div class="data-message mono" class:error={dataMessage.error} role="status">
                {dataMessage.text}
                <button class="data-dismiss" aria-label="dismiss" onclick={() => (dataMessage = null)}>×</button>
            </div>
        {/if}
    </header>

    <!-- Course grid -->
    <main class="main">
        {#if grades.semesters.length === 0}
            <div class="section-label mono">redirecting to semester setup…</div>
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
                    {#if grades.activeSemester && grades.activeSemester.branch !== "unknown"}
                        <button
                            class="onboard-btn-secondary mono"
                            disabled={seeding}
                            onclick={handleReseed}
                        >
                            {seeding ? "seeding..." : "re-seed from catalog"}
                        </button>
                    {/if}
                    {#if seedError}
                        <div class="add-hint mono" style="color: #f87171" role="alert">{seedError}</div>
                    {/if}
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
                    {#if addError}
                        <div class="add-hint mono text-xs" style="color: #f87171" role="alert">{addError}</div>
                    {/if}
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

	.header-left {
		display: flex;
		align-items: center;
		gap: 1.25rem;
		min-width: 0;
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

    .overall-pill.subtle {
        padding: 0.3rem 0.7rem;
        opacity: 0.85;
    }

    .basis-toggle {
        background: oklch(1 0 0 / 4%);
        border: 1px solid oklch(1 0 0 / 10%);
        border-radius: 6px;
        padding: 0.3rem 0.55rem;
        color: oklch(0.6 0.02 265);
        font-size: 0.62rem;
        cursor: pointer;
        letter-spacing: 0.04em;
    }

    .basis-toggle:hover {
        color: oklch(0.9 0.01 265);
        border-color: oklch(1 0 0 / 18%);
    }

    .data-menu {
        position: relative;
    }

    .data-trigger {
        background: oklch(1 0 0 / 4%);
        border: 1px solid oklch(1 0 0 / 10%);
        border-radius: 6px;
        padding: 0.35rem 0.6rem;
        color: oklch(0.7 0.02 265);
        font-size: 0.68rem;
        cursor: pointer;
    }

    .data-trigger:hover {
        color: oklch(0.9 0.01 265);
        border-color: oklch(1 0 0 / 18%);
    }

    .data-dropdown {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        min-width: 230px;
        background: oklch(0.13 0.02 265);
        border: 1px solid oklch(1 0 0 / 14%);
        border-radius: 8px;
        box-shadow: 0 12px 40px oklch(0 0 0 / 50%);
        z-index: 60;
        padding: 0.35rem 0;
        display: flex;
        flex-direction: column;
    }

    .data-item {
        display: block;
        padding: 0.5rem 0.8rem;
        font-size: 0.7rem;
        color: oklch(0.7 0.02 265);
        text-decoration: none;
        cursor: pointer;
    }

    .data-item:hover,
    .data-item:focus-within {
        background: oklch(1 0 0 / 5%);
        color: #22d3ee;
    }

    .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
    }

    .data-message {
        max-width: 1200px;
        margin: 0.6rem auto 0;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.68rem;
        color: #4ade80;
    }

    .data-message.error {
        color: #f87171;
    }

    .data-dismiss {
        background: none;
        border: none;
        color: inherit;
        cursor: pointer;
        font-size: 0.85rem;
    }

    .sem-error {
        font-size: 0.65rem;
        color: #f87171;
        padding: 0.3rem 0.75rem;
    }

    /* ── Semester switcher ──────────────────────── */

	.sem-switcher {
		position: relative;
		min-width: 0;
		width: 240px;
		flex-shrink: 0;
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

	.sem-row.dragging {
		opacity: 0.55;
	}

	.sem-row.drag-over-before {
		box-shadow: inset 0 1px 0 #22d3ee88;
	}

	.sem-row.drag-over-after {
		box-shadow: inset 0 -1px 0 #22d3ee88;
	}

	.sem-row.active .sem-switch-btn {
		color: oklch(0.9 0.01 265);
	}

	.sem-drag-handle,
	.sem-drag-spacer {
		width: 1.35rem;
		height: 1.75rem;
		display: block;
		flex-shrink: 0;
	}

	.sem-drag-handle {
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		border-radius: 5px;
		padding: 0;
		color: oklch(0.35 0.02 265);
		cursor: grab;
		transition: color 0.12s ease, background 0.12s ease;
	}

	.sem-drag-handle:hover:not(:disabled) {
		color: oklch(0.7 0.02 265);
		background: oklch(1 0 0 / 5%);
	}

	.sem-row.dragging .sem-drag-handle {
		cursor: grabbing;
		color: #22d3ee;
	}

	.sem-drag-handle:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.sem-drag-icon {
		width: 8px;
		height: 12px;
		fill: currentColor;
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
			width: 180px;
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
