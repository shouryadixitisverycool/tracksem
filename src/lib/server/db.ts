import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { DEFAULT_COURSES, SEM_DATA } from '$lib/data/courses';
import type { Course, Component, SubItem, SemesterMeta } from '$lib/types';

type SemesterRow = {
	id: string;
	label: string;
	branch: string;
	semester: string;
	created_at: number;
	is_active: number;
	sort_order: number | null;
	course_count: number;
};

type CourseRow = {
	id: string;
	name: string;
	full_name: string;
	color: string;
	semester_id: string | null;
	hide_absolute_grade: number;
	hide_relative_grade: number;
	class_size: number | null;
};

type ComponentRow = {
	id: string;
	course_id: string;
	name: string;
	weight: number;
	max_score: number;
	score: number | null;
	best_of: number | null;
	sort_order: number;
	stats_mode: 'global' | 'per-sub' | null;
	scale_target_id: string | null;
	class_avg: number | null;
	class_median: number | null;
	class_max: number | null;
	class_std_dev: number | null;
};

type SubItemRow = {
	id: string;
	component_id: string;
	name: string;
	score: number | null;
	max_score: number;
	sort_order: number;
	class_avg: number | null;
	class_median: number | null;
	class_max: number | null;
	class_std_dev: number | null;
	scale_target_id: string | null;
};

const dbPath = resolve(process.cwd(), 'data', 'tracksem.db');
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// ─── Base schema ─────────────────────────────────────────────────────────────

db.exec(`
	CREATE TABLE IF NOT EXISTS semesters (
		id TEXT PRIMARY KEY,
		label TEXT NOT NULL,
		branch TEXT NOT NULL,
		semester TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		is_active INTEGER NOT NULL DEFAULT 0,
		sort_order INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS courses (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		full_name TEXT NOT NULL,
		color TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS components (
		id TEXT PRIMARY KEY,
		course_id TEXT NOT NULL,
		name TEXT NOT NULL,
		weight REAL NOT NULL,
		max_score REAL NOT NULL,
		score REAL,
		best_of INTEGER,
		sort_order INTEGER NOT NULL,
		stats_mode TEXT DEFAULT 'global',
		class_avg REAL,
		class_median REAL,
		class_max REAL,
		class_std_dev REAL,
		FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS sub_items (
		id TEXT PRIMARY KEY,
		component_id TEXT NOT NULL,
		name TEXT NOT NULL,
		score REAL,
		max_score REAL NOT NULL,
		sort_order INTEGER NOT NULL,
		class_avg REAL,
		class_median REAL,
		class_max REAL,
		class_std_dev REAL,
		scale_target_id TEXT,
		FOREIGN KEY (component_id) REFERENCES components(id) ON DELETE CASCADE
	);
`);

// ─── Column migrations ────────────────────────────────────────────────────────

const semesterColumns = db.prepare('PRAGMA table_info(semesters)').all() as { name: string }[];
if (!semesterColumns.some((column) => column.name === 'sort_order')) {
	db.prepare('ALTER TABLE semesters ADD COLUMN sort_order INTEGER').run();
}

const semestersMissingOrder = db
	.prepare('SELECT id FROM semesters WHERE sort_order IS NULL ORDER BY created_at ASC')
	.all() as { id: string }[];

if (semestersMissingOrder.length > 0) {
	const updateSemesterSortOrder = db.prepare('UPDATE semesters SET sort_order = ? WHERE id = ?');
	db.transaction(() => {
		semestersMissingOrder.forEach((semester, index) => {
			updateSemesterSortOrder.run(index, semester.id);
		});
	})();
}

const componentColumns = db.prepare('PRAGMA table_info(components)').all() as { name: string }[];
if (!componentColumns.some((column) => column.name === 'scale_target_id')) {
	db.prepare('ALTER TABLE components ADD COLUMN scale_target_id TEXT').run();
}

