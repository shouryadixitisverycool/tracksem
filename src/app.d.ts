import type { User } from '$lib/server/db';
import type { AgentAuth } from '$lib/server/agentAuth';

declare global {
	namespace App {
		interface Locals {
			user: User | null;
			sessionId: string | null;
			/** Set only on /mcp requests that carry a valid bearer token */
			agent: AgentAuth | null;
		}
		// interface PageData {}
	}
}

export {};
