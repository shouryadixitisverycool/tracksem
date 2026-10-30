import { json, type Handle } from '@sveltejs/kit';
import { base } from '$app/paths';
import { env } from '$env/dynamic/private';
import { building } from '$app/environment';
import { deleteExpiredSessions } from '$lib/server/db';
import { buildAllowlist, hostnameOf } from '$lib/server/hosts';
import { readSession } from '$lib/server/session';
import { authenticateBearer } from '$lib/server/apiTokens';

let allowlist: Set<string> | null = null;

/** Reachable without signing in (paths relative to the base path) */
const PUBLIC_PAGES = new Set(['/auth']);
const PUBLIC_API = new Set(['/api/auth/login', '/api/auth/register', '/api/health']);
/** Agent endpoints: no session needed, they authenticate with bearer tokens or OAuth client credentials */
const AGENT_ROUTES = new Set(['/mcp', '/oauth/register', '/oauth/token', '/oauth/revoke']);

if (!building) setInterval(deleteExpiredSessions, 6 * 60 * 60 * 1000).unref();

export const handle: Handle = async ({ event, resolve }) => {
	// Reject requests whose Host header isn't ours, which blocks DNS-rebinding attacks
	allowlist ??= buildAllowlist(env.ORIGIN, env.TRACKSEM_ALLOWED_HOSTS);
	const host = event.request.headers.get('host');
	if (!host || !allowlist.has(hostnameOf(host))) {
		return new Response('Forbidden: unexpected Host header', { status: 403 });
	}

	const route = event.url.pathname.slice(base.length) || '/';
	event.locals.agent = null;

	// SvelteKit's CSRF rule (svelte.config.js turns the built-in one off): no cross-site form
	// posts, except to the OAuth endpoints that clients call directly and that never use cookies.
	if (isCrossSiteFormPost(event.request, event.url) && !AGENT_ROUTES.has(route)) {
		return new Response(`Cross-site ${event.request.method} form submissions are forbidden`, { status: 403 });
	}

	// Bearer tokens only work on /mcp, which ignores cookies (CORS is open there, so a cookie
	// session must never authorize it). The route itself answers 401 when locals.agent is null.
	if (AGENT_ROUTES.has(route) || route.startsWith('/.well-known/')) {
		event.locals.user = null;
		event.locals.sessionId = null;
		if (route === '/mcp') event.locals.agent = bearerAuth(event.request.headers.get('authorization'));
		return resolve(event);
	}

	const session = readSession(event.cookies);
	event.locals.user = session?.user ?? null;
	event.locals.sessionId = session?.sessionId ?? null;

	if (!event.locals.user) {
		if (route.startsWith('/api/')) {
			if (!PUBLIC_API.has(route)) return json({ error: 'Sign in first' }, { status: 401 });
		} else if (!PUBLIC_PAGES.has(route) && !route.startsWith('/_app/') && !isStaticAsset(route)) {
			// Remember where to come back to (the OAuth consent page needs this)
			const next = route === '/' ? '' : `?next=${encodeURIComponent(route + event.url.search)}`;
			return redirectTo(`${base}/auth${next}`);
		}
	}

	return resolve(event);
};

const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain', 'application/x-sveltekit-formdata'];

function isCrossSiteFormPost(request: Request, url: URL): boolean {
	if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return false;
	const type = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? '';
	return FORM_TYPES.includes(type) && request.headers.get('origin') !== url.origin;
}

function bearerAuth(header: string | null) {
	const match = header?.match(/^Bearer\s+(\S+)$/i);
	return match ? authenticateBearer(match[1]) : null;
}

function isStaticAsset(route: string): boolean {
	return /^\/[^/]+\.(png|svg|webmanifest|txt|ico)$/.test(route);
}

function redirectTo(location: string): Response {
	return new Response(null, { status: 303, headers: { location } });
}
