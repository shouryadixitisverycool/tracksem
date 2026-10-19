import { json } from '@sveltejs/kit';
import { seedByBranch, semesterExists } from '$lib/server/db';
import { getCourses } from '$lib/data/courses';
import { isSafeId, jsonError, readJsonObject } from '$lib/server/validation';
import type { RequestHandler } from './$types';

/** POST /api/courses/seed → seed catalog courses for a branch + semester into an existing semester */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readJsonObject(request);
	if (!body || !isSafeId(body.semesterId)) return jsonError(400, 'Missing or invalid semesterId');
	if (!semesterExists(body.semesterId)) return jsonError(404, 'Semester not found');

	const catalogCourses = getCourses(String(body.branch ?? ''), String(body.semester ?? ''));
	if (catalogCourses.length === 0) {
		return jsonError(400, 'No catalog courses found for this branch and semester');
	}
	return json(seedByBranch(catalogCourses, body.semesterId));
};
