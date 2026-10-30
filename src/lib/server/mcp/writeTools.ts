import { BRANCHES, getCourses, getSemesters } from '$lib/data/courses';
import { LETTERS } from '$lib/grading';
import type { Component, Course, SubItem } from '$lib/types';
import * as v from '$lib/server/validation';
import {
	addComponent,
	addCourseWithDefaults,
	addSubItem,
	createSemesterWithCourses,
	deleteComponent,
	deleteCourse,
	deleteSubItem,
	findScaleRefs,
	getActiveSemester,
	getAllSemesters,
	getCourse,
	getCoursesBySemester,
	getItemLocation,
	reorderComponents,
	renameSemester,
	runInTransaction,
	semesterExists,
	setActiveSemester,
	updateComponentField,
	updateCourseField,
	updateCourseGradeVisibility,
	updateSubItemField
} from '$lib/server/db';
import { recordChange, undoChange, type AgentChange, type UndoOp } from '../audit';
import { describeCourse } from './summaries';
import { ToolError, type JsonSchema, type Tool, type ToolContext } from './types';

type Fields = Record<string, unknown>;

/** Colors for new courses, cycled by how many courses the semester already has */
const COURSE_COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#7c3aed', '#65a30d'];

/** Hide flags are not in COURSE_FIELDS (they live in their own column setter), so they get their own validator */
const HIDE_FIELDS: Record<string, v.Validator> = {
	hideAbsoluteGrade: (value) =>
		typeof value === 'boolean' ? { ok: true, value } : { ok: false, error: 'must be true or false' },
	hideRelativeGrade: (value) =>
		typeof value === 'boolean' ? { ok: true, value } : { ok: false, error: 'must be true or false' }
};

const show = (value: unknown): string => {
	if (value === null || value === undefined) return '—';
	return typeof value === 'object' ? JSON.stringify(value) : String(value);
};
const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function requireId(value: unknown, what: string): string {
	if (!v.isSafeId(value)) throw new ToolError(`${what} must be a valid id`);
	return value;
}

/** Validate the given fields; undefined values are skipped */
function validateFields(raw: Fields, fields: Record<string, v.Validator>): Fields {
	const out: Fields = {};
	for (const [field, value] of Object.entries(raw)) {
		if (value === undefined) continue;
		if (!Object.hasOwn(fields, field)) throw new ToolError(`Unknown field "${field}"`);
		const checked = v.validateField(fields, field, value);
		if (!checked.ok) throw new ToolError(checked.error);
		out[field] = checked.value;
	}
	return out;
}

/** Validate an update's `changes` object, which must name at least one field */
function validateChanges(raw: unknown, fields: Record<string, v.Validator>): Fields {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ToolError('changes must be an object');
	if (Object.keys(raw).length === 0) throw new ToolError('changes must include at least one field');
	return validateFields(raw as Fields, fields);
}

/** Throws a ToolError when a db write fails, which rolls back the surrounding transaction */
function written(result: { ok: boolean; error?: string } | boolean): void {
	if (typeof result === 'boolean') {
		if (!result) throw new ToolError('Not found');
		return;
	}
	if (!result.ok) throw new ToolError(result.error ?? 'Write failed');
}

function courseOrThrow(userId: string, courseId: string): Course {
	const course = getCourse(userId, courseId);
	if (!course) throw new ToolError('Course not found');
	return course;
}

function componentOrThrow(
	userId: string,
	componentId: string
): { course: Course; component: Component; sortOrder: number } {
	const location = getItemLocation(userId, componentId);
	if (!location || location.kind !== 'component') throw new ToolError('Component not found');
	const course = courseOrThrow(userId, location.courseId);
	const component = course.components.find((item) => item.id === componentId);
	if (!component) throw new ToolError('Component not found');
	return { course, component, sortOrder: location.sortOrder };
}

function subItemOrThrow(
	userId: string,
	subItemId: string
): { course: Course; parent: Component; subItem: SubItem; sortOrder: number } {
	const location = getItemLocation(userId, subItemId);
	if (!location || location.kind !== 'sub') throw new ToolError('Sub-item not found');
	const course = courseOrThrow(userId, location.courseId);
	const parent = course.components.find((item) => item.id === location.componentId);
	const subItem = parent?.subItems?.find((item) => item.id === subItemId);
	if (!parent || !subItem) throw new ToolError('Sub-item not found');
	return { course, parent, subItem, sortOrder: location.sortOrder };
}

type ItemInfo = { kind: 'component' | 'sub'; name: string; score: number | null };

