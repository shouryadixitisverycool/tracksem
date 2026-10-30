import { json } from '@sveltejs/kit';
import { listConnectedApps, revokeConnectedApp } from '$lib/server/apiTokens';
import { isSafeId, jsonError, readJsonObject } from '$lib/server/validation';
import type { RequestHandler } from './$types';

/** GET /api/connected-apps → OAuth apps connected to the user's account */
export const GET: RequestHandler = ({ locals }) => {
	return json({ apps: listConnectedApps(locals.user!.id) });
};

/** DELETE /api/connected-apps → { id } disconnects one app */
export const DELETE: RequestHandler = async ({ request, locals }) => {
	const body = await readJsonObject(request);
	if (!body || !isSafeId(body.id)) return jsonError(400, 'Missing or invalid id');
	return revokeConnectedApp(locals.user!.id, body.id) ? json({ ok: true }) : jsonError(404, 'App not found');
};
