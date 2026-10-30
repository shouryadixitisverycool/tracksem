import type { AgentAuth, Scope } from './agentAuth';
import { getDb, runInTransaction } from './db';
import {
	ACCESS_TOKEN_TTL_S,
	AUTH_CODE_TTL_MS,
	REFRESH_TOKEN_TTL_MS,
	TOKEN_PREFIX,
	formatScope,
	hashToken,
	newToken,
	parseScope,
	safeEqual
} from './tokenFormat';

export type PersonalTokenInfo = {
	id: string;
	name: string;
	scopes: Scope[];
	createdAt: number;
	lastUsedAt: number | null;
	/** null = never expires */
	expiresAt: number | null;
};

export type OAuthClient = {
	id: string;
	name: string;
	redirectUris: string[];
	/** True when the client registered with client_secret_post/basic and must present its secret */
	confidential: boolean;
	createdAt: number;
};

export type ConnectedApp = {
	/** oauth_grants.id */
	id: string;
	clientName: string;
	scopes: Scope[];
	createdAt: number;
	lastUsedAt: number | null;
};

export type AuthCode = {
	clientId: string;
	userId: string;
	redirectUri: string;
	codeChallenge: string;
	scopes: Scope[];
	resource: string | null;
};

export type IssuedTokens = {
	accessToken: string;
	refreshToken: string;
	/** Seconds */
	expiresIn: number;
	scopes: Scope[];
};

/** last_used_at is only written when the stored value is older than this */
const TOUCH_INTERVAL_MS = 60_000;
const NAME_MAX_LENGTH = 60;

/** Stored scope text back to scopes; unparseable text grants nothing */
const scopesOf = (text: string): Scope[] => parseScope(text) ?? [];

/** Whether last_used_at needs writing */
const shouldTouch = (lastUsedAt: number | null, now: number): boolean =>
	lastUsedAt === null || now - lastUsedAt >= TOUCH_INTERVAL_MS;

// ─── Personal access tokens ─────────────────────────────────────────────────