/** Every component and sub-item of a course, by id */
function indexItems(course: Course): Map<string, ItemInfo> {
	const items = new Map<string, ItemInfo>();
	for (const component of course.components) {
		items.set(component.id, { kind: 'component', name: component.name, score: component.score });
		for (const sub of component.subItems ?? []) items.set(sub.id, { kind: 'sub', name: sub.name, score: sub.score });
	}
	return items;
}

type FieldEdit = {
	tool: string;
	courseId: string;
	/** Prefix of the summary, e.g. "CS1.301 · Midsem" */
	label: string;
	current: Fields;
	changes: Fields;
	write: (field: string, value: unknown) => void;
	undo: (field: string, value: unknown) => UndoOp;
};

/** Write the fields that differ and log them as one change; null when nothing differs */
function applyFieldEdits(ctx: ToolContext, edit: FieldEdit): AgentChange | null {
	const diffs = Object.keys(edit.changes).filter((field) => !sameValue(edit.current[field], edit.changes[field]));
	if (diffs.length === 0) return null;
	const parts = diffs.map((field) => `${field} ${show(edit.current[field])} → ${show(edit.changes[field])}`);
	const summary = `${edit.label}: ${parts.join(', ')}`;
	const undo = diffs.map((field) => edit.undo(field, edit.current[field] ?? null));
	return runInTransaction(() => {
		for (const field of diffs) edit.write(field, edit.changes[field]);
		return recordChange(ctx.auth, { tool: edit.tool, summary, courseId: edit.courseId, undo });
	});
}

/** Result for a course-scoped write: the change plus the course as it now reads */
function courseResult(ctx: ToolContext, change: AgentChange, courseId: string) {
	return {
		changeId: change.id,
		summary: change.summary,
		course: describeCourse(courseOrThrow(ctx.auth.userId, courseId))
	};
}

// ─── Schema helpers ──────────────────────────────────────────────────────────

const obj = (properties: Record<string, JsonSchema>, required: string[]): JsonSchema & { type: 'object' } => ({
	type: 'object',
	properties,
	required,
	additionalProperties: false
});

const idSchema = (description: string): JsonSchema => ({ type: 'string', description, minLength: 1, maxLength: 255 });

const nameSchema = (description: string): JsonSchema => ({
	type: 'string',
	description,
	minLength: 1,
	maxLength: v.MAX_NAME_LENGTH
});

/** Non-negative number or null (clears the field) */
const nullableNumber = (description: string, maximum?: number): JsonSchema => ({
	type: ['number', 'null'],
	description,
	minimum: 0,
	...(maximum === undefined ? {} : { maximum })
});

const percentSchema = (description: string): JsonSchema => nullableNumber(description, 100);

const SCALE: JsonSchema = {
	type: ['object', 'null'],
	description:
		"Work this item's marks out from other items instead of entering them, or null to stop. " +
		"from: ids of components or sub-items in the same course, or 'course' for every other component. " +
		"mode 'absolute' copies the % (default); 'relative' takes the same percentile on this item's own class curve (needs this item's class stats). " +
		"combine 'weight' averages sources by course weight (default); 'equal' averages them equally.",
	properties: {
		from: {
			type: ['string', 'array'],
			description: "List of item ids, or the string 'course'",
			items: { type: 'string', minLength: 1, maxLength: 255 },
			minItems: 1,
			maxItems: v.MAX_SCALE_SOURCES
		},
		mode: { type: 'string', enum: ['absolute', 'relative'] },
		combine: { type: 'string', enum: ['weight', 'equal'] }
	},
	required: ['from'],
	additionalProperties: false
};

const CLASS_STATS = {
	classAvg: nullableNumber('Class average, in marks'),
	classMedian: nullableNumber('Class median, in marks'),
	classMax: nullableNumber('Highest mark in the class, in marks'),
	classStdDev: nullableNumber('Standard deviation of class marks'),
	classFullPct: percentSchema('Percent of the class (0 to 100) that scored full marks')
};

const COMPONENT_CHANGES: JsonSchema = obj(
	{
		name: nameSchema('Component name'),
		weight: { type: 'number', minimum: 0, maximum: 100, description: 'Share of the course grade, in percent (0 to 100)' },
		maxScore: { type: 'number', minimum: 0, description: 'Full marks for the component (greater than 0)' },
		score: nullableNumber('Marks scored, out of maxScore, or null to clear'),
		bestOf: { type: ['integer', 'null'], minimum: 1, description: 'Count only the best N sub-items, or null for all' },
		statsMode: { type: 'string', enum: ['global', 'per-sub'], description: 'How class stats are applied' },
		scale: SCALE,
		...CLASS_STATS
	},
	[]
);

