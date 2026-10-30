// Pure token helpers (no $lib imports) so node --test can use them.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Scope } from './agentAuth.ts';

/** Prefixes make a token's kind obvious and let lookups skip the wrong table */
export const TOKEN_PREFIX = {
	personal: 'tsm_pat_',
	access: 'tsm_at_',
	refresh: 'tsm_rt_',
	code: 'tsm_ac_',
	clientSecret: 'tsm_cs_'
} as const;

export const ACCESS_TOKEN_TTL_S = 3600;
export const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const AUTH_CODE_TTL_MS = 10 * 60 * 1000;

const MAX_REDIRECT_URI_LENGTH = 2000;
const PKCE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const BLOCKED_SCHEMES = new Set([
	'javascript',
	'data',
	'file',
	'vbscript',
	'blob',
	'about',
	'ws',
	'wss',
	'ftp'
]);

/** A new random token with the given prefix (32 bytes of entropy) */
export function newToken(prefix: string): string {
	return prefix + randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest; tokens are stored only in this form */
export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** Accepts "read write" or ['read', 'write']; "write" implies "read". Unknown values give null. */
export function parseScope(value: unknown): Scope[] | null {
	let parts: unknown[];
	if (typeof value === 'string') parts = value.split(/\s+/).filter(Boolean);
	else if (Array.isArray(value)) parts = value;
	else return null;
	if (parts.length === 0) return null;

	let read = false;
	let write = false;
	for (const part of parts) {
		if (part === 'read') read = true;
		else if (part === 'write') write = true;
		else return null;
	}
	if (write) return ['read', 'write'];
	return read ? ['read'] : null;
}

/** Canonical space-separated form stored in the database */
export function formatScope(scopes: Scope[]): string {
	return scopes.includes('write') ? 'read write' : 'read';
}

/** RFC 8252 and OAuth 2.1 redirect URI rules for registered clients */
export function isAllowedRedirectUri(uri: string): boolean {
	if (typeof uri !== 'string' || uri.length === 0 || uri.length > MAX_REDIRECT_URI_LENGTH) return false;
	if (uri.includes('#')) return false;

	let url: URL;
	try {
		url = new URL(uri);
	} catch {
		return false;
	}
	if (url.username !== '' || url.password !== '') return false;

	const scheme = url.protocol.slice(0, -1).toLowerCase();
	if (scheme === 'https') return true;
	if (scheme === 'http') return LOOPBACK_HOSTS.has(url.hostname);
	return !BLOCKED_SCHEMES.has(scheme);
}

/** Constant-time string comparison (false for different lengths) */
export function safeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	if (left.length !== right.length) return false;
	return timingSafeEqual(left, right);
}

/** RFC 7636 S256: challenge must equal base64url(sha256(verifier)) */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
	if (!PKCE_VERIFIER.test(verifier)) return false;
	const computed = createHash('sha256').update(verifier).digest('base64url');
	return safeEqual(computed, challenge);
}
