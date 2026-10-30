import type { Course, Component, ScaleRule, SubItem, SemesterMeta } from '$lib/types';
import { getContext, setContext } from 'svelte';
import {
    computeEffectiveCompPct,
    courseCurvedGrade,
    wouldCreateScaleCycle,
    type CourseCurvedGrade,
} from '$lib/gradeMath';
import { base } from '$app/paths';
import { SaveQueue, type SaveState } from '$lib/saveQueue.svelte';

function generateId(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

    // randomUUID requires HTTPS; getRandomValues also works on local HTTP deployments.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export {
    computeCompPct,
    computeEffectiveCompPct,
    computeEffectiveSubPct,
    computeSubPct,
    effectiveComponentWeight,
    getScaleTargetPct,
    predictItem,
} from '$lib/gradeMath';

export class ApiError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
    }
}

/** Session expired or signed out in another tab: go to the sign-in page */
export function redirectIfSignedOut(res: Response): void {
    if (res.status === 401) window.location.assign(`${base}/auth`);
}

/** JSON request helper (path is relative to the base path); throws ApiError on non-2xx responses */
async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const res = await fetch(base + path, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    redirectIfSignedOut(res);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
        const message = (data as { error?: string } | null)?.error ?? `${method} ${path} failed (${res.status})`;
        throw new ApiError(message, res.status);
    }
    return data as T;
}

export type StatField = 'classAvg' | 'classMedian' | 'classMax' | 'classStdDev' | 'classFullPct';

export type PendingDelete = {
    key: string;
    kind: 'component' | 'sub';
    courseId: string;
    label: string;
    expiresAt: number;
};

export const UNDO_DELETE_MS = 6000;

type ScaleRef = { item: Component | SubItem; scale: ScaleRule };

/** The rule without sources that would make `id` depend on itself; null if none are left */
function acyclicRule(course: Course, id: string, rule: ScaleRule | null): ScaleRule | null {
    if (!rule || rule.from === 'course') return rule;
    const from = rule.from.filter((sourceId) => !wouldCreateScaleCycle(course, id, sourceId));
    return from.length > 0 ? { ...rule, from } : null;
}

export type GradesSnapshot = { semesters: SemesterMeta[]; courses: Course[] };

class GradesStore {
    /** Courses of every semester; the single copy that edits mutate */
    allCourses = $state<Course[]>([]);
    semesters = $state<SemesterMeta[]>([]);
    activeSemesterId = $state<string | null>(null);
    /** Courses of the active semester */
    courses = $derived(this.allCourses.filter((c) => c.semesterId === this.activeSemesterId));
    loaded = $state(false);
    /** Items hidden from the UI whose DELETE is held back so it can be undone */
    pendingDeletes = $state<PendingDelete[]>([]);
    readonly saves = new SaveQueue();

    #deleteJobs = new Map<string, { timer: ReturnType<typeof setTimeout>; restore: () => void; commit: () => void }>();

    get saveState(): SaveState {
        return this.saves.state;
    }

    get hasPendingWrites(): boolean {
        return this.saves.pending > 0 || this.pendingDeletes.length > 0;
    }

    setGradeVisibility(courseId: string, field: 'hideAbsoluteGrade' | 'hideRelativeGrade', hidden: boolean): void {
        const course = this.getCourse(courseId);
        if (!course) return;
        course[field] = hidden;
        this.#save(`courses:${courseId}:${field}`, '/api/courses', 'PATCH', { id: courseId, field, hidden });
    }

    setClassSize(courseId: string, classSize: number | null): void {
        const course = this.getCourse(courseId);
        if (!course) return;
        course.classSize = classSize;
        this.#patchCourse(courseId, 'classSize', classSize);
    }

    setCredits(courseId: string, credits: number | null): void {
        const course = this.getCourse(courseId);
        if (!course) return;
        course.credits = credits;
        this.#patchCourse(courseId, 'credits', credits);
    }

