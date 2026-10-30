import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkArgs, handleMcpPayload } from './protocol.ts';
import type { ServerInfo } from './protocol.ts';
import { ToolError } from './types.ts';
import type { Tool, ToolContext } from './types.ts';
import type { AgentAuth } from '../agentAuth.ts';

const server: ServerInfo = { name: 'tracksem', version: '1.0.0', title: 'tracksem grades', instructions: 'Test' };

const writeAuth: AgentAuth = { userId: 'u', scopes: ['read', 'write'], label: 't', kind: 'personal', credentialId: 'c' };
const readAuth: AgentAuth = { ...writeAuth, scopes: ['read'] };

const echo: Tool = {
	name: 'echo',
	title: 'Echo',
	description: 'Returns its arguments',
	inputSchema: { type: 'object', properties: { text: { type: 'string', minLength: 1 } }, required: ['text'], additionalProperties: false },
	scope: 'read',
	annotations: { readOnlyHint: true },
	handler: (args) => ({ said: args.text })
};

const scalar: Tool = {
	name: 'scalar',
	title: 'Scalar',
	description: 'Returns a number',
	inputSchema: { type: 'object' },
	scope: 'read',
	handler: () => 42
};

const silent: Tool = {
	name: 'silent',
	title: 'Silent',
	description: 'Returns nothing',
	inputSchema: { type: 'object' },
	scope: 'read',
	handler: () => undefined
};

const fail: Tool = {
	name: 'fail',
	title: 'Fail',
	description: 'Throws a ToolError',
	inputSchema: { type: 'object' },
	scope: 'read',
	handler: () => {
		throw new ToolError('Semester not found');
	}
};

const crash: Tool = {
	name: 'crash',
	title: 'Crash',
	description: 'Throws a plain error',
	inputSchema: { type: 'object' },
	scope: 'read',
	handler: () => {
		throw new Error('database exploded');
	}
};

const save: Tool = {
	name: 'save',
	title: 'Save',
	description: 'Writes something',
	inputSchema: { type: 'object' },
	scope: 'write',
	annotations: { destructiveHint: false },
	handler: () => ({ saved: true })
};

const tools = [echo, scalar, silent, fail, crash, save];
const ctxFor = (auth: AgentAuth): ToolContext => ({ auth });
const ctx = ctxFor(writeAuth);

test('initialize negotiates a supported protocol version', async () => {
	const reply = (await handleMcpPayload(
		{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
		ctx,
		tools,
		server
	)) as { result: Record<string, unknown> };
	assert.equal(reply.result.protocolVersion, '2025-06-18');
	assert.deepEqual(reply.result.capabilities, { tools: { listChanged: false } });
	assert.deepEqual(reply.result.serverInfo, { name: 'tracksem', version: '1.0.0', title: 'tracksem grades' });
	assert.equal(reply.result.instructions, 'Test');
});

test('initialize falls back to the newest version for unknown client versions', async () => {
	const reply = (await handleMcpPayload(
		{ jsonrpc: '2.0', id: 'a', method: 'initialize', params: { protocolVersion: '1999-01-01' } },
		ctx,
		tools,
		server
	)) as { id: string; result: Record<string, unknown> };
	assert.equal(reply.id, 'a');
	assert.equal(reply.result.protocolVersion, '2025-11-25');
});

test('tools/list hides write tools from read-only tokens', async () => {
	const names = async (auth: AgentAuth) => {
		const reply = (await handleMcpPayload(
			{ jsonrpc: '2.0', id: 2, method: 'tools/list' },
			ctxFor(auth),
			tools,
			server
		)) as { result: { tools: { name: string; annotations?: unknown }[]; nextCursor?: string } };
		assert.equal(reply.result.nextCursor, undefined);
		return reply.result.tools.map((tool) => tool.name);
	};
	assert.deepEqual(await names(readAuth), ['echo', 'scalar', 'silent', 'fail', 'crash']);
	assert.ok((await names(writeAuth)).includes('save'));
});

test('tools/list omits annotations when the tool has none', async () => {
	const reply = (await handleMcpPayload({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, ctx, tools, server)) as {
		result: { tools: Record<string, unknown>[] };
	};
	const [withAnnotations, withoutAnnotations] = reply.result.tools;
	assert.deepEqual(withAnnotations.annotations, { readOnlyHint: true });
	assert.equal('annotations' in withoutAnnotations, false);
});

test('tools/call returns text and structured content', async () => {
	const reply = (await handleMcpPayload(
		{ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } },
		ctx,
		tools,
		server
	)) as { result: { content: { type: string; text: string }[]; structuredContent: unknown; isError: boolean } };
	assert.equal(reply.result.isError, false);
	assert.deepEqual(reply.result.structuredContent, { said: 'hi' });
	assert.equal(reply.result.content[0].type, 'text');
	assert.equal(reply.result.content[0].text, JSON.stringify({ said: 'hi' }, null, 2));
});

test('tools/call wraps non-object results and undefined results', async () => {
	const wrapped = (await handleMcpPayload(
		{ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'scalar' } },
		ctx,
		tools,
		server
	)) as { result: { structuredContent: unknown } };
	assert.deepEqual(wrapped.result.structuredContent, { result: 42 });

	const empty = (await handleMcpPayload(
		{ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'silent' } },
		ctx,
		tools,
		server
	)) as { result: { structuredContent: unknown } };
	assert.deepEqual(empty.result.structuredContent, { ok: true });
});