const SUB_ITEM_CHANGES: JsonSchema = obj(
	{
		name: nameSchema('Sub-item name'),
		maxScore: { type: 'number', minimum: 0, description: 'Full marks for the sub-item (greater than 0)' },
		score: nullableNumber('Marks scored, out of maxScore, or null to clear'),
		scale: SCALE,
		...CLASS_STATS
	},
	[]
);

const COURSE_CHANGES: JsonSchema = obj(
	{
		name: nameSchema('Short course code, e.g. CS1.301'),
		fullName: nameSchema('Full course title'),
		classSize: { type: ['integer', 'null'], minimum: 1, description: 'Number of students in the class, or null' },
		credits: { type: ['number', 'null'], minimum: 0, maximum: 40, description: 'Course credits (0 to 40), or null' },
		officialGrade: {
			type: ['string', 'null'],
			enum: [...LETTERS, null],
			description: 'Final letter grade once released, or null to clear'
		},
		hideAbsoluteGrade: { type: 'boolean', description: 'Hide the absolute grade on the course' },
		hideRelativeGrade: { type: 'boolean', description: 'Hide the curved (relative) grade on the course' }
	},
	[]
);

const ID_PROP = (description: string) => idSchema(description);

// ─── Component and sub-item edits ────────────────────────────────────────────

function updateCourse(args: Record<string, unknown>, ctx: ToolContext) {
	const userId = ctx.auth.userId;
	const courseId = requireId(args.courseId, 'courseId');
	const changes = validateChanges(args.changes, { ...v.COURSE_FIELDS, ...HIDE_FIELDS });
	const course = courseOrThrow(userId, courseId);
	const change = applyFieldEdits(ctx, {
		tool: 'update_course',
		courseId,
		label: course.name,
		current: course,
		changes,
		write: (field, value) => {
			if (field === 'hideAbsoluteGrade' || field === 'hideRelativeGrade') {
				written(updateCourseGradeVisibility(userId, courseId, field, value === true));
			} else {
				written(updateCourseField(userId, courseId, field, value));
			}
		},
		undo: (field, value) => ({ op: 'setCourse', id: courseId, field, value })
	});
	if (!change) return { changed: false };
	return courseResult(ctx, change, courseId);
}

function updateComponent(args: Record<string, unknown>, ctx: ToolContext) {
	const userId = ctx.auth.userId;
	const componentId = requireId(args.componentId, 'componentId');
	const changes = validateChanges(args.changes, v.COMPONENT_FIELDS);
	const { course, component } = componentOrThrow(userId, componentId);
	const change = applyFieldEdits(ctx, {
		tool: 'update_component',
		courseId: course.id,
		label: `${course.name} · ${component.name}`,
		current: component,
		changes,
		write: (field, value) => written(updateComponentField(userId, componentId, field, value)),
		undo: (field, value) => ({ op: 'setComponent', id: componentId, field, value })
	});
	if (!change) return { changed: false };
	return courseResult(ctx, change, course.id);
}

function updateSubItem(args: Record<string, unknown>, ctx: ToolContext) {
	const userId = ctx.auth.userId;
	const subItemId = requireId(args.subItemId, 'subItemId');
	const changes = validateChanges(args.changes, v.SUB_ITEM_FIELDS);
	const { course, parent, subItem } = subItemOrThrow(userId, subItemId);
	const change = applyFieldEdits(ctx, {
		tool: 'update_sub_item',
		courseId: course.id,
		label: `${course.name} · ${parent.name} · ${subItem.name}`,
		current: subItem,
		changes,
		write: (field, value) => written(updateSubItemField(userId, subItemId, field, value)),
		undo: (field, value) => ({ op: 'setSubItem', id: subItemId, field, value })
	});
	if (!change) return { changed: false };
	return courseResult(ctx, change, course.id);
}

