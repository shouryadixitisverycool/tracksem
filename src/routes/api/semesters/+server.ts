import { json } from '@sveltejs/kit';
import {
	getAllSemesters,
	createSemester,
	createSemesterWithCourses,
	renameSemester,
	reorderSemesters,
	deleteSemester,
	semesterIdTaken
} from '$lib/server/db';
import { getCourses } from '$lib/data/courses';
import * as v from '$lib/server/validation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	return json(getAllSemesters(locals.user!.id));
};

/**
 * POST /api/semesters → { id?, label, branch, semester, seed? }
 * Creates the semester (active) and, with seed: true, its catalog courses in one transaction.
 * Responds with { semester, courses }.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await v.readJsonObject(request);
	if (!body) return v.jsonError(400, 'Invalid request body');
	const id = body.id ?? crypto.randomUUID();
	if (!v.isSafeId(id)) return v.jsonError(400, 'Invalid semester id');
	if (semesterIdTaken(id)) return v.jsonError(409, 'Semester id already exists');

	const label = v.name(body.label);
	if (!label.ok || typeof body.branch !== 'string' || !body.branch || typeof body.semester !== 'string' || !body.semester) {
		return v.jsonError(400, 'Missing or invalid label, branch or semester');
	}

	if (body.seed === true) {
		const catalogCourses = getCourses(body.branch, body.semester);
		if (catalogCourses.length === 0) return v.jsonError(400, 'No catalog courses found for this branch and semester');
		return json(createSemesterWithCourses(locals.user!.id, id, label.value as string, body.branch, body.semester, catalogCourses));
	}

	return json({ semester: createSemester(locals.user!.id, id, label.value as string, body.branch, body.semester), courses: [] });
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	const body = await v.readJsonObject(request);
	if (!body) return v.jsonError(400, 'Invalid request body');
	if (body.order !== undefined) {
		if (!Array.isArray(body.order) || !body.order.every(v.isSafeId)) return v.jsonError(400, 'Invalid semester order');
		reorderSemesters(locals.user!.id, body.order);
		return json({ ok: true });
	}
	const label = v.name(body.label);
	if (!v.isSafeId(body.id) || !label.ok) return v.jsonError(400, 'Missing or invalid id or label');
	if (!renameSemester(locals.user!.id, body.id, label.value as string)) return v.jsonError(404, 'Semester not found');
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const body = await v.readJsonObject(request);
	if (!body || !v.isSafeId(body.id)) return v.jsonError(400, 'Missing or invalid id');
	deleteSemester(locals.user!.id, body.id);
	return json({ ok: true });
};
