import { json } from '@sveltejs/kit';
import { addComponent, updateComponentField, deleteComponent, reorderComponents } from '$lib/server/db';
import * as v from '$lib/server/validation';
import type { RequestHandler } from './$types';

/** POST /api/components → add a new component */
export const POST: RequestHandler = async ({ request }) => {
	const body = await v.readJsonObject(request);
	if (!body || !v.isSafeId(body.courseId) || !v.isSafeId(body.id)) return v.jsonError(400, 'Missing or invalid ids');
	const name = v.name(body.name);
	if (!name.ok) return v.jsonError(400, name.error);
	const result = addComponent(body.courseId, body.id, name.value as string);
	return result.ok ? json({ ok: true }) : v.jsonError(result.status, result.error);
};

/** PATCH /api/components → update one field ({ id, field, value }) or the order ({ courseId, order }) */
export const PATCH: RequestHandler = async ({ request }) => {
	const body = await v.readJsonObject(request);
	if (!body) return v.jsonError(400, 'Invalid request body');
	if (body.order !== undefined) {
		if (!v.isSafeId(body.courseId) || !Array.isArray(body.order) || !body.order.every(v.isSafeId)) {
			return v.jsonError(400, 'Invalid component order');
		}
		reorderComponents(body.courseId, body.order);
		return json({ ok: true });
	}
	if (!v.isSafeId(body.id)) return v.jsonError(400, 'Missing or invalid id');
	const result = updateComponentField(body.id, body.field as string, body.value);
	return result.ok ? json({ ok: true }) : v.jsonError(result.status, result.error);
};

/** DELETE /api/components → remove a component (scale targets pointing at it are cleared) */
export const DELETE: RequestHandler = async ({ request }) => {
	const body = await v.readJsonObject(request);
	if (!body || !v.isSafeId(body.id)) return v.jsonError(400, 'Missing or invalid id');
	deleteComponent(body.id);
	return json({ ok: true });
};