function setScores(args: Record<string, unknown>, ctx: ToolContext) {
	const userId = ctx.auth.userId;
	const raw = args.scores;
	if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) {
		throw new ToolError('scores must be an array of 1 to 50 entries');
	}

	const seen = new Set<string>();
	const entries = raw.map((entry: unknown, index: number) => {
		if (!entry || typeof entry !== 'object') throw new ToolError(`scores[${index}] must be an object`);
		const { id, score } = entry as Record<string, unknown>;
		const itemId = requireId(id, `scores[${index}].id`);
		if (seen.has(itemId)) throw new ToolError(`Duplicate id ${itemId}`);
		seen.add(itemId);
		if (score === undefined) throw new ToolError(`scores[${index}].score is required (a number or null)`);
		const checked = v.nonNegativeOrNull(score);
		if (!checked.ok) throw new ToolError(`scores[${index}].score: ${checked.error}`);
		const location = getItemLocation(userId, itemId);
		if (!location) throw new ToolError(`No component or sub-item with id ${itemId}`);
		return { id: itemId, score: checked.value as number | null, courseId: location.courseId };
	});

	const byCourse = new Map<string, typeof entries>();
	for (const entry of entries) byCourse.set(entry.courseId, [...(byCourse.get(entry.courseId) ?? []), entry]);

	const logged = runInTransaction(() => {
		const results: { change: AgentChange; courseId: string }[] = [];
		for (const [courseId, group] of byCourse) {
			const course = courseOrThrow(userId, courseId);
			const items = indexItems(course);
			const diffs = group.filter((entry) => !sameValue(items.get(entry.id)?.score, entry.score));
			if (diffs.length === 0) continue;

			const parts: string[] = [];
			const undo: UndoOp[] = [];
			for (const diff of diffs) {
				const item = items.get(diff.id)!;
				parts.push(`${item.name}: ${show(item.score)} → ${show(diff.score)}`);
				undo.push(
					item.kind === 'component'
						? { op: 'setComponent', id: diff.id, field: 'score', value: item.score }
						: { op: 'setSubItem', id: diff.id, field: 'score', value: item.score }
				);
				written(
					item.kind === 'component'
						? updateComponentField(userId, diff.id, 'score', diff.score)
						: updateSubItemField(userId, diff.id, 'score', diff.score)
				);
			}
			const change = recordChange(ctx.auth, {
				tool: 'set_scores',
				summary: `${course.name} · ${parts.join(', ')}`,
				courseId,
				undo
			});
			results.push({ change, courseId });
		}
		return results;
	});

	if (logged.length === 0) return { changed: false };
	return {
		changed: true,
		changes: logged.map((result) => ({ changeId: result.change.id, summary: result.change.summary, courseId: result.courseId })),
		courses: logged.map((result) => describeCourse(courseOrThrow(userId, result.courseId)))
	};
}

// ─── Adds and deletes ────────────────────────────────────────────────────────

function addComponentTool(args: Record<string, unknown>, ctx: ToolContext) {
	const userId = ctx.auth.userId;
	const courseId = requireId(args.courseId, 'courseId');
	const course = courseOrThrow(userId, courseId);
	const fields = validateFields(
		{ name: args.name, weight: args.weight, maxScore: args.maxScore, score: args.score, bestOf: args.bestOf },
		v.COMPONENT_FIELDS
	);
	if (typeof fields.name !== 'string') throw new ToolError('name is required');
	const { name, ...extras } = fields;

	const id = crypto.randomUUID();
	const change = runInTransaction(() => {
		written(addComponent(userId, courseId, id, name as string));
		for (const [field, value] of Object.entries(extras)) written(updateComponentField(userId, id, field, value));
		return recordChange(ctx.auth, {
			tool: 'add_component',
			summary: `${course.name} · added ${name}`,
			courseId,
			undo: [{ op: 'deleteComponent', id }]
		});
	});
	return courseResult(ctx, change, courseId);
}

function addSubItemTool(args: Record<string, unknown>, ctx: ToolContext) {
	const userId = ctx.auth.userId;
	const componentId = requireId(args.componentId, 'componentId');
	const { course, component } = componentOrThrow(userId, componentId);
	const fields = validateFields({ name: args.name, maxScore: args.maxScore, score: args.score }, v.SUB_ITEM_FIELDS);
	if (typeof fields.name !== 'string' || typeof fields.maxScore !== 'number') {
		throw new ToolError('name and maxScore are required');
	}

	const id = crypto.randomUUID();
	const name = fields.name;
	const change = runInTransaction(() => {
		written(addSubItem(userId, componentId, id, name, fields.maxScore as number));
		if (fields.score !== undefined && fields.score !== null) {
			written(updateSubItemField(userId, id, 'score', fields.score));
		}
		return recordChange(ctx.auth, {
			tool: 'add_sub_item',
			summary: `${course.name} · ${component.name}: added ${name}`,
			courseId: course.id,
			undo: [{ op: 'deleteSubItem', id }]
		});
	});
	return courseResult(ctx, change, course.id);
}

