import { json } from '@sveltejs/kit';
import { listChanges } from '$lib/server/audit';
import { jsonError } from '$lib/server/validation';
import type { RequestHandler } from './$types';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/** GET /api/agent-changes?limit=1..100 → recent changes made by agents, newest first */
export const GET: RequestHandler = ({ locals, url }) => {
	const raw = url.searchParams.get('limit');
	const limit = raw === null ? DEFAULT_LIMIT : Number(raw);
	if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
		return jsonError(400, `limit must be a whole number from 1 to ${MAX_LIMIT}`);
	}
	return json({ changes: listChanges(locals.user!.id, limit) });
};
