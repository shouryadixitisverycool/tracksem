<script lang="ts">
    import type { Course } from "$lib/types";
    import type { CourseCurvedGrade } from "$lib/gradeMath";
    import { grades } from "$lib/stores/grades.svelte";
    import { getGradeColor, getLetterGrade, LETTERS } from "$lib/grading";
    import GradeVisibilityButton from "$lib/components/GradeVisibilityButton.svelte";
    import NumberField from "$lib/components/NumberField.svelte";

    interface Props {
        course: Course;
        proj: { grade: number | null; filled: number; total: number };
        curved: CourseCurvedGrade | null;
        totalWeight: number;
    }

    let { course, proj, curved, totalWeight }: Props = $props();

    const gradeColor = $derived(getGradeColor(proj.grade));
    const uid = $props.id();
</script>

<div class="hero" style="--accent: {course.color}">
    <div class="hero-left">
        <div class="course-chip mono" style="color: {course.color}; border-color: {course.color}30">
            {course.name}
        </div>
        <h1 class="course-fullname">{course.fullName}</h1>
        <div class="meta mono">
            {proj.filled}/{proj.total} components graded
            {#if totalWeight !== 100}
                · <span style="color: #fb923c">⚠ weights sum to {totalWeight}%</span>
            {:else}
                · <span style="color: oklch(0.4 0.02 265)">weights OK</span>
            {/if}
        </div>
        <div class="course-meta-row mono">
            <span class="meta-field" title="Used to estimate how far above the average the topper sits">
                <label for="{uid}-size">class size</label>
                <NumberField
                    id="{uid}-size"
                    class="num-input mono class-size-input"
                    integer
                    exclusiveMin
                    placeholder="?"
                    value={course.classSize}
                    onCommit={(v) => grades.setClassSize(course.id, v)}
                />
            </span>
            <span class="meta-field" title="Course credits, used for SGPA / CGPA">
                <label for="{uid}-credits">credits</label>
                <NumberField
                    id="{uid}-credits"
                    class="num-input mono class-size-input"
                    max={40}
                    placeholder="?"
                    value={course.credits}
                    onCommit={(v) => grades.setCredits(course.id, v)}
                />
            </span>
            <span class="meta-field" title="Final grade once released; overrides predictions in SGPA / CGPA">
                <label for="{uid}-official">official grade</label>
                <select
                    id="{uid}-official"
                    class="meta-select mono"
                    value={course.officialGrade ?? ""}
                    onchange={(e) => grades.setOfficialGrade(course.id, e.currentTarget.value || null)}
                >
                    <option value="">not out</option>
                    {#each LETTERS as letter (letter)}
                        <option value={letter}>{letter}</option>
                    {/each}
                </select>
            </span>
        </div>
    </div>
    <div class="hero-grade">
        <div class="hero-grade-row">
            <div class="hero-grade-col">
                <div class="letter-grade mono" style="color: {gradeColor}">
                    {getLetterGrade(proj.grade)}
                </div>
                {#if proj.grade !== null}
                    <div class="pct-grade mono" style="color: {gradeColor}">
                        {proj.grade.toFixed(2)}%
                    </div>
                {:else}
                    <div class="grade-note">enter scores to see projection</div>
                {/if}
                <div class="grade-label">
                    <GradeVisibilityButton
                        label="absolute"
                        hidden={course.hideAbsoluteGrade}
                        onchange={(hidden) => grades.setGradeVisibility(course.id, "hideAbsoluteGrade", hidden)}
                    />
                    <span>absolute</span>
                </div>
            </div>
            <div class="hero-grade-divider"></div>
            <div class="hero-grade-col">
                {#if curved}
                    <div class="letter-grade curved-letter mono" style="color: {curved.color}">
                        {curved.letter}
                    </div>
                    <div class="pct-grade mono" style="color: {curved.color}">
                        P{curved.percentile.toFixed(0)}
                    </div>
                    {#if curved.coverage < 1}
                        <div class="coverage-note mono">based on {Math.round(curved.coverage * 100)}% of course</div>
                    {/if}
                    {#if curved.projected}
                        <div class="coverage-note mono" style="color: {curved.projected.color}">
                            projected final: {curved.projected.letter} (P{curved.projected.percentile.toFixed(0)})
                        </div>
                    {/if}
                {:else}
                    <div class="letter-grade curved-letter mono" style="color: oklch(0.45 0.02 265)">—</div>
                    <div class="grade-note">add class stats to see projection</div>
                {/if}
                <div class="grade-label">
                    <GradeVisibilityButton
                        label="relative"
                        hidden={course.hideRelativeGrade}
                        onchange={(hidden) => grades.setGradeVisibility(course.id, "hideRelativeGrade", hidden)}
                    />
                    <span>curved</span>
                </div>
            </div>
        </div>
        {#if course.officialGrade}
            <div class="official-badge mono" style="color: #22d3ee; border-color: #22d3ee40">
                official: {course.officialGrade}
            </div>
        {/if}
    </div>
</div>