function deleteComponentTool(args: Record<string, unknown>, ctx: ToolContext) {
	const userId = ctx.auth.userId;
	const componentId = requireId(args.componentId, 'componentId');
	const { course, component, sortOrder } = componentOrThrow(userId, componentId);
	const subIds = (component.subItems ?? []).map((sub) => sub.id);
	const scaleRefs = findScaleRefs([componentId, ...subIds]);

	const change = runInTransaction(() => {
		deleteComponent(userId, componentId);
		return recordChange(ctx.auth, {
			tool: 'delete_component',
			summary: `${course.name} · deleted ${component.name}`,
			courseId: course.id,
			undo: [{ op: 'restoreComponent', courseId: course.id, sortOrder, component, scaleRefs }]
		});
	});
	return courseResult(ctx, change, course.id);
}

function deleteSubItemTool(args: Record<string, unknown>, ctx: ToolContext) {
	const userId = ctx.auth.userId;
	const subItemId = requireId(args.subItemId, 'subItemId');
	const { course, parent, subItem, sortOrder } = subItemOrThrow(userId, subItemId);
	const scaleRefs = findScaleRefs([subItemId]);

	const change = runInTransaction(() => {
		deleteSubItem(userId, subItemId);
		return recordChange(ctx.auth, {
			tool: 'delete_sub_item',
			summary: `${course.name} · ${parent.name}: deleted ${subItem.name}`,
			courseId: course.id,
			undo: [{ op: 'restoreSubItem', componentId: parent.id, sortOrder, subItem, scaleRefs }]
		});
	});
	return courseResult(ctx, change, course.id);
}

function reorderComponentsTool(args: Record<string, unknown>, ctx: ToolContext) {
	const userId = ctx.auth.userId;
	const courseId = requireId(args.courseId, 'courseId');
	const course = courseOrThrow(userId, courseId);
	const order = args.order;
	if (!Array.isArray(order) || !order.every(v.isSafeId)) throw new ToolError('order must be an array of component ids');

	const known = new Set(course.components.map((component) => component.id));
	const requested = new Set<string>();
	for (const id of order as string[]) {
		if (!known.has(id)) throw new ToolError(`Component ${id} is not in this course`);
		if (requested.has(id)) throw new ToolError(`Duplicate component id ${id} in order`);
		requested.add(id);
	}

	const current = course.components.map((component) => component.id);
	const next = [...(order as string[]), ...current.filter((id) => !requested.has(id))];
	if (next.every((id, index) => id === current[index])) return { changed: false };

	const change = runInTransaction(() => {
		reorderComponents(userId, courseId, order as string[]);
		return recordChange(ctx.auth, {
			tool: 'reorder_components',
			summary: `${course.name}: reordered components`,
			courseId,
			undo: [{ op: 'reorderComponents', courseId, order: current }]
		});
	});
	return courseResult(ctx, change, courseId);
}

function addCourseTool(args: Record<string, unknown>, ctx: ToolContext) {
	const userId = ctx.auth.userId;
	let semesterId: string;
	if (args.semesterId === undefined) {
		const active = getActiveSemester(userId);
		if (!active) throw new ToolError('No active semester. Pass semesterId, or create one with create_semester first.');
		semesterId = active;
	} else {
		semesterId = requireId(args.semesterId, 'semesterId');
		if (!semesterExists(userId, semesterId)) throw new ToolError('Semester not found');
	}

	const fields = validateFields({ name: args.name, fullName: args.fullName, credits: args.credits }, v.COURSE_FIELDS);
	if (typeof fields.name !== 'string' || typeof fields.fullName !== 'string') {
		throw new ToolError('name and fullName are required');
	}
	const color =
		args.color === undefined
			? COURSE_COLORS[getCoursesBySemester(userId, semesterId).length % COURSE_COLORS.length]
			: validateFields({ color: args.color }, { color: v.color }).color as string;

	const name = fields.name;
	const fullName = fields.fullName;
	const created = runInTransaction(() => {
		const added = addCourseWithDefaults(userId, name, fullName, color, semesterId);
		if (!added.ok) throw new ToolError(added.error);
		const courseId = added.value.id;
		if (fields.credits !== undefined) written(updateCourseField(userId, courseId, 'credits', fields.credits));
		const change = recordChange(ctx.auth, {
			tool: 'add_course',
			summary: `Added course ${name}`,
			courseId,
			undo: [{ op: 'deleteCourse', id: courseId }]
		});
		return { change, courseId };
	});
	return courseResult(ctx, created.change, created.courseId);
}

