import { json } from '@sveltejs/kit';
import { undoChange } from '$lib/server/audit';
import { isSafeId, jsonError, readJsonObject } from '$lib/server/validation';
import type { RequestHandler } from './$types';

/** POST /api/agent-changes/undo → { id } reverts one agent change */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await readJsonObject(request);
	if (!body || !isSafeId(body.id)) return jsonError(400, 'Missing or invalid id');
	const result = undoChange(locals.user!.id, body.id);
	return result.ok ? json({ ok: true }) : jsonError(result.status, result.error);
};
