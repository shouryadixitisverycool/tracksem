import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupUserDatabase } from '$lib/server/db';
import type { RequestHandler } from './$types';

/** GET /api/export/db → SQLite snapshot holding only the signed-in user's data, as an attachment */
export const GET: RequestHandler = async ({ locals }) => {
	const dir = await mkdtemp(join(tmpdir(), 'tracksem-backup-'));
	try {
		const file = join(dir, 'tracksem.db');
		await backupUserDatabase(locals.user!.id, file);
		const bytes = await readFile(file);
		const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
		return new Response(bytes, {
			headers: {
				'Content-Type': 'application/vnd.sqlite3',
				'Content-Disposition': `attachment; filename="tracksem-${stamp}.db"`,
				'Content-Length': String(bytes.byteLength),
				'Cache-Control': 'no-store'
			}
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
};
