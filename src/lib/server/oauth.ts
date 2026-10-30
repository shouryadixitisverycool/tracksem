import type { Scope } from './agentAuth';
import { getClient, verifyClientSecret, type OAuthClient } from './apiTokens';
import { oauthTokenFailures } from './authLimits';
import { issuerUrl, mcpResourceUrl, publicUrl } from './publicUrl';
import { formatScope, parseScope } from './tokenFormat';

export const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Protocol-Version'
};

export const CLIENT_AUTH_METHODS = ['none', 'client_secret_post', 'client_secret_basic'];

/** JSON with CORS and no caching (responses can carry secrets) */
export function oauthJson(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...CORS_HEADERS, 'content-type': 'application/json', 'cache-control': 'no-store' }
	});
}

/** RFC 6749 section 5.2 error body */
export function oauthError(status: number, error: string, description: string): Response {
	return oauthJson({ error, error_description: description }, status);
}

export function preflight(): Response {
	return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Metadata documents are public and change rarely */
export function metadataJson(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		headers: { ...CORS_HEADERS, 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' }
	});
}

/** Form-encoded or JSON request parameters as strings. Anything that isn't JSON is read as a form. */
export async function readParams(request: Request): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	if ((request.headers.get('content-type') ?? '').includes('application/json')) {
		const body: unknown = await request.json().catch(() => null);
		if (body && typeof body === 'object' && !Array.isArray(body)) {
			for (const [key, value] of Object.entries(body)) if (typeof value === 'string') out[key] = value;
		}
		return out;
	}
	for (const [key, value] of new URLSearchParams(await request.text())) out[key] = value;
	return out;
}

/** Client id and secret from HTTP Basic (url-decoded, RFC 6749 section 2.3.1) or from the form body */
export function presentedCredentials(
	request: Request,
	params: Record<string, string>
): { clientId: string; secret: string | null } | null {
	const basic = parseBasic(request.headers.get('authorization'));
	if (basic) return basic;
	return params.client_id ? { clientId: params.client_id, secret: params.client_secret || null } : null;
}

function parseBasic(header: string | null): { clientId: string; secret: string | null } | null {
	const match = header?.match(/^Basic\s+(\S+)$/i);
	if (!match) return null;
	try {
		const decoded = atob(match[1]);
		const colon = decoded.indexOf(':');
		if (colon < 0) return null;
		return {
			clientId: decodeURIComponent(decoded.slice(0, colon)),
			secret: decodeURIComponent(decoded.slice(colon + 1))
		};
	} catch {
		return null;
	}
}

export type ClientAuth = { ok: true; client: OAuthClient } | { ok: false; response: Response };

/** Checks the presented client credentials. Public clients need only their id; failures are rate limited per client id. */
export function authenticateClient(request: Request, params: Record<string, string>): ClientAuth {
	const creds = presentedCredentials(request, params);
	if (!creds) return { ok: false, response: oauthError(401, 'invalid_client', 'client_id is required') };
	if (oauthTokenFailures.blocked(creds.clientId)) {
		return { ok: false, response: oauthError(429, 'invalid_request', 'Too many failed attempts. Try again in 15 minutes') };
	}
	const client = getClient(creds.clientId);
	const valid =
		client !== null && (!client.confidential || (creds.secret !== null && verifyClientSecret(client.id, creds.secret)));
	if (!client || !valid) {
		oauthTokenFailures.record(creds.clientId);
		return { ok: false, response: oauthError(401, 'invalid_client', 'Client authentication failed') };
	}
	return { ok: true, client };
}

/** Trailing slashes don't change a resource identifier */
const trimSlash = (value: string): string => value.replace(/\/$/, '');

/** An absent resource is fine. Otherwise it must name this MCP endpoint or the issuer. */
export function acceptedResource(value: string | undefined, url: URL): boolean {
	if (!value) return true;
	const given = trimSlash(value);
	return given === trimSlash(mcpResourceUrl(url)) || given === trimSlash(issuerUrl(url));
}

