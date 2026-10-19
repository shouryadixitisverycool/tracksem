import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { building } from '$app/environment';
import { COURSE_CREDITS, DEFAULT_COURSES, catalogIdForName, findTemplate } from '$lib/data/courses';
import { wouldCreateScaleCycle } from '$lib/gradeMath';
import type { Course, Component, SubItem, SemesterMeta } from '$lib/types';
import { COMPONENT_FIELDS, COURSE_FIELDS, SUB_ITEM_FIELDS, validateField } from './validation';

type DB = Database.Database;

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
	credits: number | null;
	official_grade: string | null;
	template_id: string | null;
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
	class_full_pct: number | null;
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
	class_full_pct: number | null;
	scale_target_id: string | null;
};

export type Result<T = undefined> =
	| (T extends undefined ? { ok: true } : { ok: true; value: T })
	| { ok: false; status: number; error: string };

const failure = (status: number, error: string) => ({ ok: false as const, status, error });

// ─── Connection ──────────────────────────────────────────────────────────────

/** TRACKSEM_DB_PATH, else data/tracksem.db in production and data/dev.db otherwise */
export function resolveDbPath(): string {
	const configured = process.env.TRACKSEM_DB_PATH?.trim();
	if (configured) return resolve(configured);
	const file = process.env.NODE_ENV === 'production' ? 'tracksem.db' : 'dev.db';
	return resolve(process.cwd(), 'data', file);
}

let instance: DB | null = null;

function getDb(): DB {
	if (instance) return instance;
	if (building) throw new Error('The database must not be opened during the build');

	const dbPath = resolveDbPath();
	mkdirSync(dirname(dbPath), { recursive: true });
	const db = new Database(dbPath);
	db.pragma('foreign_keys = ON');
	db.pragma('journal_mode = WAL');
	migrate(db);
	instance = db;
	return db;
}

// ─── Schema & migrations ─────────────────────────────────────────────────────

function columnNames(db: DB, table: string): Set<string> {
	return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
}

function addColumnIfMissing(db: DB, table: string, column: string, definition: string): void {
	if (!columnNames(db, table).has(column)) {
		db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
	}
}

/** Pre-versioning migrations, detected via table_info so they work on any old database */
function legacyMigrations(db: DB): void {
	addColumnIfMissing(db, 'semesters', 'sort_order', 'INTEGER');
	const missingOrder = db
		.prepare('SELECT id FROM semesters WHERE sort_order IS NULL ORDER BY created_at ASC')
		.all() as { id: string }[];
	if (missingOrder.length > 0) {
		const update = db.prepare('UPDATE semesters SET sort_order = ? WHERE id = ?');
		db.transaction(() => missingOrder.forEach((semester, index) => update.run(index, semester.id)))();
	}

	addColumnIfMissing(db, 'components', 'scale_target_id', 'TEXT');
	addColumnIfMissing(db, 'sub_items', 'scale_target_id', 'TEXT');
	addColumnIfMissing(db, 'courses', 'hide_absolute_grade', 'INTEGER NOT NULL DEFAULT 0');
	addColumnIfMissing(db, 'courses', 'hide_relative_grade', 'INTEGER NOT NULL DEFAULT 0');
	addColumnIfMissing(db, 'courses', 'class_size', 'INTEGER');
	addColumnIfMissing(db, 'courses', 'semester_id', 'TEXT REFERENCES semesters(id)');

	const orphanCount = (
		db.prepare('SELECT COUNT(*) as c FROM courses WHERE semester_id IS NULL').get() as { c: number }
	).c;
	if (orphanCount > 0) {
		const semId = crypto.randomUUID();
		db.prepare(
			`INSERT INTO semesters (id, label, branch, semester, created_at, is_active, sort_order)
			 VALUES (?, ?, ?, ?, ?, 1, ?)`
		).run(semId, 'Semester 1', 'unknown', 'unknown', Date.now(), nextSemesterSortOrder(db));
		db.prepare('UPDATE courses SET semester_id = ? WHERE semester_id IS NULL').run(semId);
	}
}

