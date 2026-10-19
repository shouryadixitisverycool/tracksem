import type { Course, Component, SubItem, SemesterMeta } from '$lib/types';
import {
    combineStandings,
    predictGrade,
    standingToPrediction,
    type PredictedGrade,
    type Standing,
} from '$lib/curveGrading';
import type { CourseCurvedGrade } from '$lib/gradeMath';

function generateId(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

    // randomUUID requires HTTPS; getRandomValues also works on local HTTP deployments.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type StatsSource = Pick<SubItem, 'maxScore' | 'classAvg' | 'classMedian' | 'classMax' | 'classStdDev'>;

/** Curve prediction for one item scoring `pct`% against its own class stats */
export function predictItem(course: Course, item: StatsSource, pct: number | null): PredictedGrade | null {
    if (pct === null || item.classAvg == null) return null;
    return predictGrade((pct / 100) * item.maxScore, item.maxScore, {
        avg: item.classAvg,
        median: item.classMedian,
        max: item.classMax,
        stdDev: item.classStdDev,
    }, course.classSize);
}

function getSubStanding(course: Course, sub: SubItem): Standing | null {
    if (sub.scaleTargetId) return getScaleTargetStanding(course, sub.scaleTargetId);
    return predictItem(course, sub, computeSubPct(sub));
}

function getComponentStanding(course: Course, comp: Component): Standing | null {
    if (comp.scaleTargetId) return getScaleTargetStanding(course, comp.scaleTargetId);

    if (comp.statsMode === 'per-sub' && comp.subItems && comp.subItems.length > 0) {
        const items = comp.subItems
            .map((sub) => getSubStanding(course, sub))
            .filter((standing): standing is Standing => standing !== null)
            .map((standing) => ({ weight: 1, standing }));
        return combineStandings(items);
    }

    return predictItem(course, comp, computeEffectiveCompPct(course, comp));
}

function getScaleTargetStanding(course: Course, targetId: string | null | undefined): Standing | null {
    if (!targetId) return null;

    for (const comp of course.components) {
        if (comp.id === targetId) return getComponentStanding(course, comp);

        const sub = comp.subItems?.find((item) => item.id === targetId);
        if (sub) return getSubStanding(course, sub);
    }

    return null;
}

/**
 * Compute the effective percentage (0–100) for a component.
 * - If subItems exist: average of filled scores (best-of if bestOf set)
 * - Otherwise: score / maxScore * 100
 */
export function computeCompPct(comp: Component): number | null {
    if (comp.subItems && comp.subItems.length > 0) {
        const filled = comp.subItems
            .filter((s) => s.score !== null)
            .map((s) => ({ pct: (s.score! / s.maxScore) * 100 }));

        if (filled.length === 0) return null;

        if (comp.bestOf && comp.bestOf < filled.length) {
            const top = filled
                .map((f) => f.pct)
                .sort((a, b) => b - a)
                .slice(0, comp.bestOf);
            return top.reduce((a, b) => a + b, 0) / top.length;
        }

        const avg = filled.reduce((sum, f) => sum + f.pct, 0) / filled.length;
        return avg;
    }

    if (comp.score === null) return null;
    return (comp.score / comp.maxScore) * 100;
}

export function computeSubPct(sub: SubItem): number | null {
    if (sub.score === null) return null;
    return (sub.score / sub.maxScore) * 100;
}

export function computeEffectiveSubPct(course: Course, sub: SubItem): number | null {
    return sub.scaleTargetId ? getScaleTargetPct(course, sub.scaleTargetId) : computeSubPct(sub);
}

export function computeEffectiveCompPct(course: Course, comp: Component): number | null {
    if (comp.scaleTargetId) return getScaleTargetPct(course, comp.scaleTargetId);

    if (comp.subItems && comp.subItems.length > 0) {
        const filled = comp.subItems
            .map((sub) => computeEffectiveSubPct(course, sub))
            .filter((pct): pct is number => pct !== null);

        if (filled.length === 0) return null;

        if (comp.bestOf && comp.bestOf < filled.length) {
            const top = filled.sort((a, b) => b - a).slice(0, comp.bestOf);
            return top.reduce((a, b) => a + b, 0) / top.length;
        }

        return filled.reduce((sum, pct) => sum + pct, 0) / filled.length;
    }

    return computeCompPct(comp);
}

export function getScaleTargetPct(course: Course, targetId: string | null | undefined): number | null {
    if (!targetId) return null;

    for (const comp of course.components) {
        if (comp.id === targetId) return computeEffectiveCompPct(course, comp);

        const sub = comp.subItems?.find((item) => item.id === targetId);
        if (sub) return computeEffectiveSubPct(course, sub);
    }

    return null;
}

export function effectiveComponentWeight(course: Course, componentId: string): number {
    const comp = course.components.find((item) => item.id === componentId);
    if (!comp || comp.scaleTargetId) return 0;

    return course.components.reduce(
        (sum, item) => sum + (item.scaleTargetId === componentId ? item.weight : 0),
        comp.weight
    );
}

/** Fire-and-forget API helper */
async function api(path: string, method: string, body?: unknown): Promise<unknown> {
    const res = await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
    });
    return res.json();
}

