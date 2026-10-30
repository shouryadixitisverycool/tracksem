// Pure JSON-RPC / MCP handling (no $lib imports) so node --test can use it.
import { canWrite } from '../agentAuth.ts';
import type { AgentAuth } from '../agentAuth.ts';
import { ToolError } from './types.ts';
import type { JsonSchema, Tool, ToolContext } from './types.ts';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export type ServerInfo = { name: string; version: string; title?: string; instructions: string };

type JsonRpcId = string | number | null;

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

const isObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value);

const errorReply = (id: JsonRpcId, code: number, message: string) => ({
	jsonrpc: '2.0',
	id,
	error: { code, message }
});

const resultReply = (id: JsonRpcId, result: unknown) => ({ jsonrpc: '2.0', id, result });

/** Handle one JSON-RPC message or a batch. Returns null when nothing needs a reply. */
export async function handleMcpPayload(
	payload: unknown,
	ctx: ToolContext,
	tools: Tool[],
	server: ServerInfo
): Promise<unknown | null> {
	if (Array.isArray(payload)) {
		if (payload.length === 0) return errorReply(null, INVALID_REQUEST, 'Invalid request: empty batch');
		const replies: unknown[] = [];
		for (const message of payload) {
			const reply = await handleMessage(message, ctx, tools, server);
			if (reply !== null) replies.push(reply);
		}
		return replies.length > 0 ? replies : null;
	}
	return handleMessage(payload, ctx, tools, server);
}

async function handleMessage(
	message: unknown,
	ctx: ToolContext,
	tools: Tool[],
	server: ServerInfo
): Promise<unknown | null> {
	if (!isObject(message)) return errorReply(null, INVALID_REQUEST, 'Invalid request: expected an object');

	// Client responses to server requests: we never send requests, so ignore them
	if (!('method' in message) && ('result' in message || 'error' in message)) return null;

	const rawId = message.id;
	const id: JsonRpcId = typeof rawId === 'string' || typeof rawId === 'number' ? rawId : null;
	const isNotification = rawId === undefined;

	if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
		return errorReply(id, INVALID_REQUEST, 'Invalid request: expected jsonrpc "2.0" and a string method');
	}

	if (isNotification) return null;

	const params = isObject(message.params) ? message.params : {};
	const auth = ctx.auth;

	switch (message.method) {
		case 'initialize': {
			const requested = params.protocolVersion;
			const protocolVersion =
				typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
					? requested
					: SUPPORTED_PROTOCOL_VERSIONS[0];
			return resultReply(id, {
				protocolVersion,
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: server.name, version: server.version, title: server.title },
				instructions: server.instructions
			});
		}
		case 'ping':
			return resultReply(id, {});
		case 'tools/list':
			return resultReply(id, { tools: listTools(tools, auth) });
		case 'tools/call':
			return callTool(id, params, ctx, tools, auth);
		case 'resources/list':
			return resultReply(id, { resources: [] });
		case 'resources/templates/list':
			return resultReply(id, { resourceTemplates: [] });
		case 'prompts/list':
			return resultReply(id, { prompts: [] });
		case 'logging/setLevel':
			return resultReply(id, {});
		default:
			return errorReply(id, METHOD_NOT_FOUND, `Method not found: ${message.method}`);
	}
}

function listTools(tools: Tool[], auth: AgentAuth) {
	return tools
		.filter((tool) => tool.scope !== 'write' || canWrite(auth))
		.map((tool) => {
			const entry: Record<string, unknown> = {
				name: tool.name,
				title: tool.title,
				description: tool.description,
				inputSchema: tool.inputSchema
			};
			if (tool.annotations !== undefined) entry.annotations = tool.annotations;
			return entry;
		});
}

function toolError(message: string) {
	return { content: [{ type: 'text', text: message }], isError: true };
}

