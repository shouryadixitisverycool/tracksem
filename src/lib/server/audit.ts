import type { AgentAuth } from './agentAuth';
import type { Component, Course, ScaleRule, SubItem } from '$lib/types';
import {
	deleteComponent,
	deleteCourse,
	deleteSemester,
	deleteSubItem,
	getCourse,
	getDb,
	getItemLocation,
	renameSemester,
	reorderComponents,
	restoreComponent,
	restoreCourse,
	restoreScaleRefs,
	restoreSubItem,
	runInTransaction,
	semesterExists,
	setActiveSemester,
	updateComponentField,
	updateCourseField,
	updateCourseGradeVisibility,
	updateSubItemField,
	type Result
} from './db';
import { notifyUserChanged } from './events';

/** Inverse operations stored with each agent change; undo applies them in reverse order */
export type UndoOp =
	| { op: 'setCourse'; id: string; field: string; value: unknown }
	| { op: 'setComponent'; id: string; field: string; value: unknown }
	| { op: 'setSubItem'; id: string; field: string; value: unknown }
	| { op: 'deleteCourse'; id: string }
	| { op: 'deleteComponent'; id: string }
	| { op: 'deleteSubItem'; id: string }
	| { op: 'deleteSemester'; id: string }
	| { op: 'restoreCourse'; semesterId: string; course: Course }
	| { op: 'restoreComponent'; courseId: string; sortOrder: number; component: Component; scaleRefs: ScaleRef[] }
	| { op: 'restoreSubItem'; componentId: string; sortOrder: number; subItem: SubItem; scaleRefs: ScaleRef[] }
	| { op: 'reorderComponents'; courseId: string; order: string[] }
	| { op: 'setActiveSemester'; id: string }
	| { op: 'renameSemester'; id: string; label: string };

/** A scale rule that a delete trimmed, so undo can put it back (older logs hold a single targetId) */
export type ScaleRef = { kind: 'component' | 'sub'; id: string; scale?: ScaleRule; targetId?: string };

export type AgentChange = {
	id: string;
	createdAt: number;
	/** AgentAuth.label of whoever made it */
	actor: string;
	tool: string;
	summary: string;
	courseId: string | null;
	undoneAt: number | null;
	/** False once undone, or when it has no undo ops */
	canUndo: boolean;
};

/** Keep at most this many change rows per user */
const MAX_CHANGES_PER_USER = 500;

/** Undo cannot apply because the target changed since the change was made */
class UndoFailure extends Error {}

type ChangeRow = {
	id: string;
	created_at: number;
	actor: string;
	tool: string;
	summary: string;
	course_id: string | null;
	undone_at: number | null;
	undo: string;
};

const parseOps = (undo: string): UndoOp[] => JSON.parse(undo) as UndoOp[];

const toChange = (row: ChangeRow): AgentChange => ({
	id: row.id,
	createdAt: row.created_at,
	actor: row.actor,
	tool: row.tool,
	summary: row.summary,
	courseId: row.course_id,
	undoneAt: row.undone_at,
	canUndo: row.undone_at === null && parseOps(row.undo).length > 0
});

/** Log a change and notify the user's open tabs (events.notifyUserChanged) */
export function recordChange(
	auth: AgentAuth,
	change: { tool: string; summary: string; courseId: string | null; undo: UndoOp[] }
): AgentChange {
	const db = getDb();
	const row: ChangeRow = {
		id: crypto.randomUUID(),
		created_at: Date.now(),
		actor: auth.label,
		tool: change.tool,
		summary: change.summary,
		course_id: change.courseId,
		undone_at: null,
		undo: JSON.stringify(change.undo)
	};
	runInTransaction(() => {
		db.prepare(
			`INSERT INTO agent_changes (id, user_id, created_at, actor, tool, summary, course_id, undo, undone_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`
		).run(row.id, auth.userId, row.created_at, row.actor, row.tool, row.summary, row.course_id, row.undo);
		db.prepare(
			`DELETE FROM agent_changes WHERE user_id = ? AND id NOT IN (
				SELECT id FROM agent_changes WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?
			)`
		).run(auth.userId, auth.userId, MAX_CHANGES_PER_USER);
	});
	notifyUserChanged(auth.userId);
	return toChange(row);
}

