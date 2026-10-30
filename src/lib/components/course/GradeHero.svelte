<script lang="ts">
    import type { Course } from "$lib/types";
    import type { CourseCurvedGrade } from "$lib/gradeMath";
    import { getGradeColor, getLetterGrade } from "$lib/grading";
    import { courseProgress } from "$lib/need";
    import { fmt } from "./display";

    interface Props {
        course: Course;
        proj: { grade: number | null; filled: number; total: number };
        curved: CourseCurvedGrade | null;
        totalWeight: number;
        onsetup: () => void;
    }

    let { course, proj, curved, totalWeight, onsetup }: Props = $props();

    const gradeColor = $derived(getGradeColor(proj.grade));
    const progress = $derived(courseProgress(course));
    const earned = $derived(progress.secured);
    const lost = $derived(Math.max(100 - progress.maxPossible, 0));
    const open = $derived(Math.max(progress.maxPossible - progress.secured, 0));
</script>

<section class="hero" style="--accent: {course.color}" aria-label="{course.name} grade">
    <div class="hero-top">
        <div>
            <span class="course-chip mono" style="color: {course.color}; border-color: {course.color}40">{course.name}</span>
            <h1 class="course-fullname">{course.fullName}</h1>
            <div class="dim mono hero-meta">
                {proj.filled} of {proj.total} graded
                {#if course.credits != null}· {fmt(course.credits)} credits{/if}
                {#if course.classSize != null}· class of {course.classSize}{/if}
                {#if totalWeight !== 100}
                    · <button class="link warn" onclick={onsetup}>⚠ weights add up to {fmt(totalWeight)}%</button>
                {/if}
            </div>
            {#if course.officialGrade}
                <span class="official-badge mono">official grade: {course.officialGrade}</span>
            {/if}
        </div>
        <div class="hero-grades">
            <div class="hero-grade">
                <div class="letter-grade mono" style="color: {gradeColor}">{getLetterGrade(proj.grade)}</div>
                {#if proj.grade !== null}
                    <div class="pct-grade mono" style="color: {gradeColor}">{proj.grade.toFixed(2)}%</div>
                {:else}
                    <div class="grade-note mono">enter scores to see a grade</div>
                {/if}
            </div>
            <div class="hero-grade-divider"></div>
            <div class="hero-grade">
                {#if curved}
                    <div class="letter-grade curved-letter mono" style="color: {curved.color}">{curved.letter}</div>
                    <div class="pct-grade mono" style="color: {curved.color}">P{Math.floor(curved.percentile)}</div>
                {:else}
                    <div class="letter-grade curved-letter mono dim">—</div>
                    <div class="grade-note mono">add class stats to see the curve</div>
                {/if}
                <div class="grade-label mono">curved</div>
            </div>
        </div>
    </div>

    <div class="progress" aria-hidden="true">
        <div class="earned" style="width: {earned}%"></div>
        <div class="lost" style="width: {lost}%"></div>
        <div class="open" style="width: {open}%"></div>
    </div>
    <div class="legend mono">
        <span style="--c: #4ade80">{earned.toFixed(1)} pts earned</span>
        <span style="--c: #f8717199">{lost.toFixed(1)} lost</span>
        <span style="--c: oklch(1 0 0 / 14%)">{open.toFixed(1)} still open</span>
    </div>
</section>
