import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { building } from '$app/environment';
import { COURSE_CREDITS, DEFAULT_COURSES, catalogIdForName, findTemplate } from '$lib/data/courses';
import { wouldCreateScaleCycle } from '$lib/gradeMath';
import type { Course, Component, ScaleRule, SubItem, SemesterMeta } from '$lib/types';
import { COMPONENT_FIELDS, COURSE_FIELDS, SUB_ITEM_FIELDS, scale as scaleValidator, validateField } from './validation';

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
	scale: string | null;
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
	scale: string | null;
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

/**
 * The shared connection. Exported for the agent-access modules (apiTokens.ts, audit.ts), which
 * keep their own tables; grade data should still go through the user-scoped functions below.
 */
export function getDb(): DB {
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
		const { nextSortOrder } = db
			.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as nextSortOrder FROM semesters')
			.get() as { nextSortOrder: number };
		db.prepare(
			`INSERT INTO semesters (id, label, branch, semester, created_at, is_active, sort_order)
			 VALUES (?, ?, ?, ?, ?, 1, ?)`
		).run(semId, 'Semester 1', 'unknown', 'unknown', Date.now(), nextSortOrder);
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
	},
	// 2: user accounts. Semesters belong to a user; existing semesters stay unowned (invisible)
	// until scripts/create-user.mjs --claim assigns them.
	(db) => {
		db.exec(`
			CREATE TABLE IF NOT EXISTS users (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				roll_number TEXT NOT NULL UNIQUE COLLATE NOCASE,
				password_hash TEXT NOT NULL,
				created_at INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS sessions (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				created_at INTEGER NOT NULL,
				expires_at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
		`);
		addColumnIfMissing(db, 'semesters', 'user_id', 'TEXT REFERENCES users(id) ON DELETE CASCADE');
		db.exec('CREATE INDEX IF NOT EXISTS semesters_user_id ON semesters(user_id)');
	},
	// 3: agent access. Personal access tokens, OAuth clients/codes/grants for MCP connectors,
	// and a log of changes agents made (with the inverse operations needed to undo them).
	(db) => {
		db.exec(`
			CREATE TABLE IF NOT EXISTS api_tokens (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				name TEXT NOT NULL,
				token_hash TEXT NOT NULL UNIQUE,
				scope TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				last_used_at INTEGER,
				expires_at INTEGER,
				revoked_at INTEGER
			);
			CREATE INDEX IF NOT EXISTS api_tokens_user_id ON api_tokens(user_id);

			CREATE TABLE IF NOT EXISTS oauth_clients (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				redirect_uris TEXT NOT NULL,
				secret_hash TEXT,
				created_at INTEGER NOT NULL
			);

			CREATE TABLE IF NOT EXISTS oauth_codes (
				code_hash TEXT PRIMARY KEY,
				client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				redirect_uri TEXT NOT NULL,
				code_challenge TEXT NOT NULL,
				scope TEXT NOT NULL,
				resource TEXT,
				expires_at INTEGER NOT NULL
			);

			CREATE TABLE IF NOT EXISTS oauth_grants (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
				scope TEXT NOT NULL,
				refresh_hash TEXT NOT NULL UNIQUE,
				created_at INTEGER NOT NULL,
				last_used_at INTEGER,
				expires_at INTEGER NOT NULL,
				revoked_at INTEGER
			);
			CREATE INDEX IF NOT EXISTS oauth_grants_user_id ON oauth_grants(user_id);

			CREATE TABLE IF NOT EXISTS oauth_access_tokens (
				token_hash TEXT PRIMARY KEY,
				grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
				expires_at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS oauth_access_tokens_grant_id ON oauth_access_tokens(grant_id);

			CREATE TABLE IF NOT EXISTS agent_changes (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				created_at INTEGER NOT NULL,
				actor TEXT NOT NULL,
				tool TEXT NOT NULL,
				summary TEXT NOT NULL,
				course_id TEXT,
				undo TEXT NOT NULL,
				undone_at INTEGER
			);
			CREATE INDEX IF NOT EXISTS agent_changes_user_created ON agent_changes(user_id, created_at);
		`);
	},
	// 4: scaling from several items or the whole course, absolutely or relatively. The JSON `scale`
	// column replaces scale_target_id, which is cleared but kept (legacyMigrations re-adds it).
	(db) => {
		for (const table of ['components', 'sub_items']) {
			addColumnIfMissing(db, table, 'scale', 'TEXT');
			db.prepare(
				`UPDATE ${table} SET scale = json_object('from', json_array(scale_target_id), 'mode', 'absolute', 'combine', 'weight'),
				 scale_target_id = NULL WHERE scale_target_id IS NOT NULL`
			).run();
		}
	}
];

