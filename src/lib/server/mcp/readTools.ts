// Read-only MCP tools: grades, projections and the change log. All scoped to the token's user.
import type { Course } from '$lib/types';
import { BRANCHES, COURSE_CREDITS, getCourses, getSemesters } from '$lib/data/courses';
import { CURVED_CUTOFFS, LETTER_CUTOFFS } from '$lib/grading';
import { computeEffectiveCompPct, requiredScoreForPercentile } from '$lib/gradeMath';
import { courseProgress, requiredAcrossRemaining, requiredPct } from '$lib/need';
import { listChanges } from '$lib/server/audit';
import { getAllSemesters, getCourse, getCoursesBySemester, getEveryCourse } from '$lib/server/db';
import { isSafeId } from '$lib/server/validation';
import { cumulativeGpa, round2, semesterGpa, summarizeCourse, describeCourse } from './summaries';
import { ToolError, type Tool, type ToolContext } from './types';

const readOnly = { readOnlyHint: true, openWorldHint: false };

const LETTER_MIN = new Map<string, number>(LETTER_CUTOFFS.map((cutoff) => [cutoff.letter, cutoff.min]));
const CURVED_PERCENTILE = new Map<string, number>(CURVED_CUTOFFS.map((cutoff) => [cutoff.letter, cutoff.percentile]));
const ABSOLUTE_LETTERS = LETTER_CUTOFFS.map((cutoff) => cutoff.letter);
const CURVED_LETTERS = CURVED_CUTOFFS.map((cutoff) => cutoff.letter);

/** An optional id argument: undefined when absent, ToolError when malformed */
function optionalId(args: Record<string, unknown>, key: string): string | undefined {
	const value = args[key];
	if (value === undefined) return undefined;
	if (!isSafeId(value)) throw new ToolError(`${key} must be an id returned by the list tools`);
	return value;
}

function requireCourse(ctx: ToolContext, value: unknown): Course {
	if (!isSafeId(value)) throw new ToolError('courseId must be an id returned by list_courses');
	const course = getCourse(ctx.auth.userId, value);
	if (!course) throw new ToolError('Course not found');
	return course;
}

function requireComponent(course: Course, componentId: string): Course['components'][number] {
	const comp = course.components.find((item) => item.id === componentId);
	if (!comp) throw new ToolError('Component not found in this course');
	return comp;
}