    setCourseName(courseId: string, field: 'name' | 'fullName', value: string): void {
        const course = this.getCourse(courseId);
        const trimmed = value.trim();
        if (!course || !trimmed || trimmed === course[field]) return;
        course[field] = trimmed;
        this.#patchCourse(courseId, field, trimmed);
    }

    setOfficialGrade(courseId: string, grade: string | null): void {
        const course = this.getCourse(courseId);
        if (!course) return;
        course.officialGrade = grade;
        this.#patchCourse(courseId, 'officialGrade', grade);
    }

    get activeSemester(): SemesterMeta | null {
        return this.semesters.find((s) => s.id === this.activeSemesterId) ?? null;
    }

    constructor(initial: GradesSnapshot | null) {
        if (!initial) return;
        this.semesters = initial.semesters;
        const active = initial.semesters.find((s) => s.isActive) ?? initial.semesters[initial.semesters.length - 1] ?? null;
        this.activeSemesterId = active?.id ?? null;
        this.allCourses = initial.courses;
        this.loaded = true;
    }

    /** Force reload from DB (after pending writes have landed) */
    async reload(): Promise<void> {
        await this.#settle();
        const [sems, courses] = await Promise.all([
            api<SemesterMeta[]>('/api/semesters'),
            api<Course[]>('/api/courses?all=1')
        ]);
        this.semesters = sems;
        const active = sems.find((s) => s.isActive) ?? sems[sems.length - 1] ?? null;
        if (!this.activeSemesterId || !sems.some((s) => s.id === this.activeSemesterId)) {
            this.activeSemesterId = active?.id ?? null;
        }
        this.allCourses = courses;
    }

    /** Quietly resync with the server unless local edits are still unsaved */
    async refresh(): Promise<void> {
        if (!this.loaded || this.hasPendingWrites || this.saves.failures.length > 0) return;
        try {
            await this.reload();
        } catch {
            // offline or server restarting; the next visibility change will try again
        }
    }

    /** Drop failed writes and reload the server's copy */
    async discardFailedSaves(): Promise<void> {
        this.saves.dismiss();
        await this.reload();
    }

    /** Switch the viewed + active semester; courses are already loaded, the DB write is queued */
    switchSemester(id: string): void {
        if (id === this.activeSemesterId || !this.semesters.some((s) => s.id === id)) return;
        this.commitPendingDeletes();
        this.semesters = this.semesters.map((s) => ({ ...s, isActive: s.id === id }));
        this.activeSemesterId = id;
        this.#save('semesters:active', '/api/semesters/active', 'POST', { id }, 0);
    }

    /** Create a new active semester, seeding its catalog courses in the same request */
    async createSemester(label: string, branch: string, semester: string, seed = true): Promise<SemesterMeta> {
        await this.#settle();
        const created = await api<{ semester: SemesterMeta; courses: Course[] }>('/api/semesters', 'POST', {
            id: generateId(),
            label,
            branch,
            semester,
            seed
        });
        this.semesters = [...this.semesters.map((s) => ({ ...s, isActive: false })), created.semester];
        this.activeSemesterId = created.semester.id;
        this.allCourses = [...this.allCourses, ...created.courses];
        return created.semester;
    }

    /** Rename a semester label */
    renameSemester(id: string, label: string): void {
        this.semesters = this.semesters.map((s) => (s.id === id ? { ...s, label } : s));
        this.#save(`semesters:${id}:label`, '/api/semesters', 'PATCH', { id, label }, 0);
    }

    /** Reorder semesters in the switcher */
    reorderSemesters(ids: string[]): void {
        if (ids.length !== this.semesters.length) return;

        const currentIds = this.semesters.map((semester) => semester.id);
        if (currentIds.every((id, index) => id === ids[index])) return;

        const semestersById = new Map(this.semesters.map((semester) => [semester.id, semester]));
        const nextSemesters = ids
            .map((id) => semestersById.get(id))
            .filter((semester): semester is SemesterMeta => Boolean(semester));

        if (nextSemesters.length !== this.semesters.length) return;

        this.semesters = nextSemesters;
        this.#save('semesters:order', '/api/semesters', 'PATCH', { order: ids }, 0);
    }