/** Read the JSON scale column; anything malformed counts as not scaled */
function parseScale(text: string | null): ScaleRule | null {
	if (!text) return null;
	try {
		const result = scaleValidator(JSON.parse(text));
		return result.ok ? (result.value as ScaleRule | null) : null;
	} catch {
		return null;
	}
}

const scaleColumn = (rule: ScaleRule | null | undefined): string | null => (rule ? JSON.stringify(rule) : null);

/** An item's scale rule, also reading the single scaleTargetId of older exports and undo logs */
function ruleOf(item: { scale?: ScaleRule | null }): ScaleRule | null {
	if (item.scale) return item.scale;
	const legacy = (item as { scaleTargetId?: unknown }).scaleTargetId;
	return typeof legacy === 'string' && legacy ? { from: [legacy], mode: 'absolute', combine: 'weight' } : null;
}

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
			`SELECT id, course_id, name, weight, max_score, score, best_of, sort_order, stats_mode, scale,
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
						 class_avg, class_median, class_max, class_std_dev, class_full_pct, scale
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
			scale: parseScale(row.scale)
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
			scale: parseScale(row.scale),
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
	const mapScale = (item: { scale?: ScaleRule | null }): string | null => {
		const rule = ruleOf(item);
		if (!rule || rule.from === 'course') return scaleColumn(rule);
		const from = rule.from.map((id) => idMap.get(id)).filter((id): id is string => id !== undefined);
		return from.length > 0 ? scaleColumn({ ...rule, from }) : null;
	};

	const insertComponentStmt = db.prepare(
		`INSERT INTO components (
			id, course_id, name, weight, max_score, score, best_of, sort_order,
			stats_mode, scale, class_avg, class_median, class_max, class_std_dev, class_full_pct
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	const insertSubItemStmt = db.prepare(
		`INSERT INTO sub_items (
			id, component_id, name, score, max_score, sort_order,
			class_avg, class_median, class_max, class_std_dev, class_full_pct, scale
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
			mapScale(component),
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
				mapScale(subItem)
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

function nextSemesterSortOrder(db: DB, userId: string): number {
	const row = db
		.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM semesters WHERE user_id = ?')
		.get(userId) as { next_order: number };
	return row.next_order;
}

function getActiveSemesterId(db: DB, userId: string): string | null {
	const row = db
		.prepare('SELECT id FROM semesters WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1')
		.get(userId) as { id: string } | undefined;
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

function insertSemester(
	db: DB,
	userId: string,
	id: string,
	label: string,
	branch: string,
	semester: string,
	active: boolean
): void {
	if (active) db.prepare('UPDATE semesters SET is_active = 0 WHERE user_id = ?').run(userId);
	db.prepare(
		`INSERT INTO semesters (id, user_id, label, branch, semester, created_at, is_active, sort_order)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	).run(id, userId, label, branch, semester, Date.now(), active ? 1 : 0, nextSemesterSortOrder(db, userId));
}

/** Run fn in one transaction (nested calls become savepoints) */
export function runInTransaction<T>(fn: () => T): T {
	return getDb().transaction(fn)();
}

// ─── Ownership ───────────────────────────────────────────────────────────────
// Every exported function below takes the signed-in user's id. Rows owned by someone else
// behave exactly like missing rows (404 / no-op), so ids from other accounts reveal nothing.

function ownsCourse(db: DB, userId: string, courseId: string): boolean {
	return (
		db
			.prepare('SELECT 1 FROM courses c JOIN semesters s ON s.id = c.semester_id WHERE c.id = ? AND s.user_id = ?')
			.get(courseId, userId) !== undefined
	);
}

function ownsComponent(db: DB, userId: string, componentId: string): boolean {
	return (
		db
			.prepare(
				`SELECT 1 FROM components cm
				 JOIN courses c ON c.id = cm.course_id
				 JOIN semesters s ON s.id = c.semester_id
				 WHERE cm.id = ? AND s.user_id = ?`
			)
			.get(componentId, userId) !== undefined
	);
}