class GradesStore {
    courses = $state<Course[]>([]);
    semesters = $state<SemesterMeta[]>([]);
    activeSemesterId = $state<string | null>(null);
    loaded = $state(false);

    setGradeVisibility(courseId: string, field: 'hideAbsoluteGrade' | 'hideRelativeGrade', hidden: boolean): void {
        const course = this.getCourse(courseId);
        if (!course) return;
        course[field] = hidden;
        void api('/api/courses', 'PATCH', { id: courseId, field, hidden });
    }

    setClassSize(courseId: string, classSize: number | null): void {
        const course = this.getCourse(courseId);
        if (!course) return;
        course.classSize = classSize;
        void api('/api/courses', 'PATCH', { id: courseId, field: 'classSize', value: classSize });
    }

    get activeSemester(): SemesterMeta | null {
        return this.semesters.find((s) => s.id === this.activeSemesterId) ?? null;
    }

    /** Clear all state — call on sign-out so the next user starts fresh */
    reset(): void {
        this.courses = [];
        this.semesters = [];
        this.activeSemesterId = null;
        this.loaded = false;
    }

    /** Load semesters then courses from the API */
    async load(): Promise<void> {
        if (this.loaded) return;
        const semRes = await fetch('/api/semesters');
        const sems: SemesterMeta[] = await semRes.json();
        this.semesters = sems;
        const active = sems.find((s) => s.isActive) ?? sems[sems.length - 1] ?? null;
        this.activeSemesterId = active?.id ?? null;

        if (this.activeSemesterId) {
            const res = await fetch(`/api/courses?semesterId=${this.activeSemesterId}`);
            this.courses = await res.json();
        } else {
            this.courses = [];
        }
        this.loaded = true;
    }

    /** Force reload from DB */
    async reload(): Promise<void> {
        const semRes = await fetch('/api/semesters');
        this.semesters = await semRes.json();
        const active = this.semesters.find((s) => s.isActive) ?? this.semesters[this.semesters.length - 1] ?? null;
        // Keep current activeSemesterId if still valid, else use DB active
        if (this.activeSemesterId && !this.semesters.find((s) => s.id === this.activeSemesterId)) {
            this.activeSemesterId = active?.id ?? null;
        } else if (!this.activeSemesterId) {
            this.activeSemesterId = active?.id ?? null;
        }
        await this.#loadCoursesForSemester(this.activeSemesterId);
    }

    /** Switch the viewed + active semester (persists to DB) */
    async switchSemester(id: string): Promise<void> {
        await api('/api/semesters/active', 'POST', { id });
        this.semesters = this.semesters.map((s) => ({ ...s, isActive: s.id === id }));
        this.activeSemesterId = id;
        await this.#loadCoursesForSemester(id);
    }

    /** Create a new semester (sets it active) */
    async createSemester(label: string, branch: string, semester: string): Promise<SemesterMeta> {
        const id = generateId();
        const meta = (await api('/api/semesters', 'POST', { id, label, branch, semester })) as SemesterMeta;
        this.semesters = [...this.semesters.map((s) => ({ ...s, isActive: false })), meta];
        this.activeSemesterId = meta.id;
        this.courses = [];
        return meta;
    }

    /** Rename a semester label */
    async renameSemester(id: string, label: string): Promise<void> {
        this.semesters = this.semesters.map((s) => (s.id === id ? { ...s, label } : s));
        await api('/api/semesters', 'PATCH', { id, label });
    }

