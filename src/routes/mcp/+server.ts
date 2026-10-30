import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ALL_TOOLS } from '$lib/server/mcp';
import { handleMcpPayload } from '$lib/server/mcp/protocol';
import type { ServerInfo } from '$lib/server/mcp/protocol';
import { agentRequests } from '$lib/server/authLimits';
import { publicUrl } from '$lib/server/publicUrl';

const INSTRUCTIONS = `tracksem tracks one student's semester grades.
Data: semesters -> courses -> components (weight in % of the course, maxScore, score = raw marks or null if not graded yet; optional sub-items such as Quiz 1/2 with best-of; optional class stats avg/median/max/std dev/full-marks % that feed the curved (relative) grade prediction; scale means the item's marks are worked out from other items or the whole course, copying the % (absolute) or the percentile on its own class curve (relative)).
Start with list_semesters / list_courses / get_course to find ids; never invent ids. Scores are raw marks out of maxScore.
what_do_i_need answers "what do I need on X for grade Y".
Every edit is logged and the user can undo it from the tracksem account page or with undo_change, so tell the user what you changed.
Read-only tokens can't edit.`;

const SERVER: ServerInfo = {
	name: 'tracksem',
	title: 'tracksem grades',
	version: '1.0.0',
	instructions: INSTRUCTIONS
};

const CORS: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
	'Cache-Control': 'no-store'
};

const rpcError = (status: number, code: number, message: string, id: null, headers: Record<string, string> = {}) =>
	json({ jsonrpc: '2.0', id, error: { code, message } }, { status, headers: { ...CORS, ...headers } });

/** CORS preflight */
export const OPTIONS: RequestHandler = async () =>
	new Response(null, {
		status: 204,
		headers: {
			...CORS,
			'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
			'Access-Control-Allow-Headers':
				'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
			'Access-Control-Max-Age': '86400'
		}
	});

/** No server-to-client stream and no sessions, so GET and DELETE are not offered */
export const GET: RequestHandler = async () => new Response(null, { status: 405, headers: { ...CORS, Allow: 'POST' } });
export const DELETE: RequestHandler = async () =>
	new Response(null, { status: 405, headers: { ...CORS, Allow: 'POST' } });

/** JSON-RPC endpoint (stateless, JSON responses only) */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	const agent = locals.agent;
	if (!agent) {
		const resourceMetadata = publicUrl('/.well-known/oauth-protected-resource/mcp', url);
		const invalidToken = request.headers.get('authorization') !== null ? ', error="invalid_token"' : '';
		return rpcError(401, -32001, 'Authentication required', null, {
			'WWW-Authenticate': `Bearer realm="tracksem", resource_metadata="${resourceMetadata}"${invalidToken}`
		});
	}

	if (agentRequests.blocked(agent.credentialId)) {
		return rpcError(429, -32000, 'Too many requests', null, { 'Retry-After': '60' });
	}
	agentRequests.record(agent.credentialId);

	let payload: unknown;
	try {
		payload = await request.json();
	} catch {
		return rpcError(400, -32700, 'Parse error', null);
	}

	const reply = await handleMcpPayload(payload, { auth: agent }, ALL_TOOLS, SERVER);
	if (reply === null) return new Response(null, { status: 202, headers: CORS });
	return json(reply, { headers: CORS });
};