test('tools/call turns ToolError into an isError result', async () => {
	const reply = (await handleMcpPayload(
		{ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'fail' } },
		ctx,
		tools,
		server
	)) as { result: { content: { text: string }[]; isError: boolean } };
	assert.equal(reply.result.isError, true);
	assert.equal(reply.result.content[0].text, 'Semester not found');
});

test('tools/call hides internal error details', async () => {
	const original = console.error;
	console.error = () => {};
	try {
		const reply = (await handleMcpPayload(
			{ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'crash' } },
			ctx,
			tools,
			server
		)) as { result: { content: { text: string }[]; isError: boolean } };
		assert.equal(reply.result.isError, true);
		assert.equal(reply.result.content[0].text, 'Internal error while running crash');
	} finally {
		console.error = original;
	}
});

test('tools/call refuses write tools for read-only tokens', async () => {
	const reply = (await handleMcpPayload(
		{ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'save' } },
		ctxFor(readAuth),
		tools,
		server
	)) as { result: { content: { text: string }[]; isError: boolean } };
	assert.equal(reply.result.isError, true);
	assert.match(reply.result.content[0].text, /read-only/);
});

test('tools/call reports invalid arguments as an isError result', async () => {
	const reply = (await handleMcpPayload(
		{ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'echo', arguments: { text: '' , extra: 1 } } },
		ctx,
		tools,
		server
	)) as { result: { content: { text: string }[]; isError: boolean } };
	assert.equal(reply.result.isError, true);
	assert.equal(
		reply.result.content[0].text,
		'Invalid arguments: text: must be at least 1 characters; extra: unknown property'
	);
});

test('tools/call rejects unknown tools with a JSON-RPC error', async () => {
	const reply = (await handleMcpPayload(
		{ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'nope' } },
		ctx,
		tools,
		server
	)) as { error: { code: number; message: string } };
	assert.equal(reply.error.code, -32602);
	assert.equal(reply.error.message, 'Unknown tool: nope');
});

test('unknown methods return method not found', async () => {
	const reply = (await handleMcpPayload({ jsonrpc: '2.0', id: 12, method: 'sampling/createMessage' }, ctx, tools, server)) as {
		error: { code: number };
	};
	assert.equal(reply.error.code, -32601);
});

test('empty list methods and ping respond', async () => {
	const ping = (await handleMcpPayload({ jsonrpc: '2.0', id: 13, method: 'ping' }, ctx, tools, server)) as { result: unknown };
	assert.deepEqual(ping.result, {});
	const resources = (await handleMcpPayload({ jsonrpc: '2.0', id: 14, method: 'resources/list' }, ctx, tools, server)) as {
		result: unknown;
	};
	assert.deepEqual(resources.result, { resources: [] });
	const prompts = (await handleMcpPayload({ jsonrpc: '2.0', id: 15, method: 'prompts/list' }, ctx, tools, server)) as {
		result: unknown;
	};
	assert.deepEqual(prompts.result, { prompts: [] });
});