function deleteCourseTool(args: Record<string, unknown>, ctx: ToolContext) {
	const userId = ctx.auth.userId;
	const courseId = requireId(args.courseId, 'courseId');
	const course = courseOrThrow(userId, courseId);
	if (!course.semesterId) throw new ToolError('Course is not in a semester');

	const change = runInTransaction(() => {
		deleteCourse(userId, courseId);
		return recordChange(ctx.auth, {
			tool: 'delete_course',
			summary: `Deleted course ${course.name}`,
			courseId,
			undo: [{ op: 'restoreCourse', semesterId: course.semesterId as string, course }]
		});
	});
	return { changeId: change.id, summary: change.summary, deleted: true };
}

// ─── Semesters ───────────────────────────────────────────────────────────────

function semesterOrThrow(userId: string, semesterId: string) {
	const semester = getAllSemesters(userId).find((item) => item.id === semesterId);
	if (!semester) throw new ToolError('Semester not found');
	return semester;
}

function createSemesterTool(args: Record<string, unknown>, ctx: ToolContext) {
	const userId = ctx.auth.userId;
	const branch = args.branch;
	if (typeof branch !== 'string' || !BRANCHES.includes(branch)) {
		throw new ToolError(`Unknown branch. Valid branches: ${BRANCHES.join(', ')}`);
	}
	const semester = args.semester;
	const semesters = getSemesters(branch);
	if (typeof semester !== 'string' || !semesters.includes(semester)) {
		throw new ToolError(`Unknown semester for ${branch}. Valid semesters: ${semesters.join(', ')}`);
	}

	const catalog = getCourses(branch, semester);
	let selected = catalog;
	if (args.courseIds !== undefined) {
		if (!Array.isArray(args.courseIds) || !args.courseIds.every(v.isSafeId)) {
			throw new ToolError('courseIds must be an array of course ids');
		}
		const wanted = new Set(args.courseIds as string[]);
		for (const id of wanted) {
			if (!catalog.some((course) => course.id === id)) throw new ToolError(`Course ${id} is not in ${branch} ${semester}`);
		}
		selected = catalog.filter((course) => wanted.has(course.id));
	}

	const labelChecked = v.name(args.label === undefined ? `${branch} ${semester}` : args.label);
	if (!labelChecked.ok) throw new ToolError(`label: ${labelChecked.error}`);
	const label = labelChecked.value as string;

	const previous = getActiveSemester(userId);
	const id = crypto.randomUUID();
	const change = runInTransaction(() => {
		createSemesterWithCourses(userId, id, label, branch, semester, selected);
		const undo: UndoOp[] = [];
		if (previous) undo.push({ op: 'setActiveSemester', id: previous });
		undo.push({ op: 'deleteSemester', id });
		return recordChange(ctx.auth, {
			tool: 'create_semester',
			summary: `Created ${label} with ${selected.length} courses`,
			courseId: null,
			undo
		});
	});
	return { changeId: change.id, summary: change.summary, semesterId: id, semesters: getAllSemesters(userId) };
}

function setActiveSemesterTool(args: Record<string, unknown>, ctx: ToolContext) {
	const userId = ctx.auth.userId;
	const semesterId = requireId(args.semesterId, 'semesterId');
	const target = semesterOrThrow(userId, semesterId);
	const previous = getActiveSemester(userId);
	if (previous === semesterId) return { changed: false };

	const change = runInTransaction(() => {
		written(setActiveSemester(userId, semesterId));
		return recordChange(ctx.auth, {
			tool: 'set_active_semester',
			summary: `Switched active semester to ${target.label}`,
			courseId: null,
			undo: previous ? [{ op: 'setActiveSemester', id: previous }] : []
		});
	});
	return { changed: true, changeId: change.id, summary: change.summary, semesters: getAllSemesters(userId) };
}

function renameSemesterTool(args: Record<string, unknown>, ctx: ToolContext) {
	const userId = ctx.auth.userId;
	const semesterId = requireId(args.semesterId, 'semesterId');
	const labelChecked = v.name(args.label);
	if (!labelChecked.ok) throw new ToolError(`label: ${labelChecked.error}`);
	const label = labelChecked.value as string;
	const target = semesterOrThrow(userId, semesterId);
	if (target.label === label) return { changed: false };

	const change = runInTransaction(() => {
		written(renameSemester(userId, semesterId, label));
		return recordChange(ctx.auth, {
			tool: 'rename_semester',
			summary: `Renamed ${target.label} to ${label}`,
			courseId: null,
			undo: [{ op: 'renameSemester', id: semesterId, label: target.label }]
		});
	});
	return { changed: true, changeId: change.id, summary: change.summary, semesters: getAllSemesters(userId) };
}