function ownsSubItem(db: DB, userId: string, subItemId: string): boolean {
	return (
		db
			.prepare(
				`SELECT 1 FROM sub_items si
				 JOIN components cm ON cm.id = si.component_id
				 JOIN courses c ON c.id = cm.course_id
				 JOIN semesters s ON s.id = c.semester_id
				 WHERE si.id = ? AND s.user_id = ?`
			)
			.get(subItemId, userId) !== undefined
	);
}

// ─── Users & sessions ────────────────────────────────────────────────────────

export type User = { id: string; name: string; rollNumber: string };
type UserRow = { id: string; name: string; roll_number: string; password_hash: string };

const toUser = (row: UserRow): User => ({ id: row.id, name: row.name, rollNumber: row.roll_number });

/** Inserts a user; returns null when the roll number is already registered */
export function createUser(name: string, rollNumber: string, passwordHash: string): User | null {
	const id = crypto.randomUUID();
	const inserted = getDb()
		.prepare(
			`INSERT INTO users (id, name, roll_number, password_hash, created_at) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(roll_number) DO NOTHING`
		)
		.run(id, name, rollNumber, passwordHash, Date.now()).changes;
	return inserted > 0 ? { id, name, rollNumber } : null;
}

/** The user plus their password hash, for checking a login */
export function findUserByRollNumber(rollNumber: string): (User & { passwordHash: string }) | null {
	const row = getDb()
		.prepare('SELECT id, name, roll_number, password_hash FROM users WHERE roll_number = ?')
		.get(rollNumber) as UserRow | undefined;
	return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
}

export function getPasswordHash(userId: string): string | null {
	const row = getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as
		| { password_hash: string }
		| undefined;
	return row?.password_hash ?? null;
}

/** Replaces the password and signs out every other session of this user */
export function setPasswordHash(userId: string, passwordHash: string, keepSessionId: string): void {
	const db = getDb();
	db.transaction(() => {
		db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
		db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, keepSessionId);
	})();
}

export function createSession(sessionId: string, userId: string, expiresAt: number): void {
	getDb()
		.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
		.run(sessionId, userId, Date.now(), expiresAt);
}

