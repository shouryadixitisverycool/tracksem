import { json } from '@sveltejs/kit';
import { setActiveSemester } from '$lib/server/db';
import { isSafeId, jsonError, readJsonObject } from '$lib/server/validation';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await readJsonObject(request);
	if (!body || !isSafeId(body.id)) return jsonError(400, 'Missing or invalid id');
	if (!setActiveSemester(body.id)) return jsonError(404, 'Semester not found');
	return json({ ok: true });
};
