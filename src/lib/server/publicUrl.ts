import { base } from '$app/paths';
import { env } from '$env/dynamic/private';

/**
 * Absolute public URL for an app path such as '/mcp'. Uses ORIGIN (set in production) so URLs
 * advertised to OAuth clients don't depend on the Host header; falls back to the request origin.
 */
export function publicUrl(path: string, requestUrl?: URL): string {
	const origin = (env.ORIGIN?.trim() || requestUrl?.origin || 'http://localhost:5173').replace(/\/+$/, '');
	return `${origin}${base}${path}`;
}

/** OAuth issuer: the app root, e.g. https://host/tracksem */
export const issuerUrl = (requestUrl?: URL): string => publicUrl('', requestUrl);

/** The MCP endpoint, which is also the OAuth protected resource identifier */
export const mcpResourceUrl = (requestUrl?: URL): string => publicUrl('/mcp', requestUrl);