const subItemColumns = db.prepare('PRAGMA table_info(sub_items)').all() as { name: string }[];
if (!subItemColumns.some((column) => column.name === 'scale_target_id')) {
	db.prepare('ALTER TABLE sub_items ADD COLUMN scale_target_id TEXT').run();
}

// Add semester_id column to courses if it doesn't exist
const courseColumns = db.prepare('PRAGMA table_info(courses)').all() as { name: string }[];
for (const column of ['hide_absolute_grade', 'hide_relative_grade']) {
	if (!courseColumns.some((col) => col.name === column)) {
		db.prepare(`ALTER TABLE courses ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`).run();
	}
}
if (!courseColumns.some((col) => col.name === 'class_size')) {
	db.prepare('ALTER TABLE courses ADD COLUMN class_size INTEGER').run();
}
if (!courseColumns.some((col) => col.name === 'semester_id')) {
	db.prepare('ALTER TABLE courses ADD COLUMN semester_id TEXT REFERENCES semesters(id)').run();
}

// ─── Startup migration: orphaned courses → default semester ──────────────────

const orphanCount = (
	db.prepare('SELECT COUNT(*) as c FROM courses WHERE semester_id IS NULL').get() as { c: number }
).c;

if (orphanCount > 0) {
	const semId = crypto.randomUUID();
	const nextSortOrder = getNextSemesterSortOrder();
	db.prepare(
		`INSERT INTO semesters (id, label, branch, semester, created_at, is_active, sort_order)
		 VALUES (?, ?, ?, ?, ?, 1, ?)`
	).run(semId, 'Semester 1', 'unknown', 'unknown', Date.now(), nextSortOrder);
	db.prepare('UPDATE courses SET semester_id = ? WHERE semester_id IS NULL').run(semId);
}

// If no semesters at all and no courses, ensure is_active logic still works (nothing to do).

// ─── Internal helpers ─────────────────────────────────────────────────────────

function rowsToSemesterMeta(rows: SemesterRow[]): SemesterMeta[] {
	return rows.map((r) => ({
		id: r.id,
		label: r.label,
		branch: r.branch,
		semester: r.semester,
		createdAt: r.created_at,
		isActive: r.is_active === 1,
		courseCount: r.course_count
	}));
}

function getNextSemesterSortOrder(): number {
	const row = db
		.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM semesters')
		.get() as { next_order: number };
	return row.next_order;
}

function fetchCoursesBySemester(semesterId: string): Course[] {
	const courseRows = db
		.prepare(
			'SELECT id, name, full_name, color, semester_id, hide_absolute_grade, hide_relative_grade, class_size FROM courses WHERE semester_id = ? ORDER BY rowid ASC'
		)
		.all(semesterId) as CourseRow[];

	if (courseRows.length === 0) return [];

	const courseIds = courseRows.map((r) => `'${r.id}'`).join(',');

	const componentRows = db
		.prepare(
			`SELECT id, course_id, name, weight, max_score, score, best_of, sort_order, stats_mode, scale_target_id,
			 class_avg, class_median, class_max, class_std_dev
			 FROM components
			 WHERE course_id IN (${courseIds})
			 ORDER BY course_id, sort_order ASC`
		)
		.all() as ComponentRow[];

	const compIds = componentRows.map((r) => `'${r.id}'`).join(',');
	const subRows =
		compIds.length > 0
			? (db
					.prepare(
						`SELECT id, component_id, name, score, max_score, sort_order,
					 class_avg, class_median, class_max, class_std_dev, scale_target_id
					 FROM sub_items
					 WHERE component_id IN (${compIds})
					 ORDER BY component_id, sort_order ASC`
					)
					.all() as SubItemRow[])
			: [];

	const subsByComp = new Map<string, SubItem[]>();
	for (const row of subRows) {
		const subItem: SubItem = {
			id: row.id,
			name: row.name,
			score: row.score,
			maxScore: row.max_score,
			classAvg: row.class_avg,
			classMedian: row.class_median,
			classMax: row.class_max,
			classStdDev: row.class_std_dev,
			scaleTargetId: row.scale_target_id
		};

		const current = subsByComp.get(row.component_id) ?? [];
		current.push(subItem);
		subsByComp.set(row.component_id, current);
	}

	const compsByCourse = new Map<string, Component[]>();
	for (const row of componentRows) {
		const component: Component = {
			id: row.id,
			name: row.name,
			weight: row.weight,
			maxScore: row.max_score,
			score: row.score,
			bestOf: row.best_of ?? undefined,
			statsMode: row.stats_mode === 'per-sub' ? 'per-sub' : 'global',
			scaleTargetId: row.scale_target_id,
			classAvg: row.class_avg,
			classMedian: row.class_median,
			classMax: row.class_max,
			classStdDev: row.class_std_dev,
			subItems: subsByComp.get(row.id)
		};

		if (!component.subItems?.length) {
			delete component.subItems;
		}

		const current = compsByCourse.get(row.course_id) ?? [];
		current.push(component);
		compsByCourse.set(row.course_id, current);
	}

	return courseRows.map((course) => ({
		id: course.id,
		name: course.name,
		fullName: course.full_name,
		color: course.color,
		hideAbsoluteGrade: course.hide_absolute_grade === 1,
		hideRelativeGrade: course.hide_relative_grade === 1,
		classSize: course.class_size,
		components: compsByCourse.get(course.id) ?? []
	}));
}

