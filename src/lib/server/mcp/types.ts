import type { AgentAuth, Scope } from '../agentAuth';

/** JSON Schema subset understood by protocol.ts's argument checker */
export type JsonSchema = {
	type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null' | ('string' | 'number' | 'integer' | 'boolean' | 'null' | 'object' | 'array')[];
	description?: string;
	properties?: Record<string, JsonSchema>;
	required?: string[];
	additionalProperties?: boolean;
	items?: JsonSchema;
	enum?: (string | number | null)[];
	minimum?: number;
	maximum?: number;
	minItems?: number;
	maxItems?: number;
	minLength?: number;
	maxLength?: number;
};

export type ToolContext = { auth: AgentAuth };

export type Tool = {
	name: string;
	title: string;
	description: string;
	inputSchema: JsonSchema & { type: 'object' };
	/** 'write' tools are hidden from and refused for read-only tokens */
	scope: Scope;
	annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
	/** Return any JSON-serializable value; it's sent as structuredContent and as text */
	handler: (args: Record<string, unknown>, ctx: ToolContext) => unknown | Promise<unknown>;
};

/** Throw from a handler to return an MCP tool error (isError: true) the agent can read and fix */
export class ToolError extends Error {}
