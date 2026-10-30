import { json } from '@sveltejs/kit';
import { createPersonalToken, listPersonalTokens, revokePersonalToken } from '$lib/server/apiTokens';
import { isSafeId, jsonError, readJsonObject } from '$lib/server/validation';
import type { RequestHandler } from './$types';

const MAX_ACTIVE_TOKENS = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_DAYS = [30, 90, 365, null] as const;

/** GET /api/tokens → the user's active personal access tokens */
export const GET: RequestHandler = ({ locals }) => {
	return json({ tokens: listPersonalTokens(locals.user!.id) });
};

/** POST /api/tokens → { name, access: 'read' | 'write', expiresInDays: 30 | 90 | 365 | null }; the token is returned once */
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user!.id;
	const body = await readJsonObject(request);
	if (!body) return jsonError(400, 'Invalid request body');

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (name.length < 1 || name.length > 60) return jsonError(400, 'Name must be 1 to 60 characters');
	if (body.access !== 'read' && body.access !== 'write') return jsonError(400, "Access must be 'read' or 'write'");
	if (!EXPIRY_DAYS.includes(body.expiresInDays as (typeof EXPIRY_DAYS)[number])) {
		return jsonError(400, 'Expiry must be 30, 90, 365 days or never');
	}
	if (listPersonalTokens(userId).length >= MAX_ACTIVE_TOKENS) {
		return jsonError(400, `You can have at most ${MAX_ACTIVE_TOKENS} active tokens`);
	}

	const days = body.expiresInDays as number | null;
	const expiresAt = days === null ? null : Date.now() + days * DAY_MS;
	const scopes = body.access === 'write' ? (['read', 'write'] as const) : (['read'] as const);
	const created = createPersonalToken(userId, name, [...scopes], expiresAt);
	return json(created);
};

/** DELETE /api/tokens → { id } revokes one token */
export const DELETE: RequestHandler = async ({ request, locals }) => {
	const body = await readJsonObject(request);
	if (!body || !isSafeId(body.id)) return jsonError(400, 'Missing or invalid id');
	return revokePersonalToken(locals.user!.id, body.id) ? json({ ok: true }) : jsonError(404, 'Token not found');
};