    /** Delete a semester and its courses */
    async deleteSemester(id: string): Promise<void> {
        await this.#settle();
        await api('/api/semesters', 'DELETE', { id });
        this.semesters = this.semesters.filter((s) => s.id !== id);
        this.allCourses = this.allCourses.filter((c) => c.semesterId !== id);
        if (this.activeSemesterId === id) {
            const next = this.semesters[this.semesters.length - 1] ?? null;
            if (next) this.switchSemester(next.id);
            else this.activeSemesterId = null;
        }
    }

    /** Add a new course with default components */
    async addCourse(name: string, fullName: string, color: string): Promise<void> {
        const created = await api<Course>('/api/courses', 'POST', {
            name,
            fullName,
            color,
            semesterId: this.activeSemesterId
        });
        this.allCourses = [...this.allCourses, created];
        this.#bumpCourseCount(1);
    }

    /** Seed courses from the catalog for a given branch + semester into the active semester */
    async seedFromCatalog(branch: string, semester: string): Promise<void> {
        const semesterId = this.activeSemesterId;
        if (!semesterId) return;
        const seeded = await api<Course[]>('/api/courses/seed', 'POST', { branch, semester, semesterId });
        this.allCourses = [...this.allCourses.filter((c) => c.semesterId !== semesterId), ...seeded];
        this.semesters = this.semesters.map((s) =>
            s.id === semesterId ? { ...s, courseCount: seeded.length } : s
        );
    }

    /** Delete a course */
    async deleteCourse(courseId: string): Promise<void> {
        await this.#settle();
        await api('/api/courses', 'DELETE', { id: courseId });
        this.allCourses = this.allCourses.filter((c) => c.id !== courseId);
        this.#bumpCourseCount(-1);
    }