/** Newest first */
export function listChanges(userId: string, limit = 50): AgentChange[] {
	const rows = getDb()
		.prepare(
			`SELECT id, created_at, actor, tool, summary, course_id, undone_at, undo FROM agent_changes
			 WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`
		)
		.all(userId, limit) as ChangeRow[];
	return rows.map(toChange);
}

/** Throws UndoFailure when a Result reports an error */
function check(result: Result): void {
	if (!result.ok) throw new UndoFailure(result.error);
}

/** Throws UndoFailure when a lookup or boolean write found nothing */
function assertFound(found: boolean, what: string): void {
	if (!found) throw new UndoFailure(`${what} no longer exists`);
}

/** Apply one inverse operation for the user */
function applyUndo(userId: string, op: UndoOp): void {
	switch (op.op) {
		case 'setCourse':
			if (op.field === 'hideAbsoluteGrade' || op.field === 'hideRelativeGrade') {
				assertFound(updateCourseGradeVisibility(userId, op.id, op.field, Boolean(op.value)), 'Course');
			} else {
				check(updateCourseField(userId, op.id, op.field, op.value));
			}
			return;
		case 'setComponent':
			check(updateComponentField(userId, op.id, op.field, op.value));
			return;
		case 'setSubItem':
			check(updateSubItemField(userId, op.id, op.field, op.value));
			return;
		case 'deleteCourse':
			assertFound(getCourse(userId, op.id) !== null, 'Course');
			deleteCourse(userId, op.id);
			return;
		case 'deleteComponent':
			assertFound(getItemLocation(userId, op.id)?.kind === 'component', 'Component');
			deleteComponent(userId, op.id);
			return;
		case 'deleteSubItem':
			assertFound(getItemLocation(userId, op.id)?.kind === 'sub', 'Sub-item');
			deleteSubItem(userId, op.id);
			return;
		case 'deleteSemester':
			assertFound(semesterExists(userId, op.id), 'Semester');
			deleteSemester(userId, op.id);
			return;
		case 'restoreCourse':
			check(restoreCourse(userId, op.semesterId, op.course));
			return;
		case 'restoreComponent':
			check(restoreComponent(userId, op.courseId, op.sortOrder, op.component));
			restoreScaleRefs(userId, op.scaleRefs);
			return;
		case 'restoreSubItem':
			check(restoreSubItem(userId, op.componentId, op.sortOrder, op.subItem));
			restoreScaleRefs(userId, op.scaleRefs);
			return;
		case 'reorderComponents':
			assertFound(getCourse(userId, op.courseId) !== null, 'Course');
			reorderComponents(userId, op.courseId, op.order);
			return;
		case 'setActiveSemester':
			assertFound(setActiveSemester(userId, op.id), 'Semester');
			return;
		case 'renameSemester':
			assertFound(renameSemester(userId, op.id, op.label), 'Semester');
			return;
	}
}

/** Applies the change's undo ops in one transaction, marks it undone, notifies open tabs */
export function undoChange(userId: string, changeId: string): Result {
	const db = getDb();
	const row = db
		.prepare('SELECT undo, undone_at FROM agent_changes WHERE id = ? AND user_id = ?')
		.get(changeId, userId) as { undo: string; undone_at: number | null } | undefined;
	if (!row) return { ok: false, status: 404, error: 'Change not found' };
	if (row.undone_at !== null) return { ok: false, status: 409, error: 'This change was already undone' };

	const ops = parseOps(row.undo);
	if (ops.length === 0) return { ok: false, status: 409, error: 'This change has nothing to undo' };

	try {
		runInTransaction(() => {
			for (const op of ops.reverse()) applyUndo(userId, op);
			db.prepare('UPDATE agent_changes SET undone_at = ? WHERE id = ? AND user_id = ?').run(
				Date.now(),
				changeId,
				userId
			);
		});
	} catch (error) {
		if (error instanceof UndoFailure) return { ok: false, status: 409, error: `Can't undo: ${error.message}` };
		throw error;
	}
	notifyUserChanged(userId);
	return { ok: true };
}
