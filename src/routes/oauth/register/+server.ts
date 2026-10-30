import { registerClient } from '$lib/server/apiTokens';
import { oauthRegistrations } from '$lib/server/authLimits';
import { CLIENT_AUTH_METHODS, oauthError, oauthJson, preflight } from '$lib/server/oauth';
import { isAllowedRedirectUri } from '$lib/server/tokenFormat';
import { readJsonObject } from '$lib/server/validation';
import type { RequestHandler } from './$types';

const GRANT_TYPES = ['authorization_code', 'refresh_token'];
const RESPONSE_TYPES = ['code'];
const MAX_REDIRECT_URIS = 10;
const MAX_NAME_LENGTH = 100;

/** Accepts an optional list that only contains allowed values */
function listOf(value: unknown, fallback: string[], allowed: string[]): string[] | null {
	if (value === undefined) return fallback;
	if (!Array.isArray(value) || value.length === 0) return null;
	return value.every((item) => typeof item === 'string' && allowed.includes(item)) ? (value as string[]) : null;
}

/** POST /oauth/register (RFC 7591 dynamic client registration) */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const address = getClientAddress();
	if (oauthRegistrations.blocked(address)) {
		return oauthError(429, 'invalid_client_metadata', 'Too many client registrations. Try again later');
	}
	oauthRegistrations.record(address);

	const body = await readJsonObject(request);
	if (!body) return oauthError(400, 'invalid_client_metadata', 'Request body must be a JSON object');

	const uris = body.redirect_uris;
	const urisValid =
		Array.isArray(uris) &&
		uris.length >= 1 &&
		uris.length <= MAX_REDIRECT_URIS &&
		uris.every((uri) => typeof uri === 'string' && isAllowedRedirectUri(uri));
	if (!urisValid) return oauthError(400, 'invalid_redirect_uri', `redirect_uris needs 1 to ${MAX_REDIRECT_URIS} allowed URIs`);

	if (body.client_name !== undefined && typeof body.client_name !== 'string') {
		return oauthError(400, 'invalid_client_metadata', 'client_name must be a string');
	}
	const name = (typeof body.client_name === 'string' ? body.client_name.trim() : '').slice(0, MAX_NAME_LENGTH) || 'MCP client';

	const method = body.token_endpoint_auth_method ?? 'none';
	if (typeof method !== 'string' || !CLIENT_AUTH_METHODS.includes(method)) {
		return oauthError(400, 'invalid_client_metadata', `token_endpoint_auth_method must be one of ${CLIENT_AUTH_METHODS.join(', ')}`);
	}

	const grantTypes = listOf(body.grant_types, GRANT_TYPES, GRANT_TYPES);
	if (!grantTypes) return oauthError(400, 'invalid_client_metadata', 'grant_types may only be authorization_code and refresh_token');
	const responseTypes = listOf(body.response_types, RESPONSE_TYPES, RESPONSE_TYPES);
	if (!responseTypes) return oauthError(400, 'invalid_client_metadata', 'response_types may only be code');

	const confidential = method !== 'none';
	const { client, clientSecret } = registerClient({ name, redirectUris: uris as string[], confidential });

	const response: Record<string, unknown> = {
		client_id: client.id,
		client_name: client.name,
		redirect_uris: client.redirectUris,
		token_endpoint_auth_method: method,
		grant_types: grantTypes,
		response_types: responseTypes,
		client_id_issued_at: Math.floor(client.createdAt / 1000)
	};
	if (clientSecret) {
		response.client_secret = clientSecret;
		response.client_secret_expires_at = 0;
	}
	return oauthJson(response, 201);
};

export const OPTIONS: RequestHandler = () => preflight();
