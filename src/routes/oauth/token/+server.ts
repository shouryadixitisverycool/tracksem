import type { RequestHandler } from './$types';
import { consumeAuthCode, createGrant, refreshGrant, type IssuedTokens } from '$lib/server/apiTokens';
import { oauthTokenFailures } from '$lib/server/authLimits';
import { acceptedResource, authenticateClient, oauthError, oauthJson, preflight, readParams } from '$lib/server/oauth';
import { formatScope, parseScope, verifyPkceS256 } from '$lib/server/tokenFormat';

const trimSlash = (value: string): string => value.replace(/\/$/, '');

function tokenResponse(tokens: IssuedTokens): Response {
	return oauthJson({
		access_token: tokens.accessToken,
		token_type: 'Bearer',
		expires_in: tokens.expiresIn,
		refresh_token: tokens.refreshToken,
		scope: formatScope(tokens.scopes)
	});
}

/** POST /oauth/token (RFC 6749 section 3.2) for authorization_code and refresh_token */
export const POST: RequestHandler = async ({ request, url }) => {
	const params = await readParams(request);
	const auth = authenticateClient(request, params);
	if (!auth.ok) return auth.response;
	const client = auth.client;

	if (params.grant_type === 'authorization_code') {
		const { code, code_verifier: verifier, redirect_uri: redirectUri, resource } = params;
		if (!code || !verifier || !redirectUri) {
			return oauthError(400, 'invalid_request', 'code, code_verifier and redirect_uri are required');
		}
		if (!acceptedResource(resource, url)) return oauthError(400, 'invalid_target', 'resource must be this tracksem MCP endpoint');

		// Codes are single use, so consume before checking the rest
		const stored = consumeAuthCode(code);
		const matches =
			stored !== null &&
			stored.clientId === client.id &&
			stored.redirectUri === redirectUri &&
			verifyPkceS256(verifier, stored.codeChallenge) &&
			(!resource || !stored.resource || trimSlash(resource) === trimSlash(stored.resource));
		if (!stored || !matches) {
			oauthTokenFailures.record(client.id);
			return oauthError(400, 'invalid_grant', 'The authorization code is invalid, expired, or already used');
		}
		return tokenResponse(createGrant(stored.userId, client.id, stored.scopes));
	}

	if (params.grant_type === 'refresh_token') {
		const refreshToken = params.refresh_token;
		if (!refreshToken) return oauthError(400, 'invalid_request', 'refresh_token is required');
		// A scope may only narrow the grant. The grant's own scopes are returned, which is the current behavior.
		if (params.scope && !parseScope(params.scope)) return oauthError(400, 'invalid_scope', 'Unknown scope requested');
		const tokens = refreshGrant(refreshToken, client.id);
		if (!tokens) {
			oauthTokenFailures.record(client.id);
			return oauthError(400, 'invalid_grant', 'The refresh token is invalid, expired, or revoked');
		}
		return tokenResponse(tokens);
	}

	return oauthError(400, 'unsupported_grant_type', 'Only authorization_code and refresh_token are supported');
};

export const OPTIONS: RequestHandler = () => preflight();
