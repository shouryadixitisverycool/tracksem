import { json } from '@sveltejs/kit';
import { addSubItem, updateSubItemField, deleteSubItem, getSubItemCount } from '$lib/server/db';
import * as v from '$lib/server/validation';
import type { RequestHandler } from './$types';

/** POST /api/sub-items → add a new sub-item */
export const POST: RequestHandler = async ({ request }) => {
	const body = await v.readJsonObject(request);
	if (!body || !v.isSafeId(body.componentId) || !v.isSafeId(body.id)) return v.jsonError(400, 'Missing or invalid ids');
	const name = v.name(body.name);
	const maxScore = v.positiveNumber(body.maxScore);
	if (!name.ok) return v.jsonError(400, name.error);
	if (!maxScore.ok) return v.jsonError(400, `maxScore: ${maxScore.error}`);
	const result = addSubItem(body.componentId, body.id, name.value as string, maxScore.value as number);
	return result.ok ? json({ ok: true }) : v.jsonError(result.status, result.error);
};

/** PATCH /api/sub-items → update a sub-item field */
export const PATCH: RequestHandler = async ({ request }) => {
	const body = await v.readJsonObject(request);
	if (!body || !v.isSafeId(body.id)) return v.jsonError(400, 'Missing or invalid id');
	const result = updateSubItemField(body.id, body.field as string, body.value);
	return result.ok ? json({ ok: true }) : v.jsonError(result.status, result.error);
};

/** DELETE /api/sub-items → remove a sub-item (scale targets pointing at it are cleared) */
export const DELETE: RequestHandler = async ({ request }) => {
	const body = await v.readJsonObject(request);
	if (!body || !v.isSafeId(body.id)) return v.jsonError(400, 'Missing or invalid id');
	deleteSubItem(body.id);
	const remaining = v.isSafeId(body.componentId) ? getSubItemCount(body.componentId) : undefined;
	return json({ ok: true, remaining });
};