/** The session's user if it hasn't expired; expired sessions are deleted on sight */
export function getSessionUser(sessionId: string): { user: User; expiresAt: number } | null {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT u.id, u.name, u.roll_number, u.password_hash, s.expires_at
			 FROM sessions s JOIN users u ON u.id = s.user_id
			 WHERE s.id = ?`
		)
		.get(sessionId) as (UserRow & { expires_at: number }) | undefined;
	if (!row) return null;
	if (row.expires_at <= Date.now()) {
		deleteSession(sessionId);
		return null;
	}
	return { user: toUser(row), expiresAt: row.expires_at };
}

export function extendSession(sessionId: string, expiresAt: number): void {
	getDb().prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(expiresAt, sessionId);
}

export function deleteSession(sessionId: string): void {
	getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function deleteExpiredSessions(): void {
	getDb().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

// ─── Semester functions ──────────────────────────────────────────────────────

export function getAllSemesters(userId: string): SemesterMeta[] {
	const rows = getDb()
		.prepare(
			`SELECT s.id, s.label, s.branch, s.semester, s.created_at, s.is_active, s.sort_order,
			 COUNT(c.id) as course_count
			 FROM semesters s
			 LEFT JOIN courses c ON c.semester_id = s.id
			 WHERE s.user_id = ?
			 GROUP BY s.id
			 ORDER BY s.sort_order IS NULL ASC, s.sort_order ASC, s.created_at ASC`
		)
		.all(userId) as SemesterRow[];
	return rowsToSemesterMeta(rows);
}

/** True if this user owns the semester */
export function semesterExists(userId: string, id: string): boolean {
	return getDb().prepare('SELECT 1 FROM semesters WHERE id = ? AND user_id = ?').get(id, userId) !== undefined;
}

/** True if any account already uses this semester id (ids are global primary keys) */
export function semesterIdTaken(id: string): boolean {
	return getDb().prepare('SELECT 1 FROM semesters WHERE id = ?').get(id) !== undefined;
}

export function createSemester(userId: string, id: string, label: string, branch: string, semester: string): SemesterMeta {
	const db = getDb();
	db.transaction(() => insertSemester(db, userId, id, label, branch, semester, true))();
	return getSemesterMeta(db, id)!;
}

/** Create a semester and seed the given catalog courses in a single transaction */
export function createSemesterWithCourses(
	userId: string,
	id: string,
	label: string,
	branch: string,
	semester: string,
	catalogCourses: Course[]
): { semester: SemesterMeta; courses: Course[] } {
	const db = getDb();
	db.transaction(() => {
		insertSemester(db, userId, id, label, branch, semester, true);
		seedCourses(db, catalogCourses, id);
	})();
	return { semester: getSemesterMeta(db, id)!, courses: getCoursesBySemester(userId, id) };
}

export function setActiveSemester(userId: string, id: string): boolean {
	const db = getDb();
	return db.transaction(() => {
		if (!semesterExists(userId, id)) return false;
		db.prepare('UPDATE semesters SET is_active = 0 WHERE user_id = ?').run(userId);
		db.prepare('UPDATE semesters SET is_active = 1 WHERE id = ?').run(id);
		return true;
	})();
}

export function renameSemester(userId: string, id: string, label: string): boolean {
	return getDb().prepare('UPDATE semesters SET label = ? WHERE id = ? AND user_id = ?').run(label, id, userId).changes > 0;
}

export function reorderSemesters(userId: string, ids: string[]): void {
	const db = getDb();
	const existingIds = (
		db
			.prepare(
				'SELECT id FROM semesters WHERE user_id = ? ORDER BY sort_order IS NULL ASC, sort_order ASC, created_at ASC'
			)
			.all(userId) as { id: string }[]
	).map((row) => row.id);

	const existingIdSet = new Set(existingIds);
	const validIds = [...new Set(ids)].filter((id) => existingIdSet.has(id));
	const validIdSet = new Set(validIds);
	const orderedIds = [...validIds, ...existingIds.filter((id) => !validIdSet.has(id))];
	const update = db.prepare('UPDATE semesters SET sort_order = ? WHERE id = ?');
	db.transaction(() => orderedIds.forEach((id, index) => update.run(index, id)))();
}

export function deleteSemester(userId: string, id: string): void {
	const db = getDb();
	db.transaction(() => {
		if (!semesterExists(userId, id)) return;
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

/** Seed catalog courses into an existing semester (the caller checks ownership) */
export function seedByBranch(userId: string, selectedCourses: Course[], semesterId: string): Course[] {
	const db = getDb();
	db.transaction(() => {
		if (semesterExists(userId, semesterId)) seedCourses(db, selectedCourses, semesterId);
	})();
	return getCoursesBySemester(userId, semesterId);
}

export function getCoursesBySemester(userId: string, semesterId: string): Course[] {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT ${COURSE_COLUMN_NAMES.map((column) => `c.${column}`).join(', ')}
			 FROM courses c JOIN semesters s ON s.id = c.semester_id
			 WHERE c.semester_id = ? AND s.user_id = ?
			 ORDER BY c.rowid ASC`
		)
		.all(semesterId, userId) as CourseRow[];
	return hydrateCourses(db, rows);
}

/** Courses of the active semester */
export function getAllCourses(userId: string): Course[] {
	const activeSemId = getActiveSemesterId(getDb(), userId);
	return activeSemId ? getCoursesBySemester(userId, activeSemId) : [];
}