test('notifications and client responses produce no reply', async () => {
	assert.equal(await handleMcpPayload({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx, tools, server), null);
	assert.equal(await handleMcpPayload({ jsonrpc: '2.0', id: 3, result: {} }, ctx, tools, server), null);
});

test('malformed messages return invalid request', async () => {
	const notObject = (await handleMcpPayload('hello', ctx, tools, server)) as { id: unknown; error: { code: number } };
	assert.equal(notObject.error.code, -32600);
	assert.equal(notObject.id, null);

	const badVersion = (await handleMcpPayload({ jsonrpc: '1.0', id: 'x', method: 'ping' }, ctx, tools, server)) as {
		id: unknown;
		error: { code: number };
	};
	assert.equal(badVersion.error.code, -32600);
	assert.equal(badVersion.id, 'x');
});

test('empty batch is an invalid request', async () => {
	const reply = (await handleMcpPayload([], ctx, tools, server)) as { error: { code: number } };
	assert.equal(reply.error.code, -32600);
});

test('batch returns replies only for requests', async () => {
	const replies = (await handleMcpPayload(
		[
			{ jsonrpc: '2.0', id: 1, method: 'ping' },
			{ jsonrpc: '2.0', method: 'notifications/initialized' },
			{ jsonrpc: '2.0', id: 2, method: 'prompts/list' }
		],
		ctx,
		tools,
		server
	)) as { id: number }[];
	assert.deepEqual(
		replies.map((reply) => reply.id),
		[1, 2]
	);

	const none = await handleMcpPayload([{ jsonrpc: '2.0', method: 'notifications/initialized' }], ctx, tools, server);
	assert.equal(none, null);
});

const schema = {
	type: 'object' as const,
	properties: {
		score: { type: ['number', 'null'] as ['number', 'null'], minimum: 0, maximum: 100 },
		count: { type: 'integer' as const },
		mode: { type: 'string' as const, enum: ['a', 'b'] },
		tags: { type: 'array' as const, minItems: 1, maxItems: 2, items: { type: 'string' as const } },
		name: { type: 'string' as const, minLength: 2, maxLength: 4 }
	},
	required: ['count'],
	additionalProperties: false
};

test('checkArgs accepts valid values', () => {
	assert.deepEqual(checkArgs(schema, { count: 2, score: null, mode: 'a', tags: ['x'], name: 'abc' }), []);
	assert.deepEqual(checkArgs(schema, { count: 0 }), []);
});

test('checkArgs reports type, required and unknown property problems', () => {
	assert.deepEqual(checkArgs(schema, { count: 1, score: 'high' }), ['score: must be number or null']);
	assert.deepEqual(checkArgs(schema, {}), ['count: is required']);
	assert.deepEqual(checkArgs(schema, { count: 1.5 }), ['count: must be integer']);
	assert.deepEqual(checkArgs(schema, { count: 1, bogus: true }), ['bogus: unknown property']);
	assert.deepEqual(checkArgs(schema, [1]), ['arguments: must be object']);
});

test('checkArgs checks ranges, enums, lengths and items with nested paths', () => {
	assert.deepEqual(checkArgs(schema, { count: 1, score: 101 }), ['score: must be at most 100']);
	assert.deepEqual(checkArgs(schema, { count: 1, mode: 'c' }), ['mode: must be one of "a", "b"']);
	assert.deepEqual(checkArgs(schema, { count: 1, name: 'a' }), ['name: must be at least 2 characters']);
	assert.deepEqual(checkArgs(schema, { count: 1, tags: [] }), ['tags: must have at least 1 items']);
	assert.deepEqual(checkArgs(schema, { count: 1, tags: ['x', 3] }), ['tags[1]: must be string']);
	assert.deepEqual(checkArgs(schema, { count: 1, tags: ['x', 3, 4] }), [
		'tags: must have at most 2 items',
		'tags[1]: must be string',
		'tags[2]: must be string'
	]);
	assert.deepEqual(checkArgs({ type: 'object', properties: { inner: schema } }, { inner: { count: 'x' } }, 'changes'), [
		'changes.inner.count: must be integer'
	]);
});