/** Returns the plaintext token once; only its hash is stored */
export function createPersonalToken(
	userId: string,
	name: string,
	scopes: Scope[],
	expiresAt: number | null
): { token: string; info: PersonalTokenInfo } {
	const trimmed = name.trim();
	if (trimmed.length < 1 || trimmed.length > NAME_MAX_LENGTH) {
		throw new Error(`Token name must be 1-${NAME_MAX_LENGTH} characters`);
	}

	const id = crypto.randomUUID();
	const token = newToken(TOKEN_PREFIX.personal);
	const scope = formatScope(scopes);
	const createdAt = Date.now();

	getDb()
		.prepare(
			`INSERT INTO api_tokens (id, user_id, name, token_hash, scope, created_at, expires_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.run(id, userId, trimmed, hashToken(token), scope, createdAt, expiresAt);

	return {
		token,
		info: {
			id,
			name: trimmed,
			scopes: scopesOf(scope),
			createdAt,
			lastUsedAt: null,
			expiresAt
		}
	};
}

/** Active (not revoked, not expired) tokens, newest first */
export function listPersonalTokens(userId: string): PersonalTokenInfo[] {
	const rows = getDb()
		.prepare(
			`SELECT id, name, scope, created_at, last_used_at, expires_at
			 FROM api_tokens
			 WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
			 ORDER BY created_at DESC`
		)
		.all(userId, Date.now()) as {
		id: string;
		name: string;
		scope: string;
		created_at: number;
		last_used_at: number | null;
		expires_at: number | null;
	}[];

	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		scopes: scopesOf(row.scope),
		createdAt: row.created_at,
		lastUsedAt: row.last_used_at,
		expiresAt: row.expires_at
	}));
}

export function revokePersonalToken(userId: string, tokenId: string): boolean {
	const result = getDb()
		.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
		.run(Date.now(), tokenId, userId);
	return result.changes > 0;
}

// ─── OAuth clients (RFC 7591 dynamic registration) ──────────────────────────

type ClientRow = {
	id: string;
	name: string;
	redirect_uris: string;
	secret_hash: string | null;
	created_at: number;
};

const clientFromRow = (row: ClientRow): OAuthClient => ({
	id: row.id,
	name: row.name,
	redirectUris: JSON.parse(row.redirect_uris) as string[],
	confidential: row.secret_hash !== null,
	createdAt: row.created_at
});

/** Returns the client and, for confidential clients, the plaintext secret (shown once) */
export function registerClient(input: {
	name: string;
	redirectUris: string[];
	confidential: boolean;
}): { client: OAuthClient; clientSecret: string | null } {
	const id = crypto.randomUUID();
	const clientSecret = input.confidential ? newToken(TOKEN_PREFIX.clientSecret) : null;
	const createdAt = Date.now();

	getDb()
		.prepare(
			`INSERT INTO oauth_clients (id, name, redirect_uris, secret_hash, created_at)
			 VALUES (?, ?, ?, ?, ?)`
		)
		.run(
			id,
			input.name,
			JSON.stringify(input.redirectUris),
			clientSecret === null ? null : hashToken(clientSecret),
			createdAt
		);

	return {
		client: {
			id,
			name: input.name,
			redirectUris: input.redirectUris,
			confidential: input.confidential,
			createdAt
		},
		clientSecret
	};
}

export function getClient(clientId: string): OAuthClient | null {
	const row = getDb()
		.prepare('SELECT id, name, redirect_uris, secret_hash, created_at FROM oauth_clients WHERE id = ?')
		.get(clientId) as ClientRow | undefined;
	return row ? clientFromRow(row) : null;
}

/** Constant-time check of a confidential client's secret */
export function verifyClientSecret(clientId: string, secret: string): boolean {
	const row = getDb()
		.prepare('SELECT secret_hash FROM oauth_clients WHERE id = ?')
		.get(clientId) as { secret_hash: string | null } | undefined;
	if (!row?.secret_hash) return false;
	return safeEqual(row.secret_hash, hashToken(secret));
}

// ─── Authorization codes (10 minutes, single use) ───────────────────────────

export function createAuthCode(code: AuthCode): string {
	const value = newToken(TOKEN_PREFIX.code);

	getDb()
		.prepare(
			`INSERT INTO oauth_codes
			 (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			hashToken(value),
			code.clientId,
			code.userId,
			code.redirectUri,
			code.codeChallenge,
			formatScope(code.scopes),
			code.resource,
			Date.now() + AUTH_CODE_TTL_MS
		);

	return value;
}

/** Deletes the code and returns it if it existed and hadn't expired */
export function consumeAuthCode(code: string): AuthCode | null {
	const db = getDb();
	const codeHash = hashToken(code);
	const now = Date.now();

	return runInTransaction(() => {
		const row = db
			.prepare(
				`SELECT client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at
				 FROM oauth_codes WHERE code_hash = ?`
			)
			.get(codeHash) as
			| {
					client_id: string;
					user_id: string;
					redirect_uri: string;
					code_challenge: string;
					scope: string;
					resource: string | null;
					expires_at: number;
			  }
			| undefined;

		db.prepare('DELETE FROM oauth_codes WHERE code_hash = ? OR expires_at <= ?').run(codeHash, now);
		if (!row || row.expires_at <= now) return null;

		return {
			clientId: row.client_id,
			userId: row.user_id,
			redirectUri: row.redirect_uri,
			codeChallenge: row.code_challenge,
			scopes: scopesOf(row.scope),
			resource: row.resource
		};
	});
}

// ─── Grants (one per approved connection) ───────────────────────────────────

/** Inserts an access token for a grant and returns its plaintext */
function insertAccessToken(db: ReturnType<typeof getDb>, grantId: string, now: number): string {
	const accessToken = newToken(TOKEN_PREFIX.access);
	db.prepare('INSERT INTO oauth_access_tokens (token_hash, grant_id, expires_at) VALUES (?, ?, ?)').run(
		hashToken(accessToken),
		grantId,
		now + ACCESS_TOKEN_TTL_S * 1000
	);
	return accessToken;
}

/** New grant with a 1 hour access token and a 90 day refresh token */
export function createGrant(userId: string, clientId: string, scopes: Scope[]): IssuedTokens {
	const db = getDb();
	const id = crypto.randomUUID();
	const refreshToken = newToken(TOKEN_PREFIX.refresh);
	const scope = formatScope(scopes);
	const now = Date.now();

	return runInTransaction(() => {
		db.prepare(
			`INSERT INTO oauth_grants (id, user_id, client_id, scope, refresh_hash, created_at, expires_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		).run(id, userId, clientId, scope, hashToken(refreshToken), now, now + REFRESH_TOKEN_TTL_MS);

		return {
			accessToken: insertAccessToken(db, id, now),
			refreshToken,
			expiresIn: ACCESS_TOKEN_TTL_S,
			scopes: scopesOf(scope)
		};
	});
}

/**
 * Rotates the refresh token (the old one stops working) and extends the grant to 90 days from now.
 * Returns null for unknown/rotated/expired/revoked tokens or a client mismatch.
 */
export function refreshGrant(refreshToken: string, clientId: string): IssuedTokens | null {
	const db = getDb();
	const oldHash = hashToken(refreshToken);

	return runInTransaction(() => {
		const grant = db
			.prepare(
				`SELECT id, client_id, scope, expires_at, revoked_at
				 FROM oauth_grants WHERE refresh_hash = ?`
			)
			.get(oldHash) as
			| { id: string; client_id: string; scope: string; expires_at: number; revoked_at: number | null }
			| undefined;

		const now = Date.now();
		if (!grant || grant.revoked_at !== null || grant.expires_at <= now) return null;
		if (grant.client_id !== clientId) return null;

		const newRefreshToken = newToken(TOKEN_PREFIX.refresh);
		db.prepare(
			`UPDATE oauth_grants SET refresh_hash = ?, expires_at = ?, last_used_at = ?
			 WHERE id = ?`
		).run(hashToken(newRefreshToken), now + REFRESH_TOKEN_TTL_MS, now, grant.id);

		db.prepare('DELETE FROM oauth_access_tokens WHERE grant_id = ? AND expires_at <= ?').run(grant.id, now);

		return {
			accessToken: insertAccessToken(db, grant.id, now),
			refreshToken: newRefreshToken,
			expiresIn: ACCESS_TOKEN_TTL_S,
			scopes: scopesOf(grant.scope)
		};
	});
}

export function listConnectedApps(userId: string): ConnectedApp[] {
	const rows = getDb()
		.prepare(
			`SELECT g.id, c.name AS client_name, g.scope, g.created_at, g.last_used_at
			 FROM oauth_grants g
			 JOIN oauth_clients c ON c.id = g.client_id
			 WHERE g.user_id = ? AND g.revoked_at IS NULL AND g.expires_at > ?
			 ORDER BY g.created_at DESC`
		)
		.all(userId, Date.now()) as {
		id: string;
		client_name: string;
		scope: string;
		created_at: number;
		last_used_at: number | null;
	}[];

	return rows.map((row) => ({
		id: row.id,
		clientName: row.client_name,
		scopes: scopesOf(row.scope),
		createdAt: row.created_at,
		lastUsedAt: row.last_used_at
	}));
}

export function revokeConnectedApp(userId: string, grantId: string): boolean {
	const db = getDb();
	return runInTransaction(() => {
		const result = db
			.prepare('UPDATE oauth_grants SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
			.run(Date.now(), grantId, userId);
		if (result.changes === 0) return false;
		db.prepare('DELETE FROM oauth_access_tokens WHERE grant_id = ?').run(grantId);
		return true;
	});
}

/** RFC 7009: revoke an access or refresh token (the refresh token revokes its grant); unknown tokens are ignored */
export function revokeOAuthToken(token: string): void {
	const db = getDb();
	const hash = hashToken(token);

	if (token.startsWith(TOKEN_PREFIX.access)) {
		db.prepare('DELETE FROM oauth_access_tokens WHERE token_hash = ?').run(hash);
	} else if (token.startsWith(TOKEN_PREFIX.refresh)) {
		runInTransaction(() => {
			const grant = db
				.prepare('SELECT id FROM oauth_grants WHERE refresh_hash = ?')
				.get(hash) as { id: string } | undefined;
			if (!grant) return;
			db.prepare('UPDATE oauth_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(
				Date.now(),
				grant.id
			);
			db.prepare('DELETE FROM oauth_access_tokens WHERE grant_id = ?').run(grant.id);
		});
	}
}

// ─── Bearer lookup ──────────────────────────────────────────────────────────

/** Resolves a personal token or OAuth access token; updates last_used_at at most once a minute */
export function authenticateBearer(token: string): AgentAuth | null {
	const db = getDb();
	const hash = hashToken(token);
	const now = Date.now();

	if (token.startsWith(TOKEN_PREFIX.personal)) {
		const row = db
			.prepare(
				`SELECT id, user_id, name, scope, last_used_at FROM api_tokens
				 WHERE token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`
			)
			.get(hash, now) as
			| { id: string; user_id: string; name: string; scope: string; last_used_at: number | null }
			| undefined;
		if (!row) return null;

		const scopes = parseScope(row.scope);
		if (!scopes) return null;
		if (shouldTouch(row.last_used_at, now)) {
			db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now, row.id);
		}

		return { userId: row.user_id, scopes, label: row.name, kind: 'personal', credentialId: row.id };
	}

	if (token.startsWith(TOKEN_PREFIX.access)) {
		const row = db
			.prepare(
				`SELECT g.id, g.user_id, g.scope, g.last_used_at, c.name AS client_name
				 FROM oauth_access_tokens a
				 JOIN oauth_grants g ON g.id = a.grant_id
				 JOIN oauth_clients c ON c.id = g.client_id
				 WHERE a.token_hash = ? AND a.expires_at > ?
				   AND g.revoked_at IS NULL AND g.expires_at > ?`
			)
			.get(hash, now, now) as
			| {
					id: string;
					user_id: string;
					scope: string;
					last_used_at: number | null;
					client_name: string;
			  }
			| undefined;
		if (!row) return null;

		const scopes = parseScope(row.scope);
		if (!scopes) return null;
		if (shouldTouch(row.last_used_at, now)) {
			db.prepare('UPDATE oauth_grants SET last_used_at = ? WHERE id = ?').run(now, row.id);
		}

		return {
			userId: row.user_id,
			scopes,
			label: row.client_name,
			kind: 'oauth',
			credentialId: row.id
		};
	}

	return null;
}
