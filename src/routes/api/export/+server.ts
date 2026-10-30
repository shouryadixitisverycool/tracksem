import { getExportData } from '$lib/server/db';
import type { RequestHandler } from './$types';

/** GET /api/export → every semester and course as a downloadable JSON file */
export const GET: RequestHandler = async ({ locals }) => {
	const data = getExportData(locals.user!.id);
	const date = data.exportedAt.slice(0, 10);
	return new Response(JSON.stringify(data, null, 2), {
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Content-Disposition': `attachment; filename="tracksem-${date}.json"`,
			'Cache-Control': 'no-store'
		}
	});
};
