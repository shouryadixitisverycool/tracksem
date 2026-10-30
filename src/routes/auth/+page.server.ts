import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import type { PageServerLoad } from './$types';

/** A path inside this app: starts with a single slash, no backslashes or control characters */
function safeNext(value: string | null): string | null {
	if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
	return /[\u0000-\u001f\u007f]/.test(value) ? null : value;
}

export const load: PageServerLoad = ({ locals, url }) => {
	const next = safeNext(url.searchParams.get('next'));
	if (locals.user) redirect(303, `${base}${next ?? '/'}`);
	return { next };
};
