import { json } from '@sveltejs/kit';
import { checkPassword, checkPersonName, checkRollNumber, hashPassword } from '$lib/server/accounts';
import { registrations } from '$lib/server/authLimits';
import { createUser } from '$lib/server/db';
import { startSession } from '$lib/server/session';
import { jsonError, readJsonObject } from '$lib/server/validation';
import type { RequestHandler } from './$types';

/** POST /api/auth/register → { name, rollNumber, password }; signs the new user in */
export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	const body = await readJsonObject(request);
	if (!body) return jsonError(400, 'Invalid request body');
	const name = checkPersonName(body.name);
	if (!name.ok) return jsonError(400, name.error);
	const rollNumber = checkRollNumber(body.rollNumber);
	if (!rollNumber.ok) return jsonError(400, rollNumber.error);
	const password = checkPassword(body.password);
	if (!password.ok) return jsonError(400, password.error);

	const client = getClientAddress();
	if (registrations.blocked(client)) return jsonError(429, 'Too many new accounts. Try again later');

	const user = createUser(name.value, rollNumber.value, await hashPassword(password.value));
	if (!user) return jsonError(409, 'That roll number already has an account. Sign in instead');
	registrations.record(client);
	startSession(cookies, user.id);
	return json({ user });
};
