import { json } from '@sveltejs/kit';
import { resetCourse } from '$lib/server/db';
import { isSafeId, jsonError } from '$lib/server/validation';
import type { RequestHandler } from './$types';

/** POST /api/courses/:id/reset → restore the catalog template's components; returns the course */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!isSafeId(params.id)) return jsonError(400, 'Invalid course id');
	const result = resetCourse(locals.user!.id, params.id);
	return result.ok ? json(result.value) : jsonError(result.status, result.error);
};
