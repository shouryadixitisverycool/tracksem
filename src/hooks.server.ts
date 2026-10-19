import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { buildAllowlist, hostnameOf } from '$lib/server/hosts';

let allowlist: Set<string> | null = null;

/** Rejects requests whose Host header isn't ours, which blocks DNS-rebinding attacks */
export const handle: Handle = async ({ event, resolve }) => {
	allowlist ??= buildAllowlist(env.ORIGIN, env.TRACKSEM_ALLOWED_HOSTS);
	const host = event.request.headers.get('host');
	if (!host || !allowlist.has(hostnameOf(host))) {
		return new Response('Forbidden: unexpected Host header', { status: 403 });
	}
	return resolve(event);
};