    /** Reorder semesters in the switcher */
    async reorderSemesters(ids: string[]): Promise<void> {
        if (ids.length !== this.semesters.length) return;

        const currentIds = this.semesters.map((semester) => semester.id);
        if (currentIds.every((id, index) => id === ids[index])) return;

        const semestersById = new Map(this.semesters.map((semester) => [semester.id, semester]));
        const nextSemesters = ids
            .map((id) => semestersById.get(id))
            .filter((semester): semester is SemesterMeta => Boolean(semester));

        if (nextSemesters.length !== this.semesters.length) return;

        this.semesters = nextSemesters;
        await api('/api/semesters', 'PATCH', { order: ids });
    }

    /** Delete a semester and its courses */
    async deleteSemester(id: string): Promise<void> {
        await api('/api/semesters', 'DELETE', { id });
        this.semesters = this.semesters.filter((s) => s.id !== id);
        if (this.activeSemesterId === id) {
            const next = this.semesters[this.semesters.length - 1] ?? null;
            if (next) {
                await this.switchSemester(next.id);
            } else {
                this.activeSemesterId = null;
                this.courses = [];
            }
        }
    }

    /** Add a new course with default components */
    async addCourse(name: string, fullName: string, color: string): Promise<void> {
        const created = (await api('/api/courses', 'POST', {
            name,
            fullName,
            color,
            semesterId: this.activeSemesterId
        })) as Course;
        this.courses = [...this.courses, created];
        // bump courseCount in semesters
        if (this.activeSemesterId) {
            this.semesters = this.semesters.map((s) =>
                s.id === this.activeSemesterId ? { ...s, courseCount: s.courseCount + 1 } : s
            );
        }
    }

