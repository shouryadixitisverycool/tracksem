import { json } from '@sveltejs/kit';
import { checkPassword, hashPassword, verifyPassword } from '$lib/server/accounts';
import { passwordChanges } from '$lib/server/authLimits';
import { getPasswordHash, setPasswordHash } from '$lib/server/db';
import { jsonError, readJsonObject } from '$lib/server/validation';
import type { RequestHandler } from './$types';

/** POST /api/auth/password → { currentPassword, newPassword }; signs out the user's other sessions */
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user!;
	const body = await readJsonObject(request);
	if (!body || typeof body.currentPassword !== 'string') return jsonError(400, 'Enter your current password');
	const next = checkPassword(body.newPassword);
	if (!next.ok) return jsonError(400, next.error);
	if (passwordChanges.blocked(user.id)) return jsonError(429, 'Too many failed attempts. Wait 15 minutes');

	const stored = getPasswordHash(user.id);
	if (!stored || !(await verifyPassword(body.currentPassword, stored))) {
		passwordChanges.record(user.id);
		return jsonError(400, 'Current password is wrong');
	}
	passwordChanges.clear(user.id);
	setPasswordHash(user.id, await hashPassword(next.value), locals.sessionId!);
	return json({ ok: true });
};