/** Courses of every semester, each tagged with its semesterId */
export function getEveryCourse(userId: string): Course[] {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT ${COURSE_COLUMN_NAMES.map((column) => `c.${column}`).join(', ')}
			 FROM courses c JOIN semesters s ON s.id = c.semester_id
			 WHERE s.user_id = ?
			 ORDER BY s.sort_order ASC, c.rowid ASC`
		)
		.all(userId) as CourseRow[];
	return hydrateCourses(db, rows);
}

/** Unscoped; only call after an ownership check */
function loadCourse(db: DB, id: string): Course | null {
	const row = db.prepare(`SELECT ${COURSE_COLUMNS} FROM courses WHERE id = ?`).get(id) as CourseRow | undefined;
	return row ? hydrateCourses(db, [row])[0] : null;
}

export function getCourse(userId: string, id: string): Course | null {
	const db = getDb();
	return ownsCourse(db, userId, id) ? loadCourse(db, id) : null;
}

export function addCourseWithDefaults(
	userId: string,
	name: string,
	fullName: string,
	color: string,
	semesterId?: string
): Result<Course> {
	const db = getDb();
	const semId = semesterId ?? getActiveSemesterId(db, userId);
	if (!semId || !semesterExists(userId, semId)) return failure(400, 'Semester not found');
	const courseId = db.transaction(() => createCourse(db, { name, fullName, color }, defaultComponents(), semId))();
	return { ok: true, value: loadCourse(db, courseId)! };
}

export function deleteCourse(userId: string, courseId: string): void {
	const db = getDb();
	if (ownsCourse(db, userId, courseId)) db.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
}

const COURSE_COL_MAP: Record<string, string> = {
	name: 'name',
	fullName: 'full_name',
	hideAbsoluteGrade: 'hide_absolute_grade',
	hideRelativeGrade: 'hide_relative_grade',
	classSize: 'class_size',
	credits: 'credits',
	officialGrade: 'official_grade'
};

export function updateCourseGradeVisibility(
	userId: string,
	id: string,
	field: 'hideAbsoluteGrade' | 'hideRelativeGrade',
	hidden: boolean
): boolean {
	const db = getDb();
	if (!ownsCourse(db, userId, id)) return false;
	return db.prepare(`UPDATE courses SET ${COURSE_COL_MAP[field]} = ? WHERE id = ?`).run(hidden ? 1 : 0, id).changes > 0;
}

export function updateCourseField(userId: string, id: string, field: string, value: unknown): Result {
	const validated = validateField(COURSE_FIELDS, field, value);
	if (!validated.ok) return failure(400, validated.error);
	const db = getDb();
	if (!ownsCourse(db, userId, id)) return failure(404, 'Course not found');
	db.prepare(`UPDATE courses SET ${COURSE_COL_MAP[field]} = ? WHERE id = ?`).run(validated.value, id);
	return { ok: true };
}

export function resetCourse(userId: string, courseId: string): Result<Course> {
	const db = getDb();
	if (!ownsCourse(db, userId, courseId)) return failure(404, 'Course not found');
	const row = db.prepare('SELECT name, template_id FROM courses WHERE id = ?').get(courseId) as {
		name: string;
		template_id: string | null;
	};

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
	return { ok: true, value: loadCourse(db, courseId)! };
}

// ─── Component & sub-item functions ──────────────────────────────────────────

const COMP_COL_MAP: Record<string, string> = {
	score: 'score',
	weight: 'weight',
	maxScore: 'max_score',
	name: 'name',
	bestOf: 'best_of',
	statsMode: 'stats_mode',
	scale: 'scale',
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
	scale: 'scale'
};

/** Rule for the old single-target field, which the API still accepts */
function legacyScaleField(field: string, value: unknown): { field: string; value: unknown } {
	if (field !== 'scaleTargetId') return { field, value };
	return { field: 'scale', value: value ? { from: [value], mode: 'absolute', combine: 'weight' } : null };
}

/** The caller has already checked that the user owns sourceId */
function checkScaleRule(db: DB, kind: 'component' | 'sub', sourceId: string, rule: ScaleRule): Result {
	const courseRow = (
		kind === 'component'
			? db.prepare('SELECT course_id FROM components WHERE id = ?').get(sourceId)
			: db
					.prepare('SELECT c.course_id FROM sub_items s JOIN components c ON c.id = s.component_id WHERE s.id = ?')
					.get(sourceId)
	) as { course_id: string } | undefined;
	if (!courseRow) return failure(404, `${kind === 'component' ? 'Component' : 'Sub-item'} not found`);
	if (rule.from === 'course') return { ok: true };

	const course = loadCourse(db, courseRow.course_id)!;
	const owner =
		kind === 'component'
			? course.components.find((comp) => comp.id === sourceId)
			: course.components.find((comp) => comp.subItems?.some((sub) => sub.id === sourceId));

	for (const targetId of rule.from) {
		if (targetId === sourceId) return failure(400, 'An item cannot be scaled from itself');
		if (kind === 'component' && owner?.subItems?.some((sub) => sub.id === targetId)) {
			return failure(400, 'A component cannot be scaled from its own sub-items');
		}
		if (kind === 'sub' && owner?.id === targetId) return failure(400, 'A sub-item cannot be scaled from its own component');

		const exists = course.components.some(
			(comp) => comp.id === targetId || comp.subItems?.some((sub) => sub.id === targetId)
		);
		if (!exists) return failure(400, 'Scale sources must be in the same course');
		if (wouldCreateScaleCycle(course, sourceId, targetId)) return failure(400, 'That scale source would create a cycle');
	}
	return { ok: true };
}

export function updateComponentField(userId: string, id: string, rawField: string, rawValue: unknown): Result {
	const db = getDb();
	const { field, value } = legacyScaleField(rawField, rawValue);
	const validated = validateField(COMPONENT_FIELDS, field, value);
	if (!validated.ok) return failure(400, validated.error);
	if (!ownsComponent(db, userId, id)) return failure(404, 'Component not found');

	if (field === 'scale' && validated.value !== null) {
		const check = checkScaleRule(db, 'component', id, validated.value as ScaleRule);
		if (!check.ok) return check;
	}

	const stored = field === 'scale' ? scaleColumn(validated.value as ScaleRule | null) : validated.value;
	db.prepare(`UPDATE components SET ${COMP_COL_MAP[field]} = ? WHERE id = ?`).run(stored, id);
	return { ok: true };
}

export function addComponent(userId: string, courseId: string, id: string, name: string): Result {
	const db = getDb();
	if (!ownsCourse(db, userId, courseId)) return failure(404, 'Course not found');
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

/** Items whose scale rule lists any of the ids, with the rule as it is now */
function scaleRefsTo(db: DB, ids: string[]): (ScaleRefRow & { scale: ScaleRule })[] {
	if (ids.length === 0) return [];
	const json = JSON.stringify(ids);
	const query = (table: string) =>
		db
			.prepare(
				`SELECT id, scale FROM ${table} WHERE scale IS NOT NULL AND EXISTS (
				 SELECT 1 FROM json_each(${table}.scale, '$.from') f WHERE f.value IN (SELECT value FROM json_each(?)))`
			)
			.all(json) as { id: string; scale: string }[];
	const refs: (ScaleRefRow & { scale: ScaleRule })[] = [];
	for (const [kind, table] of [['component', 'components'], ['sub', 'sub_items']] as const) {
		for (const row of query(table)) {
			const scale = parseScale(row.scale);
			if (scale) refs.push({ kind, id: row.id, scale });
		}
	}
	return refs;
}

/** Ids are random UUIDs, so only the owning course can reference them. Rules left with no source are cleared. */
const clearScaleRefs = (db: DB, ids: string[]) => {
	const gone = new Set(ids);
	for (const ref of scaleRefsTo(db, ids)) {
		const from = (ref.scale.from as string[]).filter((id) => !gone.has(id));
		const next = from.length > 0 ? scaleColumn({ ...ref.scale, from }) : null;
		db.prepare(`UPDATE ${ref.kind === 'component' ? 'components' : 'sub_items'} SET scale = ? WHERE id = ?`).run(next, ref.id);
	}
};

/** Delete a component and clear any scale targets that pointed at it or its sub-items */
export function deleteComponent(userId: string, id: string): void {
	const db = getDb();
	db.transaction(() => {
		if (!ownsComponent(db, userId, id)) return;
		const subIds = (db.prepare('SELECT id FROM sub_items WHERE component_id = ?').all(id) as { id: string }[]).map(
			(row) => row.id
		);
		clearScaleRefs(db, [id, ...subIds]);
		db.prepare('DELETE FROM components WHERE id = ?').run(id);
	})();
}

export function reorderComponents(userId: string, courseId: string, ids: string[]): void {
	const db = getDb();
	if (!ownsCourse(db, userId, courseId)) return;
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

export function updateSubItemField(userId: string, id: string, rawField: string, rawValue: unknown): Result {
	const db = getDb();
	const { field, value } = legacyScaleField(rawField, rawValue);
	const validated = validateField(SUB_ITEM_FIELDS, field, value);
	if (!validated.ok) return failure(400, validated.error);
	if (!ownsSubItem(db, userId, id)) return failure(404, 'Sub-item not found');

	if (field === 'scale' && validated.value !== null) {
		const check = checkScaleRule(db, 'sub', id, validated.value as ScaleRule);
		if (!check.ok) return check;
	}

	const stored = field === 'scale' ? scaleColumn(validated.value as ScaleRule | null) : validated.value;
	db.prepare(`UPDATE sub_items SET ${SUB_COL_MAP[field]} = ? WHERE id = ?`).run(stored, id);
	return { ok: true };
}

export function addSubItem(userId: string, componentId: string, id: string, name: string, maxScore: number): Result {
	const db = getDb();
	if (!ownsComponent(db, userId, componentId)) return failure(404, 'Component not found');
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

export function deleteSubItem(userId: string, id: string): void {
	const db = getDb();
	db.transaction(() => {
		if (!ownsSubItem(db, userId, id)) return;
		clearScaleRefs(db, [id]);
		db.prepare('DELETE FROM sub_items WHERE id = ?').run(id);
	})();
}

export function getSubItemCount(userId: string, componentId: string): number | undefined {
	const db = getDb();
	if (!ownsComponent(db, userId, componentId)) return undefined;
	const row = db.prepare('SELECT COUNT(*) as count FROM sub_items WHERE component_id = ?').get(componentId) as {
		count: number;
	};
	return row.count;
}

// ─── Agent undo support ──────────────────────────────────────────────────────

/** A scale rule a delete trimmed; `targetId` is the single target recorded by older undo logs */
type ScaleRefRow = { kind: 'component' | 'sub'; id: string; scale?: ScaleRule; targetId?: string };

/** Active semester id for the user, or null */
export function getActiveSemester(userId: string): string | null {
	return getActiveSemesterId(getDb(), userId);
}

/** Where a component or sub-item sits; componentId is the item itself for components */
export function getItemLocation(
	userId: string,
	id: string
): { kind: 'component' | 'sub'; courseId: string; componentId: string; sortOrder: number } | null {
	const db = getDb();
	const component = db
		.prepare(
			`SELECT cm.course_id, cm.sort_order FROM components cm
			 JOIN courses c ON c.id = cm.course_id
			 JOIN semesters s ON s.id = c.semester_id
			 WHERE cm.id = ? AND s.user_id = ?`
		)
		.get(id, userId) as { course_id: string; sort_order: number } | undefined;
	if (component) {
		return { kind: 'component', courseId: component.course_id, componentId: id, sortOrder: component.sort_order };
	}

	const sub = db
		.prepare(
			`SELECT cm.id AS component_id, cm.course_id, si.sort_order FROM sub_items si
			 JOIN components cm ON cm.id = si.component_id
			 JOIN courses c ON c.id = cm.course_id
			 JOIN semesters s ON s.id = c.semester_id
			 WHERE si.id = ? AND s.user_id = ?`
		)
		.get(id, userId) as { component_id: string; course_id: string; sort_order: number } | undefined;
	return sub
		? { kind: 'sub', courseId: sub.course_id, componentId: sub.component_id, sortOrder: sub.sort_order }
		: null;
}

/** Scale rules that list any of the ids; call only after an ownership check */
export function findScaleRefs(ids: string[]): ScaleRefRow[] {
	return scaleRefsTo(getDb(), ids);
}

/** Put trimmed scale rules back as they were; skips items that are gone or not owned */
export function restoreScaleRefs(userId: string, refs: ScaleRefRow[]): void {
	const db = getDb();
	for (const ref of refs) {
		const rule = ref.scale ?? ruleOf({ scaleTargetId: ref.targetId } as { scale?: ScaleRule });
		if (!rule) continue;
		const owned = ref.kind === 'component' ? ownsComponent(db, userId, ref.id) : ownsSubItem(db, userId, ref.id);
		if (!owned) continue;
		db.prepare(`UPDATE ${ref.kind === 'component' ? 'components' : 'sub_items'} SET scale = ? WHERE id = ?`).run(
			scaleColumn(rule),
			ref.id
		);
	}
}

/** True if a course, component or sub-item already uses this id */
function anyItemHasId(db: DB, id: string): boolean {
	return (
		db
			.prepare(
				'SELECT 1 FROM courses WHERE id = ? UNION ALL SELECT 1 FROM components WHERE id = ? UNION ALL SELECT 1 FROM sub_items WHERE id = ?'
			)
			.get(id, id, id) !== undefined
	);
}

/** Insert a sub-item under its original id */
function insertSubItemWithId(db: DB, componentId: string, subItem: SubItem, sortOrder: number): void {
	db.prepare(
		`INSERT INTO sub_items (
			id, component_id, name, score, max_score, sort_order,
			class_avg, class_median, class_max, class_std_dev, class_full_pct, scale
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		subItem.id,
		componentId,
		subItem.name,
		subItem.score ?? null,
		subItem.maxScore,
		sortOrder,
		subItem.classAvg ?? null,
		subItem.classMedian ?? null,
		subItem.classMax ?? null,
		subItem.classStdDev ?? null,
		subItem.classFullPct ?? null,
		scaleColumn(ruleOf(subItem))
	);
}