    /** Import a JSON export as new semester(s); returns how many were added */
    async importData(payload: string): Promise<number> {
        await this.#settle();
        const res = await fetch(`${base}/api/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload
        });
        redirectIfSignedOut(res);
        const data = (await res.json().catch(() => null)) as { semesters?: SemesterMeta[]; error?: string } | null;
        if (!res.ok) throw new ApiError(data?.error ?? `import failed (${res.status})`, res.status);
        await this.reload();
        return data?.semesters?.length ?? 0;
    }

    getCourse(id: string): Course | undefined {
        return this.courses.find((c) => c.id === id);
    }

    /** Make sure a course is loaded, switching to its semester if needed; false if it doesn't exist */
    async ensureCourse(courseId: string): Promise<boolean> {
        if (this.getCourse(courseId)) return true;
        if (!this.allCourses.some((c) => c.id === courseId)) {
            try {
                await api<Course>(`/api/courses/${encodeURIComponent(courseId)}`);
            } catch (error) {
                if (error instanceof ApiError && (error.status === 404 || error.status === 400)) return false;
                throw error;
            }
            // Created in another tab: pick it up along with any new semester
            await this.reload();
        }
        const semesterId = this.allCourses.find((c) => c.id === courseId)?.semesterId;
        if (semesterId) this.switchSemester(semesterId);
        return this.getCourse(courseId) !== undefined;
    }

    // ─── Direct score (top-level) ───────────────────────────────────────────────

    updateScore(courseId: string, componentId: string, score: number | null): void {
        const comp = this.#getComp(courseId, componentId);
        if (!comp || comp.scale) return;
        comp.score = score;
        this.#patchComponent(componentId, 'score', score);
    }

    // ─── Sub-item scores ────────────────────────────────────────────────────────

    updateSubScore(courseId: string, componentId: string, subItemId: string, score: number | null): void {
        const comp = this.#getComp(courseId, componentId);
        if (comp?.scale) return;
        const sub = this.#getSub(courseId, componentId, subItemId);
        if (!sub || sub.scale) return;
        sub.score = score;
        this.#patchSub(subItemId, 'score', score);
    }

    updateSubMaxScore(courseId: string, componentId: string, subItemId: string, maxScore: number): void {
        const sub = this.#getSub(courseId, componentId, subItemId);
        if (!sub) return;
        sub.maxScore = maxScore;
        this.#patchSub(subItemId, 'maxScore', maxScore);
    }

    updateSubName(courseId: string, componentId: string, subItemId: string, name: string): void {
        const sub = this.#getSub(courseId, componentId, subItemId);
        const trimmed = name.trim();
        if (!sub || !trimmed || trimmed === sub.name) return;
        sub.name = trimmed;
        this.#patchSub(subItemId, 'name', trimmed);
    }

    addSubItem(courseId: string, componentId: string): void {
        const comp = this.#getComp(courseId, componentId);
        if (!comp) return;
        if (!comp.subItems) comp.subItems = [];
        const n = comp.subItems.length + 1;
        const id = generateId();
        const name = `${comp.name} ${n}`.slice(0, 100);
        comp.subItems.push({ id, name, score: null, maxScore: comp.maxScore });
        this.#save(`sub-items:${id}:create`, '/api/sub-items', 'POST', { componentId, id, name, maxScore: comp.maxScore }, 0);
    }

    /** Hide a sub-item now; the DELETE is sent after the undo window */
    removeSubItem(courseId: string, componentId: string, subItemId: string): void {
        const course = this.getCourse(courseId);
        const comp = this.#getComp(courseId, componentId);
        if (!course || !comp?.subItems) return;
        const index = comp.subItems.findIndex((s) => s.id === subItemId);
        if (index === -1) return;
        const sub = comp.subItems[index];
        const refs = this.#detachScaleRefs(course, new Set([subItemId]));
        comp.subItems = comp.subItems.filter((s) => s.id !== subItemId);

        this.#scheduleDelete(
            { key: `sub:${subItemId}`, kind: 'sub', courseId, label: sub.name },
            () => {
                const current = this.#getComp(courseId, componentId);
                if (!current) return;
                const next = [...(current.subItems ?? [])];
                next.splice(Math.min(index, next.length), 0, sub);
                current.subItems = next;
                this.#restoreScaleRefs(refs);
            },
            () => {
                const current = this.#getComp(courseId, componentId);
                if (current?.bestOf && current.bestOf > (current.subItems?.length ?? 0)) {
                    current.bestOf = current.subItems?.length || undefined;
                    this.#patchComponent(componentId, 'bestOf', current.bestOf ?? null);
                }
                this.#save(`sub-items:${subItemId}:delete`, '/api/sub-items', 'DELETE', { id: subItemId, componentId }, 0);
            }
        );
    }

    updateBestOf(courseId: string, componentId: string, bestOf: number | undefined): void {
        const comp = this.#getComp(courseId, componentId);
        if (!comp) return;
        comp.bestOf = bestOf;
        this.#patchComponent(componentId, 'bestOf', bestOf ?? null);
    }

    // ─── Component-level ────────────────────────────────────────────────────────

    reorderComponents(courseId: string, ids: string[]): void {
        const course = this.getCourse(courseId);
        if (!course || ids.length !== course.components.length || new Set(ids).size !== ids.length) return;
        const componentsById = new Map(course.components.map((component) => [component.id, component]));
        if (ids.some((id) => !componentsById.has(id))) return;
        if (ids.every((id, index) => id === course.components[index].id)) return;

        course.components = ids.map((id) => componentsById.get(id)!);
        this.#save(`components:${courseId}:order`, '/api/components', 'PATCH', { courseId, order: ids }, 0);
    }

    updateWeight(courseId: string, componentId: string, weight: number): void {
        const comp = this.#getComp(courseId, componentId);
        if (!comp) return;
        comp.weight = weight;
        this.#patchComponent(componentId, 'weight', weight);
    }

    updateMaxScore(courseId: string, componentId: string, maxScore: number): void {
        const comp = this.#getComp(courseId, componentId);
        if (!comp) return;
        comp.maxScore = maxScore;
        this.#patchComponent(componentId, 'maxScore', maxScore);
    }

    updateName(courseId: string, componentId: string, name: string): void {
        const comp = this.#getComp(courseId, componentId);
        const trimmed = name.trim();
        if (!comp || !trimmed || trimmed === comp.name) return;
        comp.name = trimmed;
        this.#patchComponent(componentId, 'name', trimmed);
    }

    addComponent(courseId: string): void {
        const course = this.courses.find((c) => c.id === courseId);
        if (!course) return;
        const id = generateId();
        const name = 'New Component';
        course.components.push({ id, name, weight: 0, maxScore: 100, score: null });
        this.#save(`components:${id}:create`, '/api/components', 'POST', { courseId, id, name }, 0);
    }

    /** Hide a component now; the DELETE is sent after the undo window */
    removeComponent(courseId: string, componentId: string): void {
        const course = this.courses.find((c) => c.id === courseId);
        if (!course) return;
        const index = course.components.findIndex((c) => c.id === componentId);
        if (index === -1) return;
        const comp = course.components[index];
        const deletedIds = new Set([comp.id, ...(comp.subItems ?? []).map((sub) => sub.id)]);
        const refs = this.#detachScaleRefs(course, deletedIds);
        course.components = course.components.filter((c) => c.id !== componentId);

        this.#scheduleDelete(
            { key: `component:${componentId}`, kind: 'component', courseId, label: comp.name },
            () => {
                const current = this.getCourse(courseId);
                if (!current) return;
                const next = [...current.components];
                next.splice(Math.min(index, next.length), 0, comp);
                current.components = next;
                this.#restoreScaleRefs(refs);
            },
            () => this.#save(`components:${componentId}:delete`, '/api/components', 'DELETE', { id: componentId }, 0)
        );
    }

    undoDelete(key: string): void {
        const job = this.#deleteJobs.get(key);
        if (!job) return;
        clearTimeout(job.timer);
        this.#deleteJobs.delete(key);
        this.pendingDeletes = this.pendingDeletes.filter((item) => item.key !== key);
        job.restore();
    }

    /** Send every held-back delete now */
    commitPendingDeletes(): void {
        for (const key of [...this.#deleteJobs.keys()]) this.#commitDelete(key);
    }

    /** Restore the catalog template's components; throws ApiError (e.g. 400 when there is no template) */
    async resetCourse(courseId: string): Promise<void> {
        await this.#settle();
        const course = await api<Course>(`/api/courses/${encodeURIComponent(courseId)}/reset`, 'POST');
        this.allCourses = this.allCourses.map((c) => (c.id === courseId ? course : c));
    }

    // ─── Class stats ────────────────────────────────────────────────────────────

    updateClassStats(courseId: string, componentId: string, field: StatField, value: number | null): void {
        const comp = this.#getComp(courseId, componentId);
        if (!comp) return;
        comp[field] = value;
        this.#patchComponent(componentId, field, value);
    }

    updateStatsMode(courseId: string, componentId: string, mode: 'global' | 'per-sub'): void {
        const comp = this.#getComp(courseId, componentId);
        if (!comp) return;
        comp.statsMode = mode;
        this.#patchComponent(componentId, 'statsMode', mode);
    }

    /** Scale a component from other items (null stops scaling); sources that would loop are dropped */
    updateScale(courseId: string, componentId: string, rule: ScaleRule | null): void {
        const course = this.getCourse(courseId);
        const comp = this.#getComp(courseId, componentId);
        if (!course || !comp) return;
        const next = acyclicRule(course, componentId, rule);
        if (rule && !next) return;
        comp.scale = next;
        this.#patchComponent(componentId, 'scale', next);
    }

    updateSubClassStats(courseId: string, componentId: string, subItemId: string, field: StatField, value: number | null): void {
        const sub = this.#getSub(courseId, componentId, subItemId);
        if (!sub) return;
        sub[field] = value;
        this.#patchSub(subItemId, field, value);
    }

    updateSubScale(courseId: string, componentId: string, subItemId: string, rule: ScaleRule | null): void {
        const course = this.getCourse(courseId);
        const sub = this.#getSub(courseId, componentId, subItemId);
        if (!course || !sub) return;
        const next = acyclicRule(course, subItemId, rule);
        if (rule && !next) return;
        sub.scale = next;
        this.#patchSub(subItemId, 'scale', next);
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
        return course ? courseCurvedGrade(course) : null;
    }

    /** Wait for queued writes (e.g. before signing out) */
    settle(): Promise<void> {
        return this.#settle();
    }

    // ─── Private helpers ────────────────────────────────────────────────────────

    #save(key: string, path: string, method: string, body: unknown, delayMs = 300): void {
        this.saves.enqueue(key, { path: base + path, method, body }, delayMs);
    }

    #patchComponent(id: string, field: string, value: unknown): void {
        this.#save(`components:${id}:${field}`, '/api/components', 'PATCH', { id, field, value: value ?? null });
    }

    #patchSub(id: string, field: string, value: unknown): void {
        this.#save(`sub-items:${id}:${field}`, '/api/sub-items', 'PATCH', { id, field, value: value ?? null });
    }

    #patchCourse(id: string, field: string, value: unknown): void {
        this.#save(`courses:${id}:${field}`, '/api/courses', 'PATCH', { id, field, value: value ?? null });
    }

    /** Commit held-back deletes and wait for every queued write to land */
    async #settle(): Promise<void> {
        this.commitPendingDeletes();
        await this.saves.idle();
    }

    #scheduleDelete(item: Omit<PendingDelete, 'expiresAt'>, restore: () => void, commit: () => void): void {
        const timer = setTimeout(() => this.#commitDelete(item.key), UNDO_DELETE_MS);
        this.#deleteJobs.set(item.key, { timer, restore, commit });
        this.pendingDeletes = [...this.pendingDeletes, { ...item, expiresAt: Date.now() + UNDO_DELETE_MS }];
    }

    #commitDelete(key: string): void {
        const job = this.#deleteJobs.get(key);
        if (!job) return;
        clearTimeout(job.timer);
        this.#deleteJobs.delete(key);
        this.pendingDeletes = this.pendingDeletes.filter((item) => item.key !== key);
        job.commit();
    }

    /** Drop `ids` from scale rules locally (the server does the same on DELETE); a rule left empty is cleared */
    #detachScaleRefs(course: Course, ids: Set<string>): ScaleRef[] {
        const refs: ScaleRef[] = [];
        for (const comp of course.components) {
            for (const item of [comp, ...(comp.subItems ?? [])]) {
                const rule = item.scale;
                if (!rule || rule.from === 'course' || ids.has(item.id) || !rule.from.some((id) => ids.has(id))) continue;
                refs.push({ item, scale: rule });
                const from = rule.from.filter((id) => !ids.has(id));
                item.scale = from.length > 0 ? { ...rule, from } : null;
            }
        }
        return refs;
    }

    #restoreScaleRefs(refs: ScaleRef[]): void {
        for (const ref of refs) ref.item.scale = ref.scale;
    }

    #bumpCourseCount(delta: number): void {
        if (!this.activeSemesterId) return;
        this.semesters = this.semesters.map((s) =>
            s.id === this.activeSemesterId ? { ...s, courseCount: Math.max(0, s.courseCount + delta) } : s
        );
    }

    #getComp(courseId: string, componentId: string): Component | undefined {
        return this.courses.find((c) => c.id === courseId)?.components.find((c) => c.id === componentId);
    }

    #getSub(courseId: string, componentId: string, subItemId: string): SubItem | undefined {
        return this.#getComp(courseId, componentId)?.subItems?.find((s) => s.id === subItemId);
    }
}

// Each layout owns its store, including during SSR. Never share account data across requests.
const gradesContext = Symbol('grades');

export function provideGrades(initial: GradesSnapshot | null): GradesStore {
    return setContext(gradesContext, new GradesStore(initial));
}

export function getGrades(): GradesStore {
    const grades = getContext<GradesStore | undefined>(gradesContext);
    if (!grades) throw new Error('Grades must be provided by the root layout');
    return grades;
}
