import { json } from '@sveltejs/kit';
import { importSemesters } from '$lib/server/db';
import { parseImport } from '$lib/server/importData';
import { jsonError } from '$lib/server/validation';
import type { RequestHandler } from './$types';

const MAX_BYTES = 5 * 1024 * 1024;

/** POST /api/import → a tracksem JSON export; every semester is added as a new semester */
export const POST: RequestHandler = async ({ request }) => {
	const raw = await request.text();
	if (raw.length > MAX_BYTES) return jsonError(413, 'Import file is too large');

	let payload: unknown;
	try {
		payload = JSON.parse(raw);
	} catch {
		return jsonError(400, 'Import file is not valid JSON');
	}

	const parsed = parseImport(payload);
	if (!parsed.ok) return jsonError(400, `Invalid import: ${parsed.error}`);
	return json({ semesters: importSemesters(parsed.semesters) });
};