/** Numbered migrations tracked in PRAGMA user_version; each must be idempotent */
const MIGRATIONS: ((db: DB) => void)[] = [
	// 1: template ids, credits, official grades, "full marks %" class stat
	(db) => {
		addColumnIfMissing(db, 'courses', 'template_id', 'TEXT');
		addColumnIfMissing(db, 'courses', 'credits', 'REAL');
		addColumnIfMissing(db, 'courses', 'official_grade', 'TEXT');
		addColumnIfMissing(db, 'components', 'class_full_pct', 'REAL');
		addColumnIfMissing(db, 'sub_items', 'class_full_pct', 'REAL');

		const rows = db.prepare('SELECT id, name, template_id, credits FROM courses').all() as {
			id: string;
			name: string;
			template_id: string | null;
			credits: number | null;
		}[];
		const setTemplate = db.prepare('UPDATE courses SET template_id = ? WHERE id = ? AND template_id IS NULL');
		const setCredits = db.prepare('UPDATE courses SET credits = ? WHERE id = ? AND credits IS NULL');
		for (const row of rows) {
			const templateId = row.template_id ?? catalogIdForName(row.name) ?? null;
			if (!templateId) continue;
			if (!row.template_id) setTemplate.run(templateId, row.id);
			const credits = COURSE_CREDITS[templateId];
			if (row.credits === null && credits !== undefined) setCredits.run(credits, row.id);
		}
	}
];

function migrate(db: DB): void {
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

	legacyMigrations(db);

	const current = db.pragma('user_version', { simple: true }) as number;
	for (let version = current; version < MIGRATIONS.length; version++) {
		db.transaction(() => {
			MIGRATIONS[version](db);
			db.pragma(`user_version = ${version + 1}`);
		})();
	}
}

// ─── Row mapping ─────────────────────────────────────────────────────────────

const COURSE_COLUMN_NAMES = [
	'id', 'name', 'full_name', 'color', 'semester_id', 'hide_absolute_grade', 'hide_relative_grade',
	'class_size', 'credits', 'official_grade', 'template_id'
];
const COURSE_COLUMNS = COURSE_COLUMN_NAMES.join(', ');

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

/** Load full course trees for course rows, using parameterized json_each id lists */
function hydrateCourses(db: DB, courseRows: CourseRow[]): Course[] {
	if (courseRows.length === 0) return [];

	const componentRows = db
		.prepare(
			`SELECT id, course_id, name, weight, max_score, score, best_of, sort_order, stats_mode, scale_target_id,
			 class_avg, class_median, class_max, class_std_dev, class_full_pct
			 FROM components
			 WHERE course_id IN (SELECT value FROM json_each(?))
			 ORDER BY course_id, sort_order ASC`
		)
		.all(JSON.stringify(courseRows.map((r) => r.id))) as ComponentRow[];

	const subRows =
		componentRows.length > 0
			? (db
					.prepare(
						`SELECT id, component_id, name, score, max_score, sort_order,
						 class_avg, class_median, class_max, class_std_dev, class_full_pct, scale_target_id
						 FROM sub_items
						 WHERE component_id IN (SELECT value FROM json_each(?))
						 ORDER BY component_id, sort_order ASC`
					)
					.all(JSON.stringify(componentRows.map((r) => r.id))) as SubItemRow[])
			: [];

	const subsByComp = new Map<string, SubItem[]>();
	for (const row of subRows) {
		const list = subsByComp.get(row.component_id) ?? [];
		list.push({
			id: row.id,
			name: row.name,
			score: row.score,
			maxScore: row.max_score,
			classAvg: row.class_avg,
			classMedian: row.class_median,
			classMax: row.class_max,
			classStdDev: row.class_std_dev,
			classFullPct: row.class_full_pct,
			scaleTargetId: row.scale_target_id
		});
		subsByComp.set(row.component_id, list);
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
			classFullPct: row.class_full_pct,
			subItems: subsByComp.get(row.id)
		};
		if (!component.subItems?.length) delete component.subItems;

		const list = compsByCourse.get(row.course_id) ?? [];
		list.push(component);
		compsByCourse.set(row.course_id, list);
	}

	return courseRows.map((course) => ({
		id: course.id,
		name: course.name,
		fullName: course.full_name,
		color: course.color,
		semesterId: course.semester_id,
		hideAbsoluteGrade: course.hide_absolute_grade === 1,
		hideRelativeGrade: course.hide_relative_grade === 1,
		classSize: course.class_size,
		credits: course.credits,
		officialGrade: course.official_grade,
		templateId: course.template_id,
		components: compsByCourse.get(course.id) ?? []
	}));
}

