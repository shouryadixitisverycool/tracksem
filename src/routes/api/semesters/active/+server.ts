import { json } from '@sveltejs/kit';
import { setActiveSemester } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const { id } = await request.json();
	if (!id) {
		return json({ error: 'Missing id' }, { status: 400 });
	}
	setActiveSemester(id);
	return json({ ok: true });
};
