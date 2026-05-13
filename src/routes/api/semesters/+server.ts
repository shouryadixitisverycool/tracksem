import { json } from '@sveltejs/kit';
import {
	getAllSemesters,
	createSemester,
	renameSemester,
	deleteSemester
} from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const semesters = getAllSemesters();
	return json(semesters);
};

export const POST: RequestHandler = async ({ request }) => {
	const { id, label, branch, semester } = await request.json();
	if (!id || !label || !branch || !semester) {
		return json({ error: 'Missing fields' }, { status: 400 });
	}
	const meta = createSemester(id, label, branch, semester);
	return json(meta);
};

export const PATCH: RequestHandler = async ({ request }) => {
	const { id, label } = await request.json();
	if (!id || !label) {
		return json({ error: 'Missing fields' }, { status: 400 });
	}
	renameSemester(id, label);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request }) => {
	const { id } = await request.json();
	if (!id) {
		return json({ error: 'Missing id' }, { status: 400 });
	}
	deleteSemester(id);
	return json({ ok: true });
};
