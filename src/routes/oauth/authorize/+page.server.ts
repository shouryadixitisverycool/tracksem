import { fail, redirect } from '@sveltejs/kit';
import { createAuthCode } from '$lib/server/apiTokens';
import { callbackUrl, checkAuthorizeRequest } from '$lib/server/oauth';
import type { Actions, PageServerLoad } from './$types';
import type { Scope } from '$lib/server/agentAuth';

/** Keeps only string fields (uploaded files are not valid OAuth parameters) */
function stringFields(entries: Iterable<[string, FormDataEntryValue]>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of entries) if (typeof value === 'string') out[key] = value;
	return out;
}

/** Shows the consent page, or redirects errors back to the app */
export const load: PageServerLoad = ({ url, setHeaders }) => {
	// A consent page must never render inside another site's frame (clickjacking)
	setHeaders({ 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" });
	const check = checkAuthorizeRequest(stringFields(url.searchParams), url);
	if (check.kind === 'fatal') return { error: check.message, client: null, scopes: [] as Scope[], params: {} };
	if (check.kind === 'redirect') {
		redirect(
			303,
			callbackUrl(check.redirectUri, { error: check.error, error_description: check.description, state: check.state }, url)
		);
	}
	const { client, scopes, params, redirectUri } = check.request;
	const target = new URL(redirectUri);
	return {
		error: null,
		client: { name: client.name, redirectHost: target.host || target.protocol.replace(/:$/, '') },
		scopes,
		params
	};
};

export const actions: Actions = {
	approve: async ({ request, url, locals }) => {
		const input = stringFields((await request.formData()).entries());
		const check = checkAuthorizeRequest(input, url);
		if (check.kind === 'fatal') return fail(400, { error: check.message });
		if (check.kind === 'redirect') {
			redirect(
				303,
				callbackUrl(check.redirectUri, { error: check.error, error_description: check.description, state: check.state }, url)
			);
		}
		const approved = check.request;
		// The user may narrow write to read, never widen beyond what the app asked for
		const scopes: Scope[] = input.access === 'read' ? ['read'] : approved.scopes;
		const code = createAuthCode({
			clientId: approved.client.id,
			userId: locals.user!.id,
			redirectUri: approved.redirectUri,
			codeChallenge: approved.params.code_challenge,
			scopes,
			resource: approved.params.resource || null
		});
		redirect(303, callbackUrl(approved.redirectUri, { code, state: approved.params.state || null }, url));
	},

	deny: async ({ request, url }) => {
		const input = stringFields((await request.formData()).entries());
		const check = checkAuthorizeRequest(input, url);
		if (check.kind === 'fatal') return fail(400, { error: check.message });
		const redirectUri = check.kind === 'ok' ? check.request.redirectUri : check.redirectUri;
		const state = check.kind === 'ok' ? check.request.params.state : check.state;
		redirect(
			303,
			callbackUrl(redirectUri, { error: 'access_denied', error_description: 'The user denied the request', state: state || null }, url)
		);
	}
};
