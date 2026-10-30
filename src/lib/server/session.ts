import type { Cookies } from '@sveltejs/kit';
import { base } from '$app/paths';
import { SESSION_TTL_MS, newSessionToken, sessionIdFor } from './accounts';
import { createSession, deleteSession, extendSession, getSessionUser, type User } from './db';

export const SESSION_COOKIE = 'tracksem_session';

function setCookie(cookies: Cookies, token: string, expiresAt: number): void {
	// `secure` defaults to true; SvelteKit relaxes it for http://localhost during development
	cookies.set(SESSION_COOKIE, token, {
		path: base || '/',
		httpOnly: true,
		sameSite: 'lax',
		expires: new Date(expiresAt)
	});
}

export function startSession(cookies: Cookies, userId: string): void {
	const token = newSessionToken();
	const expiresAt = Date.now() + SESSION_TTL_MS;
	createSession(sessionIdFor(token), userId, expiresAt);
	setCookie(cookies, token, expiresAt);
}

/** The signed-in user; sessions past half their lifetime get extended so active users stay signed in */
export function readSession(cookies: Cookies): { user: User; sessionId: string } | null {
	const token = cookies.get(SESSION_COOKIE);
	if (!token) return null;
	const sessionId = sessionIdFor(token);
	const session = getSessionUser(sessionId);
	if (!session) {
		cookies.delete(SESSION_COOKIE, { path: base || '/' });
		return null;
	}
	if (session.expiresAt - Date.now() < SESSION_TTL_MS / 2) {
		const expiresAt = Date.now() + SESSION_TTL_MS;
		extendSession(sessionId, expiresAt);
		setCookie(cookies, token, expiresAt);
	}
	return { user: session.user, sessionId };
}

export function endSession(cookies: Cookies): void {
	const token = cookies.get(SESSION_COOKIE);
	if (token) deleteSession(sessionIdFor(token));
	cookies.delete(SESSION_COOKIE, { path: base || '/' });
}