function insertCourse(
	courseId: string,
	course: Pick<Course, 'name' | 'fullName' | 'color'>,
	semesterId: string
): void {
	db.prepare(
		'INSERT INTO courses (id, name, full_name, color, semester_id) VALUES (?, ?, ?, ?, ?)'
	).run(courseId, course.name, course.fullName, course.color, semesterId);
}

function insertComponents(courseId: string, components: Component[]): Component[] {
	const insertComponentStmt = db.prepare(
		`INSERT INTO components (
			id, course_id, name, weight, max_score, score, best_of, sort_order,
			stats_mode, scale_target_id, class_avg, class_median, class_max, class_std_dev
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	const insertSubItemStmt = db.prepare(
		`INSERT INTO sub_items (
			id, component_id, name, score, max_score, sort_order,
			class_avg, class_median, class_max, class_std_dev, scale_target_id
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);

	return components.map((component, compIdx) => {
		const componentId = crypto.randomUUID();
		insertComponentStmt.run(
			componentId,
			courseId,
			component.name,
			component.weight,
			component.maxScore,
			component.score ?? null,
			component.bestOf ?? null,
			compIdx,
			component.statsMode ?? 'global',
			component.scaleTargetId ?? null,
			component.classAvg ?? null,
			component.classMedian ?? null,
			component.classMax ?? null,
			component.classStdDev ?? null
		);

		const subItems = component.subItems?.map((subItem, subIdx) => {
			const subItemId = crypto.randomUUID();
			insertSubItemStmt.run(
				subItemId,
				componentId,
				subItem.name,
				subItem.score ?? null,
				subItem.maxScore,
				subIdx,
				subItem.classAvg ?? null,
				subItem.classMedian ?? null,
				subItem.classMax ?? null,
				subItem.classStdDev ?? null,
				subItem.scaleTargetId ?? null
			);

			return {
				id: subItemId,
				name: subItem.name,
				score: subItem.score ?? null,
				maxScore: subItem.maxScore,
				classAvg: subItem.classAvg ?? null,
				classMedian: subItem.classMedian ?? null,
				classMax: subItem.classMax ?? null,
				classStdDev: subItem.classStdDev ?? null,
				scaleTargetId: subItem.scaleTargetId ?? null
			};
		});

		return {
			id: componentId,
			name: component.name,
			weight: component.weight,
			maxScore: component.maxScore,
			score: component.score ?? null,
			bestOf: component.bestOf,
			statsMode: component.statsMode ?? 'global',
			scaleTargetId: component.scaleTargetId ?? null,
			classAvg: component.classAvg ?? null,
			classMedian: component.classMedian ?? null,
			classMax: component.classMax ?? null,
			classStdDev: component.classStdDev ?? null,
			subItems: subItems?.length ? subItems : undefined
		};
	});
}

function createCourseFromTemplateInSemester(template: Course, semesterId: string): Course {
	return db.transaction(() => {
		const courseId = crypto.randomUUID();
		insertCourse(courseId, template, semesterId);
		const components = insertComponents(courseId, template.components);

		return {
			id: courseId,
			name: template.name,
			fullName: template.fullName,
			color: template.color,
			components
		};
	})();
}

function getActiveSemesterId(): string | null {
	const row = db
		.prepare('SELECT id FROM semesters WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1')
		.get() as { id: string } | undefined;
	return row?.id ?? null;
}

// ─── Semester functions ───────────────────────────────────────────────────────

export function getAllSemesters(): SemesterMeta[] {
	const rows = db
		.prepare(
			`SELECT s.id, s.label, s.branch, s.semester, s.created_at, s.is_active, s.sort_order,
			 COUNT(c.id) as course_count
			 FROM semesters s
			 LEFT JOIN courses c ON c.semester_id = s.id
			 GROUP BY s.id
			 ORDER BY s.sort_order IS NULL ASC, s.sort_order ASC, s.created_at ASC`
		)
		.all() as SemesterRow[];
	return rowsToSemesterMeta(rows);
}

export function createSemester(
	id: string,
	label: string,
	branch: string,
	semester: string
): SemesterMeta {
	const nextSortOrder = getNextSemesterSortOrder();
	db.transaction(() => {
		db.prepare('UPDATE semesters SET is_active = 0').run();
		db.prepare(
			`INSERT INTO semesters (id, label, branch, semester, created_at, is_active, sort_order)
			 VALUES (?, ?, ?, ?, ?, 1, ?)`
		).run(id, label, branch, semester, Date.now(), nextSortOrder);
	})();

	const row = db
		.prepare(
			`SELECT s.id, s.label, s.branch, s.semester, s.created_at, s.is_active, s.sort_order,
			 COUNT(c.id) as course_count
			 FROM semesters s
			 LEFT JOIN courses c ON c.semester_id = s.id
			 WHERE s.id = ?
			 GROUP BY s.id`
		)
		.get(id) as SemesterRow;

	return rowsToSemesterMeta([row])[0];
}

export function setActiveSemester(id: string): void {
	db.transaction(() => {
		db.prepare('UPDATE semesters SET is_active = 0').run();
		db.prepare('UPDATE semesters SET is_active = 1 WHERE id = ?').run(id);
	})();
}

export function renameSemester(id: string, label: string): void {
	db.prepare('UPDATE semesters SET label = ? WHERE id = ?').run(label, id);
}

export function reorderSemesters(ids: string[]): void {
	const existingIds = (
		db
			.prepare(
				'SELECT id FROM semesters ORDER BY sort_order IS NULL ASC, sort_order ASC, created_at ASC'
			)
			.all() as { id: string }[]
	).map((row) => row.id);

	const existingIdSet = new Set(existingIds);
	const validIds = ids.filter((id) => existingIdSet.has(id));
	const validIdSet = new Set(validIds);
	const orderedIds = [...validIds, ...existingIds.filter((id) => !validIdSet.has(id))];
	const updateSemesterSortOrder = db.prepare('UPDATE semesters SET sort_order = ? WHERE id = ?');

	db.transaction(() => {
		orderedIds.forEach((id, index) => {
			updateSemesterSortOrder.run(index, id);
		});
	})();
}

export function deleteSemester(id: string): void {
	db.transaction(() => {
		// courses cascade-delete their components → sub_items via FK
		db.prepare('DELETE FROM courses WHERE semester_id = ?').run(id);
		db.prepare('DELETE FROM semesters WHERE id = ?').run(id);
	})();
}

// ─── Course functions ─────────────────────────────────────────────────────────

export async function seedByBranch(
	selectedCourses: Course[],
	semesterId: string
): Promise<Course[]> {
	const seeded: Course[] = [];

	for (const selectedCourse of selectedCourses) {
		const defaultMatch = DEFAULT_COURSES.find((course) => course.id === selectedCourse.id);

		if (defaultMatch && defaultMatch.components.length > 0) {
			seeded.push(
				createCourseFromTemplateInSemester(
					{
						...defaultMatch,
						name: selectedCourse.name,
						fullName: selectedCourse.fullName,
						color: selectedCourse.color
					},
					semesterId
				)
			);
			continue;
		}

		if (selectedCourse.components.length > 0) {
			seeded.push(createCourseFromTemplateInSemester(selectedCourse, semesterId));
			continue;
		}

		seeded.push(
			await addCourseWithDefaults(selectedCourse.name, selectedCourse.fullName, selectedCourse.color, semesterId)
		);
	}

	return seeded;
}

export async function getCoursesBySemester(semesterId: string): Promise<Course[]> {
	return fetchCoursesBySemester(semesterId);
}

/** Fallback for when no semesterId is provided — uses the active semester */
export async function getAllCourses(): Promise<Course[]> {
	const activeSemId = getActiveSemesterId();
	if (!activeSemId) return [];
	return fetchCoursesBySemester(activeSemId);
}

export async function addCourseWithDefaults(
	name: string,
	fullName: string,
	color: string,
	semesterId?: string
): Promise<Course> {
	const semId = semesterId ?? getActiveSemesterId();
	if (!semId) throw new Error('No active semester');

	return createCourseFromTemplateInSemester(
		{
			id: crypto.randomUUID(),
			name,
			fullName,
			color,
			components: [
				{
					id: crypto.randomUUID(),
					name: 'Quiz',
					weight: 0,
					maxScore: 100,
					score: null,
					subItems: [
						{ id: crypto.randomUUID(), name: 'Quiz 1', score: null, maxScore: 100 },
						{ id: crypto.randomUUID(), name: 'Quiz 2', score: null, maxScore: 100 }
					]
				},
				{
					id: crypto.randomUUID(),
					name: 'Midsem',
					weight: 0,
					maxScore: 100,
					score: null
				},
				{
					id: crypto.randomUUID(),
					name: 'Endsem',
					weight: 0,
					maxScore: 100,
					score: null
				}
			]
		},
		semId
	);
}

export async function addCourseWithComponents(
	template: Course,
	semesterId?: string
): Promise<Course> {
	const semId = semesterId ?? getActiveSemesterId();
	if (!semId) throw new Error('No active semester');
	return createCourseFromTemplateInSemester(template, semId);
}

export async function deleteCourse(courseId: string): Promise<void> {
	db.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
}

export function updateCourseGradeVisibility(
	id: string,
	field: 'hideAbsoluteGrade' | 'hideRelativeGrade',
	hidden: boolean
): boolean {
	const column = field === 'hideAbsoluteGrade' ? 'hide_absolute_grade' : 'hide_relative_grade';
	return db.prepare(`UPDATE courses SET ${column} = ? WHERE id = ?`).run(hidden ? 1 : 0, id).changes > 0;
}

export function updateCourseClassSize(id: string, classSize: number | null): boolean {
	return db.prepare('UPDATE courses SET class_size = ? WHERE id = ?').run(classSize, id).changes > 0;
}

const COMP_COL_MAP: Record<string, string> = {
	score: 'score',
	weight: 'weight',
	maxScore: 'max_score',
	name: 'name',
	bestOf: 'best_of',
	statsMode: 'stats_mode',
	scaleTargetId: 'scale_target_id',
	classAvg: 'class_avg',
	classMedian: 'class_median',
	classMax: 'class_max',
	classStdDev: 'class_std_dev'
};

export async function updateComponentField(id: string, field: string, value: unknown): Promise<void> {
	const column = COMP_COL_MAP[field];
	if (!column) return;

	db.prepare(`UPDATE components SET ${column} = ? WHERE id = ?`).run(value ?? null, id);
}

export async function addComponent(courseId: string, id: string, name: string): Promise<void> {
	const row = db
		.prepare('SELECT sort_order FROM components WHERE course_id = ? ORDER BY sort_order DESC LIMIT 1')
		.get(courseId) as { sort_order: number } | undefined;
	const nextOrder = row ? row.sort_order + 1 : 0;

	db.prepare(
		`INSERT INTO components (
			id, course_id, name, weight, max_score, score, best_of, sort_order,
			stats_mode, scale_target_id, class_avg, class_median, class_max, class_std_dev
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(id, courseId, name, 0, 100, null, null, nextOrder, 'global', null, null, null, null, null);
}

export async function deleteComponent(id: string): Promise<void> {
	db.prepare('DELETE FROM components WHERE id = ?').run(id);
}

export function reorderComponents(courseId: string, ids: string[]): void {
	const existingIds = (db.prepare(
		'SELECT id FROM components WHERE course_id = ? ORDER BY sort_order ASC'
	).all(courseId) as { id: string }[]).map((row) => row.id);
	const existingIdSet = new Set(existingIds);
	const validIds = [...new Set(ids)].filter((id) => existingIdSet.has(id));
	const validIdSet = new Set(validIds);
	const orderedIds = [...validIds, ...existingIds.filter((id) => !validIdSet.has(id))];
	const updateOrder = db.prepare('UPDATE components SET sort_order = ? WHERE id = ? AND course_id = ?');
	db.transaction(() => {
		orderedIds.forEach((id, index) => updateOrder.run(index, id, courseId));
	})();
}

const SUB_COL_MAP: Record<string, string> = {
	score: 'score',
	maxScore: 'max_score',
	name: 'name',
	classAvg: 'class_avg',
	classMedian: 'class_median',
	classMax: 'class_max',
	classStdDev: 'class_std_dev',
	scaleTargetId: 'scale_target_id'
};

export async function updateSubItemField(id: string, field: string, value: unknown): Promise<void> {
	const column = SUB_COL_MAP[field];
	if (!column) return;

	db.prepare(`UPDATE sub_items SET ${column} = ? WHERE id = ?`).run(value ?? null, id);
}

export async function addSubItem(
	componentId: string,
	id: string,
	name: string,
	maxScore: number
): Promise<void> {
	const row = db
		.prepare('SELECT sort_order FROM sub_items WHERE component_id = ? ORDER BY sort_order DESC LIMIT 1')
		.get(componentId) as { sort_order: number } | undefined;
	const nextOrder = row ? row.sort_order + 1 : 0;

	db.prepare(
		`INSERT INTO sub_items (
			id, component_id, name, score, max_score, sort_order,
			class_avg, class_median, class_max, class_std_dev, scale_target_id
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(id, componentId, name, null, maxScore, nextOrder, null, null, null, null, null);
}

export async function deleteSubItem(id: string): Promise<void> {
	db.prepare('DELETE FROM sub_items WHERE id = ?').run(id);
}

export async function getSubItemCount(componentId: string): Promise<number> {
	const row = db
		.prepare('SELECT COUNT(*) as count FROM sub_items WHERE component_id = ?')
		.get(componentId) as { count: number };

	return row.count;
}

const resetCourseTx = db.transaction((courseId: string, original: Course) => {
	db.prepare('DELETE FROM components WHERE course_id = ?').run(courseId);
	insertComponents(courseId, original.components);
});

export async function resetCourse(courseId: string): Promise<void> {
	const row = db.prepare('SELECT name FROM courses WHERE id = ?').get(courseId) as { name: string } | undefined;
	if (!row) return;

	let original = DEFAULT_COURSES.find((course) => course.name === row.name);
	if (!original) {
		for (const branch of Object.values(SEM_DATA)) {
			for (const courses of Object.values(branch)) {
				const match = courses.find((course) => course.name === row.name);
				if (match) {
					original = match;
					break;
				}
			}

			if (original) break;
		}
	}

	if (!original) return;
	resetCourseTx(courseId, original);
}
