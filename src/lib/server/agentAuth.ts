// Kept dependency-free (no $lib imports) so node --test can use it.

/** "write" implies "read" */
export type Scope = 'read' | 'write';

/** Who is calling the MCP endpoint: set on locals.agent by hooks.server.ts from a bearer token */
export type AgentAuth = {
	userId: string;
	scopes: Scope[];
	/** Shown in the change log, e.g. the token name or the OAuth client name */
	label: string;
	kind: 'personal' | 'oauth';
	/** api_tokens.id for personal tokens, oauth_grants.id for OAuth; also the rate-limit key */
	credentialId: string;
};

export const canWrite = (auth: AgentAuth): boolean => auth.scopes.includes('write');