/** Insert a component and its sub-items under their original ids */
function insertComponentWithIds(db: DB, courseId: string, component: Component, sortOrder: number): void {
	db.prepare(
		`INSERT INTO components (
			id, course_id, name, weight, max_score, score, best_of, sort_order,
			stats_mode, scale, class_avg, class_median, class_max, class_std_dev, class_full_pct
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		component.id,
		courseId,
		component.name,
		component.weight,
		component.maxScore,
		component.score ?? null,
		component.bestOf ?? null,
		sortOrder,
		component.statsMode ?? 'global',
		scaleColumn(ruleOf(component)),
		component.classAvg ?? null,
		component.classMedian ?? null,
		component.classMax ?? null,
		component.classStdDev ?? null,
		component.classFullPct ?? null
	);
	(component.subItems ?? []).forEach((subItem, index) => insertSubItemWithId(db, component.id, subItem, index));
}

/** Re-insert a component at its old position; later components shift down */
export function restoreComponent(userId: string, courseId: string, sortOrder: number, component: Component): Result {
	const db = getDb();
	if (!ownsCourse(db, userId, courseId)) return failure(404, 'Course not found');
	const ids = [component.id, ...(component.subItems ?? []).map((sub) => sub.id)];
	if (ids.some((id) => anyItemHasId(db, id))) return failure(409, 'Component id already exists');
	db.transaction(() => {
		db.prepare('UPDATE components SET sort_order = sort_order + 1 WHERE course_id = ? AND sort_order >= ?').run(
			courseId,
			sortOrder
		);
		insertComponentWithIds(db, courseId, component, sortOrder);
	})();
	return { ok: true };
}

/** Re-insert a sub-item at its old position; later sub-items shift down */
export function restoreSubItem(userId: string, componentId: string, sortOrder: number, subItem: SubItem): Result {
	const db = getDb();
	if (!ownsComponent(db, userId, componentId)) return failure(404, 'Component not found');
	if (anyItemHasId(db, subItem.id)) return failure(409, 'Sub-item id already exists');
	db.transaction(() => {
		db.prepare('UPDATE sub_items SET sort_order = sort_order + 1 WHERE component_id = ? AND sort_order >= ?').run(
			componentId,
			sortOrder
		);
		insertSubItemWithId(db, componentId, subItem, sortOrder);
	})();
	return { ok: true };
}

/** Re-create a course with its original ids and its full component tree */
export function restoreCourse(userId: string, semesterId: string, course: Course): Result {
	const db = getDb();
	if (!semesterExists(userId, semesterId)) return failure(404, 'Semester not found');
	if (anyItemHasId(db, course.id)) return failure(409, 'Course id already exists');
	db.transaction(() => {
		insertCourse(db, course.id, course, semesterId);
		course.components.forEach((component, index) => insertComponentWithIds(db, course.id, component, index));
	})();
	return { ok: true };
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

export function getExportData(userId: string): ExportData {
	const courses = getEveryCourse(userId);
	return {
		app: 'tracksem',
		version: 1,
		exportedAt: new Date().toISOString(),
		semesters: getAllSemesters(userId).map((semester) => ({
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
export function importSemesters(userId: string, semesters: ImportSemester[]): SemesterMeta[] {
	const db = getDb();
	const ids = db.transaction(() => {
		const hadSemesters = getActiveSemesterId(db, userId) !== null;
		return semesters.map((semester, index) => {
			const id = crypto.randomUUID();
			insertSemester(db, userId, id, semester.label, semester.branch, semester.semester, !hadSemesters && index === 0);
			for (const course of semester.courses) createCourse(db, course, course.components, id);
			return id;
		});
	})();
	return ids.map((id) => getSemesterMeta(db, id)!);
}

/**
 * Consistent online snapshot written to `destination`, then trimmed to one user's data:
 * other accounts, every session and the password hash are removed, and VACUUM drops the
 * freed pages so deleted rows can't be recovered from the file.
 */
export async function backupUserDatabase(userId: string, destination: string): Promise<void> {
	await getDb().backup(destination);
	const copy = new Database(destination);
	try {
		copy.pragma('foreign_keys = ON');
		copy.pragma('journal_mode = DELETE');
		copy.transaction(() => {
			copy.prepare('DELETE FROM sessions').run();
			copy
				.prepare(
					`DELETE FROM courses WHERE semester_id IS NULL
					 OR semester_id IN (SELECT id FROM semesters WHERE user_id IS NOT ?)`
				)
				.run(userId);
			copy.prepare('DELETE FROM semesters WHERE user_id IS NOT ?').run(userId);
			copy.prepare('DELETE FROM users WHERE id != ?').run(userId);
			copy.prepare("UPDATE users SET password_hash = '' WHERE id = ?").run(userId);
		})();
		copy.exec('VACUUM');
	} finally {
		copy.close();
	}
}