/** RFC 8414 metadata for the authorization server */
export function authorizationServerMetadata(url: URL) {
	return {
		issuer: issuerUrl(url),
		authorization_endpoint: publicUrl('/oauth/authorize', url),
		token_endpoint: publicUrl('/oauth/token', url),
		registration_endpoint: publicUrl('/oauth/register', url),
		revocation_endpoint: publicUrl('/oauth/revoke', url),
		response_types_supported: ['code'],
		response_modes_supported: ['query'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: CLIENT_AUTH_METHODS,
		revocation_endpoint_auth_methods_supported: CLIENT_AUTH_METHODS,
		scopes_supported: ['read', 'write'],
		authorization_response_iss_parameter_supported: true
	};
}

/** RFC 9728 metadata for the MCP endpoint */
export function protectedResourceMetadata(url: URL) {
	return {
		resource: mcpResourceUrl(url),
		authorization_servers: [issuerUrl(url)],
		scopes_supported: ['read', 'write'],
		bearer_methods_supported: ['header'],
		resource_name: 'tracksem'
	};
}

export type AuthorizeRequest = {
	client: OAuthClient;
	redirectUri: string;
	scopes: Scope[];
	/** Validated values, ready to post back to the consent form */
	params: Record<string, string>;
};

export type AuthorizeCheck =
	/** Can't tell the app where to send the user, so the error is shown on the page */
	| { kind: 'fatal'; message: string }
	/** Errors go back to the app's redirect_uri */
	| { kind: 'redirect'; redirectUri: string; error: string; description: string; state: string | null }
	| { kind: 'ok'; request: AuthorizeRequest };

/** Validates an authorization request. Shared by the consent page load and its actions. */
export function checkAuthorizeRequest(input: Record<string, string>, url: URL): AuthorizeCheck {
	const client = input.client_id ? getClient(input.client_id) : null;
	if (!client) return { kind: 'fatal', message: 'This app is not registered with tracksem. Check the connector and try again.' };

	let redirectUri = input.redirect_uri ?? '';
	if (!redirectUri && client.redirectUris.length === 1) redirectUri = client.redirectUris[0];
	if (!client.redirectUris.includes(redirectUri)) {
		return { kind: 'fatal', message: "The redirect address doesn't match the one this app registered." };
	}

	const state = input.state || null;
	const fail = (error: string, description: string): AuthorizeCheck => ({
		kind: 'redirect',
		redirectUri,
		error,
		description,
		state
	});

	if (input.response_type !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported');
	if (!input.code_challenge || input.code_challenge_method !== 'S256') {
		return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required');
	}
	let scopes: Scope[] = ['read', 'write'];
	if (input.scope) {
		const parsed = parseScope(input.scope);
		if (!parsed) return fail('invalid_scope', 'Unknown scope requested');
		scopes = parsed;
	}
	if (!acceptedResource(input.resource, url)) return fail('invalid_target', 'resource must be this tracksem MCP endpoint');

	return {
		kind: 'ok',
		request: {
			client,
			redirectUri,
			scopes,
			params: {
				response_type: 'code',
				client_id: client.id,
				redirect_uri: redirectUri,
				code_challenge: input.code_challenge,
				code_challenge_method: 'S256',
				scope: formatScope(scopes),
				state: state ?? '',
				resource: input.resource ?? ''
			}
		}
	};
}

/** Adds fields (skipping empty ones) and iss to a redirect URI, keeping any query it already has */
export function callbackUrl(redirectUri: string, fields: Record<string, string | null>, url: URL): string {
	const target = new URL(redirectUri);
	for (const [key, value] of Object.entries(fields)) if (value) target.searchParams.set(key, value);
	target.searchParams.set('iss', issuerUrl(url));
	return target.toString();
}
