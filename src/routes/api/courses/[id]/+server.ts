import { json } from '@sveltejs/kit';
import { getCourse } from '$lib/server/db';
import { isSafeId, jsonError } from '$lib/server/validation';
import type { RequestHandler } from './$types';

/** GET /api/courses/:id → a single course (any semester), including its semesterId */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!isSafeId(params.id)) return jsonError(400, 'Invalid course id');
	const course = getCourse(locals.user!.id, params.id);
	return course ? json(course) : jsonError(404, 'Course not found');
};