export const readTools: Tool[] = [
	{
		name: 'list_semesters',
		title: 'List semesters',
		description:
			'List every semester with its id, label, branch, whether it is active, its course count and its SGPA, plus the cumulative GPA (CGPA) over all courses. ' +
			'GPA is on the 10-point scale; each course counts its official grade if released, else its predicted curved letter. ' +
			'Returns { activeSemesterId, semesters: [{ id, label, branch, semester, isActive, courseCount, sgpa }], cgpa }. Null GPA means no graded courses yet.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		scope: 'read',
		annotations: readOnly,
		handler(_args, ctx) {
			const uid = ctx.auth.userId;
			const semesters = getAllSemesters(uid);
			const courses = getEveryCourse(uid);
			const bySemester = new Map<string, Course[]>();
			for (const course of courses) {
				const key = course.semesterId ?? '';
				bySemester.set(key, [...(bySemester.get(key) ?? []), course]);
			}
			return {
				activeSemesterId: semesters.find((sem) => sem.isActive)?.id ?? null,
				semesters: semesters.map((sem) => ({
					id: sem.id,
					label: sem.label,
					branch: sem.branch,
					semester: sem.semester,
					isActive: sem.isActive,
					courseCount: sem.courseCount,
					sgpa: round2(semesterGpa(bySemester.get(sem.id) ?? []).gpa),
				})),
				cgpa: round2(cumulativeGpa(courses).gpa),
			};
		},
	},
	{
		name: 'list_courses',
		title: 'List courses',
		description:
			'List the courses of one semester (default: the active semester) as one summary line each. Percentages are 0–100 of the course. ' +
			'secured and maxPossible are on 0–100 of the whole course (marks already earned, and the best still reachable). ' +
			'Returns { semester: { id, label }, courses: CourseSummary[], sgpa }. Use get_course for the component tree. Ids come from list_semesters.',
		inputSchema: {
			type: 'object',
			properties: {
				semesterId: {
					type: 'string',
					description: 'Semester id from list_semesters. Omit for the active semester.',
				},
			},
			additionalProperties: false,
		},
		scope: 'read',
		annotations: readOnly,
		handler(args, ctx) {
			const uid = ctx.auth.userId;
			const requested = optionalId(args, 'semesterId');
			const semesters = getAllSemesters(uid);
			const sem = requested
				? semesters.find((item) => item.id === requested)
				: semesters.find((item) => item.isActive);
			if (!sem) {
				throw new ToolError(requested ? 'Semester not found' : 'No active semester; pass semesterId from list_semesters');
			}
			const courses = getCoursesBySemester(uid, sem.id);
			return {
				semester: { id: sem.id, label: sem.label },
				courses: courses.map(summarizeCourse),
				sgpa: round2(semesterGpa(courses).gpa),
			};
		},
	},
	{
		name: 'get_course',
		title: 'Get course',
		description:
			'Full course with its editable component tree and computed values. Units: weight and maxScore are the entered numbers; ' +
			'score is raw marks (out of maxScore); pct, classStats and subItem pct are 0–100 percentages. ' +
			'curved is the curve-based standing (letter and percentile) per component and for the course, with coverage (fraction of weight used) ' +
			'and projected letter (ungraded parts filled in). Returns CourseDetail. Ids come from list_courses.',
		inputSchema: {
			type: 'object',
			properties: {
				courseId: { type: 'string', description: 'Course id from list_courses' },
			},
			required: ['courseId'],
			additionalProperties: false,
		},
		scope: 'read',
		annotations: readOnly,
		handler(args, ctx) {
			return describeCourse(requireCourse(ctx, args.courseId));
		},
	},
	{
		name: 'what_do_i_need',
		title: 'What do I need',
		description:
			'Projects the marks needed to reach a target. Give exactly one of: target (an absolute letter: A, A-, B, B-, C, C-, D, ' +
			'which maps to its minimum percentage) or targetPct (0–100, a course percentage). ' +
			'Without componentId: returns the average % needed across all remaining ungraded components. ' +
			'With componentId: returns the % that component must average (requiredPct), the raw marks (requiredMarks, out of maxScore), ' +
			'reachable (requiredPct <= 100) and alreadySecured (target already met). mode applies only with componentId: ' +
			'"same" (default) assumes the other ungraded components score the same % as this one; "last" assumes they are left out, as if this were the last one counted. ' +
			'curved=true: target must be a curved letter (A, A-, B, B-, C), with componentId. It returns the raw score the component needs for that ' +
			'percentile on its class curve (score, out of maxScore), with reachable and assumedStats. It needs class stats entered for the component ' +
			'and an ungraded component. Also returns secured and maxPossible (0–100 of the course).',
		inputSchema: {
			type: 'object',
			properties: {
				courseId: { type: 'string', description: 'Course id from list_courses' },
				target: {
					type: 'string',
					enum: ABSOLUTE_LETTERS,
					description: 'Absolute letter target. With curved=true, use A, A-, B, B- or C instead.',
				},
				targetPct: {
					type: 'number',
					minimum: 0,
					maximum: 100,
					description: 'Target course percentage, 0–100. Not allowed with curved=true.',
				},
				componentId: {
					type: 'string',
					description: 'Component id from get_course. Required for curved=true.',
				},
				mode: {
					type: 'string',
					enum: ['same', 'last'],
					description: '"same" (default): other ungraded parts score like this one. "last": other ungraded parts are ignored. Only with componentId.',
				},
				curved: {
					type: 'boolean',
					description: 'Solve against the curve (percentile letter) instead of absolute marks. Needs componentId.',
				},
			},
			required: ['courseId'],
			additionalProperties: false,
		},
		scope: 'read',
		annotations: readOnly,
		handler(args, ctx) {
			const course = requireCourse(ctx, args.courseId);
			const componentId = optionalId(args, 'componentId');
			const curved = args.curved === undefined ? false : args.curved;
			if (typeof curved !== 'boolean') throw new ToolError('curved must be true or false');

			const hasLetter = args.target !== undefined;
			const hasPct = args.targetPct !== undefined;
			if (hasLetter === hasPct) throw new ToolError('Pass exactly one of target (letter) or targetPct (0-100)');
			if (args.mode !== undefined && !componentId) throw new ToolError('mode only applies together with componentId');
			const mode = args.mode === 'last' ? 'last' : 'same';
			if (args.mode !== undefined && args.mode !== 'same' && args.mode !== 'last') {
				throw new ToolError('mode must be "same" or "last"');
			}

			const progress = courseProgress(course);
			const base = { secured: round2(progress.secured), maxPossible: round2(progress.maxPossible) };
			const letter = hasLetter && typeof args.target === 'string' ? args.target : null;

			if (curved) {
				if (!componentId) throw new ToolError('curved targets need componentId');
				if (letter === null || !CURVED_PERCENTILE.has(letter)) {
					throw new ToolError(`curved target must be one of ${CURVED_LETTERS.join(', ')}`);
				}
				const percentile = CURVED_PERCENTILE.get(letter)!;
				const comp = requireComponent(course, componentId);
				if (computeEffectiveCompPct(course, comp) !== null) {
					throw new ToolError('This component already has a score; curved solving only works for ungraded components');
				}
				const solved = requiredScoreForPercentile(course, componentId, percentile);
				if (!solved) {
					throw new ToolError('This component cannot be projected (it is scaled to another item, has no weight, or no max score)');
				}
				if (solved.assumedStats) {
					throw new ToolError('No class stats are entered for this component, so a curved target cannot be solved. Enter its class average first.');
				}
				return {
					...base,
					componentId,
					target: letter,
					targetPercentile: percentile,
					score: round2(solved.score),
					maxScore: solved.maxScore,
					reachable: solved.reachable,
					assumedStats: solved.assumedStats,
				};
			}

			let targetPct: number;
			if (letter !== null) {
				if (!LETTER_MIN.has(letter)) throw new ToolError(`target must be one of ${ABSOLUTE_LETTERS.join(', ')}`);
				targetPct = LETTER_MIN.get(letter)!;
			} else {
				const value = args.targetPct;
				if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
					throw new ToolError('targetPct must be a number from 0 to 100');
				}
				targetPct = value;
			}

			if (componentId) {
				const comp = requireComponent(course, componentId);
				const required = requiredPct(course, componentId, targetPct, mode);
				if (required === null) throw new ToolError('This component carries no weight, so it cannot move the total');
				return {
					...base,
					componentId,
					target: letter,
					targetPct,
					mode,
					requiredPct: round2(required),
					requiredMarks: round2((required * comp.maxScore) / 100),
					maxScore: comp.maxScore,
					reachable: required <= 100,
					alreadySecured: required <= 0,
				};
			}

			const across = requiredAcrossRemaining(course, targetPct);
			if (!across) {
				return { ...base, target: letter, targetPct, requiredAveragePct: null, remaining: [], note: 'No ungraded components left' };
			}
			return {
				...base,
				target: letter,
				targetPct,
				requiredAveragePct: round2(across.pct),
				reachable: across.pct <= 100,
				alreadySecured: across.pct <= 0,
				remaining: across.remaining.map((comp) => ({ id: comp.id, name: comp.name, weight: comp.weight })),
			};
		},
	},
	{
		name: 'get_catalog',
		title: 'Get catalog',
		description:
			'Curriculum catalog used when creating a semester. With no arguments: returns { branches: [{ name, semesters }] }. ' +
			'With both branch and semester (names exactly as returned here): returns the catalog courses for that semester as ' +
			'{ courses: [{ id, name, fullName, credits, components: [{ name, weight }] }] }. Weights are % of the course, as in the catalog.',
		inputSchema: {
			type: 'object',
			properties: {
				branch: { type: 'string', description: 'Branch name, e.g. CSE. Requires semester.' },
				semester: { type: 'string', description: 'Semester name, e.g. "Semester 1". Requires branch.' },
			},
			additionalProperties: false,
		},
		scope: 'read',
		annotations: readOnly,
		handler(args) {
			const branch = args.branch;
			const semester = args.semester;
			if (branch === undefined && semester === undefined) {
				return {
					branches: BRANCHES.map((name) => ({ name, semesters: getSemesters(name) })),
				};
			}
			if (typeof branch !== 'string' || typeof semester !== 'string') {
				throw new ToolError('Pass both branch and semester, or neither');
			}
			if (!BRANCHES.includes(branch)) throw new ToolError('Unknown branch; call get_catalog with no arguments');
			if (!getSemesters(branch).includes(semester)) throw new ToolError('Unknown semester for this branch');
			return {
				branch,
				semester,
				courses: getCourses(branch, semester).map((course) => ({
					id: course.id,
					name: course.name,
					fullName: course.fullName,
					credits: COURSE_CREDITS[course.id] ?? course.credits ?? null,
					components: course.components.map((comp) => ({ name: comp.name, weight: comp.weight })),
				})),
			};
		},
	},
	{
		name: 'list_recent_changes',
		title: 'List recent changes',
		description:
			'Recent edits made through the agent API, newest first: { changes: [{ id, createdAt, actor, tool, summary, courseId, undoneAt, canUndo }] }. ' +
			'createdAt and undoneAt are epoch milliseconds. Only changes that can still be undone have canUndo true.',
		inputSchema: {
			type: 'object',
			properties: {
				limit: {
					type: 'integer',
					minimum: 1,
					maximum: 100,
					description: 'How many changes to return, 1–100. Default 50.',
				},
			},
			additionalProperties: false,
		},
		scope: 'read',
		annotations: readOnly,
		handler(args, ctx) {
			const limit = args.limit === undefined ? 50 : args.limit;
			if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) {
				throw new ToolError('limit must be an integer from 1 to 100');
			}
			return { changes: listChanges(ctx.auth.userId, limit) };
		},
	},
];
