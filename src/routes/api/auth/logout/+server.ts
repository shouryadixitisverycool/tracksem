import { json } from '@sveltejs/kit';
import { endSession } from '$lib/server/session';
import type { RequestHandler } from './$types';

/** POST /api/auth/logout → ends this session */
export const POST: RequestHandler = async ({ cookies }) => {
	endSession(cookies);
	return json({ ok: true });
};
