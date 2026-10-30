import type { RequestHandler } from './$types';
import { revokeOAuthToken } from '$lib/server/apiTokens';
import { authenticateClient, CORS_HEADERS, presentedCredentials, preflight, readParams } from '$lib/server/oauth';

/** POST /oauth/revoke (RFC 7009). Always 200, even for unknown tokens. */
export const POST: RequestHandler = async ({ request }) => {
	const params = await readParams(request);
	// Clients that identify themselves must authenticate. Anonymous (public) revocation still works.
	if (presentedCredentials(request, params)) {
		const auth = authenticateClient(request, params);
		if (!auth.ok) return auth.response;
	}
	if (params.token) revokeOAuthToken(params.token);
	return new Response(null, { status: 200, headers: { ...CORS_HEADERS, 'cache-control': 'no-store' } });
};

export const OPTIONS: RequestHandler = () => preflight();