async function callTool(
	id: JsonRpcId,
	params: Record<string, unknown>,
	ctx: ToolContext,
	tools: Tool[],
	auth: AgentAuth
) {
	if (typeof params.name !== 'string') return errorReply(id, INVALID_PARAMS, 'Invalid params: name must be a string');
	const name = params.name;
	const tool = tools.find((candidate) => candidate.name === name);
	if (!tool) return errorReply(id, INVALID_PARAMS, `Unknown tool: ${name}`);

	if (tool.scope === 'write' && !canWrite(auth)) {
		return resultReply(
			id,
			toolError(
				`This token is read-only, so ${name} can't change data. Ask the user for a token with write access.`
			)
		);
	}

	const args = params.arguments === undefined ? {} : params.arguments;
	const problems = checkArgs(tool.inputSchema, args);
	if (problems.length > 0) return resultReply(id, toolError(`Invalid arguments: ${problems.join('; ')}`));

	let value: unknown;
	try {
		value = await tool.handler(args as Record<string, unknown>, ctx);
	} catch (err) {
		if (err instanceof ToolError) return resultReply(id, toolError(err.message));
		console.error(`MCP tool ${name} failed:`, err);
		return resultReply(id, toolError(`Internal error while running ${name}`));
	}

	const shown = value === undefined ? { ok: true } : value;
	return resultReply(id, {
		content: [{ type: 'text', text: JSON.stringify(shown, null, 2) }],
		structuredContent: isObject(shown) ? shown : { result: shown },
		isError: false
	});
}

const matchesType = (type: string, value: unknown): boolean => {
	switch (type) {
		case 'null':
			return value === null;
		case 'string':
			return typeof value === 'string';
		case 'number':
			return typeof value === 'number' && Number.isFinite(value);
		case 'integer':
			return Number.isInteger(value);
		case 'boolean':
			return typeof value === 'boolean';
		case 'array':
			return Array.isArray(value);
		case 'object':
			return isObject(value);
		default:
			return false;
	}
};

const childPath = (path: string, key: string) => (path ? `${path}.${key}` : key);

/** Check a value against the JsonSchema subset in types.ts. Returns human-readable problems (empty when valid). */
export function checkArgs(schema: JsonSchema, value: unknown, path = ''): string[] {
	const where = path || 'arguments';
	const problems: string[] = [];

	if (schema.type !== undefined) {
		const types = Array.isArray(schema.type) ? schema.type : [schema.type];
		if (!types.some((type) => matchesType(type, value))) {
			return [`${where}: must be ${types.join(' or ')}`];
		}
	}

	if (schema.enum !== undefined && !schema.enum.some((option) => option === value)) {
		problems.push(`${where}: must be one of ${schema.enum.map((option) => JSON.stringify(option)).join(', ')}`);
	}

	if (typeof value === 'number') {
		if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${where}: must be at least ${schema.minimum}`);
		if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${where}: must be at most ${schema.maximum}`);
	}

	if (typeof value === 'string') {
		if (schema.minLength !== undefined && value.length < schema.minLength) {
			problems.push(`${where}: must be at least ${schema.minLength} characters`);
		}
		if (schema.maxLength !== undefined && value.length > schema.maxLength) {
			problems.push(`${where}: must be at most ${schema.maxLength} characters`);
		}
	}

	if (Array.isArray(value)) {
		if (schema.minItems !== undefined && value.length < schema.minItems) {
			problems.push(`${where}: must have at least ${schema.minItems} items`);
		}
		if (schema.maxItems !== undefined && value.length > schema.maxItems) {
			problems.push(`${where}: must have at most ${schema.maxItems} items`);
		}
		if (schema.items) {
			value.forEach((item, index) => {
				problems.push(...checkArgs(schema.items as JsonSchema, item, `${where}[${index}]`));
			});
		}
	}

	if (isObject(value)) {
		const properties = schema.properties ?? {};
		for (const key of schema.required ?? []) {
			if (value[key] === undefined) problems.push(`${childPath(path, key)}: is required`);
		}
		for (const [key, propertySchema] of Object.entries(properties)) {
			if (value[key] !== undefined) {
				problems.push(...checkArgs(propertySchema, value[key], childPath(path, key)));
			}
		}
		if (schema.additionalProperties === false) {
			for (const key of Object.keys(value)) {
				if (!(key in properties)) problems.push(`${childPath(path, key)}: unknown property`);
			}
		}
	}

	return problems;
}