    /** Seed courses from the catalog for a given branch + semester */
    async seedFromCatalog(branch: string, semester: string): Promise<void> {
        if (!this.activeSemesterId) return;
        const res = await fetch('/api/courses/seed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ branch, semester, semesterId: this.activeSemesterId })
        });
        const seeded: Course[] = await res.json();
        this.courses = seeded;
        // update courseCount
        this.semesters = this.semesters.map((s) =>
            s.id === this.activeSemesterId ? { ...s, courseCount: seeded.length } : s
        );
    }

    /** Delete a course */
    async deleteCourse(courseId: string): Promise<void> {
        await api('/api/courses', 'DELETE', { id: courseId });
        this.courses = this.courses.filter((c) => c.id !== courseId);
        if (this.activeSemesterId) {
            this.semesters = this.semesters.map((s) =>
                s.id === this.activeSemesterId ? { ...s, courseCount: Math.max(0, s.courseCount - 1) } : s
            );
        }
    }

    getCourse(id: string): Course | undefined {
        return this.courses.find((c) => c.id === id);
    }

    // ─── Direct score (top-level) ───────────────────────────────────────────────

    updateScore(courseId: string, componentId: string, score: number | null): void {
        const comp = this.#getComp(courseId, componentId);
        if (!comp || comp.scaleTargetId) return;
        comp.score = score;
        api('/api/components', 'PATCH', { id: componentId, field: 'score', value: score });
    }

    // ─── Sub-item scores ────────────────────────────────────────────────────────

    updateSubScore(courseId: string, componentId: string, subItemId: string, score: number | null): void {
        const comp = this.#getComp(courseId, componentId);
        if (comp?.scaleTargetId) return;
        const sub = this.#getSub(courseId, componentId, subItemId);
        if (!sub || sub.scaleTargetId) return;
        sub.score = score;
        api('/api/sub-items', 'PATCH', { id: subItemId, field: 'score', value: score });
    }

    updateSubMaxScore(courseId: string, componentId: string, subItemId: string, maxScore: number): void {
        const comp = this.#getComp(courseId, componentId);
        if (comp?.scaleTargetId) return;
        const sub = this.#getSub(courseId, componentId, subItemId);
        if (!sub || sub.scaleTargetId) return;
        sub.maxScore = maxScore;
        api('/api/sub-items', 'PATCH', { id: subItemId, field: 'maxScore', value: maxScore });
    }

    updateSubName(courseId: string, componentId: string, subItemId: string, name: string): void {
        const sub = this.#getSub(courseId, componentId, subItemId);
        if (!sub) return;
        sub.name = name;
        api('/api/sub-items', 'PATCH', { id: subItemId, field: 'name', value: name });
    }

    addSubItem(courseId: string, componentId: string): void {
        const comp = this.#getComp(courseId, componentId);
        if (!comp) return;
        if (!comp.subItems) comp.subItems = [];
        const n = comp.subItems.length + 1;
        const id = `${componentId}-${generateId()}`;
        const name = `${comp.name} ${n}`;
        comp.subItems.push({ id, name, score: null, maxScore: comp.maxScore });
        api('/api/sub-items', 'POST', { componentId, id, name, maxScore: comp.maxScore });
    }

    removeSubItem(courseId: string, componentId: string, subItemId: string): void {
        const comp = this.#getComp(courseId, componentId);
        if (!comp || !comp.subItems) return;
        comp.subItems = comp.subItems.filter((s) => s.id !== subItemId);
        if (comp.bestOf && comp.bestOf > comp.subItems.length) {
            comp.bestOf = comp.subItems.length || undefined;
            api('/api/components', 'PATCH', { id: componentId, field: 'bestOf', value: comp.bestOf });
        }
        api('/api/sub-items', 'DELETE', { id: subItemId, componentId });
    }

    updateBestOf(courseId: string, componentId: string, bestOf: number | undefined): void {
        const comp = this.#getComp(courseId, componentId);
        if (!comp) return;
        comp.bestOf = bestOf;
        api('/api/components', 'PATCH', { id: componentId, field: 'bestOf', value: bestOf });
    }

    // ─── Component-level ────────────────────────────────────────────────────────

    async reorderComponents(courseId: string, ids: string[]): Promise<void> {
        const course = this.getCourse(courseId);
        if (!course || ids.length !== course.components.length || new Set(ids).size !== ids.length) return;
        const componentsById = new Map(course.components.map((component) => [component.id, component]));
        if (ids.some((id) => !componentsById.has(id))) return;
        if (ids.every((id, index) => id === course.components[index].id)) return;

        course.components = ids.map((id) => componentsById.get(id)!);
        await api('/api/components', 'PATCH', { courseId, order: ids });
    }

    updateWeight(courseId: string, componentId: string, weight: number): void {
        const comp = this.#getComp(courseId, componentId);
        if (!comp) return;
        comp.weight = weight;
        api('/api/components', 'PATCH', { id: componentId, field: 'weight', value: weight });
    }

    updateMaxScore(courseId: string, componentId: string, maxScore: number): void {
        const comp = this.#getComp(courseId, componentId);
        if (!comp || comp.scaleTargetId) return;
        comp.maxScore = maxScore;
        api('/api/components', 'PATCH', { id: componentId, field: 'maxScore', value: maxScore });
    }

    updateName(courseId: string, componentId: string, name: string): void {
        const comp = this.#getComp(courseId, componentId);
        if (!comp) return;
        comp.name = name;
        api('/api/components', 'PATCH', { id: componentId, field: 'name', value: name });
    }

    addComponent(courseId: string): void {
        const course = this.courses.find((c) => c.id === courseId);
        if (!course) return;
        const id = `${courseId}-${generateId()}`;
        const name = 'New Component';
        course.components.push({ id, name, weight: 0, maxScore: 100, score: null });
        api('/api/components', 'POST', { courseId, id, name });
    }

    removeComponent(courseId: string, componentId: string): void {
        const course = this.courses.find((c) => c.id === courseId);
        if (!course) return;
        course.components = course.components.filter((c) => c.id !== componentId);
        api('/api/components', 'DELETE', { id: componentId });
    }

    async resetCourse(courseId: string): Promise<void> {
        await api(`/api/courses/${courseId}/reset`, 'POST');
        await this.reload();
    }

    // ─── Class stats ────────────────────────────────────────────────────────────

    updateClassStats(courseId: string, componentId: string, field: 'classAvg' | 'classMedian' | 'classMax' | 'classStdDev', value: number | null): void {
        const comp = this.#getComp(courseId, componentId);
        if (!comp || comp.scaleTargetId) return;
        comp[field] = value;
        api('/api/components', 'PATCH', { id: componentId, field, value });
    }

    updateStatsMode(courseId: string, componentId: string, mode: 'global' | 'per-sub'): void {
        const comp = this.#getComp(courseId, componentId);
        if (!comp) return;
        comp.statsMode = mode;
        api('/api/components', 'PATCH', { id: componentId, field: 'statsMode', value: mode });
    }

    updateScaleTarget(courseId: string, componentId: string, targetId: string | null): void {
        const comp = this.#getComp(courseId, componentId);
        if (!comp) return;
        comp.scaleTargetId = targetId;
        api('/api/components', 'PATCH', { id: componentId, field: 'scaleTargetId', value: targetId });
    }

    updateSubClassStats(courseId: string, componentId: string, subItemId: string, field: 'classAvg' | 'classMedian' | 'classMax' | 'classStdDev', value: number | null): void {
        const sub = this.#getSub(courseId, componentId, subItemId);
        if (!sub || sub.scaleTargetId) return;
        sub[field] = value;
        api('/api/sub-items', 'PATCH', { id: subItemId, field, value });
    }

    updateSubScaleTarget(courseId: string, componentId: string, subItemId: string, targetId: string | null): void {
        const sub = this.#getSub(courseId, componentId, subItemId);
        if (!sub) return;
        sub.scaleTargetId = targetId;
        api('/api/sub-items', 'PATCH', { id: subItemId, field: 'scaleTargetId', value: targetId });
    }

    // ─── Derived computations ───────────────────────────────────────────────────

    projectedGrade(courseId: string): { grade: number | null; filled: number; total: number } {
        const course = this.courses.find((c) => c.id === courseId);
        if (!course) return { grade: null, filled: 0, total: 0 };

        let weightedSum = 0;
        let filledWeight = 0;
        let filled = 0;

        for (const comp of course.components) {
            const pct = computeEffectiveCompPct(course, comp);
            if (pct !== null) {
                weightedSum += pct * (comp.weight / 100);
                filledWeight += comp.weight;
                filled++;
            }
        }

        if (filledWeight === 0) return { grade: null, filled: 0, total: course.components.length };
        const grade = (weightedSum / filledWeight) * 100;
        return { grade, filled, total: course.components.length };
    }

    componentPct(courseId: string, componentId: string): number | null {
        const comp = this.#getComp(courseId, componentId);
        if (!comp) return null;
        const course = this.courses.find((c) => c.id === courseId);
        if (!course) return null;
        return computeEffectiveCompPct(course, comp);
    }

    totalWeight(courseId: string): number {
        const course = this.courses.find((c) => c.id === courseId);
        if (!course) return 0;
        return course.components.reduce((sum, c) => sum + c.weight, 0);
    }

    /** Overall curved grade: standing on the weighted total of components that have a score AND class stats */
    curvedGrade(courseId: string): CourseCurvedGrade | null {
        const course = this.courses.find((c) => c.id === courseId);
        if (!course) return null;

        const items = course.components
            .map((comp) => ({ weight: comp.weight, standing: getComponentStanding(course, comp) }))
            .filter((item): item is { weight: number; standing: Standing } => item.standing !== null);

        const combined = combineStandings(items);
        if (!combined) return null;
        const totalWeight = course.components.reduce((sum, comp) => sum + comp.weight, 0);
        const usedWeight = items.reduce((sum, item) => sum + item.weight, 0);
        return {
            ...standingToPrediction(combined),
            coverage: totalWeight > 0 ? usedWeight / totalWeight : 0,
            projected: null,
        };
    }

    // ─── Private helpers ────────────────────────────────────────────────────────

    async #loadCoursesForSemester(semesterId: string | null): Promise<void> {
        if (!semesterId) {
            this.courses = [];
            return;
        }
        const res = await fetch(`/api/courses?semesterId=${semesterId}`);
        this.courses = await res.json();
    }

    #getComp(courseId: string, componentId: string): Component | undefined {
        return this.courses.find((c) => c.id === courseId)?.components.find((c) => c.id === componentId);
    }

    #getSub(courseId: string, componentId: string, subItemId: string): SubItem | undefined {
        return this.#getComp(courseId, componentId)?.subItems?.find((s) => s.id === subItemId);
    }
}

export const grades = new GradesStore();