// ─── Insert helpers ──────────────────────────────────────────────────────────

type CourseInsert = Pick<Course, 'name' | 'fullName' | 'color'> &
	Partial<Pick<Course, 'credits' | 'officialGrade' | 'templateId' | 'classSize' | 'hideAbsoluteGrade' | 'hideRelativeGrade'>>;

function insertCourse(db: DB, courseId: string, course: CourseInsert, semesterId: string): void {
	db.prepare(
		`INSERT INTO courses (id, name, full_name, color, semester_id, hide_absolute_grade, hide_relative_grade,
		 class_size, credits, official_grade, template_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		courseId,
		course.name,
		course.fullName,
		course.color,
		semesterId,
		course.hideAbsoluteGrade ? 1 : 0,
		course.hideRelativeGrade ? 1 : 0,
		course.classSize ?? null,
		course.credits ?? null,
		course.officialGrade ?? null,
		course.templateId ?? null
	);
}

/** Insert components with fresh ids; scale targets are remapped to the new ids (or dropped) */
function insertComponents(db: DB, courseId: string, components: Component[]): void {
	const idMap = new Map<string, string>();
	for (const component of components) {
		idMap.set(component.id, crypto.randomUUID());
		for (const sub of component.subItems ?? []) idMap.set(sub.id, crypto.randomUUID());
	}
	const mapTarget = (target: string | null | undefined) => (target ? (idMap.get(target) ?? null) : null);

	const insertComponentStmt = db.prepare(
		`INSERT INTO components (
			id, course_id, name, weight, max_score, score, best_of, sort_order,
			stats_mode, scale_target_id, class_avg, class_median, class_max, class_std_dev, class_full_pct
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	const insertSubItemStmt = db.prepare(
		`INSERT INTO sub_items (
			id, component_id, name, score, max_score, sort_order,
			class_avg, class_median, class_max, class_std_dev, class_full_pct, scale_target_id
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);

	components.forEach((component, compIdx) => {
		const componentId = idMap.get(component.id)!;
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
			mapTarget(component.scaleTargetId),
			component.classAvg ?? null,
			component.classMedian ?? null,
			component.classMax ?? null,
			component.classStdDev ?? null,
			component.classFullPct ?? null
		);

		component.subItems?.forEach((subItem, subIdx) => {
			insertSubItemStmt.run(
				idMap.get(subItem.id)!,
				componentId,
				subItem.name,
				subItem.score ?? null,
				subItem.maxScore,
				subIdx,
				subItem.classAvg ?? null,
				subItem.classMedian ?? null,
				subItem.classMax ?? null,
				subItem.classStdDev ?? null,
				subItem.classFullPct ?? null,
				mapTarget(subItem.scaleTargetId)
			);
		});
	});
}

function defaultComponents(): Component[] {
	return [
		{
			id: 'quiz',
			name: 'Quiz',
			weight: 0,
			maxScore: 100,
			score: null,
			subItems: [
				{ id: 'quiz-1', name: 'Quiz 1', score: null, maxScore: 100 },
				{ id: 'quiz-2', name: 'Quiz 2', score: null, maxScore: 100 }
			]
		},
		{ id: 'midsem', name: 'Midsem', weight: 0, maxScore: 100, score: null },
		{ id: 'endsem', name: 'Endsem', weight: 0, maxScore: 100, score: null }
	];
}

function createCourse(db: DB, course: CourseInsert, components: Component[], semesterId: string): string {
	const courseId = crypto.randomUUID();
	insertCourse(db, courseId, course, semesterId);
	insertComponents(db, courseId, components);
	return courseId;
}

function nextSemesterSortOrder(db: DB): number {
	const row = db
		.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM semesters')
		.get() as { next_order: number };
	return row.next_order;
}

function getActiveSemesterId(db: DB): string | null {
	const row = db
		.prepare('SELECT id FROM semesters WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1')
		.get() as { id: string } | undefined;
	return row?.id ?? null;
}

function getSemesterMeta(db: DB, id: string): SemesterMeta | null {
	const row = db
		.prepare(
			`SELECT s.id, s.label, s.branch, s.semester, s.created_at, s.is_active, s.sort_order,
			 COUNT(c.id) as course_count
			 FROM semesters s
			 LEFT JOIN courses c ON c.semester_id = s.id
			 WHERE s.id = ?
			 GROUP BY s.id`
		)
		.get(id) as SemesterRow | undefined;
	return row ? rowsToSemesterMeta([row])[0] : null;
}

function insertSemester(db: DB, id: string, label: string, branch: string, semester: string, active: boolean): void {
	if (active) db.prepare('UPDATE semesters SET is_active = 0').run();
	db.prepare(
		`INSERT INTO semesters (id, label, branch, semester, created_at, is_active, sort_order)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`
	).run(id, label, branch, semester, Date.now(), active ? 1 : 0, nextSemesterSortOrder(db));
}

// ─── Semester functions ──────────────────────────────────────────────────────

export function getAllSemesters(): SemesterMeta[] {
	const rows = getDb()
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

export function semesterExists(id: string): boolean {
	return getDb().prepare('SELECT 1 FROM semesters WHERE id = ?').get(id) !== undefined;
}

export function createSemester(id: string, label: string, branch: string, semester: string): SemesterMeta {
	const db = getDb();
	db.transaction(() => insertSemester(db, id, label, branch, semester, true))();
	return getSemesterMeta(db, id)!;
}

/** Create a semester and seed the given catalog courses in a single transaction */
export function createSemesterWithCourses(
	id: string,
	label: string,
	branch: string,
	semester: string,
	catalogCourses: Course[]
): { semester: SemesterMeta; courses: Course[] } {
	const db = getDb();
	db.transaction(() => {
		insertSemester(db, id, label, branch, semester, true);
		seedCourses(db, catalogCourses, id);
	})();
	return { semester: getSemesterMeta(db, id)!, courses: getCoursesBySemester(id) };
}

export function setActiveSemester(id: string): boolean {
	const db = getDb();
	return db.transaction(() => {
		if (!semesterExists(id)) return false;
		db.prepare('UPDATE semesters SET is_active = 0').run();
		db.prepare('UPDATE semesters SET is_active = 1 WHERE id = ?').run(id);
		return true;
	})();
}

export function renameSemester(id: string, label: string): boolean {
	return getDb().prepare('UPDATE semesters SET label = ? WHERE id = ?').run(label, id).changes > 0;
}

export function reorderSemesters(ids: string[]): void {
	const db = getDb();
	const existingIds = (
		db
			.prepare('SELECT id FROM semesters ORDER BY sort_order IS NULL ASC, sort_order ASC, created_at ASC')
			.all() as { id: string }[]
	).map((row) => row.id);

	const existingIdSet = new Set(existingIds);
	const validIds = [...new Set(ids)].filter((id) => existingIdSet.has(id));
	const validIdSet = new Set(validIds);
	const orderedIds = [...validIds, ...existingIds.filter((id) => !validIdSet.has(id))];
	const update = db.prepare('UPDATE semesters SET sort_order = ? WHERE id = ?');
	db.transaction(() => orderedIds.forEach((id, index) => update.run(index, id)))();
}

export function deleteSemester(id: string): void {
	const db = getDb();
	db.transaction(() => {
		// courses cascade-delete their components → sub_items via FK
		db.prepare('DELETE FROM courses WHERE semester_id = ?').run(id);
		db.prepare('DELETE FROM semesters WHERE id = ?').run(id);
	})();
}

// ─── Course functions ────────────────────────────────────────────────────────

function seedCourses(db: DB, selectedCourses: Course[], semesterId: string): void {
	for (const selected of selectedCourses) {
		const template = DEFAULT_COURSES.find((course) => course.id === selected.id);
		const components = template?.components.length
			? template.components
			: selected.components.length
				? selected.components
				: defaultComponents();
		createCourse(
			db,
			{
				name: selected.name,
				fullName: selected.fullName,
				color: selected.color,
				credits: selected.credits ?? COURSE_CREDITS[selected.id] ?? null,
				templateId: selected.id
			},
			components,
			semesterId
		);
	}
}

/** Seed catalog courses into an existing semester */
export function seedByBranch(selectedCourses: Course[], semesterId: string): Course[] {
	const db = getDb();
	db.transaction(() => seedCourses(db, selectedCourses, semesterId))();
	return getCoursesBySemester(semesterId);
}

export function getCoursesBySemester(semesterId: string): Course[] {
	const db = getDb();
	const rows = db
		.prepare(`SELECT ${COURSE_COLUMNS} FROM courses WHERE semester_id = ? ORDER BY rowid ASC`)
		.all(semesterId) as CourseRow[];
	return hydrateCourses(db, rows);
}

/** Courses of the active semester */
export function getAllCourses(): Course[] {
	const activeSemId = getActiveSemesterId(getDb());
	return activeSemId ? getCoursesBySemester(activeSemId) : [];
}

/** Courses of every semester, each tagged with its semesterId */
export function getEveryCourse(): Course[] {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT ${COURSE_COLUMN_NAMES.map((column) => `c.${column}`).join(', ')}
			 FROM courses c JOIN semesters s ON s.id = c.semester_id
			 ORDER BY s.sort_order ASC, c.rowid ASC`
		)
		.all() as CourseRow[];
	return hydrateCourses(db, rows);
}

export function getCourse(id: string): Course | null {
	const db = getDb();
	const row = db.prepare(`SELECT ${COURSE_COLUMNS} FROM courses WHERE id = ?`).get(id) as CourseRow | undefined;
	return row ? hydrateCourses(db, [row])[0] : null;
}

export function addCourseWithDefaults(
	name: string,
	fullName: string,
	color: string,
	semesterId?: string
): Result<Course> {
	const db = getDb();
	const semId = semesterId ?? getActiveSemesterId(db);
	if (!semId || !semesterExists(semId)) return failure(400, 'Semester not found');
	const courseId = db.transaction(() => createCourse(db, { name, fullName, color }, defaultComponents(), semId))();
	return { ok: true, value: getCourse(courseId)! };
}

export function deleteCourse(courseId: string): void {
	getDb().prepare('DELETE FROM courses WHERE id = ?').run(courseId);
}

const COURSE_COL_MAP: Record<string, string> = {
	hideAbsoluteGrade: 'hide_absolute_grade',
	hideRelativeGrade: 'hide_relative_grade',
	classSize: 'class_size',
	credits: 'credits',
	officialGrade: 'official_grade'
};

export function updateCourseGradeVisibility(
	id: string,
	field: 'hideAbsoluteGrade' | 'hideRelativeGrade',
	hidden: boolean
): boolean {
	return getDb().prepare(`UPDATE courses SET ${COURSE_COL_MAP[field]} = ? WHERE id = ?`).run(hidden ? 1 : 0, id).changes > 0;
}

export function updateCourseField(id: string, field: string, value: unknown): Result {
	const validated = validateField(COURSE_FIELDS, field, value);
	if (!validated.ok) return failure(400, validated.error);
	const changes = getDb()
		.prepare(`UPDATE courses SET ${COURSE_COL_MAP[field]} = ? WHERE id = ?`)
		.run(validated.value, id).changes;
	return changes > 0 ? { ok: true } : failure(404, 'Course not found');
}

export function resetCourse(courseId: string): Result<Course> {
	const db = getDb();
	const row = db.prepare('SELECT name, template_id FROM courses WHERE id = ?').get(courseId) as
		| { name: string; template_id: string | null }
		| undefined;
	if (!row) return failure(404, 'Course not found');

	const templateId = row.template_id ?? catalogIdForName(row.name) ?? null;
	const template =
		(templateId ? findTemplate(templateId) : undefined) ??
		DEFAULT_COURSES.find((course) => course.name === row.name);
	if (!template) return failure(400, 'This course was not created from a catalog template, so there is nothing to reset to');
	if (template.components.length === 0) {
		return failure(400, 'The catalog has no component breakdown for this course, so reset would delete everything');
	}

	db.transaction(() => {
		db.prepare('DELETE FROM components WHERE course_id = ?').run(courseId);
		insertComponents(db, courseId, template.components);
		if (!row.template_id) db.prepare('UPDATE courses SET template_id = ? WHERE id = ?').run(template.id, courseId);
	})();
	return { ok: true, value: getCourse(courseId)! };
}

// ─── Component & sub-item functions ──────────────────────────────────────────

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
	classStdDev: 'class_std_dev',
	classFullPct: 'class_full_pct'
};

const SUB_COL_MAP: Record<string, string> = {
	score: 'score',
	maxScore: 'max_score',
	name: 'name',
	classAvg: 'class_avg',
	classMedian: 'class_median',
	classMax: 'class_max',
	classStdDev: 'class_std_dev',
	classFullPct: 'class_full_pct',
	scaleTargetId: 'scale_target_id'
};

function checkScaleTarget(db: DB, kind: 'component' | 'sub', sourceId: string, targetId: string): Result {
	const courseRow = (
		kind === 'component'
			? db.prepare('SELECT course_id FROM components WHERE id = ?').get(sourceId)
			: db
					.prepare('SELECT c.course_id FROM sub_items s JOIN components c ON c.id = s.component_id WHERE s.id = ?')
					.get(sourceId)
	) as { course_id: string } | undefined;
	if (!courseRow) return failure(404, `${kind === 'component' ? 'Component' : 'Sub-item'} not found`);

	const course = getCourse(courseRow.course_id)!;
	if (targetId === sourceId) return failure(400, 'An item cannot be scaled to itself');

	const owner =
		kind === 'component'
			? course.components.find((comp) => comp.id === sourceId)
			: course.components.find((comp) => comp.subItems?.some((sub) => sub.id === sourceId));
	if (kind === 'component' && owner?.subItems?.some((sub) => sub.id === targetId)) {
		return failure(400, 'A component cannot be scaled to its own sub-items');
	}
	if (kind === 'sub' && owner?.id === targetId) return failure(400, 'A sub-item cannot be scaled to its own component');

	const exists = course.components.some(
		(comp) => comp.id === targetId || comp.subItems?.some((sub) => sub.id === targetId)
	);
	if (!exists) return failure(400, 'Scale target must be in the same course');
	if (wouldCreateScaleCycle(course, sourceId, targetId)) return failure(400, 'That scale target would create a cycle');
	return { ok: true };
}

export function updateComponentField(id: string, field: string, value: unknown): Result {
	const db = getDb();
	const validated = validateField(COMPONENT_FIELDS, field, value);
	if (!validated.ok) return failure(400, validated.error);

	if (field === 'scaleTargetId' && validated.value !== null) {
		const check = checkScaleTarget(db, 'component', id, validated.value as string);
		if (!check.ok) return check;
	}

	const changes = db.prepare(`UPDATE components SET ${COMP_COL_MAP[field]} = ? WHERE id = ?`).run(validated.value, id).changes;
	return changes > 0 ? { ok: true } : failure(404, 'Component not found');
}

export function addComponent(courseId: string, id: string, name: string): Result {
	const db = getDb();
	if (!db.prepare('SELECT 1 FROM courses WHERE id = ?').get(courseId)) return failure(404, 'Course not found');
	if (db.prepare('SELECT 1 FROM components WHERE id = ?').get(id)) return failure(409, 'Component id already exists');

	const row = db
		.prepare('SELECT sort_order FROM components WHERE course_id = ? ORDER BY sort_order DESC LIMIT 1')
		.get(courseId) as { sort_order: number } | undefined;
	db.prepare(
		`INSERT INTO components (id, course_id, name, weight, max_score, score, best_of, sort_order, stats_mode)
		 VALUES (?, ?, ?, 0, 100, NULL, NULL, ?, 'global')`
	).run(id, courseId, name, row ? row.sort_order + 1 : 0);
	return { ok: true };
}

const clearScaleRefs = (db: DB, ids: string[]) => {
	const json = JSON.stringify(ids);
	db.prepare('UPDATE components SET scale_target_id = NULL WHERE scale_target_id IN (SELECT value FROM json_each(?))').run(json);
	db.prepare('UPDATE sub_items SET scale_target_id = NULL WHERE scale_target_id IN (SELECT value FROM json_each(?))').run(json);
};

/** Delete a component and clear any scale targets that pointed at it or its sub-items */
export function deleteComponent(id: string): void {
	const db = getDb();
	db.transaction(() => {
		const subIds = (db.prepare('SELECT id FROM sub_items WHERE component_id = ?').all(id) as { id: string }[]).map(
			(row) => row.id
		);
		clearScaleRefs(db, [id, ...subIds]);
		db.prepare('DELETE FROM components WHERE id = ?').run(id);
	})();
}

export function reorderComponents(courseId: string, ids: string[]): void {
	const db = getDb();
	const existingIds = (
		db.prepare('SELECT id FROM components WHERE course_id = ? ORDER BY sort_order ASC').all(courseId) as { id: string }[]
	).map((row) => row.id);
	const existingIdSet = new Set(existingIds);
	const validIds = [...new Set(ids)].filter((id) => existingIdSet.has(id));
	const validIdSet = new Set(validIds);
	const orderedIds = [...validIds, ...existingIds.filter((id) => !validIdSet.has(id))];
	const updateOrder = db.prepare('UPDATE components SET sort_order = ? WHERE id = ? AND course_id = ?');
	db.transaction(() => orderedIds.forEach((id, index) => updateOrder.run(index, id, courseId)))();
}

export function updateSubItemField(id: string, field: string, value: unknown): Result {
	const db = getDb();
	const validated = validateField(SUB_ITEM_FIELDS, field, value);
	if (!validated.ok) return failure(400, validated.error);

	if (field === 'scaleTargetId' && validated.value !== null) {
		const check = checkScaleTarget(db, 'sub', id, validated.value as string);
		if (!check.ok) return check;
	}

	const changes = db.prepare(`UPDATE sub_items SET ${SUB_COL_MAP[field]} = ? WHERE id = ?`).run(validated.value, id).changes;
	return changes > 0 ? { ok: true } : failure(404, 'Sub-item not found');
}

export function addSubItem(componentId: string, id: string, name: string, maxScore: number): Result {
	const db = getDb();
	if (!db.prepare('SELECT 1 FROM components WHERE id = ?').get(componentId)) return failure(404, 'Component not found');
	if (db.prepare('SELECT 1 FROM sub_items WHERE id = ?').get(id)) return failure(409, 'Sub-item id already exists');

	const row = db
		.prepare('SELECT sort_order FROM sub_items WHERE component_id = ? ORDER BY sort_order DESC LIMIT 1')
		.get(componentId) as { sort_order: number } | undefined;
	db.prepare(
		`INSERT INTO sub_items (id, component_id, name, score, max_score, sort_order)
		 VALUES (?, ?, ?, NULL, ?, ?)`
	).run(id, componentId, name, maxScore, row ? row.sort_order + 1 : 0);
	return { ok: true };
}

export function deleteSubItem(id: string): void {
	const db = getDb();
	db.transaction(() => {
		clearScaleRefs(db, [id]);
		db.prepare('DELETE FROM sub_items WHERE id = ?').run(id);
	})();
}

export function getSubItemCount(componentId: string): number {
	const row = getDb()
		.prepare('SELECT COUNT(*) as count FROM sub_items WHERE component_id = ?')
		.get(componentId) as { count: number };
	return row.count;
}

// ─── Export / import / backup ────────────────────────────────────────────────

export type ExportedSemester = Pick<SemesterMeta, 'label' | 'branch' | 'semester' | 'isActive'> & {
	id: string;
	courses: Course[];
};

export type ExportData = {
	app: 'tracksem';
	version: 1;
	exportedAt: string;
	semesters: ExportedSemester[];
};

export function getExportData(): ExportData {
	const courses = getEveryCourse();
	return {
		app: 'tracksem',
		version: 1,
		exportedAt: new Date().toISOString(),
		semesters: getAllSemesters().map((semester) => ({
			id: semester.id,
			label: semester.label,
			branch: semester.branch,
			semester: semester.semester,
			isActive: semester.isActive,
			courses: courses.filter((course) => course.semesterId === semester.id)
		}))
	};
}

export type ImportSemester = { label: string; branch: string; semester: string; courses: Course[] };

/** Import semesters as new rows with fresh ids; never touches existing data */
export function importSemesters(semesters: ImportSemester[]): SemesterMeta[] {
	const db = getDb();
	const ids = db.transaction(() => {
		const hadSemesters = getActiveSemesterId(db) !== null;
		return semesters.map((semester, index) => {
			const id = crypto.randomUUID();
			insertSemester(db, id, semester.label, semester.branch, semester.semester, !hadSemesters && index === 0);
			for (const course of semester.courses) createCourse(db, course, course.components, id);
			return id;
		});
	})();
	return ids.map((id) => getSemesterMeta(db, id)!);
}

/** Consistent online snapshot (includes WAL contents) written to `destination` */
export async function backupDatabase(destination: string): Promise<void> {
	await getDb().backup(destination);
}
