import { json } from '@sveltejs/kit';
import { checkRollNumber, dummyPasswordHash, verifyPassword } from '$lib/server/accounts';
import { loginFailures } from '$lib/server/authLimits';
import { findUserByRollNumber } from '$lib/server/db';
import { startSession } from '$lib/server/session';
import { jsonError, readJsonObject } from '$lib/server/validation';
import type { RequestHandler } from './$types';

const WRONG = 'Wrong roll number or password';

/** POST /api/auth/login → { rollNumber, password } */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = await readJsonObject(request);
	if (!body) return jsonError(400, 'Invalid request body');
	const rollNumber = checkRollNumber(body.rollNumber);
	if (!rollNumber.ok || typeof body.password !== 'string') return jsonError(401, WRONG);
	if (loginFailures.blocked(rollNumber.value)) {
		return jsonError(429, 'Too many failed attempts. Wait 15 minutes and try again');
	}

	const user = findUserByRollNumber(rollNumber.value);
	const valid = await verifyPassword(body.password, user?.passwordHash ?? (await dummyPasswordHash()));
	if (!user || !valid) {
		loginFailures.record(rollNumber.value);
		return jsonError(401, WRONG);
	}

	loginFailures.clear(rollNumber.value);
	startSession(cookies, user.id);
	return json({ user: { id: user.id, name: user.name, rollNumber: user.rollNumber } });
};