function undoChangeTool(args: Record<string, unknown>, ctx: ToolContext) {
	const changeId = requireId(args.changeId, 'changeId');
	const result = undoChange(ctx.auth.userId, changeId);
	if (!result.ok) throw new ToolError(result.error);
	return { undone: true };
}

// ─── Tool definitions ────────────────────────────────────────────────────────

const WRITE_ANNOTATIONS = { readOnlyHint: false, openWorldHint: false } as const;
const UPDATE_ANNOTATIONS = { ...WRITE_ANNOTATIONS, idempotentHint: true } as const;
const DELETE_ANNOTATIONS = { ...WRITE_ANNOTATIONS, destructiveHint: true } as const;

export const writeTools: Tool[] = [
	{
		name: 'update_course',
		title: 'Update course',
		description:
			'Change a course: name, full name, class size, credits, official letter grade, or whether its absolute and curved grades are hidden. Only the listed fields change.',
		inputSchema: obj(
			{ courseId: ID_PROP('Course id'), changes: COURSE_CHANGES },
			['courseId', 'changes']
		),
		scope: 'write',
		annotations: UPDATE_ANNOTATIONS,
		handler: updateCourse
	},
	{
		name: 'update_component',
		title: 'Update component',
		description:
			'Change a graded component (e.g. Midsem): weight in percent of the course, full marks, score, best-of count, stats mode, scale target and class statistics. Pass null to clear a nullable field.',
		inputSchema: obj(
			{ componentId: ID_PROP('Component id'), changes: COMPONENT_CHANGES },
			['componentId', 'changes']
		),
		scope: 'write',
		annotations: UPDATE_ANNOTATIONS,
		handler: updateComponent
	},
	{
		name: 'update_sub_item',
		title: 'Update sub-item',
		description:
			'Change a sub-item (e.g. Quiz 1 inside a Quiz component): name, full marks, score, scale target and class statistics. Pass null to clear a nullable field.',
		inputSchema: obj(
			{ subItemId: ID_PROP('Sub-item id'), changes: SUB_ITEM_CHANGES },
			['subItemId', 'changes']
		),
		scope: 'write',
		annotations: UPDATE_ANNOTATIONS,
		handler: updateSubItem
	},
	{
		name: 'set_scores',
		title: 'Set scores',
		description:
			'Set the scores of up to 50 components or sub-items in one call; they may span several courses. A score is in the item\'s own marks (out of its maxScore), or null to clear it. One change is logged per course.',
		inputSchema: obj(
			{
				scores: {
					type: 'array',
					minItems: 1,
					maxItems: 50,
					description: 'Scores to set',
					items: obj(
						{
							id: idSchema('Component or sub-item id'),
							score: nullableNumber('Marks scored, or null to clear')
						},
						['id', 'score']
					)
				}
			},
			['scores']
		),
		scope: 'write',
		annotations: UPDATE_ANNOTATIONS,
		handler: setScores
	},
	{
		name: 'add_component',
		title: 'Add component',
		description:
			'Add a graded component to a course, e.g. "Project". Weight defaults to 0 and full marks to 100. Undo removes it again.',
		inputSchema: obj(
			{
				courseId: ID_PROP('Course id'),
				name: nameSchema('Component name'),
				weight: { type: 'number', minimum: 0, maximum: 100, description: 'Share of the course grade, in percent' },
				maxScore: { type: 'number', minimum: 0, description: 'Full marks (greater than 0)' },
				score: nullableNumber('Marks scored, or null'),
				bestOf: { type: ['integer', 'null'], minimum: 1, description: 'Count only the best N sub-items, or null' }
			},
			['courseId', 'name']
		),
		scope: 'write',
		annotations: WRITE_ANNOTATIONS,
		handler: addComponentTool
	},
	{
		name: 'add_sub_item',
		title: 'Add sub-item',
		description: 'Add a sub-item (e.g. "Quiz 3") to a component. Undo removes it again.',
		inputSchema: obj(
			{
				componentId: ID_PROP('Component id'),
				name: nameSchema('Sub-item name'),
				maxScore: { type: 'number', minimum: 0, description: 'Full marks (greater than 0)' },
				score: nullableNumber('Marks scored, or null')
			},
			['componentId', 'name', 'maxScore']
		),
		scope: 'write',
		annotations: WRITE_ANNOTATIONS,
		handler: addSubItemTool
	},
	{
		name: 'delete_component',
		title: 'Delete component',
		description:
			'Delete a component and its sub-items. Scale references to them are cleared. Undo restores the component at its old position, with its ids and scale references.',
		inputSchema: obj({ componentId: ID_PROP('Component id') }, ['componentId']),
		scope: 'write',
		annotations: DELETE_ANNOTATIONS,
		handler: deleteComponentTool
	},
	{
		name: 'delete_sub_item',
		title: 'Delete sub-item',
		description:
			'Delete a sub-item. Scale references to it are cleared. Undo restores it at its old position, with its id and scale references.',
		inputSchema: obj({ subItemId: ID_PROP('Sub-item id') }, ['subItemId']),
		scope: 'write',
		annotations: DELETE_ANNOTATIONS,
		handler: deleteSubItemTool
	},
	{
		name: 'reorder_components',
		title: 'Reorder components',
		description:
			'Set the display order of a course\'s components. Pass component ids in the new order; ids left out keep their relative order after the listed ones.',
		inputSchema: obj(
			{
				courseId: ID_PROP('Course id'),
				order: { type: 'array', description: 'Component ids in the new order', items: { type: 'string', minLength: 1, maxLength: 255 } }
			},
			['courseId', 'order']
		),
		scope: 'write',
		annotations: UPDATE_ANNOTATIONS,
		handler: reorderComponentsTool
	},
	{
		name: 'add_course',
		title: 'Add course',
		description:
			'Add a course with the default component layout (Quiz, Midsem, Endsem) to a semester. Defaults to the active semester. Undo deletes it.',
		inputSchema: obj(
			{
				semesterId: ID_PROP('Semester id; defaults to the active semester'),
				name: nameSchema('Short course code, e.g. CS1.301'),
				fullName: nameSchema('Full course title'),
				credits: { type: 'number', minimum: 0, maximum: 40, description: 'Course credits (0 to 40)' },
				color: { type: 'string', description: 'Hex color such as #4f46e5; picked automatically if omitted' }
			},
			['name', 'fullName']
		),
		scope: 'write',
		annotations: WRITE_ANNOTATIONS,
		handler: addCourseTool
	},
	{
		name: 'delete_course',
		title: 'Delete course',
		description:
			'Delete a course and all its components. Undo recreates it with the same ids, components and scale references.',
		inputSchema: obj({ courseId: ID_PROP('Course id') }, ['courseId']),
		scope: 'write',
		annotations: DELETE_ANNOTATIONS,
		handler: deleteCourseTool
	},
	{
		name: 'create_semester',
		title: 'Create semester',
		description:
			'Create a semester from the catalog for a branch and semester (e.g. branch "CGD", semester "Semester 1") and make it active. Pass courseIds to pick a subset of the catalog courses; by default all are added.',
		inputSchema: obj(
			{
				branch: { type: 'string', description: 'Branch code from the catalog, e.g. CGD' },
				semester: { type: 'string', description: 'Catalog semester name, e.g. "Semester 1"' },
				label: nameSchema('Display name; defaults to "<branch> <semester>"'),
				courseIds: {
					type: 'array',
					description: 'Catalog course ids to include; omit for all',
					items: { type: 'string', minLength: 1, maxLength: 255 }
				}
			},
			['branch', 'semester']
		),
		scope: 'write',
		annotations: WRITE_ANNOTATIONS,
		handler: createSemesterTool
	},
	{
		name: 'set_active_semester',
		title: 'Set active semester',
		description: 'Make a semester the active one shown on the dashboard.',
		inputSchema: obj({ semesterId: ID_PROP('Semester id') }, ['semesterId']),
		scope: 'write',
		annotations: UPDATE_ANNOTATIONS,
		handler: setActiveSemesterTool
	},
	{
		name: 'rename_semester',
		title: 'Rename semester',
		description: 'Change the display name of a semester.',
		inputSchema: obj(
			{ semesterId: ID_PROP('Semester id'), label: nameSchema('New display name') },
			['semesterId', 'label']
		),
		scope: 'write',
		annotations: UPDATE_ANNOTATIONS,
		handler: renameSemesterTool
	},
	{
		name: 'undo_change',
		title: 'Undo change',
		description:
			'Undo a change from the change log by its changeId. Fails with a reason if the affected items changed since (for example, were deleted). An undo is not itself logged.',
		inputSchema: obj({ changeId: ID_PROP('Change id from the change log') }, ['changeId']),
		scope: 'write',
		annotations: WRITE_ANNOTATIONS,
		handler: undoChangeTool
	}
];
