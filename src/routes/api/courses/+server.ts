import { json } from '@sveltejs/kit';
import {
	addCourseWithDefaults,
	deleteCourse,
	getAllCourses,
	getCoursesBySemester,
	getEveryCourse,
	updateCourseField,
	updateCourseGradeVisibility
} from '$lib/server/db';
import * as v from '$lib/server/validation';
import type { RequestHandler } from './$types';

/** GET /api/courses?semesterId=… | ?all=1 (every semester) | (active semester) */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (url.searchParams.get('all') === '1') return json(getEveryCourse(locals.user!.id));
	const semesterId = url.searchParams.get('semesterId');
	if (semesterId !== null && !v.isSafeId(semesterId)) return v.jsonError(400, 'Invalid semesterId');
	return json(semesterId ? getCoursesBySemester(locals.user!.id, semesterId) : getAllCourses(locals.user!.id));
};

/** PATCH /api/courses → { id, field, value } (visibility fields also accept { hidden }) */
export const PATCH: RequestHandler = async ({ request, locals }) => {
	const body = await v.readJsonObject(request);
	if (!body || !v.isSafeId(body.id)) return v.jsonError(400, 'Invalid course id');
	const { id, field } = body;

	if (field === 'hideAbsoluteGrade' || field === 'hideRelativeGrade') {
		const hidden = body.hidden ?? body.value;
		if (typeof hidden !== 'boolean') return v.jsonError(400, 'Invalid grade visibility settings');
		if (!updateCourseGradeVisibility(locals.user!.id, id, field, hidden)) return v.jsonError(404, 'Course not found');
		return json({ ok: true });
	}

	const result = updateCourseField(locals.user!.id, id, field as string, body.value);
	return result.ok ? json({ ok: true }) : v.jsonError(result.status, result.error);
};

/** POST /api/courses → add a new course with default components */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await v.readJsonObject(request);
	if (!body) return v.jsonError(400, 'Invalid request body');
	const name = v.name(body.name);
	const fullName = v.name(body.fullName ?? body.name);
	const color = v.color(body.color);
	if (!name.ok || !fullName.ok || !color.ok) return v.jsonError(400, 'Missing or invalid name, full name or color');
	if (body.semesterId != null && !v.isSafeId(body.semesterId)) return v.jsonError(400, 'Invalid semesterId');

	const result = addCourseWithDefaults(
		locals.user!.id,
		name.value as string,
		fullName.value as string,
		color.value as string,
		(body.semesterId as string | undefined) ?? undefined
	);
	return result.ok ? json(result.value) : v.jsonError(result.status, result.error);
};

/** DELETE /api/courses → delete a course */
export const DELETE: RequestHandler = async ({ request, locals }) => {
	const body = await v.readJsonObject(request);
	if (!body || !v.isSafeId(body.id)) return v.jsonError(400, 'Missing or invalid id');
	deleteCourse(locals.user!.id, body.id);
	return json({ ok: true });
};
